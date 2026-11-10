import { z } from 'zod';
import type { ControlMClient, MultipartFile } from '../controlm-client.js';
import { fail, runWorkflow, type Step } from '../copilot/orchestrator.js';
import { monitorRun, safeJobOutput } from '../copilot/job-monitor.js';
import { analyzeFailure, summarizeFailures, type AnalyzedFailure } from '../copilot/failure-analyzer.js';
import type { Logger } from '../logger.js';
import { toMultipartFiles, type ToolDefinition } from '../tool-generator.js';
import type { DeployResultItem, RunResponse } from '../types.js';

const FileSchema = z.object({
  field: z.string().optional().describe('Multipart field name. Defaults to "definitionsFile".'),
  filename: z.string().min(1).describe('File name, e.g. "AccountsPayable.json".'),
  content: z.string().min(1).describe('File content (JSON job definitions), or base64 when encoding is "base64".'),
  encoding: z.enum(['utf8', 'base64']).optional().describe('Encoding of `content`. Default "utf8".'),
});

type FileInput = z.infer<typeof FileSchema>;

interface DeployState {
  files: MultipartFile[];
  deployDescriptor?: string;
  ctm?: string;
  folder?: string;
  buildResult?: DeployResultItem[];
  deployResult?: DeployResultItem[];
  smokeRunId?: string;
  smokeFailures?: AnalyzedFailure[];
}

function collect(results: unknown, key: 'errors' | 'warnings'): unknown[] {
  const list = Array.isArray(results) ? results : [results];
  return list.flatMap((item) => {
    const record = item as Record<string, unknown> | null;
    return Array.isArray(record?.[key]) ? (record[key] as unknown[]) : [];
  });
}

function normalizeFiles(files: FileInput[]): MultipartFile[] {
  return toMultipartFiles(
    files.map((file) => ({
      field: file.field ?? 'definitionsFile',
      filename: file.filename,
      content: file.content,
      encoding: file.encoding ?? 'utf8',
      contentType: 'application/json',
    })),
  );
}

/**
 * deploy_application
 *
 * API calls: POST /build (validate) -> POST /deploy -> POST /run/order (smoke test)
 * -> GET /run/status (monitor) -> GET job output + failure analysis for failed jobs.
 */
