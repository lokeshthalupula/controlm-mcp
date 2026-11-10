import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import { fail, runWorkflow, type Step } from '../copilot/orchestrator.js';
import type { Logger } from '../logger.js';
import { poll } from '../polling.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { ForecastResponse } from '../types.js';

const TERMINAL = /(completed|ended|finished|success|succeeded|failed|error)/i;

interface ForecastState {
  folder?: string;
  ctm?: string;
  from?: string;
  to?: string;
  forecastId?: string;
  forecast?: ForecastResponse;
  occurrences: ForecastOccurrence[];
}

interface ForecastOccurrence {
  jobName?: string;
  folder?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  [key: string]: unknown;
}

function parseTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  // Control-M also emits YYYYMMDDHHmmss.
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(value.trim());
  if (!match) return undefined;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? '0'),
    Number(match[5] ?? '0'),
    Number(match[6] ?? '0'),
  );
}

/** Walks an arbitrary forecast payload and harvests anything that looks like a job occurrence. */
function extractOccurrences(payload: unknown, depth = 0): ForecastOccurrence[] {
  if (!payload || depth > 6) return [];

  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => extractOccurrences(entry, depth + 1));
  }

  if (typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;
  const startRaw = record.startTime ?? record.start ?? record.estimatedStartTime ?? record.from;
  const endRaw = record.endTime ?? record.end ?? record.estimatedEndTime ?? record.to;
  const name = record.jobName ?? record.name ?? record.job;

  if (name && (startRaw || endRaw)) {
    const start = parseTime(startRaw);
    const end = parseTime(endRaw);
    return [
      {
        jobName: String(name),
        folder: record.folder ? String(record.folder) : undefined,
        startTime: startRaw ? String(startRaw) : undefined,
        endTime: endRaw ? String(endRaw) : undefined,
        durationMinutes:
          start !== undefined && end !== undefined ? Math.max(0, Math.round((end - start) / 60_000)) : undefined,
      },
    ];
  }

  return Object.values(record).flatMap((value) => extractOccurrences(value, depth + 1));
}

