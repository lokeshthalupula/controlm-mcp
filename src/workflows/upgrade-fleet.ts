import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { ControlMClient } from '../controlm-client.js';
import { runWorkflow, type Step } from '../copilot/orchestrator.js';
import type { Logger } from '../logger.js';
import { poll } from '../polling.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { ProvisionOperationResponse } from '../types.js';
import { compareVersions, isAgentAvailable } from './agent-health-report.js';
import { resolveServerNames } from '../tools/index.js';

const PROVISION_TERMINAL = /(ended|complete|completed|success|succeeded|failed|error|cancell?ed)/i;
const PROVISION_FAILED = /(failed|error|cancell?ed)/i;

interface FleetTarget {
  server: string;
  host: string;
  currentVersion?: string;
  outcome?: 'upgraded' | 'failed' | 'skipped' | 'pending';
  detail?: unknown;
}

interface FleetState {
  targetVersion: string;
  candidates: FleetTarget[];
  batches: FleetTarget[][];
  canary?: FleetTarget;
  upgraded: FleetTarget[];
  failed: FleetTarget[];
  skipped: FleetTarget[];
  aborted?: string;
}

async function upgradeOne(
  client: ControlMClient,
  logger: Logger,
  target: FleetTarget,
  version: string,
  installationPath: string | undefined,
  budgetMs: number,
): Promise<FleetTarget> {
  try {
    const operation: ProvisionOperationResponse = await client.upgradeAgent({
      server: target.server,
      host: target.host,
      version,
      ...(installationPath ? { installationPath } : {}),
    });

    const operationId = operation.operationId ?? operation.requestId;
    if (operationId) {
      const result = await poll<ProvisionOperationResponse>({
        operation: `fleet.provision:${target.host}`,
        logger,
        timeoutMs: budgetMs,
        intervalMs: 10_000,
        maxIntervalMs: 30_000,
        fetch: () => client.getProvisionStatus(operationId),
        isDone: (value) => PROVISION_TERMINAL.test(String(value?.status ?? '')),
      });

      if (!result.completed || PROVISION_FAILED.test(String(result.last?.status ?? ''))) {
        return { ...target, outcome: 'failed', detail: result.last ?? 'Provisioning did not reach a terminal state.' };
      }
    }

    const ping = await client.pingAgent(target.server, target.host);
    if (!ping.reachable) {
      return { ...target, outcome: 'failed', detail: { stage: 'postUpgradePing', ping } };
    }

    return { ...target, outcome: 'upgraded', detail: { operation, ping } };
  } catch (error) {
    return { ...target, outcome: 'failed', detail: (error as Error).message };
  }
}

/**
 * upgrade_fleet
 *
 * API calls: GET /config/servers -> GET agents per server (build candidate list) ->
 * for each agent: POST /provision/upgrade/agent -> GET /provision/status -> POST ping.
 * Executes a canary first, then batches, and stops on a failure-rate breach.
 */