export function createDeployApplicationWorkflow(client: ControlMClient, logger: Logger): ToolDefinition {
  return {
    name: 'deploy_application',
    description:
      'Safe, multi-stage application deployment. Validates the Control-M definition files, aborts before ' +
      'deploying if validation produced errors, deploys the application, and optionally orders the folder as a ' +
      'smoke test, monitoring the run and analyzing any failures. Returns a per-stage execution report.',
    inputShape: {
      files: z.array(FileSchema).min(1).describe('Job/folder/connection-profile definition files to deploy.'),
      deployDescriptorFile: z
        .string()
        .optional()
        .describe('Deploy descriptor JSON content for environment-specific substitution.'),
      failOnWarnings: z.boolean().optional().describe('Treat build warnings as blocking. Default false.'),
      skipBuild: z.boolean().optional().describe('Deploy without validating first. Not recommended. Default false.'),
      smokeTestFolder: z
        .string()
        .optional()
        .describe('Folder to order after deployment as a post-deploy smoke test.'),
      ctm: z.string().optional().describe('Control-M/Server used for the smoke test order.'),
      smokeTestTimeoutSeconds: z
        .number()
        .int()
        .min(30)
        .max(7_200)
        .optional()
        .describe('How long to monitor the smoke test. Default 900.'),
      timeoutSeconds: z.number().int().min(60).max(14_400).optional().describe('Total budget. Default 3600.'),
    },
    annotations: { title: 'Deploy application workflow' },
    handler: async (args: Record<string, unknown>) => {
      const state: DeployState = {
        files: normalizeFiles(args.files as FileInput[]),
        deployDescriptor: args.deployDescriptorFile as string | undefined,
        ctm: args.ctm as string | undefined,
        folder: args.smokeTestFolder as string | undefined,
      };

      const steps: Array<Step<DeployState>> = [
        {
          name: 'validateDefinitions',
          skip: () => (args.skipBuild === true ? 'skipBuild is true.' : false),
          run: async (current) => {
            current.buildResult = await client.build(current.files);
            const errors = collect(current.buildResult, 'errors');
            const warnings = collect(current.buildResult, 'warnings');

            if (errors.length > 0) {
              fail(`Validation failed with ${errors.length} error(s); deployment was not attempted.`, errors);
            }
            if (args.failOnWarnings === true && warnings.length > 0) {
              fail(`Validation produced ${warnings.length} warning(s) and failOnWarnings is true.`, warnings);
            }
            return { errorCount: errors.length, warningCount: warnings.length, warnings, result: current.buildResult };
          },
        },
        {
          name: 'deployDefinitions',
          run: async (current) => {
            const payload = [...current.files];
            if (current.deployDescriptor) {
              payload.push({
                field: 'deployDescriptorFile',
                filename: 'deployDescriptor.json',
                content: Buffer.from(current.deployDescriptor, 'utf8'),
                contentType: 'application/json',
              });
            }
            current.deployResult = await client.deploy(payload);
            const errors = collect(current.deployResult, 'errors');
            if (errors.length > 0) {
              fail(`Deployment reported ${errors.length} error(s).`, errors);
            }
            return current.deployResult;
          },
        },
        {
          name: 'smokeTestOrder',
          skip: (current) => (current.folder ? false : 'No smokeTestFolder supplied.'),
          run: async (current) => {
            const order: RunResponse = await client.orderFolder({
              folder: current.folder,
              ...(current.ctm ? { ctm: current.ctm } : {}),
            });
            current.smokeRunId = order.runId;
            if (!order.runId) fail('Smoke test order did not return a runId.', order);
            return order;
          },
        },
        {
          name: 'smokeTestMonitor',
          skip: (current) => (current.smokeRunId ? false : 'No smoke test was ordered.'),
          run: async (current, context) => {
            const budgetMs = Math.min(
              ((args.smokeTestTimeoutSeconds as number | undefined) ?? 900) * 1_000,
              Math.max(10_000, context.remainingMs() - 30_000),
            );
            const result = await monitorRun(client, context.logger, current.smokeRunId!, {
              timeoutMs: budgetMs,
              intervalMs: 10_000,
            });

            if (result.failed.length > 0) {
              const analyzed: AnalyzedFailure[] = [];
              for (const job of result.failed) {
                const output = job.jobId ? await safeJobOutput(client, job.jobId) : { output: undefined };
                analyzed.push(analyzeFailure(job, output.output));
              }
              current.smokeFailures = analyzed;
              fail(
                `Smoke test failed: ${result.failed.length} of ${result.statuses.length} job(s) ended not OK.`,
                summarizeFailures(analyzed),
              );
            }
            if (!result.completed) {
              context.note('Smoke test did not finish within its budget; deployment itself succeeded.');
            }
            return {
              completed: result.completed,
              totals: {
                jobs: result.statuses.length,
                succeeded: result.succeeded.length,
                failed: result.failed.length,
                active: result.active.length,
              },
              statuses: result.statuses,
            };
          },
        },
      ];

      return runWorkflow<DeployState>({
        name: 'deploy_application',
        logger,
        state,
        steps,
        timeoutMs: ((args.timeoutSeconds as number | undefined) ?? 3_600) * 1_000,
        summarize: (current, records, success) => {
          if (success) {
            const smoke = current.smokeRunId ? ` Smoke test run ${current.smokeRunId} passed.` : '';
            return `Deployed ${current.files.length} definition file(s) successfully.${smoke}`;
          }
          const blocking = records.find((record) => record.status === 'failed' && !record.tolerated);
          if (blocking?.step === 'validateDefinitions') {
            return 'Deployment aborted during validation. Nothing was deployed; fix the reported errors and retry.';
          }
          if (blocking?.step === 'smokeTestOrder' || blocking?.step === 'smokeTestMonitor') {
            return 'Definitions deployed, but the post-deploy smoke test failed. Review the failure analysis and consider rolling back.';
          }
          return 'Deployment failed. Review the deployDefinitions step errors.';
        },
      });
    },
  };
}

interface RunState {
  ctm?: string;
  folder?: string;
  jobName?: string;
  variables?: Array<Record<string, string>>;
  runId?: string;
  submission?: RunResponse;
  failures?: AnalyzedFailure[];
  rerunAttempted?: boolean;
}

/**
 * run_and_monitor_job
 *
 * API calls: POST /run -> GET /run/status (poll to completion) -> GET job output for
 * every failed job -> heuristic failure analysis -> optional POST /run/job/{id}/rerun
 * -> GET /run/status again.
 */