function analyze(occurrences: ForecastOccurrence[]) {
  const withStart = occurrences
    .map((entry) => ({ entry, start: parseTime(entry.startTime) }))
    .filter((item): item is { entry: ForecastOccurrence; start: number } => item.start !== undefined)
    .sort((a, b) => a.start - b.start);

  const hourly = new Map<string, number>();
  for (const { start } of withStart) {
    const hour = new Date(start).toISOString().slice(0, 13);
    hourly.set(hour, (hourly.get(hour) ?? 0) + 1);
  }

  const buckets = [...hourly.entries()]
    .map(([hour, count]) => ({ hour: `${hour}:00Z`, jobs: count }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  const peak = [...buckets].sort((a, b) => b.jobs - a.jobs)[0];
  const longest = [...occurrences]
    .filter((entry) => entry.durationMinutes !== undefined)
    .sort((a, b) => (b.durationMinutes ?? 0) - (a.durationMinutes ?? 0))
    .slice(0, 10);

  return {
    totalOccurrences: occurrences.length,
    windowStart: withStart[0] ? new Date(withStart[0].start).toISOString() : undefined,
    windowEnd: withStart.length > 0 ? new Date(withStart[withStart.length - 1]!.start).toISOString() : undefined,
    hourlyDistribution: buckets,
    peakHour: peak,
    longestRunningJobs: longest,
    observations: buildObservations(buckets, peak, longest),
  };
}

function buildObservations(
  buckets: Array<{ hour: string; jobs: number }>,
  peak: { hour: string; jobs: number } | undefined,
  longest: ForecastOccurrence[],
): string[] {
  const notes: string[] = [];
  if (!peak) {
    notes.push('The forecast returned no parsable job start times; inspect the raw payload.');
    return notes;
  }

  const average = buckets.reduce((total, entry) => total + entry.jobs, 0) / buckets.length;
  notes.push(`Peak load is ${peak.jobs} job(s) at ${peak.hour} against an hourly average of ${average.toFixed(1)}.`);
  if (peak.jobs > average * 2.5) {
    notes.push('Peak hour is more than 2.5x the average: check agent capacity and quantitative resources for that window.');
  }
  const idle = buckets.filter((entry) => entry.jobs === 0).length;
  if (idle > 0) notes.push(`${idle} hour(s) in the window have no scheduled work and could absorb rescheduled load.`);
  if (longest[0]?.durationMinutes !== undefined) {
    notes.push(
      `Longest forecast job is "${longest[0].jobName}" at ~${longest[0].durationMinutes} minute(s); it is the critical-path candidate.`,
    );
  }
  return notes;
}

/**
 * forecast_application
 *
 * API calls: POST /forecast -> GET /forecast/{forecastId} (polled to a terminal state)
 * -> local distribution and critical-path analysis of the returned occurrences.
 */
export function createForecastApplicationTool(client: ControlMClient, logger: Logger): ToolDefinition {
  return {
    name: 'forecast_application',
    description:
      'Runs and interprets a Control-M scheduling forecast for an application folder. Submits the forecast, ' +
      'polls it to completion, then analyses the predicted run plan: hourly job distribution, peak load window, ' +
      'longest-running jobs and capacity observations. Use it before a release or to assess schedule impact.',
    inputShape: {
      folder: z.string().optional().describe('Folder (application) to forecast.'),
      ctm: z.string().optional().describe('Control-M/Server name.'),
      jobName: z.string().optional().describe('Restrict the forecast to a single job.'),
      from: z.string().optional().describe('Window start, ISO-8601 or YYYYMMDDHHmmss.'),
      to: z.string().optional().describe('Window end, ISO-8601 or YYYYMMDDHHmmss.'),
      forecastId: z.string().optional().describe('Analyse an existing forecast instead of creating a new one.'),
      extra: z.record(z.unknown()).optional().describe('Additional forecast attributes passed through verbatim.'),
      includeRawForecast: z.boolean().optional().describe('Include the raw API payload. Default false.'),
      timeoutSeconds: z.number().int().min(10).max(3_600).optional().describe('Polling budget. Default 600.'),
      intervalSeconds: z.number().int().min(1).max(120).optional().describe('Initial poll interval. Default 5.'),
    },
    annotations: { title: 'Forecast application schedule', readOnlyHint: true, idempotentHint: true },
    handler: async (args: Record<string, unknown>) => {
      const state: ForecastState = {
        folder: args.folder as string | undefined,
        ctm: args.ctm as string | undefined,
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        forecastId: args.forecastId as string | undefined,
        occurrences: [],
      };

      const steps: Array<Step<ForecastState>> = [
        {
          name: 'submitForecast',
          skip: (current) => (current.forecastId ? `Using existing forecast ${current.forecastId}.` : false),
          run: async (current) => {
            const payload: Record<string, unknown> = {
              ...((args.extra as Record<string, unknown> | undefined) ?? {}),
            };
            for (const key of ['folder', 'ctm', 'from', 'to'] as const) {
              if (current[key] !== undefined && current[key] !== '') payload[key] = current[key];
            }
            if (args.jobName !== undefined) payload.jobName = args.jobName;
            if (Object.keys(payload).length === 0) {
              fail('Provide at least a folder, a job name, or a from/to window to forecast.');
            }

            current.forecast = await client.createForecast(payload);
            current.forecastId = current.forecast.forecastId;
            return current.forecast;
          },
        },
        {
          name: 'awaitForecast',
          skip: (current) =>
            current.forecastId ? false : 'Forecast returned inline; nothing to poll.',
          run: async (current, context) => {
            const result = await poll<ForecastResponse>({
              operation: `forecast.poll:${current.forecastId}`,
              logger: context.logger,
              timeoutMs: Math.min(
                ((args.timeoutSeconds as number | undefined) ?? 600) * 1_000,
                Math.max(5_000, context.remainingMs()),
              ),
              intervalMs: ((args.intervalSeconds as number | undefined) ?? 5) * 1_000,
              maxIntervalMs: 30_000,
              fetch: () => client.getForecast(current.forecastId!),
              isDone: (value) =>
                TERMINAL.test(String(value?.status ?? '')) ||
                (value?.result !== undefined && !/running|inprogress/i.test(String(value?.status ?? ''))),
            });

            if (result.last) current.forecast = result.last;
            if (!result.completed) {
              context.note('Forecast did not reach a terminal state; analysing the latest partial payload.');
            }
            return { completed: result.completed, attempts: result.attempts, status: result.last?.status };
          },
        },
        {
          name: 'analyzeSchedule',
          run: async (current) => {
            current.occurrences = extractOccurrences(current.forecast?.result ?? current.forecast);
            if (current.occurrences.length === 0) {
              fail('The forecast payload contained no recognisable job occurrences.', current.forecast);
            }
            return analyze(current.occurrences);
          },
        },
      ];

      const run = await runWorkflow<ForecastState>({
        name: 'forecast_application',
        logger,
        state,
        steps,
        timeoutMs: ((args.timeoutSeconds as number | undefined) ?? 600) * 1_000 + 60_000,
        summarize: (current, _records, success) =>
          success
            ? `Forecast for ${current.folder ?? 'the requested scope'} produced ${current.occurrences.length} job occurrence(s).`
            : `Forecast for ${current.folder ?? 'the requested scope'} could not be analysed.`,
      });

      return {
        ...run,
        forecastId: state.forecastId,
        analysis: state.occurrences.length > 0 ? analyze(state.occurrences) : undefined,
        occurrences: state.occurrences.slice(0, 500),
        raw: args.includeRawForecast === true ? state.forecast : undefined,
      };
    },
  };
}
