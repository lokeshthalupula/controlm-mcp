import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { ControlMClient } from '../controlm-client.js';
import type { Logger } from '../logger.js';
import { poll } from '../polling.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { ProvisionOperationResponse } from '../types.js';
import { isAgentAvailable } from './agent-health-report.js';

const PROVISION_TERMINAL = /(ended|complete|completed|success|succeeded|failed|error|cancell?ed)/i;

interface Action {
  action: string;
  status: 'ok' | 'failed' | 'skipped' | 'planned';
  detail?: unknown;
}

export function createRemediateAgentTool(
  client: ControlMClient,
  config: AppConfig,
  logger: Logger,
): ToolDefinition {
  return {
    name: 'remediate_agent',
    description:
      'Diagnoses an unhealthy Control-M/Agent and applies escalating remediation: re-ping, connectivity test, ' +
      're-register the definition, and optionally reinstall or upgrade the agent. Runs in dry-run mode by ' +
      'default and always returns the diagnosis plus the plan it would execute.',
    inputShape: {
      server: z.string().min(1).describe('Control-M/Server that owns the agent.'),
      agent: z.string().min(1).describe('Agent node id to remediate.'),
      dryRun: z
        .boolean()
        .optional()
        .describe('Diagnose and plan without changing anything. Default true.'),
      allowReinstall: z
        .boolean()
        .optional()
        .describe('Permit an agent reinstall as the last remediation step. Default false.'),
      targetVersion: z.string().optional().describe('Version to use when reinstalling or upgrading.'),
      installationPath: z.string().optional().describe('Installation path used for a reinstall.'),
      timeoutSeconds: z.number().int().min(30).max(7_200).optional().describe('Remediation budget. Default 900.'),
    },
    annotations: { title: 'Remediate unhealthy Control-M agent' },
    handler: async (args: Record<string, unknown>) => {
      const log = logger.child('workflow.remediateAgent');
      const server = String(args.server);
      const agent = String(args.agent);
      const dryRun = args.dryRun !== false;
      const actions: Action[] = [];
      const findings: string[] = [];

      if (!dryRun && !config.safety.allowRemediation) {
        return {
          error: true,
          code: 'READ_ONLY',
          message: 'Active remediation is disabled (CONTROLM_ALLOW_REMEDIATION=false). Re-run with dryRun=true.',
        };
      }

      // Diagnosis.
      let registered = false;
      let definition: Record<string, unknown> | undefined;
      try {
        const agents = await client.listAgents(server);
        const match = agents.find((entry) => entry.nodeid?.toLowerCase() === agent.toLowerCase());
        registered = Boolean(match);
        definition = match as Record<string, unknown> | undefined;
        if (!registered) findings.push(`Agent "${agent}" is not registered on server "${server}".`);
        else if (match?.status && !isAgentAvailable(match.status)) {
          findings.push(`Agent status is "${match.status}".`);
        }
      } catch (error) {
        findings.push(`Unable to read agent inventory: ${(error as Error).message}`);
      }

      const ping = await client.pingAgent(server, agent);
      if (!ping.reachable) findings.push(`Ping failed: ${ping.message ?? 'no response'}.`);

      const test = ping.reachable ? await client.testAgent(server, agent) : undefined;
      if (test && !test.passed) findings.push(`Connectivity test failed: ${test.message ?? 'unknown reason'}.`);

      const healthy = registered && ping.reachable && test?.passed === true;
      if (healthy) {
        return {
          server,
          agent,
          healthy: true,
          findings,
          diagnosis: { registered, definition, ping, test },
          actions,
          message: 'Agent is healthy; no remediation required.',
        };
      }

      // Plan.
      const plan: string[] = [];
      if (!registered) plan.push('registerAgent');
      plan.push('retryPing');
      if (registered && !ping.reachable && args.allowReinstall === true) plan.push('reinstallAgent');

      if (dryRun) {
        for (const step of plan) actions.push({ action: step, status: 'planned' });
        return {
          server,
          agent,
          healthy: false,
          dryRun: true,
          findings,
          diagnosis: { registered, definition, ping, test },
          plan,
          actions,
          message: 'Dry run. Re-run with dryRun=false to apply the plan.',
        };
      }

      // Execution.
      if (!registered) {
        try {
          const added = await client.addAgent(server, { host: agent });
          registered = true;
          actions.push({ action: 'registerAgent', status: 'ok', detail: added });
        } catch (error) {
          actions.push({ action: 'registerAgent', status: 'failed', detail: (error as Error).message });
        }
      }

      const retryPing = await client.pingAgent(server, agent);
      actions.push({ action: 'retryPing', status: retryPing.reachable ? 'ok' : 'failed', detail: retryPing });

      if (!retryPing.reachable && args.allowReinstall === true) {
        try {
          const operation: ProvisionOperationResponse = await client.installAgent({
            server,
            host: agent,
            ...(args.targetVersion !== undefined ? { version: String(args.targetVersion) } : {}),
            ...(args.installationPath !== undefined ? { installationPath: String(args.installationPath) } : {}),
          });
          actions.push({ action: 'reinstallAgent', status: 'ok', detail: operation });

          const operationId = operation.operationId ?? operation.requestId;
          if (operationId) {
            const result = await poll<ProvisionOperationResponse>({
              operation: `provision.poll:${operationId}`,
              logger: log,
              timeoutMs: ((args.timeoutSeconds as number | undefined) ?? 900) * 1_000,
              intervalMs: 10_000,
              maxIntervalMs: 30_000,
              fetch: () => client.getProvisionStatus(operationId),
              isDone: (value) => PROVISION_TERMINAL.test(String(value?.status ?? '')),
            });
            actions.push({
              action: 'awaitReinstall',
              status: result.completed ? 'ok' : 'failed',
              detail: { timedOut: result.timedOut, status: result.last },
            });
          }
        } catch (error) {
          actions.push({ action: 'reinstallAgent', status: 'failed', detail: (error as Error).message });
        }
      } else if (!retryPing.reachable) {
        actions.push({
          action: 'reinstallAgent',
          status: 'skipped',
          detail: 'Reinstall not permitted. Re-run with allowReinstall=true if a reinstall is acceptable.',
        });
      }

      const finalPing = await client.pingAgent(server, agent);
      const finalTest = finalPing.reachable ? await client.testAgent(server, agent) : undefined;
      const resolved = registered && finalPing.reachable && finalTest?.passed === true;

      return {
        server,
        agent,
        healthy: resolved,
        dryRun: false,
        findings,
        actions,
        verification: { ping: finalPing, test: finalTest },
        message: resolved
          ? `Agent "${agent}" was remediated successfully.`
          : `Agent "${agent}" is still unhealthy. Manual intervention on the host is likely required.`,
      };
    },
  };
}