export function createUpgradeFleetTool(client: ControlMClient, config: AppConfig, logger: Logger): ToolDefinition {
  return {
    name: 'upgrade_fleet',
    description:
      'Bulk Control-M/Agent upgrade campaign. Discovers every agent below the target version, upgrades one ' +
      'canary host first, then proceeds in batches, validating each agent with a ping after upgrade and ' +
      'aborting the campaign when the failure rate exceeds the configured threshold. Supports dry-run ' +
      'planning. Returns a per-host outcome table.',
    inputShape: {
      targetVersion: z.string().min(1).describe('Version every agent should end up on, e.g. "9.0.21.200".'),
      server: z.string().optional().describe('Restrict the campaign to one Control-M/Server. Omit to scan all.'),
      hosts: z
        .array(z.string())
        .optional()
        .describe('Explicit host list. When omitted, all agents below targetVersion are selected.'),
      operatingSystem: z.string().optional().describe('Only upgrade agents whose OS matches this substring.'),
      installationPath: z.string().optional().describe('Installation path passed to the provisioning API.'),
      dryRun: z
        .boolean()
        .optional()
        .describe('Build and return the campaign plan without upgrading anything. Default true.'),
      batchSize: z.number().int().min(1).max(50).optional().describe('Agents upgraded per batch. Default 5.'),
      maxHosts: z.number().int().min(1).max(500).optional().describe('Hard cap on hosts in one campaign. Default 50.'),
      skipCanary: z.boolean().optional().describe('Skip the single-host canary upgrade. Default false.'),
      abortOnFailureRate: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Abort when this fraction of attempted upgrades fails. Default 0.25.'),
      perHostTimeoutSeconds: z
        .number()
        .int()
        .min(60)
        .max(7_200)
        .optional()
        .describe('Provisioning budget per host. Default 900.'),
      timeoutSeconds: z.number().int().min(120).max(43_200).optional().describe('Total campaign budget. Default 10800.'),
    },
    annotations: { title: 'Upgrade agent fleet' },
    handler: async (args: Record<string, unknown>) => {
      const targetVersion = String(args.targetVersion);
      const dryRun = args.dryRun !== false;
      const batchSize = (args.batchSize as number | undefined) ?? config.workflows.fleetBatchSize;
      const maxHosts = (args.maxHosts as number | undefined) ?? config.workflows.fleetMaxHosts;
      const abortRate = (args.abortOnFailureRate as number | undefined) ?? config.workflows.fleetAbortFailureRate;
      const perHostBudgetMs = ((args.perHostTimeoutSeconds as number | undefined) ?? 900) * 1_000;
      const osFilter = args.operatingSystem ? String(args.operatingSystem).toLowerCase() : undefined;
      const explicitHosts = (args.hosts as string[] | undefined)?.map((host) => host.toLowerCase());

      const state: FleetState = {
        targetVersion,
        candidates: [],
        batches: [],
        upgraded: [],
        failed: [],
        skipped: [],
      };

      const steps: Array<Step<FleetState>> = [
        {
          name: 'discoverCandidates',
          run: async (current) => {
            const servers = args.server ? [String(args.server)] : await resolveServerNames(client);

            for (const server of servers) {
              let agents;
              try {
                agents = await client.listAgents(server);
              } catch (error) {
                logger.warn('upgradeFleet.listFailed', { server, message: (error as Error).message });
                continue;
              }

              for (const agent of agents) {
                const host = agent.nodeid;
                const version = agent.version ? String(agent.version) : undefined;

                if (explicitHosts && !explicitHosts.includes(host.toLowerCase())) continue;
                if (osFilter && !String(agent.operatingSystem ?? '').toLowerCase().includes(osFilter)) continue;

                if (version && compareVersions(version, current.targetVersion) >= 0) {
                  current.skipped.push({ server, host, currentVersion: version, outcome: 'skipped', detail: 'Already at or above the target version.' });
                  continue;
                }
                if (agent.status && !isAgentAvailable(agent.status)) {
                  current.skipped.push({ server, host, currentVersion: version, outcome: 'skipped', detail: `Agent status is "${agent.status}"; fix it before upgrading.` });
                  continue;
                }

                current.candidates.push({ server, host, currentVersion: version, outcome: 'pending' });
              }
            }

            current.candidates = current.candidates.slice(0, maxHosts);

            if (args.skipCanary !== true && current.candidates.length > 1) {
              current.canary = current.candidates[0];
            }

            const remaining = current.canary ? current.candidates.slice(1) : current.candidates;
            for (let index = 0; index < remaining.length; index += batchSize) {
              current.batches.push(remaining.slice(index, index + batchSize));
            }

            return {
              candidates: current.candidates.length,
              skipped: current.skipped.length,
              canary: current.canary?.host,
              batches: current.batches.length,
            };
          },
        },
        {
          name: 'upgradeCanary',
          skip: (current) => {
            if (dryRun) return 'Dry run: no changes applied.';
            if (!current.canary) return 'No canary selected.';
            return false;
          },
          run: async (current, context) => {
            const result = await upgradeOne(
              client,
              context.logger,
              current.canary!,
              current.targetVersion,
              args.installationPath as string | undefined,
              Math.min(perHostBudgetMs, context.remainingMs()),
            );

            if (result.outcome === 'upgraded') {
              current.upgraded.push(result);
            } else {
              current.failed.push(result);
              current.aborted = 'Canary upgrade failed; the campaign was stopped before touching the rest of the fleet.';
              context.note(current.aborted);
            }
            return result;
          },
        },
        {
          name: 'upgradeBatches',
          skip: (current) => {
            if (dryRun) return 'Dry run: no changes applied.';
            if (current.aborted) return current.aborted;
            if (current.batches.length === 0) return 'No batches to process.';
            return false;
          },
          run: async (current, context) => {
            const batchReports: unknown[] = [];

            for (const [index, batch] of current.batches.entries()) {
              if (context.remainingMs() <= perHostBudgetMs) {
                current.aborted = 'Campaign time budget exhausted; remaining batches were not started.';
                context.note(current.aborted);
                break;
              }

              const results = await Promise.all(
                batch.map((target) =>
                  upgradeOne(
                    client,
                    context.logger,
                    target,
                    current.targetVersion,
                    args.installationPath as string | undefined,
                    Math.min(perHostBudgetMs, context.remainingMs()),
                  ),
                ),
              );

              for (const result of results) {
                if (result.outcome === 'upgraded') current.upgraded.push(result);
                else current.failed.push(result);
              }

              const attempted = current.upgraded.length + current.failed.length;
              const failureRate = attempted === 0 ? 0 : current.failed.length / attempted;
              batchReports.push({
                batch: index + 1,
                hosts: batch.map((target) => target.host),
                upgraded: results.filter((result) => result.outcome === 'upgraded').length,
                failed: results.filter((result) => result.outcome === 'failed').length,
                cumulativeFailureRate: Number(failureRate.toFixed(2)),
              });

              if (failureRate > abortRate) {
                current.aborted = `Failure rate ${Math.round(failureRate * 100)}% exceeded the ${Math.round(
                  abortRate * 100,
                )}% threshold; the campaign was stopped.`;
                context.note(current.aborted);
                break;
              }
            }

            return batchReports;
          },
        },
      ];

      const run = await runWorkflow<FleetState>({
        name: 'upgrade_fleet',
        logger,
        state,
        steps,
        timeoutMs: ((args.timeoutSeconds as number | undefined) ?? 10_800) * 1_000,
        summarize: (current) => {
          if (dryRun) {
            return `Dry run: ${current.candidates.length} agent(s) would be upgraded to ${current.targetVersion} ` +
              `in ${current.batches.length} batch(es)${current.canary ? ` after a canary on ${current.canary.host}` : ''}. ` +
              `${current.skipped.length} agent(s) skipped.`;
          }
          const attempted = current.upgraded.length + current.failed.length;
          return (
            `Upgraded ${current.upgraded.length}/${attempted} agent(s) to ${current.targetVersion}. ` +
            `${current.failed.length} failed, ${current.skipped.length} skipped.` +
            (current.aborted ? ` ${current.aborted}` : '')
          );
        },
      });

      return {
        ...run,
        campaign: {
          targetVersion,
          dryRun,
          plan: {
            canary: state.canary?.host,
            batches: state.batches.map((batch) => batch.map((target) => target.host)),
            totalCandidates: state.candidates.length,
          },
          upgraded: state.upgraded,
          failed: state.failed,
          skipped: state.skipped,
          aborted: state.aborted,
          nextSteps: state.failed.length
            ? ['Run collect_diagnostics with scope="agent" for each failed host, then remediate_agent.']
            : dryRun
              ? ['Re-run with dryRun=false to execute the campaign.']
              : ['Run agent_health_report to confirm fleet health after the campaign.'],
        },
      };
    },
  };
}
