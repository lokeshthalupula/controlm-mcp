import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import type { ToolDefinition } from '../tool-generator.js';
import { classifyJobStatus } from '../copilot/job-monitor.js';

const jobIdField = z
  .string()
  .min(1)
  .describe('Control-M job id, e.g. "ctm_srv:00abc". Obtain it from get_job_status or run_job output.');

export function createWorkloadTools(client: ControlMClient): ToolDefinition[] {
  return [
    {
      name: 'run_job',
      description:
        'Submits a job or folder for immediate execution in Control-M and returns the runId used to track it.',
      inputShape: {
        ctm: z.string().optional().describe('Control-M/Server name.'),
        server: z.string().optional().describe('Alias for ctm, accepted by some fix packs.'),
        folder: z.string().optional().describe('Folder (or SMART folder) containing the job.'),
        jobName: z.string().optional().describe('Job name to run. Omit to order the whole folder.'),
        variables: z
          .array(z.record(z.string()))
          .optional()
          .describe('Auto-edit variables, e.g. [{"%%PARM1":"value"}].'),
        extra: z.record(z.unknown()).optional().describe('Additional request attributes passed through verbatim.'),
      },
      annotations: { title: 'Run Control-M job' },
      handler: async (args: Record<string, unknown>) => {
        const { extra, ...rest } = args as Record<string, unknown> & { extra?: Record<string, unknown> };
        return client.runJob({ ...prune(rest), ...(extra ?? {}) });
      },
    },
    {
      name: 'order_folder',
      description:
        'Orders a folder (or a single job inside it) into the Control-M active jobs database, optionally with a wait-for-order date.',
      inputShape: {
        ctm: z.string().min(1).describe('Control-M/Server name.'),
        folder: z.string().min(1).describe('Folder name to order.'),
        jobName: z.string().optional().describe('Restrict the order to a single job inside the folder.'),
        orderDate: z.string().optional().describe('Order date in YYYYMMDD format. Defaults to the current ODATE.'),
        hold: z.boolean().optional().describe('Order the jobs in HOLD state.'),
        independentFlow: z.boolean().optional().describe('Order the folder as an independent flow.'),
        variables: z.array(z.record(z.string())).optional().describe('Auto-edit variables.'),
      },
      annotations: { title: 'Order Control-M folder' },
      handler: async (args: Record<string, unknown>) => client.orderFolder(prune(args)),
    },
    {
      name: 'get_job_status',
      description:
        'Retrieves job execution status. Provide `runId` to get the status of an entire submission, ' +
        'or `jobId` to get the status of a single job.',
      inputShape: {
        runId: z.string().optional().describe('Run id returned by run_job or order_folder.'),
        jobId: z.string().optional().describe('Specific Control-M job id.'),
        includeOutput: z.boolean().optional().describe('Also fetch job output (OUTPUT/sysout). Requires jobId.'),
      },
      annotations: { title: 'Get Control-M job status', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => {
        if (!args.runId && !args.jobId) {
          return { error: true, code: 'VALIDATION_ERROR', message: 'Provide either runId or jobId.' };
        }

        if (args.runId) {
          return client.getRunStatus(String(args.runId));
        }

        const jobId = String(args.jobId);
        const status = await client.getJobStatus(jobId);
        if (args.includeOutput !== true) return status;

        try {
          return { ...status, output: await client.getJobOutput(jobId) };
        } catch (error) {
          return { ...status, outputError: (error as Error).message };
        }
      },
    },
    {
      name: 'list_active_jobs',
      description:
        'Lists jobs in active flow for a Control-M/Server, including executing, waiting, submitted, queued and held jobs. ' +
        'Read-only; results are filtered from the current job-status response.',
      inputShape: {
        ctm: z.string().min(1).describe('Control-M/Server name, e.g. "CTM-B".'),
        limit: z.number().int().min(1).max(5_000).optional().describe('Maximum jobs to retrieve. Default 1000.'),
      },
      annotations: { title: 'List active Control-M jobs', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => {
        const limit = (args.limit as number | undefined) ?? 1_000;
        const response = await client.listJobStatuses({ ctm: String(args.ctm), limit });
        const statuses = response.statuses ?? [];
        return {
          ctm: String(args.ctm),
          returned: statuses.filter((job) => classifyJobStatus(job.status) === 'active').length,
          total: response.total,
          truncated: response.total !== undefined ? response.total > statuses.length : statuses.length >= limit,
          jobs: statuses.filter((job) => classifyJobStatus(job.status) === 'active'),
        };
      },
    },
    {
      name: 'rerun_job',
      description: 'Reruns a job that already exists in the Control-M active jobs database.',
      inputShape: {
        jobId: jobIdField,
        parameters: z.record(z.unknown()).optional().describe('Optional rerun parameters such as variable overrides.'),
      },
      annotations: { title: 'Rerun Control-M job' },
      handler: async (args: Record<string, unknown>) =>
        client.rerunJob(String(args.jobId), args.parameters as Record<string, unknown> | undefined),
    },
    {
      name: 'hold_job',
      description: 'Places a job in HOLD state, preventing it from being submitted until it is freed.',
      inputShape: { jobId: jobIdField },
      annotations: { title: 'Hold Control-M job', idempotentHint: true },
      handler: async (args: Record<string, unknown>) => client.holdJob(String(args.jobId)),
    },
    {
      name: 'free_job',
      description: 'Releases a job from HOLD state so that Control-M can submit it.',
      inputShape: { jobId: jobIdField },
      annotations: { title: 'Free Control-M job', idempotentHint: true },
      handler: async (args: Record<string, unknown>) => client.freeJob(String(args.jobId)),
    },
    {
      name: 'kill_job',
      description:
        'Terminates a currently executing job. Destructive: the job process is stopped and may leave partial work.',
      inputShape: {
        jobId: jobIdField,
        confirm: z.literal(true).describe('Must be true. Explicit acknowledgement that a running job will be killed.'),
      },
      annotations: { title: 'Kill Control-M job', destructiveHint: true },
      handler: async (args: Record<string, unknown>) => client.killJob(String(args.jobId)),
    },
    {
      name: 'get_job_output',
      description: 'Fetches the OUTPUT (sysout) or the Control-M log of a job run.',
      inputShape: {
        jobId: jobIdField,
        kind: z.enum(['output', 'log']).optional().describe('Which artifact to fetch. Default "output".'),
        runNo: z.number().int().min(1).optional().describe('Specific run number. Defaults to the latest run.'),
        maxChars: z.number().int().min(500).max(200_000).optional().describe('Truncate the result. Default 20000.'),
      },
      annotations: { title: 'Get Control-M job output', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => {
        const jobId = String(args.jobId);
        const maxChars = (args.maxChars as number | undefined) ?? 20_000;
        const content =
          args.kind === 'log'
            ? await client.getJobLog(jobId)
            : await client.getJobOutput(jobId, args.runNo as number | undefined);
        const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        return {
          jobId,
          kind: args.kind ?? 'output',
          truncated: text.length > maxChars,
          content: text.slice(0, maxChars),
        };
      },
    },
  ];
}

function prune(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}
