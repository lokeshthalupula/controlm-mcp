import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import type { Logger } from '../logger.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { EnvironmentSummary } from '../types.js';
import { isAgentAvailable } from './agent-health-report.js';

export interface EnvironmentSummaryOptions {
  includeAgents?: boolean;
  includeSecurity?: boolean;
}

export interface EnvironmentSummaryResult extends EnvironmentSummary {
  security?: Record<string, unknown>;
}

/** Core topology scan reused by the health-check, diagnostics and report tools. */
export async function buildEnvironmentSummary(
  client: ControlMClient,
  logger: Logger,
  options: EnvironmentSummaryOptions = {},
): Promise<EnvironmentSummaryResult> {
  const log = logger.child('environmentSummary');
  const warnings: string[] = [];

  const rawServers = await client.listServers();

  const serverRecords = (
    Array.isArray(rawServers)
      ? rawServers
      : ((rawServers as Record<string, unknown>)?.servers as unknown[] | undefined) ?? []
  ).map((entry) => (typeof entry === 'string' ? { name: entry } : (entry as Record<string, unknown>)));

  const servers: EnvironmentSummary['servers'] = [];

  for (const record of serverRecords) {
    const name = String(record.name ?? record.server ?? record.ctm ?? 'unknown');
    const state = record.state ? String(record.state) : record.status ? String(record.status) : undefined;

    if (state && !/up|available|connected/i.test(state)) {
      warnings.push(`Control-M/Server "${name}" reports state "${state}".`);
    }

    let agentCount = 0;
    let unavailableAgentCount = 0;
    let hosts: string[] | undefined;

    if (options.includeAgents !== false) {
      try {
        const agents = await client.listAgents(name);
        agentCount = agents.length;
        unavailableAgentCount = agents.filter(
          (agent) => agent.status && !isAgentAvailable(agent.status),
        ).length;
        hosts = agents.map((agent) => agent.nodeid);
        if (agentCount === 0) warnings.push(`Control-M/Server "${name}" has no registered agents.`);
        if (unavailableAgentCount > 0) {
          warnings.push(`Control-M/Server "${name}" has ${unavailableAgentCount} unavailable agent(s).`);
        }
      } catch (error) {
        warnings.push(`Unable to list agents for "${name}": ${(error as Error).message}`);
        log.warn('environmentSummary.agentsFailed', { server: name });
      }
    }

    servers.push({ name, state, hosts, agentCount, unavailableAgentCount });
  }

  const summary: EnvironmentSummaryResult = {
    generatedAt: new Date().toISOString(),
    servers,
    totals: {
      servers: servers.length,
      agents: servers.reduce((total, server) => total + server.agentCount, 0),
      unavailableAgents: servers.reduce((total, server) => total + server.unavailableAgentCount, 0),
    },
    warnings,
  };

  if (options.includeSecurity !== true) return summary;

  const security: Record<string, unknown> = {};
  try {
    const roles = await client.listRoles();
    security.roleCount = Array.isArray(roles) ? roles.length : undefined;
  } catch (error) {
    security.rolesError = (error as Error).message;
  }
  try {
    const users = await client.listUsers();
    security.userCount = Array.isArray(users) ? users.length : undefined;
  } catch (error) {
    security.usersError = (error as Error).message;
  }

  return { ...summary, security };
}

export function createEnvironmentSummaryTool(client: ControlMClient, logger: Logger): ToolDefinition {
  return {
    name: 'environment_summary',
    description:
      'Builds a topology and health overview of the whole Control-M environment: every Control-M/Server, its ' +
      'agent inventory, unavailable agent counts and configuration warnings. Use it as the first call when ' +
      'diagnosing an unfamiliar environment.',
    inputShape: {
      includeAgents: z.boolean().optional().describe('Include the agent inventory per server. Default true.'),
      includeSecurity: z
        .boolean()
        .optional()
        .describe('Include role and user counts. Requires security read permissions. Default false.'),
    },
    annotations: { title: 'Control-M environment summary', readOnlyHint: true, idempotentHint: true },
    handler: async (args: Record<string, unknown>) =>
      buildEnvironmentSummary(client, logger, {
        includeAgents: args.includeAgents as boolean | undefined,
        includeSecurity: args.includeSecurity as boolean | undefined,
      }),
  };
}
