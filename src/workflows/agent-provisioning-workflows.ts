import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { ControlMClient } from '../controlm-client.js';
import type { Logger } from '../logger.js';
import { poll } from '../polling.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { ProvisionOperationResponse } from '../types.js';
import { fail, runWorkflow, type Step } from '../copilot/orchestrator.js';
import { compareVersions } from './agent-health-report.js';

const PROVISION_TERMINAL = /(ended|complete|completed|success|succeeded|failed|error|cancell?ed)/i;
const PROVISION_FAILED = /(failed|error|cancell?ed)/i;

interface AgentState {
  server: string;
  host: string;
  requestedVersion?: string;
  installationPath?: string;
  user?: string;
  port?: number;
  operation?: ProvisionOperationResponse;
  operationId?: string;
  provisionStatus?: ProvisionOperationResponse;
  registeredBefore?: boolean;
  versionBefore?: string;
  versionAfter?: string;
  reachable?: boolean;
  testPassed?: boolean;
}

async function awaitProvisioning(
  client: ControlMClient,
  logger: Logger,
  state: AgentState,
  budgetMs: number,
): Promise<unknown> {
  const operationId = state.operationId;
  if (!operationId) {
    return 'The API returned no operation id; treating the provisioning call as synchronous.';
  }

  const result = await poll<ProvisionOperationResponse>({
    operation: `provision.poll:${operationId}`,
    logger,
    timeoutMs: Math.max(10_000, budgetMs),
    intervalMs: 10_000,
    maxIntervalMs: 30_000,
    fetch: () => client.getProvisionStatus(operationId),
    isDone: (value) => PROVISION_TERMINAL.test(String(value?.status ?? '')),
  });

  state.provisionStatus = result.last;

  if (!result.completed) {
    fail(
      `Provisioning operation ${operationId} did not reach a terminal state within the time budget.`,
      { operationId, lastStatus: result.last },
    );
  }
  if (PROVISION_FAILED.test(String(result.last?.status ?? ''))) {
    fail(`Provisioning operation ${operationId} reported status "${result.last?.status}".`, result.last);
  }

  return result.last;
}

function verifyRegistrationStep(client: ControlMClient, required: boolean): Step<AgentState> {
  return {
    name: 'verifyRegistration',
    run: async (state) => {
      const agents = await client.listAgents(state.server);
      const match = agents.find((agent) => agent.nodeid?.toLowerCase() === state.host.toLowerCase());
      state.versionAfter = match?.version ? String(match.version) : undefined;

      if (!match && required) {
        fail(`Agent "${state.host}" is not registered on Control-M/Server "${state.server}" after provisioning.`);
      }
      return { registered: Boolean(match), agent: match, agentsOnServer: agents.length };
    },
  };
}

function connectivitySteps(client: ControlMClient): Array<Step<AgentState>> {
  return [
    {
      name: 'pingAgent',
      run: async (state) => {
        const ping = await client.pingAgent(state.server, state.host);
        state.reachable = ping.reachable;
        if (!ping.reachable) fail(`Ping to agent "${state.host}" failed: ${ping.message ?? 'no response'}.`, ping);
        return ping;
      },
    },
    {
      name: 'testAgent',
      run: async (state) => {
        const test = await client.testAgent(state.server, state.host);
        state.testPassed = test.passed;
        if (!test.passed) {
          fail(`Connectivity test for agent "${state.host}" failed: ${test.message ?? 'unknown reason'}.`, test);
        }
        return test;
      },
    },
  ];
}

const baseShape = {
  server: z.string().min(1).describe('Control-M/Server that owns the agent.'),
  host: z.string().min(1).describe('Target host name of the Control-M/Agent.'),
  version: z.string().optional().describe('Agent version from the provisioning repository, e.g. "9.0.21.200".'),
  installationPath: z.string().optional().describe('Installation directory on the target host.'),
  user: z.string().optional().describe('Operating-system account that runs the agent.'),
  port: z.number().int().min(1).max(65_535).optional().describe('Server-to-agent port.'),
  timeoutSeconds: z
    .number()
    .int()
    .min(60)
    .max(10_800)
    .optional()
    .describe('Total budget for provisioning plus validation. Default 1800.'),
};

