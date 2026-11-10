import type { AppConfig } from '../config.js';
import type { ControlMClient } from '../controlm-client.js';
import type { Logger } from '../logger.js';
import type { ToolDefinition } from '../tool-generator.js';
import { createAgentTools } from './agent-tools.js';
import { createAuthTools } from './auth-tools.js';
import { createDeployTools } from './deploy-tools.js';
import { createForecastTools } from './forecast-tools.js';
import { createProvisioningTools } from './provisioning-tools.js';
import { createReportingTools } from './reporting-tools.js';
import { createSecurityTools } from './security-tools.js';
import { createWorkloadTools } from './workload-tools.js';

export { resolveServerNames } from './agent-tools.js';

/**
 * First-class tools covering the Control-M Automation API domains:
 * session/authentication, configuration, provisioning, run, deploy,
 * forecast, reporting, secrets, users and roles.
 */
export function createCoreTools(
  client: ControlMClient,
  config: AppConfig,
  logger: Logger,
): ToolDefinition[] {
  return [
    ...createAuthTools(client),
    ...createAgentTools(client),
    ...createProvisioningTools(client),
    ...createWorkloadTools(client),
    ...createDeployTools(client),
    ...createForecastTools(client, logger),
    ...createReportingTools(client, config, logger),
    ...createSecurityTools(client),
  ];
}
