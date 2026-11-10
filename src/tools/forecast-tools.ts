import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import type { Logger } from '../logger.js';
import { poll } from '../polling.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { ForecastResponse } from '../types.js';

const TERMINAL_STATES = new Set(['completed', 'ended', 'finished', 'success', 'succeeded', 'failed', 'error']);

function isTerminal(forecast: ForecastResponse | undefined): boolean {
  if (!forecast) return false;
  const status = String(forecast.status ?? '').toLowerCase();
  if (TERMINAL_STATES.has(status)) return true;
  return forecast.result !== undefined && status !== 'running' && status !== 'inprogress';
}

export function createForecastTools(client: ControlMClient, logger: Logger): ToolDefinition[] {
  return [
    {
      name: 'get_forecast',
      description:
        'Requests a Control-M forecast for a folder or service over a time window and returns the forecast ' +
        'id plus the immediate result when the server answers synchronously.',
      inputShape: {
        ctm: z.string().optional().describe('Control-M/Server name.'),
        folder: z.string().optional().describe('Folder to forecast.'),
        jobName: z.string().optional().describe('Restrict the forecast to a single job.'),
        from: z.string().optional().describe('Window start, ISO-8601 or YYYYMMDDHHmmss.'),
        to: z.string().optional().describe('Window end, ISO-8601 or YYYYMMDDHHmmss.'),
        forecastId: z
          .string()
          .optional()
          .describe('Fetch an existing forecast by id instead of creating a new one.'),
        extra: z.record(z.unknown()).optional().describe('Additional forecast attributes passed through verbatim.'),
      },
      annotations: { title: 'Get Control-M forecast', readOnlyHint: true },
      handler: async (args: Record<string, unknown>) => {
        if (args.forecastId) {
          return client.getForecast(String(args.forecastId));
        }
        const { extra, forecastId: _ignored, ...rest } = args as Record<string, unknown> & {
          extra?: Record<string, unknown>;
          forecastId?: string;
        };
        const payload: Record<string, unknown> = { ...extra };
        for (const [key, value] of Object.entries(rest)) {
          if (value !== undefined && value !== null && value !== '') payload[key] = value;
        }
        return client.createForecast(payload);
      },
    },
    {
      name: 'poll_forecast',
      description:
        'Polls an asynchronous Control-M forecast until it reaches a terminal state or the timeout elapses. ' +
        'Returns the final forecast payload and the polling timeline.',
      inputShape: {
        forecastId: z.string().min(1).describe('Forecast id returned by get_forecast.'),
        timeoutSeconds: z
          .number()
          .int()
          .min(5)
          .max(1_800)
          .optional()
          .describe('Total polling budget in seconds. Default 300.'),
        intervalSeconds: z
          .number()
          .int()
          .min(1)
          .max(120)
          .optional()
          .describe('Initial polling interval in seconds. Default 5. Backs off up to 30s.'),
      },
      annotations: { title: 'Poll Control-M forecast', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => {
        const forecastId = String(args.forecastId);
        const timeline: Array<{ attempt: number; status?: string; progress?: number }> = [];

        const result = await poll<ForecastResponse>({
          operation: `forecast.poll:${forecastId}`,
          logger: logger.child('forecast'),
          timeoutMs: ((args.timeoutSeconds as number | undefined) ?? 300) * 1_000,
          intervalMs: ((args.intervalSeconds as number | undefined) ?? 5) * 1_000,
          maxIntervalMs: 30_000,
          fetch: () => client.getForecast(forecastId),
          isDone: isTerminal,
          onTick: (value, attempt) => {
            timeline.push({ attempt, status: value?.status, progress: value?.progress });
          },
        });

        return {
          forecastId,
          completed: result.completed,
          timedOut: result.timedOut,
          attempts: result.attempts,
          elapsedMs: result.elapsedMs,
          timeline,
          forecast: result.last,
        };
      },
    },
  ];
}
