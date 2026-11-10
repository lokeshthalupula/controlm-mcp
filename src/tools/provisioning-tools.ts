import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { ProvisionInstallRequest } from '../types.js';

const installShape = {
  server: z.string().min(1).describe('Control-M/Server that will own the agent.'),
  host: z.string().min(1).describe('Target host where the agent is installed.'),
  version: z
    .string()
    .optional()
    .describe('Agent version from the provisioning repository, e.g. "9.0.21.200". Defaults to the latest image.'),
  installationPath: z.string().optional().describe('Installation directory on the target host.'),
  user: z.string().optional().describe('Operating-system account used to run the agent.'),
  port: z.number().int().min(1).max(65_535).optional().describe('Agent server-to-agent port.'),
  extra: z
    .record(z.unknown())
    .optional()
    .describe('Additional provisioning attributes passed through verbatim to the API.'),
};

function toRequest(args: Record<string, unknown>): ProvisionInstallRequest {
  const { extra, ...rest } = args as Record<string, unknown> & { extra?: Record<string, unknown> };
  const payload: Record<string, unknown> = { ...rest, ...(extra ?? {}) };
  delete payload.confirm;
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  return payload as ProvisionInstallRequest;
}

export function createProvisioningTools(client: ControlMClient): ToolDefinition[] {
  return [
    {
      name: 'provision_install_agent',
      description:
        'Low-level provisioning call: installs a Control-M/Agent on a remote host from the provisioning ' +
        'repository and returns an operation id. Prefer install_and_validate_agent, which also waits for ' +
        'completion and validates the result.',
      inputShape: installShape,
      annotations: { title: 'Install Control-M agent' },
      handler: async (args: Record<string, unknown>) => client.installAgent(toRequest(args)),
    },
    {
      name: 'provision_upgrade_agent',
      description:
        'Low-level provisioning call: upgrades an installed Control-M/Agent to a newer repository version. ' +
        'Prefer upgrade_agent (single host) or upgrade_fleet (campaign), which validate the outcome.',
      inputShape: installShape,
      annotations: { title: 'Upgrade Control-M agent' },
      handler: async (args: Record<string, unknown>) => client.upgradeAgent(toRequest(args)),
    },
    {
      name: 'provision_uninstall_agent',
      description:
        'Low-level provisioning call: uninstalls a Control-M/Agent from a remote host. Destructive: the agent ' +
        'binaries and local job data are removed.',
      inputShape: {
        server: installShape.server,
        host: installShape.host,
        installationPath: installShape.installationPath,
        user: installShape.user,
        confirm: z.literal(true).describe('Must be true. Explicit acknowledgement of an irreversible uninstall.'),
      },
      annotations: { title: 'Uninstall Control-M agent', destructiveHint: true },
      handler: async (args: Record<string, unknown>) => client.uninstallAgent(toRequest(args)),
    },
    {
      name: 'provision_status',
      description: 'Returns the status of an asynchronous provisioning operation (install, upgrade or uninstall).',
      inputShape: {
        operationId: z.string().min(1).describe('Operation id returned by a provision_* tool or an agent workflow.'),
      },
      annotations: { title: 'Provisioning status', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => client.getProvisionStatus(String(args.operationId)),
    },
    {
      name: 'repository_management',
      description:
        'Manages the Control-M provisioning repository of agent/plug-in images: list available images, ' +
        'add an image, or delete an image.',
      inputShape: {
        action: z.enum(['list', 'add', 'delete']).describe('Repository operation to perform.'),
        os: z.string().optional().describe('Operating system filter or target, e.g. "Linux" or "Windows".'),
        name: z.string().optional().describe('Image name. Required for "add" and "delete".'),
        version: z.string().optional().describe('Image version. Required for "add".'),
      },
      annotations: { title: 'Provisioning repository management' },
      handler: async (args: Record<string, unknown>) => {
        const action = String(args.action);

        if (action === 'list') {
          return { action, images: await client.listRepositoryPackages(args.os as string | undefined) };
        }

        if (action === 'add') {
          if (!args.name || !args.version || !args.os) {
            return {
              error: true,
              code: 'VALIDATION_ERROR',
              message: 'Action "add" requires name, version and os.',
            };
          }
          return { action, result: await client.addRepositoryPackage(String(args.name), String(args.version), String(args.os)) };
        }

        if (!args.name) {
          return { error: true, code: 'VALIDATION_ERROR', message: 'Action "delete" requires name.' };
        }
        return { action, result: await client.deleteRepositoryPackage(String(args.name)) };
      },
    },
  ];
}
