import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { Agent } from '../types.js';

const serverField = z.string().min(1).describe('Control-M/Server name that owns the agent.');
const agentField = z.string().min(1).describe('Agent node id (host name as registered in Control-M).');

export function createAgentTools(client: ControlMClient): ToolDefinition[] {
  return [
    {
      name: 'list_agents',
      description:
        'Lists Control-M/Agents registered to a Control-M/Server, with status, version and operating system. ' +
        'Omit `server` to enumerate agents across every server returned by the configuration service.',
      inputShape: {
        server: z.string().min(1).optional().describe('Control-M/Server name. Omit to scan all servers.'),
        status: z
          .string()
          .optional()
          .describe('Optional client-side filter on agent status, e.g. "Available" or "Unavailable".'),
        limit: z.number().int().min(1).max(2_000).optional().describe('Maximum agents to return.'),
      },
      annotations: { title: 'List Control-M agents', readOnlyHint: true },
      handler: async (args: Record<string, unknown>) => {
        const servers = args.server
          ? [String(args.server)]
          : await resolveServerNames(client);

        const results = await Promise.all(
          servers.map(async (server): Promise<{ server: string; agents: Agent[]; error?: string }> => {
            try {
              return { server, agents: await client.listAgents(server, args.limit as number | undefined) };
            } catch (error) {
              return { server, agents: [], error: (error as Error).message };
            }
          }),
        );

        const statusFilter = typeof args.status === 'string' ? args.status.toLowerCase() : undefined;
        const agents = results
          .flatMap((entry) => entry.agents)
          .filter((agent) => !statusFilter || String(agent.status ?? '').toLowerCase() === statusFilter);

        return {
          serversScanned: servers,
          totalAgents: agents.length,
          errors: results.filter((entry) => entry.error).map((entry) => ({ server: entry.server, error: entry.error })),
          agents,
        };
      },
    },
    {
      name: 'add_agent',
      description:
        'Registers an existing Control-M/Agent host with a Control-M/Server. ' +
        'This only creates the server-side definition; use install_agent to deploy binaries.',
      inputShape: {
        server: serverField,
        host: z.string().min(1).describe('Host name of the agent to register.'),
        port: z.number().int().min(1).max(65_535).optional().describe('Agent-to-server port, if non-default.'),
      },
      annotations: { title: 'Add Control-M agent', idempotentHint: false },
      handler: async (args: Record<string, unknown>) =>
        client.addAgent(String(args.server), {
          host: String(args.host),
          ...(args.port !== undefined ? { port: Number(args.port) } : {}),
        }),
    },
    {
      name: 'delete_agent',
      description:
        'Removes an agent definition from a Control-M/Server. Destructive: jobs targeting the agent will fail to run.',
      inputShape: {
        server: serverField,
        agent: agentField,
        confirm: z
          .literal(true)
          .describe('Must be true. Explicit acknowledgement that the agent definition will be deleted.'),
      },
      annotations: { title: 'Delete Control-M agent', destructiveHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => client.deleteAgent(String(args.server), String(args.agent)),
    },
    {
      name: 'ping_agent',
      description:
        'Pings a Control-M/Agent to verify network reachability from the Control-M/Server. ' +
        'Returns a structured result instead of throwing when the agent is unreachable.',
      inputShape: { server: serverField, agent: agentField },
      annotations: { title: 'Ping Control-M agent', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => client.pingAgent(String(args.server), String(args.agent)),
    },
    {
      name: 'test_agent',
      description:
        'Runs the Control-M/Agent connectivity and configuration test (deeper than ping: validates ports, ' +
        'communication protocol and agent services).',
      inputShape: { server: serverField, agent: agentField },
      annotations: { title: 'Test Control-M agent', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => client.testAgent(String(args.server), String(args.agent)),
    },
  ];
}

/** Best-effort extraction of server names from the heterogeneous /config/servers payload. */
export async function resolveServerNames(client: ControlMClient): Promise<string[]> {
  const raw = await client.listServers();
  const list = Array.isArray(raw)
    ? raw
    : ((raw as Record<string, unknown>)?.servers as unknown[] | undefined) ?? [];

  return list
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      const record = entry as Record<string, unknown>;
      const name = record?.name ?? record?.server ?? record?.ctm;
      return typeof name === 'string' ? name : undefined;
    })
    .filter((name): name is string => Boolean(name));
}