function toState(args: Record<string, unknown>): AgentState {
  return {
    server: String(args.server),
    host: String(args.host),
    requestedVersion: args.version as string | undefined,
    installationPath: args.installationPath as string | undefined,
    user: args.user as string | undefined,
    port: args.port as number | undefined,
  };
}

function provisionPayload(state: AgentState) {
  return {
    server: state.server,
    host: state.host,
    ...(state.requestedVersion !== undefined ? { version: state.requestedVersion } : {}),
    ...(state.installationPath !== undefined ? { installationPath: state.installationPath } : {}),
    ...(state.user !== undefined ? { user: state.user } : {}),
    ...(state.port !== undefined ? { port: state.port } : {}),
  };
}

/**
 * install_and_validate_agent
 *
 * API calls: GET agents -> POST /provision/install/agent -> GET /provision/status
 * -> GET agents -> POST agent (register, if missing) -> POST ping -> POST test.
 */
export function createInstallAgentWorkflow(
  client: ControlMClient,
  config: AppConfig,
  logger: Logger,
): ToolDefinition {
  return {
    name: 'install_and_validate_agent',
    description:
      'Orchestrated agent onboarding. Checks whether the host is already registered, provisions the ' +
      'Control-M/Agent, waits for the provisioning operation to reach a terminal state, registers the agent ' +
      'definition if the install did not, then validates it with ping and a connectivity test. Returns a ' +
      'step-by-step execution report with a single success verdict.',
    inputShape: {
      ...baseShape,
      registerIfMissing: z
        .boolean()
        .optional()
        .describe('Create the agent definition on the server if provisioning did not register it. Default true.'),
      failIfAlreadyInstalled: z
        .boolean()
        .optional()
        .describe('Abort instead of continuing when the host is already registered. Default false.'),
    },
    annotations: { title: 'Install agent workflow' },
    handler: async (args: Record<string, unknown>) => {
      const state = toState(args);
      const timeoutMs = ((args.timeoutSeconds as number | undefined) ?? 1_800) * 1_000;

      const steps: Array<Step<AgentState>> = [
        {
          name: 'preflightInventory',
          run: async (current) => {
            const agents = await client.listAgents(current.server);
            const match = agents.find((agent) => agent.nodeid?.toLowerCase() === current.host.toLowerCase());
            current.registeredBefore = Boolean(match);
            current.versionBefore = match?.version ? String(match.version) : undefined;

            if (match && args.failIfAlreadyInstalled === true) {
              fail(`Agent "${current.host}" is already registered on "${current.server}".`, match);
            }
            return { alreadyRegistered: current.registeredBefore, currentVersion: current.versionBefore };
          },
        },
        {
          name: 'provisionInstall',
          run: async (current) => {
            current.operation = await client.installAgent(provisionPayload(current));
            current.operationId = current.operation.operationId ?? current.operation.requestId;
            return current.operation;
          },
        },
        {
          name: 'awaitProvisioning',
          run: (current, context) =>
            awaitProvisioning(client, context.logger, current, Math.max(10_000, context.remainingMs() - 60_000)),
        },
        verifyRegistrationStep(client, false),
        {
          name: 'registerAgent',
          skip: (current) =>
            current.versionAfter !== undefined || current.registeredBefore === true
              ? 'Agent definition already present on the server.'
              : args.registerIfMissing === false
                ? 'registerIfMissing is false.'
                : !config.safety.allowRemediation
                  ? 'Remediation is disabled (CONTROLM_ALLOW_REMEDIATION=false).'
                  : false,
          run: (current) =>
            client.addAgent(current.server, {
              host: current.host,
              ...(current.port !== undefined ? { port: current.port } : {}),
            }),
        },
        ...connectivitySteps(client),
      ];

      return runWorkflow<AgentState>({
        name: 'install_and_validate_agent',
        logger,
        state,
        steps,
        timeoutMs,
        summarize: (current, _records, success) =>
          success
            ? `Agent "${current.host}" was installed on "${current.server}"${
                current.versionAfter ? ` at version ${current.versionAfter}` : ''
              } and passed ping and connectivity validation.`
            : `Installation of agent "${current.host}" on "${current.server}" did not complete. Inspect the failed step, then run collect_diagnostics for the host.`,
      });
    },
  };
}

/**
 * upgrade_agent
 *
 * API calls: GET agents (capture current version) -> POST hold-equivalent safety check
 * -> POST /provision/upgrade/agent -> GET /provision/status -> GET agents (confirm new
 * version) -> POST ping -> POST test.
 */
