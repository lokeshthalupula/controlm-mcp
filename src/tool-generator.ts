import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import type { AppConfig } from './config.js';
import { ControlMClient, type MultipartFile } from './controlm-client.js';
import { ControlMError } from './errors.js';
import type { Logger } from './logger.js';
import { describe, jsonSchemaToZod, type JSONSchema } from './schema-builder.js';
import { parameterSchema, type LoadedSpec, type OpenAPIParameter, type ResolvedOperation } from './swagger-loader.js';

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  inputShape: ZodRawShape;
  annotations?: ToolAnnotations;
  handler: (args: TArgs) => Promise<unknown>;
}

const MAX_TOOL_NAME_LENGTH = 64;

const TOOL_ALIASES: Record<string, string> = {
  createToken: 'create_api_token',
  updateToken: 'update_api_token',
  deleteToken: 'delete_api_token',
  getTokenData: 'get_api_token',
  getTokenList: 'list_api_tokens',
  updateMyPassword: 'update_user_password',
  getDeployedConnectionProfiles: 'list_deployed_connection_profiles',
  getLocalConnectionProfiles: 'list_local_connection_profiles',
  getSharedConnectionProfiles: 'list_shared_connection_profiles',
  getDeployedConnectionProfilesStatus: 'get_connection_profile_status',
  getConnectionProfilesDeploymentStatus: 'get_connection_profile_deployment_status',
  testConnectionProfile: 'test_connection_profile',
  testCentralizedConnectionProfile: 'test_shared_connection_profile',
  deleteConnectionProfile: 'delete_connection_profile',
  deleteLocalConnectionProfile: 'delete_local_connection_profile',
  deleteSharedConnectionProfile: 'delete_shared_connection_profile',
  deployAiJobtype: 'deploy_ai_jobtype',
  getDeployedAiJobtypes: 'list_ai_jobtypes',
  getDeployedFolders: 'list_deployed_folders',
  getDeployedFoldersNew: 'list_deployed_jobs',
  deleteFolder: 'delete_folder',
  getDeployedCalendars: 'list_calendars',
  deleteCalendar: 'delete_calendar',
  searchJobs: 'search_archive_jobs',
  getArchiveJobLog: 'get_archive_job_log',
  getArchiveJobOutput: 'get_archive_job_output',
  runNow: 'run_job_now',
  confirmJob: 'confirm_job',
  setToOK: 'set_job_ok',
  deleteJob: 'delete_active_job',
  undeleteJob: 'undelete_job',
  getActiveJob: 'get_active_job',
  getWaitingInfo: 'get_waiting_info',
  getSiteStandardFieldRestrictions: 'get_site_standard_restrictions',
  setSiteStandardFieldRestrictions: 'set_site_standard_restrictions',
  getSiteStandardPolicies: 'get_site_standard_policies',
  deploySiteStandardPolicies: 'deploy_site_standard_policies',
  getEligibleAgentsForUpgrade: 'get_upgrade_candidates',
  getUpgradeActivityStatusPerUpgradeId: 'get_upgrade_status',
  getUpgradeActivityLog: 'get_upgrade_log',
  retryUpgradeActivity: 'retry_upgrade',
  cancelUpgradeActivity: 'cancel_upgrade',
  deleteUpgradeActivity: 'delete_upgrade_activity',
  transformFile: 'transform_file',
  downloadReportByName: 'download_report',
  getReportByName: 'get_report_definition',
  listSecrets: 'list_secrets',
  addSecret: 'create_secret',
  updateSecret: 'update_secret',
  deleteSecret: 'delete_secret',
};

function operationToolName(prefix: string, operationId: string): string {
  return TOOL_ALIASES[operationId] ?? sanitizeToolName(prefix, operationId);
}

