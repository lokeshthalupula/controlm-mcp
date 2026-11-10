import { randomUUID } from 'node:crypto';
import { ControlMError, toControlMError } from '../errors.js';
import type { Logger } from '../logger.js';

export type StepStatus = 'ok' | 'failed' | 'skipped' | 'compensated';

export interface StepRecord {
  step: string;
  status: StepStatus;
  startedAt: string;
  durationMs: number;
  detail?: unknown;
  error?: Record<string, unknown>;
  /** Set when the step failed but was declared non-blocking. */
  tolerated?: boolean;
}

export interface StepContext {
  logger: Logger;
  correlationId: string;
  /** Milliseconds left in the workflow budget. Steps should respect it when polling. */
  remainingMs: () => number;
  /** Appends a human-readable note that surfaces in the workflow summary. */
  note: (message: string) => void;
}

export interface Step<TState> {
  name: string;
  /** Skip the step without failing the workflow. */
  skip?: (state: TState) => boolean | string;
  run: (state: TState, context: StepContext) => Promise<unknown>;
  /** A failure here is recorded but does not abort the workflow. */
  optional?: boolean;
  /** Undo logic executed in reverse order when a later blocking step fails. */
  compensate?: (state: TState, context: StepContext) => Promise<unknown>;
}

export interface WorkflowOptions<TState> {
  name: string;
  logger: Logger;
  state: TState;
  steps: Array<Step<TState>>;
  /** Total wall-clock budget. Default 30 minutes. */
  timeoutMs?: number;
  /** Run `compensate` for completed steps when a blocking step fails. Default false. */
  rollbackOnFailure?: boolean;
  /** Builds the closing narrative from the final state and step records. */
  summarize?: (state: TState, steps: StepRecord[], success: boolean) => string;
}

export interface WorkflowRun<TState> {
  workflow: string;
  correlationId: string;
  success: boolean;
  startedAt: string;
  elapsedMs: number;
  timedOut: boolean;
  summary: string;
  notes: string[];
  steps: StepRecord[];
  state: TState;
}

function defaultSummary(name: string, steps: StepRecord[], success: boolean): string {
  const failed = steps.filter((step) => step.status === 'failed' && !step.tolerated);
  if (success) return `${name} completed successfully in ${steps.length} step(s).`;
  const blocking = failed[0];
  return blocking
    ? `${name} failed at step "${blocking.step}": ${String(blocking.error?.message ?? 'unknown error')}`
    : `${name} did not complete.`;
}

/**
 * Sequential step runner shared by every Copilot workflow.
 *
 * Guarantees: a uniform result envelope, per-step timing, a wall-clock budget,
 * tolerated (optional) failures, reverse-order compensation, and structured logs
 * correlated by a single id so a multi-call orchestration can be traced end to end.
 */
export async function runWorkflow<TState>(options: WorkflowOptions<TState>): Promise<WorkflowRun<TState>> {
  const correlationId = randomUUID();
  const logger = options.logger.child(options.name, { correlationId });
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1_000;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const remainingMs = () => Math.max(0, timeoutMs - (Date.now() - startedAtMs));

  const notes: string[] = [];
  const steps: StepRecord[] = [];
  const completed: Array<Step<TState>> = [];

  const context: StepContext = {
    logger,
    correlationId,
    remainingMs,
    note: (message: string) => {
      notes.push(message);
      logger.debug('workflow.note', { note: message });
    },
  };

  logger.info('workflow.start', { workflow: options.name, steps: options.steps.length });

  let success = true;
  let timedOut = false;

  for (const step of options.steps) {
    if (remainingMs() <= 0) {
      timedOut = true;
      success = false;
      steps.push({
        step: step.name,
        status: 'skipped',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        detail: 'Workflow time budget exhausted before this step started.',
      });
      continue;
    }

    const skip = step.skip?.(options.state);
    if (skip) {
      steps.push({
        step: step.name,
        status: 'skipped',
        startedAt: new Date().toISOString(),
        durationMs: 0,
        detail: typeof skip === 'string' ? skip : 'Skip condition met.',
      });
      logger.info('workflow.step.skipped', { step: step.name });
      continue;
    }

    const stepStartedMs = Date.now();
    try {
      const detail = await step.run(options.state, context);
      steps.push({
        step: step.name,
        status: 'ok',
        startedAt: new Date(stepStartedMs).toISOString(),
        durationMs: Date.now() - stepStartedMs,
        detail,
      });
      completed.push(step);
      logger.info('workflow.step.ok', { step: step.name, durationMs: Date.now() - stepStartedMs });
    } catch (rawError) {
      const error = toControlMError(rawError, `${options.name}.${step.name}`);
      steps.push({
        step: step.name,
        status: 'failed',
        startedAt: new Date(stepStartedMs).toISOString(),
        durationMs: Date.now() - stepStartedMs,
        error: error.toJSON(),
        tolerated: step.optional === true,
      });
      logger.error('workflow.step.failed', {
        step: step.name,
        optional: step.optional === true,
        code: error.code,
        message: error.message,
      });

      if (step.optional) continue;

      success = false;

      if (options.rollbackOnFailure) {
        for (const done of [...completed].reverse()) {
          if (!done.compensate) continue;
          const compensateStartedMs = Date.now();
          try {
            const detail = await done.compensate(options.state, context);
            steps.push({
              step: `compensate:${done.name}`,
              status: 'compensated',
              startedAt: new Date(compensateStartedMs).toISOString(),
              durationMs: Date.now() - compensateStartedMs,
              detail,
            });
          } catch (compensateError) {
            steps.push({
              step: `compensate:${done.name}`,
              status: 'failed',
              startedAt: new Date(compensateStartedMs).toISOString(),
              durationMs: Date.now() - compensateStartedMs,
              error: toControlMError(compensateError, `compensate.${done.name}`).toJSON(),
            });
          }
        }
      }

      break;
    }
  }

  if (remainingMs() <= 0) timedOut = true;

  const summary = options.summarize
    ? options.summarize(options.state, steps, success)
    : defaultSummary(options.name, steps, success);

  logger.info('workflow.end', {
    workflow: options.name,
    success,
    timedOut,
    elapsedMs: Date.now() - startedAtMs,
  });

  return {
    workflow: options.name,
    correlationId,
    success,
    startedAt,
    elapsedMs: Date.now() - startedAtMs,
    timedOut,
    summary,
    notes,
    steps,
    state: options.state,
  };
}

/** Throws a workflow-scoped error from inside a step. */
export function fail(message: string, detail?: unknown): never {
  throw new ControlMError(message, { code: 'WORKFLOW_ERROR', body: detail });
}