export function createUpgradeAgentWorkflow(client: ControlMClient, logger: Logger): ToolDefinition {
  return {
    name: 'upgrade_agent',
    description:
      'Orchestrated agent upgrade. Captures the current agent version, verifies the target version is newer, ' +
      'runs the provisioning upgrade, waits for completion, then confirms the reported version changed and the ' +
      'agent still passes ping and connectivity tests. Refuses no-op or downgrade requests unless forced.',
    inputShape: {
      ...baseShape,
      version: z.string().min(1).describe('Target agent version from the provisioning repository.'),
      allowDowngrade: z
        .boolean()
        .optional()
        .describe('Permit installing a version lower than the current one. Default false.'),
      requireVersionChange: z
        .boolean()
        .optional()
        .describe('Fail if the reported version did not change after the upgrade. Default true.'),
    },
    annotations: { title: 'Upgrade agent workflow' },
    handler: async (args: Record<string, unknown>) => {
      const state = toState(args);
      const timeoutMs = ((args.timeoutSeconds as number | undefined) ?? 1_800) * 1_000;

      const steps: Array<Step<AgentState>> = [
        {
          name: 'captureCurrentVersion',
          run: async (current) => {
            const agents = await client.listAgents(current.server);
            const match = agents.find((agent) => agent.nodeid?.toLowerCase() === current.host.toLowerCase());
            if (!match) {
              fail(`Agent "${current.host}" is not registered on "${current.server}"; use install_and_validate_agent.`);
            }
            current.registeredBefore = true;
            current.versionBefore = match?.version ? String(match.version) : undefined;
            return { currentVersion: current.versionBefore, status: match?.status };
          },
        },
        {
          name: 'validateTargetVersion',
          run: async (current) => {
            const target = current.requestedVersion!;
            if (!current.versionBefore) {
              return `Current version unknown; proceeding with upgrade to ${target}.`;
            }
            const delta = compareVersions(target, current.versionBefore);
            if (delta === 0) {
              fail(`Agent "${current.host}" is already at version ${target}.`);
            }
            if (delta < 0 && args.allowDowngrade !== true) {
              fail(
                `Requested version ${target} is lower than the installed ${current.versionBefore}. ` +
                  'Re-run with allowDowngrade=true if this is intentional.',
              );
            }
            return { from: current.versionBefore, to: target, downgrade: delta < 0 };
          },
        },
        {
          name: 'preUpgradeHealthCheck',
          optional: true,
          run: async (current) => {
            const ping = await client.pingAgent(current.server, current.host);
            return { reachableBeforeUpgrade: ping.reachable, message: ping.message };
          },
        },
        {
          name: 'provisionUpgrade',
          run: async (current) => {
            current.operation = await client.upgradeAgent(provisionPayload(current));
            current.operationId = current.operation.operationId ?? current.operation.requestId;
            return current.operation;
          },
        },
        {
          name: 'awaitProvisioning',
          run: (current, context) =>
            awaitProvisioning(client, context.logger, current, Math.max(10_000, context.remainingMs() - 60_000)),
        },
        verifyRegistrationStep(client, true),
        {
          name: 'confirmVersionChange',
          skip: () => (args.requireVersionChange === false ? 'requireVersionChange is false.' : false),
          run: async (current) => {
            if (!current.versionAfter) {
              return 'Server did not report an agent version; skipping strict verification.';
            }
            if (current.versionBefore && current.versionAfter === current.versionBefore) {
              fail(
                `Agent "${current.host}" still reports version ${current.versionAfter} after the upgrade.`,
                { expected: current.requestedVersion },
              );
            }
            return { from: current.versionBefore, to: current.versionAfter };
          },
        },
        ...connectivitySteps(client),
      ];

      return runWorkflow<AgentState>({
        name: 'upgrade_agent',
        logger,
        state,
        steps,
        timeoutMs,
        summarize: (current, _records, success) =>
          success
            ? `Agent "${current.host}" upgraded from ${current.versionBefore ?? 'unknown'} to ${
                current.versionAfter ?? current.requestedVersion
              } and revalidated.`
            : `Upgrade of agent "${current.host}" did not complete. The agent may be partially upgraded; run collect_diagnostics before retrying.`,
      });
    },
  };
}
