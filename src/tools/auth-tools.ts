import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import type { ToolDefinition } from '../tool-generator.js';

export function createAuthTools(client: ControlMClient): ToolDefinition[] {
  return [
    {
      name: 'controlm_login',
      description:
        'Authenticates against the Control-M Automation API and caches the session token. ' +
        'Credentials come from the server environment and are never accepted as tool input.',
      inputShape: {
        force: z
          .boolean()
          .optional()
          .describe('Discard any cached token and perform a fresh login. Default false.'),
      },
      annotations: { title: 'Control-M login', readOnlyHint: false, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => {
        if (args.force === true) {
          await client.refreshToken();
        } else {
          await client.login();
        }
        return { ok: true, session: client.sessionState() };
      },
    },
    {
      name: 'controlm_logout',
      description: 'Invalidates the current Control-M session token on the server and clears the local cache.',
      inputShape: {},
      annotations: { title: 'Control-M logout', idempotentHint: true },
      handler: async () => {
        const result = await client.logout();
        return { ok: true, result, session: client.sessionState() };
      },
    },
    {
      name: 'controlm_refresh_token',
      description:
        'Forces a token refresh by re-authenticating. Use when a long-running workflow may outlive the session TTL.',
      inputShape: {},
      annotations: { title: 'Refresh Control-M token', idempotentHint: true },
      handler: async () => {
        await client.refreshToken();
        return { ok: true, session: client.sessionState() };
      },
    },
    {
      name: 'controlm_session_status',
      description: 'Reports whether a Control-M session token is cached, its origin and remaining lifetime.',
      inputShape: {},
      annotations: { title: 'Control-M session status', readOnlyHint: true, openWorldHint: false },
      handler: async () => ({ baseUrl: client.baseUrl, session: client.sessionState() }),
    },
  ];
}