export function sanitizeToolName(prefix: string, rawName: string): string {
  const normalized = rawName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
  return `${safePrefix}${normalized}`.slice(0, MAX_TOOL_NAME_LENGTH);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesAny(patterns: RegExp[], candidates: string[]): boolean {
  return patterns.some((pattern) => candidates.some((candidate) => pattern.test(candidate)));
}

const DESTRUCTIVE_PATTERN = /(delete|remove|uninstall|kill|purge|drop|undeploy|terminate|set.?to.?ok)/i;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function buildParamShape(params: OpenAPIParameter[], forceRequired: boolean): ZodRawShape {
  const shape: ZodRawShape = {};
  for (const parameter of params) {
    const schema = parameterSchema(parameter);
    const zodSchema = describe(jsonSchemaToZod(schema), {
      ...schema,
      description: parameter.description ?? schema.description,
    } as JSONSchema);
    const required = forceRequired || parameter.required === true;
    shape[parameter.name] = required ? zodSchema : zodSchema.optional();
  }
  return shape;
}

const MultipartFileSchema = z.object({
  field: z.string().describe('Multipart form field name, e.g. "definitionsFile".'),
  filename: z.string().describe('File name sent to Control-M, e.g. "AccountsPayable.json".'),
  content: z.string().describe('File content. Plain text, or base64 when `encoding` is "base64".'),
  encoding: z.enum(['utf8', 'base64']).optional().describe('Encoding of `content`. Default "utf8".'),
  contentType: z.string().optional().describe('MIME type. Default "application/octet-stream".'),
});

export type MultipartFileInput = z.infer<typeof MultipartFileSchema>;

export function toMultipartFiles(files: MultipartFileInput[]): MultipartFile[] {
  return files.map((file) => ({
    field: file.field,
    filename: file.filename,
    contentType: file.contentType,
    content:
      file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8'),
  }));
}

function buildOperationDescription(operation: ResolvedOperation): string {
  const parts: string[] = [];
  parts.push(operation.summary?.trim() || `${operation.method} ${operation.path}`);
  if (operation.description && operation.description.trim() !== operation.summary?.trim()) {
    parts.push(operation.description.trim());
  }
  parts.push(`Control-M Automation API: ${operation.method} ${operation.path}`);
  if (operation.tags.length > 0) parts.push(`Tags: ${operation.tags.join(', ')}`);
  if (operation.deprecated) parts.push('DEPRECATED.');
  return parts.join('\n').slice(0, 1_000);
}

function expandPath(template: string, pathArgs: Record<string, unknown>, operationId: string): string {
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = pathArgs[name];
    if (value === undefined || value === null || value === '') {
      throw new ControlMError(`Missing required path parameter "${name}" for operation ${operationId}.`, {
        code: 'VALIDATION_ERROR',
        operation: operationId,
      });
    }
    return encodeURIComponent(String(value));
  });
}

export interface GenerateOptions {
  spec: LoadedSpec;
  client: ControlMClient;
  config: AppConfig;
  logger: Logger;
  /** Tool names already registered by first-class modules; generated duplicates are skipped. */
  reservedNames: Set<string>;
}

export interface GenerationResult {
  tools: ToolDefinition[];
  skipped: number;
  total: number;
}

/**
 * Turns every operationId in the Control-M OpenAPI document into a strongly typed
 * MCP tool. Path/query/header parameters and the request body become validated
 * Zod inputs; execution is delegated to the shared Axios client so retries,
 * authentication and error normalization are applied uniformly.
 */
