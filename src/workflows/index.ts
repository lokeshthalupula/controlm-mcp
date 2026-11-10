import type { AppConfig } from '../config.js';
import type { ControlMClient } from '../controlm-client.js';
import type { Logger } from '../logger.js';
import type { ToolDefinition } from '../tool-generator.js';
import { createAgentHealthReportTool } from './agent-health-report.js';
import { createAgentInventoryTool } from './agent-inventory.js';
import { createInstallAgentWorkflow, createUpgradeAgentWorkflow } from './agent-provisioning-workflows.js';
import { createDeployApplicationWorkflow, createRunJobWorkflow } from './delivery-workflows.js';
import { createEnvironmentSummaryTool } from './environment-summary.js';
import { createForecastApplicationTool } from './forecast-application.js';
import { createGenerateReportTool } from './generate-report.js';
import { createCollectDiagnosticsTool, createHealthCheckWorkflow } from './observability-workflows.js';
import { createRemediateAgentTool } from './remediate-agent.js';
import { createUpgradeFleetTool } from './upgrade-fleet.js';

/**
 * Control-M Operations Copilot tool surface.
 *
 * Each entry chains multiple Automation API calls behind one invocation and
 * returns a uniform step-by-step execution report.
 */
export function createWorkflowTools(
  client: ControlMClient,
  config: AppConfig,
  logger: Logger,
): ToolDefinition[] {
  return [
    // Inventory and reporting
    createAgentInventoryTool(client, logger),
    createAgentHealthReportTool(client, config, logger),
    createEnvironmentSummaryTool(client, logger),
    createGenerateReportTool(client, logger),

    // Provisioning and lifecycle
    createInstallAgentWorkflow(client, config, logger),
    createUpgradeAgentWorkflow(client, logger),
    createUpgradeFleetTool(client, config, logger),
    createRemediateAgentTool(client, config, logger),

    // Delivery
    createDeployApplicationWorkflow(client, logger),
    createRunJobWorkflow(client, logger),

    // Analysis
    createForecastApplicationTool(client, logger),
    createHealthCheckWorkflow(client, config, logger),
    createCollectDiagnosticsTool(client, config, logger),
  ];
}