export function createRunJobWorkflow(client: ControlMClient, logger: Logger): ToolDefinition {
  return {
    name: 'run_and_monitor_job',
    description:
      'Submits a Control-M job or folder, monitors every job in the run to completion, retrieves the output of ' +
      'any failed job, classifies the failures with root-cause heuristics, and can automatically rerun jobs ' +
      'whose failure category is transient. Returns the full run status plus a diagnosis.',
    inputShape: {
      ctm: z.string().optional().describe('Control-M/Server name.'),
      folder: z.string().optional().describe('Folder containing the job.'),
      jobName: z.string().optional().describe('Job name. Omit to run the whole folder.'),
      variables: z.array(z.record(z.string())).optional().describe('Auto-edit variables, e.g. [{"%%PARM1":"x"}].'),
      runId: z.string().optional().describe('Monitor an existing run instead of submitting a new one.'),
      timeoutSeconds: z.number().int().min(30).max(21_600).optional().describe('Monitoring budget. Default 1800.'),
      intervalSeconds: z.number().int().min(2).max(300).optional().describe('Initial poll interval. Default 10.'),
      autoRerunOnTransientFailure: z
        .boolean()
        .optional()
        .describe('Rerun once when every failure is classified as transient (network/timeout/capacity). Default false.'),
      maxOutputChars: z.number().int().min(500).max(100_000).optional().describe('Output truncation. Default 8000.'),
    },
    annotations: { title: 'Run job workflow' },
    handler: async (args: Record<string, unknown>) => {
      const state: RunState = {
        ctm: args.ctm as string | undefined,
        folder: args.folder as string | undefined,
        jobName: args.jobName as string | undefined,
        variables: args.variables as Array<Record<string, string>> | undefined,
        runId: args.runId as string | undefined,
      };

      const timeoutMs = ((args.timeoutSeconds as number | undefined) ?? 1_800) * 1_000;
      const intervalMs = ((args.intervalSeconds as number | undefined) ?? 10) * 1_000;
      const maxOutputChars = (args.maxOutputChars as number | undefined) ?? 8_000;

      const analyzeRun = async (
        current: RunState,
        logger_: Logger,
        budgetMs: number,
      ): Promise<Record<string, unknown>> => {
        const result = await monitorRun(client, logger_, current.runId!, { timeoutMs: budgetMs, intervalMs });

        const analyzed: AnalyzedFailure[] = [];
        for (const job of result.failed) {
          const output = job.jobId
            ? await safeJobOutput(client, job.jobId, maxOutputChars)
            : { output: undefined, truncated: false };
          analyzed.push(analyzeFailure(job, output.output));
        }
        current.failures = analyzed;

        return {
          completed: result.completed,
          timedOut: result.timedOut,
          attempts: result.attempts,
          elapsedMs: result.elapsedMs,
          totals: {
            jobs: result.statuses.length,
            succeeded: result.succeeded.length,
            failed: result.failed.length,
            active: result.active.length,
          },
          statuses: result.statuses,
          analysis: analyzed.length > 0 ? summarizeFailures(analyzed) : undefined,
          timeline: result.timeline,
        };
      };

      const steps: Array<Step<RunState>> = [
        {
          name: 'submitRun',
          skip: (current) => (current.runId ? `Monitoring existing run ${current.runId}.` : false),
          run: async (current) => {
            if (!current.folder && !current.jobName) {
              fail('Provide folder and/or jobName, or an existing runId.');
            }
            const payload: Record<string, unknown> = {};
            for (const key of ['ctm', 'folder', 'jobName', 'variables'] as const) {
              if (current[key] !== undefined) payload[key] = current[key];
            }
            current.submission = await client.runJob(payload);
            current.runId = current.submission.runId;
            if (!current.runId) fail('Control-M did not return a runId for the submission.', current.submission);
            return current.submission;
          },
        },
        {
          name: 'monitorAndAnalyze',
          run: async (current, context) => {
            const outcome = await analyzeRun(current, context.logger, Math.max(10_000, context.remainingMs() - 30_000));
            const failures = current.failures ?? [];
            if (failures.length > 0) {
              fail(`${failures.length} job(s) ended not OK.`, outcome);
            }
            if (outcome.completed !== true) {
              fail('The run did not reach a terminal state within the monitoring budget.', outcome);
            }
            return outcome;
          },
        },
        {
          name: 'autoRerunTransientFailures',
          skip: (current) => {
            if (args.autoRerunOnTransientFailure !== true) return 'autoRerunOnTransientFailure is false.';
            const failures = current.failures ?? [];
            if (failures.length === 0) return 'No failures to rerun.';
            const transient = failures.every((failure) =>
              ['NETWORK', 'TIMEOUT', 'CAPACITY', 'AGENT_UNAVAILABLE'].includes(failure.category),
            );
            return transient ? false : 'At least one failure is not transient; manual review required.';
          },
          run: async (current, context) => {
            const reruns: unknown[] = [];
            for (const failure of current.failures ?? []) {
              if (!failure.jobId) continue;
              reruns.push({ jobId: failure.jobId, result: await client.rerunJob(failure.jobId) });
            }
            current.rerunAttempted = true;
            context.note(`Reran ${reruns.length} job(s) after a transient failure classification.`);
            const outcome = await analyzeRun(current, context.logger, Math.max(10_000, context.remainingMs() - 15_000));
            if ((current.failures ?? []).length > 0) {
              fail('Jobs still failed after the automatic rerun.', outcome);
            }
            return { reruns, outcome };
          },
        },
      ];

      return runWorkflow<RunState>({
        name: 'run_and_monitor_job',
        logger,
        state,
        steps,
        timeoutMs,
        summarize: (current, _records, success) => {
          if (success) {
            return `Run ${current.runId} completed successfully${
              current.rerunAttempted ? ' after an automatic rerun of transient failures' : ''
            }.`;
          }
          const failures = current.failures ?? [];
          if (failures.length === 0) {
            return `Run ${current.runId ?? '(not submitted)'} did not complete. See the failed step for details.`;
          }
          const summary = summarizeFailures(failures);
          return `Run ${current.runId} had ${failures.length} failed job(s). Dominant cause: ${
            summary.dominantCategory
          }. Next action: ${summary.consolidatedActions[0] ?? 'inspect the job output.'}`;
        },
      });
    },
  };
}
