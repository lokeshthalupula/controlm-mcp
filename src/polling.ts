import { ControlMError } from './errors.js';
import type { Logger } from './logger.js';

export interface PollOptions<T> {
  operation: string;
  logger: Logger;
  /** Total wall-clock budget in milliseconds. */
  timeoutMs: number;
  intervalMs: number;
  maxIntervalMs?: number;
  /** Returns true when polling should stop. */
  isDone: (value: T) => boolean;
  fetch: () => Promise<T>;
  /** Called after each poll; useful for building a timeline. */
  onTick?: (value: T, attempt: number) => void;
}

export interface PollResult<T> {
  completed: boolean;
  attempts: number;
  elapsedMs: number;
  last: T | undefined;
  timedOut: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls with linear backoff until `isDone` or the timeout budget is exhausted. */
export async function poll<T>(options: PollOptions<T>): Promise<PollResult<T>> {
  const started = Date.now();
  const maxInterval = options.maxIntervalMs ?? Math.max(options.intervalMs, 15_000);
  let interval = options.intervalMs;
  let attempts = 0;
  let last: T | undefined;
  let lastError: unknown;

  while (Date.now() - started < options.timeoutMs) {
    attempts += 1;
    try {
      last = await options.fetch();
      lastError = undefined;
      options.onTick?.(last, attempts);
      if (options.isDone(last)) {
        return { completed: true, attempts, elapsedMs: Date.now() - started, last, timedOut: false };
      }
    } catch (error) {
      lastError = error;
      options.logger.warn('poll.attemptFailed', {
        operation: options.operation,
        attempt: attempts,
        message: (error as Error).message,
      });
    }

    const remaining = options.timeoutMs - (Date.now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(interval, remaining));
    interval = Math.min(Math.round(interval * 1.5), maxInterval);
  }

  if (last === undefined && lastError) {
    throw new ControlMError(
      `Polling for ${options.operation} never produced a result: ${(lastError as Error).message}`,
      { code: 'WORKFLOW_ERROR', operation: options.operation, cause: lastError },
    );
  }

  return { completed: false, attempts, elapsedMs: Date.now() - started, last, timedOut: true };
}
