import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import { analyzeFailure, summarizeFailures, type AnalyzedFailure } from '../copilot/failure-analyzer.js';
import { classifyJobStatus, safeJobOutput } from '../copilot/job-monitor.js';
import { renderReport, type ReportFormat, type ReportSections } from '../copilot/report-builder.js';
import type { Logger } from '../logger.js';
import type { ToolDefinition } from '../tool-generator.js';
import { buildAgentHealthReport } from './agent-health-report.js';
import { buildEnvironmentSummary } from './environment-summary.js';

/**
 * generate_report
 *
 * API calls: GET /config/servers -> GET agents per server -> ping/test per agent
 * (optional) -> GET /run/status for the supplied runs -> GET job output for failures
 * -> POST /forecast (optional).
 */
export function createGenerateReportTool(client: ControlMClient, logger: Logger): ToolDefinition {
  return {
    name: 'generate_report',
    description:
      'Builds a consolidated Control-M operations report combining environment topology, agent health, ' +
      'recent job run outcomes with root-cause analysis, and an optional scheduling forecast. ' +
      'Returns both a rendered document (markdown or plain text) and the structured data behind it.',
    inputShape: {
      title: z.string().optional().describe('Report title. Default "Control-M Operations Report".'),
      format: z.enum(['markdown', 'text', 'json']).optional().describe('Output format. Default "markdown".'),
      includeEnvironment: z.boolean().optional().describe('Include the server/agent topology. Default true.'),
      includeAgentHealth: z.boolean().optional().describe('Include the agent health section. Default true.'),
      probeAgents: z
        .boolean()
        .optional()
        .describe('Actively ping/test agents for the health section. Slower but accurate. Default false.'),
      server: z.string().optional().describe('Restrict the report to one Control-M/Server.'),
      runIds: z
        .array(z.string())
        .optional()
        .describe('Run ids to include, with failure analysis for any job that ended not OK.'),
      includeForecast: z.boolean().optional().describe('Include a scheduling forecast section. Default false.'),
      forecastFolder: z.string().optional().describe('Folder to forecast.'),
      forecastFrom: z.string().optional().describe('Forecast window start.'),
      forecastTo: z.string().optional().describe('Forecast window end.'),
      maxOutputChars: z.number().int().min(500).max(50_000).optional().describe('Output truncation. Default 4000.'),
    },
    annotations: { title: 'Generate Control-M report', readOnlyHint: true, idempotentHint: true },
    handler: async (args: Record<string, unknown>) => {
      const log = logger.child('generateReport');
      const format = (args.format as ReportFormat | undefined) ?? 'markdown';
      const maxOutputChars = (args.maxOutputChars as number | undefined) ?? 4_000;
      const errors: string[] = [];

      const sections: ReportSections = {
        title: (args.title as string | undefined) ?? 'Control-M Operations Report',
      };

      if (args.includeEnvironment !== false) {
        try {
          sections.environment = await buildEnvironmentSummary(client, logger, { includeAgents: true });
        } catch (error) {
          errors.push(`Environment scan failed: ${(error as Error).message}`);
        }
      }

      if (args.includeAgentHealth !== false) {
        try {
          sections.agents = await buildAgentHealthReport(client, logger, {
            server: args.server as string | undefined,
            probe: args.probeAgents === true,
          });
        } catch (error) {
          errors.push(`Agent health scan failed: ${(error as Error).message}`);
        }
      }

      const runIds = (args.runIds as string[] | undefined) ?? [];
      if (runIds.length > 0) {
        const runs: NonNullable<ReportSections['runs']> = [];
        const failures: AnalyzedFailure[] = [];

        for (const runId of runIds.slice(0, 25)) {
          try {
            const status = await client.getRunStatus(runId);
            const statuses = status.statuses ?? [];
            const failed = statuses.filter((job) => classifyJobStatus(job.status) === 'failure');

            runs.push({
              runId,
              folder: statuses[0]?.folder,
              total: statuses.length,
              succeeded: statuses.filter((job) => classifyJobStatus(job.status) === 'success').length,
              failed: failed.length,
            });

            for (const job of failed.slice(0, 10)) {
              if (!job.jobId) continue;
              const output = await safeJobOutput(client, job.jobId, maxOutputChars);
              failures.push(analyzeFailure(job, output.output));
            }
          } catch (error) {
            errors.push(`Run ${runId} could not be read: ${(error as Error).message}`);
            log.warn('generateReport.runFailed', { runId });
          }
        }

        sections.runs = runs;
        if (failures.length > 0) sections.failures = summarizeFailures(failures);
      }

      if (args.includeForecast === true) {
        try {
          const payload: Record<string, unknown> = {};
          for (const [key, value] of [
            ['folder', args.forecastFolder],
            ['from', args.forecastFrom],
            ['to', args.forecastTo],
            ['ctm', args.server],
          ] as const) {
            if (value !== undefined && value !== '') payload[key] = value;
          }
          sections.forecast = await client.createForecast(payload);
        } catch (error) {
          errors.push(`Forecast failed: ${(error as Error).message}`);
        }
      }

      return {
        generatedAt: new Date().toISOString(),
        format,
        errors,
        document: renderReport(sections, format),
        data: sections,
      };
    },
  };
}
