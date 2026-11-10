import type { ControlMClient } from '../controlm-client.js';
import type { Logger } from '../logger.js';
import { poll } from '../polling.js';
import type { JobStatus, RunStatusResponse } from '../types.js';

const SUCCESS_STATES = /^(ended ok|ok|completed|success|succeeded)$/i;
const FAILURE_STATES = /(ended not ok|failed|error|aborted|killed|disappeared)/i;
const ACTIVE_STATES = /(executing|running|wait|submitted|pending|queued|held)/i;

export type JobOutcome = 'success' | 'failure' | 'active' | 'unknown';

export function classifyJobStatus(status: string | undefined): JobOutcome {
  const value = String(status ?? '').trim();
  if (!value) return 'unknown';
  if (SUCCESS_STATES.test(value)) return 'success';
  if (FAILURE_STATES.test(value)) return 'failure';
  if (ACTIVE_STATES.test(value)) return 'active';
  return 'unknown';
}

export function isRunComplete(response: RunStatusResponse | undefined): boolean {
  if (!response) return false;
  const statuses = response.statuses ?? [];
  if (statuses.length === 0) return false;
  return statuses.every((job) => {
    const outcome = classifyJobStatus(job.status);
    return outcome === 'success' || outcome === 'failure';
  });
}

export interface MonitorOptions {
  timeoutMs: number;
  intervalMs: number;
  maxIntervalMs?: number;
}

export interface MonitorResult {
  runId: string;
  completed: boolean;
  timedOut: boolean;
  attempts: number;
  elapsedMs: number;
  statuses: JobStatus[];
  succeeded: JobStatus[];
  failed: JobStatus[];
  active: JobStatus[];
  timeline: Array<{ attempt: number; completed?: number; total?: number }>;
}

/** Polls a run until every job reaches a terminal state, then buckets the results. */
export async function monitorRun(
  client: ControlMClient,
  logger: Logger,
  runId: string,
  options: MonitorOptions,
): Promise<MonitorResult> {
  const timeline: MonitorResult['timeline'] = [];

  const result = await poll<RunStatusResponse>({
    operation: `run.monitor:${runId}`,
    logger: logger.child('jobMonitor'),
    timeoutMs: options.timeoutMs,
    intervalMs: options.intervalMs,
    maxIntervalMs: options.maxIntervalMs ?? 60_000,
    fetch: () => client.getRunStatus(runId),
    isDone: isRunComplete,
    onTick: (value, attempt) => {
      timeline.push({ attempt, completed: value?.completed, total: value?.total });
    },
  });

  const statuses = result.last?.statuses ?? [];

  return {
    runId,
    completed: result.completed,
    timedOut: result.timedOut,
    attempts: result.attempts,
    elapsedMs: result.elapsedMs,
    statuses,
    succeeded: statuses.filter((job) => classifyJobStatus(job.status) === 'success'),
    failed: statuses.filter((job) => classifyJobStatus(job.status) === 'failure'),
    active: statuses.filter((job) => {
      const outcome = classifyJobStatus(job.status);
      return outcome === 'active' || outcome === 'unknown';
    }),
    timeline,
  };
}

/** Fetches job output defensively; failures become a message rather than an exception. */
export async function safeJobOutput(
  client: ControlMClient,
  jobId: string,
  maxChars = 8_000,
): Promise<{ output?: string; truncated: boolean; error?: string }> {
  try {
    const raw = await client.getJobOutput(jobId);
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    return { output: text.slice(-maxChars), truncated: text.length > maxChars };
  } catch (error) {
    return { truncated: false, error: (error as Error).message };
  }
}