export function generateToolsFromSpec(options: GenerateOptions): GenerationResult {
  const { spec, client, config, logger, reservedNames } = options;
  const log = logger.child('tool-generator');

  const includePatterns = config.openapi.include.map(globToRegExp);
  const excludePatterns = config.openapi.exclude.map(globToRegExp);

  const tools: ToolDefinition[] = [];
  const used = new Set(reservedNames);
  let skipped = 0;

  for (const operation of spec.operations) {
    if (tools.length >= config.openapi.maxTools) {
      log.warn('openapi.tools.limitReached', { limit: config.openapi.maxTools });
      skipped += 1;
      continue;
    }

    const candidates = [operation.operationId, ...operation.tags, `${operation.method} ${operation.path}`];
    if (includePatterns.length > 0 && !matchesAny(includePatterns, candidates)) {
      skipped += 1;
      continue;
    }
    if (excludePatterns.length > 0 && matchesAny(excludePatterns, candidates)) {
      skipped += 1;
      continue;
    }

    const destructive = operation.method === 'DELETE' || DESTRUCTIVE_PATTERN.test(operation.operationId);
    if (config.safety.readOnly && (destructive || operation.method !== 'GET')) {
      skipped += 1;
      continue;
    }

    let name = operationToolName(config.openapi.toolPrefix, operation.operationId);
    if (used.has(name)) {
      const suffix = `_${operation.method.toLowerCase()}`;
      name = `${name.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
      let counter = 2;
      while (used.has(name)) {
        const tail = `_${counter}`;
        name = `${name.slice(0, MAX_TOOL_NAME_LENGTH - tail.length)}${tail}`;
        counter += 1;
      }
    }
    used.add(name);

    const inputShape: ZodRawShape = {
      ...buildParamShape(operation.pathParams, true),
      ...buildParamShape(operation.queryParams, false),
    };

    if (operation.headerParams.length > 0) {
      inputShape.headers = z
        .object(buildParamShape(operation.headerParams, false))
        .partial()
        .optional()
        .describe('Optional request headers defined by this operation.');
    }

    if (operation.multipart) {
      inputShape.files = z
        .array(MultipartFileSchema)
        .min(1)
        .describe('Files uploaded as multipart/form-data.');
      if (operation.formParams.length > 0) {
        inputShape.fields = z
          .object(buildParamShape(operation.formParams, false))
          .partial()
          .optional()
          .describe('Additional multipart form fields.');
      }
    } else if (operation.bodySchema) {
      const bodySchema: ZodTypeAny = describe(jsonSchemaToZod(operation.bodySchema), operation.bodySchema);
      inputShape.body = operation.bodyRequired
        ? bodySchema.describe('Request body.')
        : bodySchema.optional().describe('Optional request body.');
    }

    const requiresConfirmation = MUTATING_METHODS.has(operation.method);
    if (requiresConfirmation) {
      inputShape._confirm = z
        .literal(true)
        .describe('Required acknowledgement before this API write is executed. Must be true.');
    }

    const pathParamNames = new Set(operation.pathParams.map((parameter) => parameter.name));
    const queryParamNames = new Set(operation.queryParams.map((parameter) => parameter.name));

    tools.push({
      name,
      description:
        buildOperationDescription(operation) +
        (requiresConfirmation ? '\nExplicit write confirmation required: set `_confirm` to true.' : ''),
      inputShape,
      annotations: {
        title: operation.summary ?? operation.operationId,
        readOnlyHint: !MUTATING_METHODS.has(operation.method),
        destructiveHint: destructive,
        idempotentHint: ['GET', 'PUT', 'DELETE', 'HEAD'].includes(operation.method),
        openWorldHint: true,
      },
      handler: async (args: Record<string, unknown>) => {
        if (requiresConfirmation && args._confirm !== true) {
          throw new ControlMError(`Explicit confirmation required: set _confirm=true for ${operation.operationId}.`, {
            code: 'VALIDATION_ERROR',
            operation: operation.operationId,
          });
        }

        const pathArgs: Record<string, unknown> = {};
        const query: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(args)) {
          if (pathParamNames.has(key)) pathArgs[key] = value;
          else if (queryParamNames.has(key)) query[key] = value;
        }

        const headers = (args.headers as Record<string, string> | undefined) ?? undefined;
        const url = expandPath(operation.path, pathArgs, operation.operationId);

        if (operation.multipart) {
          const files = toMultipartFiles((args.files as MultipartFileInput[] | undefined) ?? []);
          const fields = Object.fromEntries(
            Object.entries((args.fields as Record<string, unknown> | undefined) ?? {}).map(([key, value]) => [
              key,
              String(value),
            ]),
          );
          return client.request({
            method: operation.method as never,
            path: url,
            query,
            headers,
            form: ControlMClient.buildMultipart(files, fields),
            operation: operation.operationId,
          });
        }

        return client.request({
          method: operation.method as never,
          path: url,
          query,
          headers,
          body: args.body,
          operation: operation.operationId,
        });
      },
    });
  }

  log.info('openapi.tools.generated', {
    generated: tools.length,
    skipped,
    total: spec.operations.length,
  });

  return { tools, skipped, total: spec.operations.length };
}

/** Lightweight introspection tool so a model can discover the generated surface. */
export function createApiCatalogTool(spec: LoadedSpec | undefined, prefix: string): ToolDefinition {
  return {
    name: `${prefix}describe_api`,
    description:
      'Lists Control-M Automation API operations discovered from the OpenAPI document, ' +
      'including the generated MCP tool name, HTTP method and path. Use it to find the right tool.',
    inputShape: {
      search: z.string().optional().describe('Case-insensitive filter over operationId, path, summary or tag.'),
      tag: z.string().optional().describe('Restrict results to a single OpenAPI tag.'),
      limit: z.number().int().min(1).max(500).optional().describe('Maximum operations to return. Default 100.'),
    },
    annotations: { title: 'Describe Control-M API', readOnlyHint: true, openWorldHint: false },
    handler: async (args: Record<string, unknown>) => {
      if (!spec) {
        return {
          available: false,
          message:
            'No OpenAPI document is loaded. Set CONTROLM_OPENAPI_PATH or CONTROLM_OPENAPI_URL to enable generated tools.',
        };
      }

      const search = typeof args.search === 'string' ? args.search.toLowerCase() : undefined;
      const tag = typeof args.tag === 'string' ? args.tag.toLowerCase() : undefined;
      const limit = typeof args.limit === 'number' ? args.limit : 100;

      const matches = spec.operations
        .filter((operation) => {
          if (tag && !operation.tags.some((entry) => entry.toLowerCase() === tag)) return false;
          if (!search) return true;
          const haystack = [
            operation.operationId,
            operation.path,
            operation.summary ?? '',
            operation.tags.join(' '),
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(search);
        })
        .slice(0, limit)
        .map((operation) => ({
          tool: operationToolName(prefix, operation.operationId),
          operationId: operation.operationId,
          method: operation.method,
          path: operation.path,
          summary: operation.summary,
          tags: operation.tags,
          deprecated: operation.deprecated,
        }));

      return {
        available: true,
        source: spec.source,
        title: spec.title,
        version: spec.version,
        totalOperations: spec.operations.length,
        returned: matches.length,
        operations: matches,
      };
    },
  };
}
