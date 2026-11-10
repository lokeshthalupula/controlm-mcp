#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, type AppConfig } from './config.js';
import { ControlMClient } from './controlm-client.js';
import { ControlMError, toControlMError } from './errors.js';
import { getLogger, initLogger, type Logger } from './logger.js';
import { loadSpec, type LoadedSpec } from './swagger-loader.js';
import {
  createApiCatalogTool,
  generateToolsFromSpec,
  type ToolDefinition,
} from './tool-generator.js';
import { createCoreTools } from './tools/index.js';
import { createWorkflowTools } from './workflows/index.js';

const SERVER_NAME = 'controlm-mcp';
const SERVER_VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

const MAX_RESULT_CHARS = 200_000;
const SENSITIVE_FIELD_PATTERN =
  /^(?:password|currentpassword|newpassword|passwd|tokenvalue|accesstoken|refreshtoken|apitoken|secretvalue|clientsecret|privatekey|authorization|credential)$/i;
const SENSITIVE_TEXT_PATTERN =
  /(["']?(?:password|currentPassword|newPassword|passwd|tokenValue|accessToken|refreshToken|apiToken|secretValue|clientSecret|authorization|credential)["']?\s*[:=]\s*["']?)[^"',\s}\]]+/gi;

function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveFields);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key) ? '[REDACTED]' : redactSensitiveFields(entry),
    ]),
  );
}

function stringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (typeof value === 'string') return value.replace(SENSITIVE_TEXT_PATTERN, '$1[REDACTED]');
  try {
    return JSON.stringify(redactSensitiveFields(value), null, 2);
  } catch {
    return String(value);
  }
}

function successResult(value: unknown): ToolResult {
  const text = stringify(value);
  return {
    content: [
      {
        type: 'text',
        text:
          text.length > MAX_RESULT_CHARS
            ? `${text.slice(0, MAX_RESULT_CHARS)}\n…[truncated ${text.length - MAX_RESULT_CHARS} characters]`
            : text,
      },
    ],
  };
}

function errorResult(error: ControlMError): ToolResult {
  return {
    content: [{ type: 'text', text: stringify(error.toJSON()) }],
    isError: true,
  };
}

function registerTool(server: McpServer, tool: ToolDefinition, logger: Logger): void {
  const handler = async (args: Record<string, unknown>): Promise<ToolResult> => {
    const started = Date.now();
    logger.info('tool.invoke', { tool: tool.name });
    try {
      const result = await tool.handler(args ?? {});
      logger.info('tool.success', { tool: tool.name, durationMs: Date.now() - started });
      return successResult(result);
    } catch (rawError) {
      const error = toControlMError(rawError, tool.name);
      logger.error('tool.failure', {
        tool: tool.name,
        code: error.code,
        status: error.status,
        durationMs: Date.now() - started,
        message: error.message,
      });
      return errorResult(error);
    }
  };

  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputShape,
      annotations: tool.annotations,
    },
    // The SDK infers the argument type from `inputSchema`; our handlers are
    // uniformly typed over a record, so the signature is widened here.
    handler as never,
  );
}

export interface BuiltServer {
  server: McpServer;
  client: ControlMClient;
  config: AppConfig;
  logger: Logger;
  spec?: LoadedSpec;
  toolCount: number;
}

export async function buildServer(): Promise<BuiltServer> {
  const config = loadConfig();
  const logger = initLogger(config.logging.level, config.logging.pretty);

  logger.info('server.starting', {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    baseUrl: config.baseUrl,
    readOnly: config.safety.readOnly,
    node: process.version,
  });

  const client = new ControlMClient(config, logger);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: { listChanged: true }, logging: {} },
      instructions:
        'Control-M Operations Copilot: an enterprise MCP server for the BMC Control-M Automation API 9.22.x.\n' +
        'Prefer these orchestrated workflow tools over chaining raw API calls — each performs many Automation ' +
        'API calls and returns a uniform step-by-step execution report:\n' +
        '  Lifecycle: install_and_validate_agent, upgrade_agent, upgrade_fleet, remediate_agent\n' +
        '  Delivery:  deploy_application, run_and_monitor_job\n' +
        '  Analysis:  agent_health_report, environment_summary, health_check_workflow, collect_diagnostics, ' +
        'forecast_application, agent_inventory, generate_report\n' +
        'Typical triage path: health_check_workflow -> collect_diagnostics -> remediate_agent.\n' +
        'Typical release path: deploy_application -> run_and_monitor_job -> forecast_application.\n' +
        'Low-level tools are grouped by API domain: session (controlm_*), configuration (list_agents, ' +
        'add_agent, ping_agent, test_agent), provisioning (provision_*), run (run_job, order_folder, ' +
        'hold_job, free_job, kill_job), deploy (build, deploy), forecast (get_forecast, poll_forecast), ' +
        'reporting (list_reports, run_report, list_alerts), security (manage_users, manage_roles, ' +
        'manage_secrets).\n' +
        'ctm_describe_api lists the tools generated from the OpenAPI document. ' +
        'Destructive operations require an explicit `confirm: true` argument, and fleet-wide changes ' +
        'default to dryRun=true.',
    },
  );

  const registered = new Set<string>();
  const tools: ToolDefinition[] = [
    ...createCoreTools(client, config, logger),
    ...createWorkflowTools(client, config, logger),
  ];

  let spec: LoadedSpec | undefined;
  if (config.openapi.enabled) {
    try {
      spec = await loadSpec(config, logger);
    } catch (error) {
      logger.error('openapi.load.failed', { message: (error as Error).message });
    }
  }

  tools.push(createApiCatalogTool(spec, config.openapi.toolPrefix));

  for (const tool of tools) {
    if (registered.has(tool.name)) {
      logger.warn('tool.duplicate.skipped', { tool: tool.name });
      continue;
    }
    registerTool(server, tool, logger);
    registered.add(tool.name);
  }

  if (spec) {
    const generated = generateToolsFromSpec({
      spec,
      client,
      config,
      logger,
      reservedNames: registered,
    });
    for (const tool of generated.tools) {
      if (registered.has(tool.name)) continue;
      registerTool(server, tool, logger);
      registered.add(tool.name);
    }
  }

  logger.info('server.ready', {
    tools: registered.size,
    openapiTools: spec ? registered.size - tools.length : 0,
    specSource: spec?.source,
  });

  return { server, client, config, logger, spec, toolCount: registered.size };
}

async function main(): Promise<void> {
  const built = await buildServer();
  const { server, client, logger } = built;

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('server.connected', { transport: 'stdio' });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('server.shutdown', { signal });
    try {
      await client.logout();
    } catch {
      // Already logged inside the auth manager.
    }
    try {
      await server.close();
    } catch {
      // Transport may already be gone.
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandledRejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('process.uncaughtException', { message: error.message, stack: error.stack });
    void shutdown('uncaughtException');
  });
}

const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);

if (entryPoint === selfPath) {
  main().catch((error: unknown) => {
    const normalized = error instanceof ControlMError ? error : toControlMError(error, 'startup');
    getLogger().error('server.startupFailed', normalized.toJSON());
    process.exit(1);
  });
}
