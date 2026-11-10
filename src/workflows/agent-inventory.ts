import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import type { Logger } from '../logger.js';
import type { ToolDefinition } from '../tool-generator.js';
import { resolveServerNames } from '../tools/index.js';
import type { Agent } from '../types.js';
import { compareVersions, isAgentAvailable } from './agent-health-report.js';

interface InventoryRow {
  nodeid: string;
  server: string;
  status?: string;
  version?: string;
  operatingSystem?: string;
  hostgroups?: string[];
}

function bucket(rows: InventoryRow[], key: keyof InventoryRow): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key] === undefined || row[key] === null ? 'unknown' : String(row[key]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * agent_inventory
 *
 * API calls: GET /config/servers -> GET /config/server/{server}/agents for each server.
 */
export function createAgentInventoryTool(client: ControlMClient, logger: Logger): ToolDefinition {
  return {
    name: 'agent_inventory',
    description:
      'Fleet inventory of every Control-M/Agent across one or all Control-M/Servers. Returns the raw agent ' +
      'list plus roll-ups by status, version, operating system and server, and identifies agents below a ' +
      'baseline version so an upgrade campaign can be planned. Does not probe agents — use agent_health_report ' +
      'for live connectivity checks.',
    inputShape: {
      server: z.string().optional().describe('Restrict the inventory to one Control-M/Server. Omit to scan all.'),
      status: z.string().optional().describe('Filter by agent status, e.g. "Available" or "Unavailable".'),
      operatingSystem: z.string().optional().describe('Filter by operating system substring, e.g. "Linux".'),
      versionBelow: z
        .string()
        .optional()
        .describe('Only return agents below this version, e.g. "9.0.21.000". Also drives the upgradeCandidates list.'),
      hostgroup: z.string().optional().describe('Filter by host group membership.'),
      includeAgentList: z
        .boolean()
        .optional()
        .describe('Include the full per-agent rows, not just the roll-ups. Default true.'),
      limit: z.number().int().min(1).max(5_000).optional().describe('Maximum agents to return. Default 1000.'),
    },
    annotations: { title: 'Control-M agent inventory', readOnlyHint: true, idempotentHint: true },
    handler: async (args: Record<string, unknown>) => {
      const log = logger.child('agentInventory');
      const servers = args.server ? [String(args.server)] : await resolveServerNames(client);
      const limit = (args.limit as number | undefined) ?? 1_000;
      const errors: Array<{ server: string; error: string }> = [];

      const collected: InventoryRow[] = [];
      for (const server of servers) {
        try {
          const agents: Agent[] = await client.listAgents(server);
          for (const agent of agents) {
            collected.push({
              nodeid: agent.nodeid,
              server,
              status: agent.status ? String(agent.status) : undefined,
              version: agent.version ? String(agent.version) : undefined,
              operatingSystem: agent.operatingSystem ? String(agent.operatingSystem) : undefined,
              hostgroups: Array.isArray(agent.hostgroups) ? (agent.hostgroups as string[]) : undefined,
            });
          }
        } catch (error) {
          errors.push({ server, error: (error as Error).message });
          log.warn('agentInventory.listFailed', { server });
        }
      }

      const statusFilter = args.status ? String(args.status).toLowerCase() : undefined;
      const osFilter = args.operatingSystem ? String(args.operatingSystem).toLowerCase() : undefined;
      const hostgroupFilter = args.hostgroup ? String(args.hostgroup).toLowerCase() : undefined;
      const versionBelow = args.versionBelow as string | undefined;

      const filtered = collected.filter((row) => {
        if (statusFilter && String(row.status ?? '').toLowerCase() !== statusFilter) return false;
        if (osFilter && !String(row.operatingSystem ?? '').toLowerCase().includes(osFilter)) return false;
        if (hostgroupFilter && !(row.hostgroups ?? []).some((group) => group.toLowerCase() === hostgroupFilter)) {
          return false;
        }
        if (versionBelow && row.version && compareVersions(row.version, versionBelow) >= 0) return false;
        return true;
      });

      const rows = filtered.slice(0, limit);

      const upgradeCandidates = versionBelow
        ? rows
            .filter((row) => !row.version || compareVersions(row.version, versionBelow) < 0)
            .map((row) => ({ server: row.server, host: row.nodeid, currentVersion: row.version ?? 'unknown' }))
        : [];

      return {
        generatedAt: new Date().toISOString(),
        serversScanned: servers,
        totalDiscovered: collected.length,
        returned: rows.length,
        truncated: filtered.length > rows.length,
        errors,
        rollups: {
          byStatus: bucket(rows, 'status'),
          byVersion: bucket(rows, 'version'),
          byOperatingSystem: bucket(rows, 'operatingSystem'),
          byServer: bucket(rows, 'server'),
        },
        unavailableAgents: rows.filter((row) => row.status && !isAgentAvailable(row.status)).length,
        upgradeCandidates,
        agents: args.includeAgentList === false ? undefined : rows,
      };
    },
  };
}
