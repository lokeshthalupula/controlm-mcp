import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import { analyzeAlerts, extractAlerts } from '../copilot/alert-analyzer.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { poll } from '../polling.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { ReportRunResponse } from '../types.js';

const REPORT_TERMINAL = /(completed|ended|finished|success|succeeded|failed|error)/i;

export function createReportingTools(
  client: ControlMClient,
  config: AppConfig,
  logger: Logger,
): ToolDefinition[] {
  return [
    {
      name: 'list_reports',
      description:
        'Lists the Control-M report definitions available to the authenticated user ' +
        '(Control-M Automation API: GET /reports).',
      inputShape: {
        search: z.string().optional().describe('Case-insensitive filter over report name, description or owner.'),
      },
      annotations: { title: 'List Control-M reports', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => {
        const raw = await client.listReports();
        const list = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>)?.reports as unknown[]) ?? [];
        const search = typeof args.search === 'string' ? args.search.toLowerCase() : undefined;

        const reports = list.filter((entry) => {
          if (!search) return true;
          const record = entry as Record<string, unknown>;
          return [record.name, record.description, record.owner]
            .map((value) => String(value ?? '').toLowerCase())
            .some((value) => value.includes(search));
        });

        return { total: list.length, returned: reports.length, reports };
      },
    },
    {
      name: 'run_report',
      description:
        'Runs a Control-M report, optionally waiting for it to finish and returning the generated content ' +
        '(POST /report/{name}/run -> GET /report/status/{runId} -> GET /report/{runId}/download).',
      inputShape: {
        name: z.string().min(1).describe('Report definition name as returned by list_reports.'),
        format: z.enum(['CSV', 'PDF', 'HTML', 'JSON', 'XLSX']).optional().describe('Output format. Default "CSV".'),
        parameters: z
          .record(z.unknown())
          .optional()
          .describe('Report parameters, e.g. {"fromDate":"20260101","toDate":"20260131"}.'),
        wait: z.boolean().optional().describe('Poll until the report finishes. Default true.'),
        download: z.boolean().optional().describe('Download the report content once complete. Default true.'),
        maxChars: z.number().int().min(500).max(200_000).optional().describe('Truncate downloaded content. Default 50000.'),
        timeoutSeconds: z.number().int().min(10).max(3_600).optional().describe('Polling budget. Default 600.'),
      },
      annotations: { title: 'Run Control-M report' },
      handler: async (args: Record<string, unknown>) => {
        const name = String(args.name);
        const format = (args.format as string | undefined) ?? 'CSV';
        const maxChars = (args.maxChars as number | undefined) ?? 50_000;

        const submission: ReportRunResponse = await client.runReport(
          name,
          format,
          args.parameters as Record<string, unknown> | undefined,
        );
        const runId = submission.runId ?? submission.reportId;

        if (args.wait === false || !runId) {
          return { report: name, format, runId, submission };
        }

        const result = await poll<ReportRunResponse>({
          operation: `report.poll:${runId}`,
          logger: logger.child('reporting'),
          timeoutMs: ((args.timeoutSeconds as number | undefined) ?? 600) * 1_000,
          intervalMs: 5_000,
          maxIntervalMs: 30_000,
          fetch: () => client.getReportStatus(runId),
          isDone: (value) => REPORT_TERMINAL.test(String(value?.status ?? '')),
        });

        const base = {
          report: name,
          format,
          runId,
          completed: result.completed,
          timedOut: result.timedOut,
          status: result.last?.status,
        };

        if (!result.completed || args.download === false) return base;

        try {
          const content = await client.downloadReport(runId);
          const text = typeof content === 'string' ? content : JSON.stringify(content);
          return { ...base, truncated: text.length > maxChars, content: text.slice(0, maxChars) };
        } catch (error) {
          return { ...base, downloadError: (error as Error).message };
        }
      },
    },
    {
      name: 'report_status',
      description: 'Returns the status of a previously submitted Control-M report run.',
      inputShape: {
        runId: z.string().min(1).describe('Report run id returned by run_report.'),
      },
      annotations: { title: 'Control-M report status', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => client.getReportStatus(String(args.runId)),
    },
    {
      name: 'list_alerts',
      description:
        'Retrieves Control-M alerts and clusters them by theme and severity, highlighting nodes that appear ' +
        'repeatedly so a single infrastructure root cause can be identified (GET /run/alerts).',
      inputShape: {
        ctm: z.string().optional().describe('Control-M/Server name.'),
        severity: z.string().optional().describe('Severity filter as accepted by the API, e.g. "V", "R", "U".'),
        status: z.string().optional().describe('Alert status filter, e.g. "Not_Noticed", "Reviewed", "Closed".'),
        jobname: z.string().optional().describe('Restrict alerts to one job name.'),
        fromTime: z.string().optional().describe('Window start, YYYYMMDDHHmmss.'),
        toTime: z.string().optional().describe('Window end, YYYYMMDDHHmmss.'),
        limit: z.number().int().min(1).max(1_000).optional().describe('Maximum alerts to retrieve.'),
        includeRaw: z.boolean().optional().describe('Include the raw alert records. Default false.'),
      },
      annotations: { title: 'List and analyze Control-M alerts', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => {
        const raw = await client.listAlerts({
          ctm: args.ctm as string | undefined,
          severity: args.severity as string | undefined,
          status: args.status as string | undefined,
          jobname: args.jobname as string | undefined,
          fromTime: args.fromTime as string | undefined,
          toTime: args.toTime as string | undefined,
          limit: (args.limit as number | undefined) ?? config.workflows.alertLimit,
        });

        const alerts = extractAlerts(raw);
        return {
          analysis: analyzeAlerts(alerts),
          alerts: args.includeRaw === true ? alerts : undefined,
        };
      },
    },
    {
      name: 'update_alerts',
      description:
        'Updates the handling status of one or more Control-M alerts, for example marking them reviewed or ' +
        'closed after remediation (PUT /run/alerts).',
      inputShape: {
        alertIds: z.array(z.union([z.string(), z.number()])).min(1).describe('Alert ids to update.'),
        status: z
          .enum(['Reviewed', 'Not_Noticed', 'Closed', 'Handled'])
          .describe('New alert handling status.'),
        comment: z.string().optional().describe('Audit comment recorded with the status change.'),
      },
      annotations: { title: 'Update Control-M alerts', idempotentHint: true },
      handler: async (args: Record<string, unknown>) =>
        client.updateAlerts(
          args.alertIds as Array<string | number>,
          String(args.status),
          args.comment as string | undefined,
        ),
    },
  ];
}
