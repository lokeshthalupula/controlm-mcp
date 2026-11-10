import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { ControlMClient } from '../controlm-client.js';
import type { Logger } from '../logger.js';
import type { ToolDefinition } from '../tool-generator.js';
import { resolveServerNames } from '../tools/index.js';
import type { AgentHealthReport, HealthReportEntry } from '../types.js';

const CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!);
    }
  });

  await Promise.all(runners);
  return results;
}

export interface AgentHealthOptions {
  server?: string;
  probe?: boolean;
  onlyUnhealthy?: boolean;
  minVersion?: string;
  maxAgents?: number;
  concurrency?: number;
}

/** Core health scan reused by the health-check and diagnostics workflows. */
export async function buildAgentHealthReport(
  client: ControlMClient,
  logger: Logger,
  options: AgentHealthOptions = {},
): Promise<AgentHealthReport> {
  const log = logger.child('agentHealth');
  const probe = options.probe !== false;
  const maxAgents = options.maxAgents ?? 200;
  const minVersion = options.minVersion;
  const concurrency = options.concurrency ?? CONCURRENCY;

  const servers = options.server ? [options.server] : await resolveServerNames(client);

  const discovered = (
    await mapWithConcurrency(servers, concurrency, async (server) => {
      try {
        return (await client.listAgents(server)).map((agent) => ({ server, agent }));
      } catch (error) {
        log.warn('agentHealth.listFailed', { server, message: (error as Error).message });
        return [];
      }
    })
  ).flat();

  const targets = discovered.slice(0, maxAgents);

  const entries = await mapWithConcurrency(targets, concurrency, async ({ server, agent }) => {
    const findings: string[] = [];
    const status = agent.status;

    if (status && !isAgentAvailable(status)) {
      findings.push(`Agent status reported as "${status}".`);
    }
    if (minVersion && agent.version && compareVersions(String(agent.version), minVersion) < 0) {
      findings.push(`Agent version ${agent.version} is below the required ${minVersion}.`);
    }

    const entry: HealthReportEntry = {
      nodeid: agent.nodeid,
      server,
      status,
      version: agent.version ? String(agent.version) : undefined,
      healthy: false,
      findings,
    };

    if (probe) {
      const ping = await client.pingAgent(server, agent.nodeid);
      entry.reachable = ping.reachable;
      if (!ping.reachable) findings.push(`Ping failed: ${ping.message ?? 'no response'}.`);

      if (ping.reachable) {
        const test = await client.testAgent(server, agent.nodeid);
        entry.testPassed = test.passed;
        if (!test.passed) findings.push(`Connectivity test failed: ${test.message ?? 'unknown reason'}.`);
      } else {
        entry.testPassed = false;
      }
    }

    entry.healthy = findings.length === 0;
    return entry;
  });

  const unhealthy = entries.filter((entry) => !entry.healthy);

  return {
    generatedAt: new Date().toISOString(),
    serversScanned: servers,
    totalAgents: entries.length,
    healthyAgents: entries.length - unhealthy.length,
    unhealthyAgents: unhealthy.length,
    entries: options.onlyUnhealthy === true ? unhealthy : entries,
  };
}

export function createAgentHealthReportTool(
  client: ControlMClient,
  config: AppConfig,
  logger: Logger,
): ToolDefinition {
  return {
    name: 'agent_health_report',
    description:
      'Produces a health report for Control-M/Agents: status from the configuration service plus optional live ' +
      'ping and connectivity tests. Flags unavailable, unreachable or down-level agents with actionable findings.',
    inputShape: {
      server: z.string().optional().describe('Restrict the report to one Control-M/Server. Omit to scan all.'),
      probe: z
        .boolean()
        .optional()
        .describe('Actively ping and test each agent instead of relying on cached status. Default true.'),
      onlyUnhealthy: z.boolean().optional().describe('Return only agents with findings. Default false.'),
      minVersion: z
        .string()
        .optional()
        .describe('Flag agents below this version, e.g. "9.0.21.000".'),
      maxAgents: z.number().int().min(1).max(1_000).optional().describe('Safety cap on probed agents. Default 200.'),
    },
    annotations: { title: 'Control-M agent health report', readOnlyHint: true, idempotentHint: true },
    handler: async (args: Record<string, unknown>): Promise<AgentHealthReport> =>
      buildAgentHealthReport(client, logger, {
        server: args.server as string | undefined,
        probe: args.probe as boolean | undefined,
        onlyUnhealthy: args.onlyUnhealthy as boolean | undefined,
        minVersion: args.minVersion as string | undefined,
        maxAgents: args.maxAgents as number | undefined,
        concurrency: config.workflows.healthProbeConcurrency,
      }),
  };
}

/** Numeric dotted-version comparison; non-numeric segments compare lexicographically. */
export function compareVersions(left: string, right: string): number {
  const a = left.split('.');
  const b = right.split('.');
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? '0';
    const y = b[i] ?? '0';
    const nx = Number.parseInt(x, 10);
    const ny = Number.parseInt(y, 10);

    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function isAgentAvailable(status: unknown): boolean {
  return /^available$/i.test(String(status ?? '').trim());
}
