import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import type { ToolDefinition } from '../tool-generator.js';
import type { Role, User } from '../types.js';

export function createSecurityTools(client: ControlMClient): ToolDefinition[] {
  return [
    {
      name: 'manage_roles',
      description:
        'Manages Control-M authorization roles: list all roles, get one role, create, update or delete a role.',
      inputShape: {
        action: z.enum(['list', 'get', 'create', 'update', 'delete']).describe('Role operation to perform.'),
        name: z.string().optional().describe('Role name. Required for every action except "list".'),
        description: z.string().optional().describe('Role description for create/update.'),
        members: z.array(z.string()).optional().describe('User or group members assigned to the role.'),
        authorizations: z
          .array(z.record(z.unknown()))
          .optional()
          .describe('Authorization entries as defined by the Control-M security model.'),
        confirm: z.literal(true).optional().describe('Required when action is "delete".'),
      },
      annotations: { title: 'Manage Control-M roles' },
      handler: async (args: Record<string, unknown>) => {
        const action = String(args.action);

        if (action === 'list') return { action, roles: await client.listRoles() };

        if (!args.name) {
          return { error: true, code: 'VALIDATION_ERROR', message: `Action "${action}" requires name.` };
        }
        const name = String(args.name);

        if (action === 'get') return { action, role: await client.getRole(name) };

        if (action === 'delete') {
          if (args.confirm !== true) {
            return { error: true, code: 'VALIDATION_ERROR', message: 'Deleting a role requires confirm=true.' };
          }
          return { action, result: await client.deleteRole(name) };
        }

        const role: Role = {
          name,
          ...(args.description !== undefined ? { description: String(args.description) } : {}),
          ...(args.members !== undefined ? { members: args.members as string[] } : {}),
          ...(args.authorizations !== undefined ? { authorizations: args.authorizations as unknown[] } : {}),
        };
        return { action, result: await client.upsertRole(role, action === 'update') };
      },
    },
    {
      name: 'manage_users',
      description:
        'Manages Control-M authentication users: list all users, get one user, create, update or delete a user. ' +
        'Passwords are never echoed back in the response.',
      inputShape: {
        action: z.enum(['list', 'get', 'create', 'update', 'delete']).describe('User operation to perform.'),
        name: z.string().optional().describe('User name. Required for every action except "list".'),
        fullName: z.string().optional().describe('Display name for create/update.'),
        email: z.string().email().optional().describe('Contact email address.'),
        roles: z.array(z.string()).optional().describe('Roles assigned to the user.'),
        password: z
          .string()
          .optional()
          .describe('Initial password for create. Prefer a secret store; the value is redacted from logs.'),
        confirm: z.literal(true).optional().describe('Required when action is "delete".'),
      },
      annotations: { title: 'Manage Control-M users' },
      handler: async (args: Record<string, unknown>) => {
        const action = String(args.action);

        if (action === 'list') return { action, users: await client.listUsers() };

        if (!args.name) {
          return { error: true, code: 'VALIDATION_ERROR', message: `Action "${action}" requires name.` };
        }
        const name = String(args.name);

        if (action === 'get') return { action, user: await client.getUser(name) };

        if (action === 'delete') {
          if (args.confirm !== true) {
            return { error: true, code: 'VALIDATION_ERROR', message: 'Deleting a user requires confirm=true.' };
          }
          return { action, result: await client.deleteUser(name) };
        }

        const user: User = {
          name,
          ...(args.fullName !== undefined ? { fullName: String(args.fullName) } : {}),
          ...(args.email !== undefined ? { email: String(args.email) } : {}),
          ...(args.roles !== undefined ? { roles: args.roles as string[] } : {}),
          ...(args.password !== undefined ? { password: String(args.password) } : {}),
        };
        const result = await client.upsertUser(user, action === 'update');
        return { action, user: name, result };
      },
    },
    {
      name: 'manage_secrets',
      description:
        'Manages Control-M secrets used by connection profiles and jobs: list secret names, set a secret value, ' +
        'or delete a secret. Secret values are never returned.',
      inputShape: {
        action: z.enum(['list', 'set', 'delete']).describe('Secret operation to perform.'),
        name: z.string().optional().describe('Secret name. Required for "set" and "delete".'),
        value: z.string().optional().describe('Secret value for "set". Redacted from all logs.'),
        confirm: z.literal(true).optional().describe('Required when action is "delete".'),
      },
      annotations: { title: 'Manage Control-M secrets' },
      handler: async (args: Record<string, unknown>) => {
        const action = String(args.action);

        if (action === 'list') {
          const secrets = await client.listSecrets();
          const list = Array.isArray(secrets) ? secrets : [];
          return {
            action,
            secrets: list.map((entry) => {
              const record = entry as Record<string, unknown>;
              return { name: record?.name ?? String(entry) };
            }),
          };
        }

        if (!args.name) {
          return { error: true, code: 'VALIDATION_ERROR', message: `Action "${action}" requires name.` };
        }
        const name = String(args.name);

        if (action === 'delete') {
          if (args.confirm !== true) {
            return { error: true, code: 'VALIDATION_ERROR', message: 'Deleting a secret requires confirm=true.' };
          }
          return { action, name, result: await client.deleteSecret(name) };
        }

        if (typeof args.value !== 'string' || args.value.length === 0) {
          return { error: true, code: 'VALIDATION_ERROR', message: 'Action "set" requires a non-empty value.' };
        }
        await client.setSecret(name, args.value);
        return { action, name, result: 'Secret stored.' };
      },
    },
  ];
}
