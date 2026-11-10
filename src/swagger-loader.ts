import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import yaml from 'js-yaml';
import type { AppConfig } from './config.js';
import { ControlMError } from './errors.js';
import { createHttpsAgent } from './http.js';
import type { Logger } from './logger.js';
import type { JSONSchema } from './schema-builder.js';

export interface OpenAPIParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie' | 'formData' | 'body';
  description?: string;
  required?: boolean;
  schema?: JSONSchema;
  /** Swagger 2.0 inlines the type on the parameter itself. */
  type?: string;
  format?: string;
  items?: JSONSchema;
  enum?: unknown[];
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: {
    description?: string;
    required?: boolean;
    content?: Record<string, { schema?: JSONSchema }>;
  };
  consumes?: string[];
  responses?: Record<string, unknown>;
  deprecated?: boolean;
}

export interface OpenAPIDocument {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url: string }>;
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, Record<string, OpenAPIOperation | OpenAPIParameter[] | unknown>>;
  components?: { schemas?: Record<string, JSONSchema> };
  definitions?: Record<string, JSONSchema>;
}

export interface ResolvedOperation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated: boolean;
  pathParams: OpenAPIParameter[];
  queryParams: OpenAPIParameter[];
  headerParams: OpenAPIParameter[];
  /** Dereferenced request body schema, when the operation accepts JSON. */
  bodySchema?: JSONSchema;
  bodyRequired: boolean;
  /** True when the endpoint expects multipart/form-data (deploy/build style). */
  multipart: boolean;
  formParams: OpenAPIParameter[];
}

export interface LoadedSpec {
  document: OpenAPIDocument;
  source: string;
  title: string;
  version: string;
  operations: ResolvedOperation[];
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

const DEFAULT_LOCAL_CANDIDATES = [
  'openapi/controlm-9.22.json',
  'openapi/controlm-9.22.yaml',
  'openapi/swagger.json',
  'swagger.json',
  'openapi.json',
];

const REMOTE_CANDIDATES = ['/swagger.json', '/openapi.json', '/swagger/v1/swagger.json', '/api-docs'];

function parseSpec(raw: string, source: string): OpenAPIDocument {
  const trimmed = raw.trimStart();
  try {
    if (trimmed.startsWith('{')) return JSON.parse(raw) as OpenAPIDocument;
    return yaml.load(raw) as OpenAPIDocument;
  } catch (error) {
    throw new ControlMError(`Failed to parse OpenAPI document from ${source}: ${(error as Error).message}`, {
      code: 'OPENAPI_ERROR',
      cause: error,
    });
  }
}

async function loadFromFile(filePath: string): Promise<{ raw: string; source: string } | undefined> {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!existsSync(absolute)) return undefined;
  return { raw: await readFile(absolute, 'utf8'), source: absolute };
}

async function loadFromUrl(
  url: string,
  config: AppConfig,
): Promise<{ raw: string; source: string } | undefined> {
  try {
    const response = await axios.get(url, {
      timeout: config.http.timeoutMs,
      httpsAgent: createHttpsAgent(config),
      responseType: 'text',
      transformResponse: [(value: unknown) => value],
      headers: { Accept: 'application/json, application/yaml, text/plain' },
    });
    return { raw: String(response.data), source: url };
  } catch {
    return undefined;
  }
}

/** Resolves local `$ref` pointers against the document root, with cycle protection. */
export function createResolver(document: OpenAPIDocument) {
  const cache = new Map<string, JSONSchema>();

  function resolvePointer(ref: string): JSONSchema | undefined {
    if (!ref.startsWith('#/')) return undefined;
    const segments = ref.slice(2).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
    let current: unknown = document;
    for (const segment of segments) {
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current as JSONSchema | undefined;
  }

  function deref(schema: JSONSchema | undefined, seen = new Set<string>(), depth = 0): JSONSchema | undefined {
    if (!schema || depth > 12) return schema;

    if (schema.$ref) {
      const ref = schema.$ref;
      if (seen.has(ref)) return { type: 'object', description: `Recursive reference to ${ref}` };
      const cached = cache.get(ref);
      if (cached) return cached;

      const target = resolvePointer(ref);
      if (!target) return { type: 'object', description: `Unresolved reference ${ref}` };

      const nextSeen = new Set(seen).add(ref);
      const resolved = deref(target, nextSeen, depth + 1) ?? {};
      cache.set(ref, resolved);
      return resolved;
    }

    const out: JSONSchema = { ...schema };

    if (schema.properties) {
      out.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [key, deref(value, seen, depth + 1) ?? {}]),
      );
    }
    if (schema.items) {
      out.items = Array.isArray(schema.items)
        ? schema.items.map((item) => deref(item, seen, depth + 1) ?? {})
        : deref(schema.items, seen, depth + 1);
    }
    for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
      const list = schema[key];
      if (Array.isArray(list)) {
        out[key] = list.map((entry) => deref(entry, seen, depth + 1) ?? {});
      }
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      out.additionalProperties = deref(schema.additionalProperties as JSONSchema, seen, depth + 1);
    }

    return out;
  }

  return { deref };
}

function parameterToSchema(parameter: OpenAPIParameter): JSONSchema {
  if (parameter.schema) return parameter.schema;
  const schema: JSONSchema = { type: parameter.type ?? 'string' };
  if (parameter.format) schema.format = parameter.format;
  if (parameter.items) schema.items = parameter.items;
  if (parameter.enum) schema.enum = parameter.enum;
  if (parameter.description) schema.description = parameter.description;
  return schema;
}

function deriveOperationId(method: string, routePath: string): string {
  const slug = routePath
    .replace(/\{([^}]+)\}/g, 'by_$1')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .join('_');
  return `${method.toLowerCase()}_${slug}`.slice(0, 96);
}

export function extractOperations(document: OpenAPIDocument, logger: Logger): ResolvedOperation[] {
  const resolver = createResolver(document);
  const operations: ResolvedOperation[] = [];
  const seenIds = new Set<string>();

  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    const sharedParams = (pathItem as Record<string, unknown>).parameters as OpenAPIParameter[] | undefined;

    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method] as OpenAPIOperation | undefined;
      if (!operation || typeof operation !== 'object') continue;

      const rawParams = [...(sharedParams ?? []), ...(operation.parameters ?? [])];
      const params = rawParams
        .map((parameter) => {
          const resolved = (parameter as { $ref?: string }).$ref
            ? (resolver.deref(parameter as unknown as JSONSchema) as unknown as OpenAPIParameter)
            : parameter;
          return resolved;
        })
        .filter((parameter): parameter is OpenAPIParameter => Boolean(parameter?.name && parameter?.in));

      let operationId = operation.operationId?.trim() || deriveOperationId(method, routePath);
      if (seenIds.has(operationId)) {
        operationId = `${operationId}_${method}`;
        let suffix = 2;
        while (seenIds.has(operationId)) {
          operationId = `${operationId}_${suffix}`;
          suffix += 1;
        }
      }
      seenIds.add(operationId);

      const content = operation.requestBody?.content ?? {};
      const jsonKey = Object.keys(content).find((key) => key.includes('json'));
      const multipartKey = Object.keys(content).find(
        (key) => key.includes('multipart') || key.includes('x-www-form-urlencoded'),
      );
      const swaggerBodyParam = params.find((parameter) => parameter.in === 'body');
      const formDataParams = params.filter((parameter) => parameter.in === 'formData');

      const bodySchemaRaw =
        (jsonKey ? content[jsonKey]?.schema : undefined) ??
        swaggerBodyParam?.schema ??
        (multipartKey ? content[multipartKey]?.schema : undefined);

      const multipart = Boolean(
        multipartKey ||
          formDataParams.length > 0 ||
          operation.consumes?.some((value) => value.includes('multipart')),
      );

      operations.push({
        operationId,
        method: method.toUpperCase(),
        path: routePath,
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags ?? [],
        deprecated: Boolean(operation.deprecated),
        pathParams: params.filter((parameter) => parameter.in === 'path'),
        queryParams: params.filter((parameter) => parameter.in === 'query'),
        headerParams: params.filter((parameter) => parameter.in === 'header'),
        bodySchema: resolver.deref(bodySchemaRaw),
        bodyRequired: Boolean(operation.requestBody?.required || swaggerBodyParam?.required),
        multipart,
        formParams: formDataParams,
      });
    }
  }

  logger.info('openapi.operations.extracted', { count: operations.length });
  return operations;
}

export function parameterSchema(parameter: OpenAPIParameter): JSONSchema {
  return parameterToSchema(parameter);
}

/**
 * Loads the Control-M swagger/openapi document from (in order):
 * explicit URL, explicit file path, well-known local files, well-known remote endpoints.
 * Returns `undefined` when no spec can be located — the server then runs with
 * first-class tools only.
 */
export async function loadSpec(config: AppConfig, logger: Logger): Promise<LoadedSpec | undefined> {
  const log = logger.child('swagger');
  const attempts: Array<() => Promise<{ raw: string; source: string } | undefined>> = [];

  if (config.openapi.url) attempts.push(() => loadFromUrl(config.openapi.url!, config));
  if (config.openapi.path) attempts.push(() => loadFromFile(config.openapi.path!));
  for (const candidate of DEFAULT_LOCAL_CANDIDATES) {
    attempts.push(() => loadFromFile(candidate));
  }
  for (const candidate of REMOTE_CANDIDATES) {
    attempts.push(() => loadFromUrl(`${config.baseUrl}${candidate}`, config));
  }

  for (const attempt of attempts) {
    let loaded: { raw: string; source: string } | undefined;
    try {
      loaded = await attempt();
    } catch (error) {
      log.debug('openapi.load.attemptFailed', { message: (error as Error).message });
      continue;
    }
    if (!loaded) continue;

    const document = parseSpec(loaded.raw, loaded.source);
    if (!document.paths || Object.keys(document.paths).length === 0) {
      log.warn('openapi.load.noPaths', { source: loaded.source });
      continue;
    }

    const operations = extractOperations(document, log);
    log.info('openapi.load.success', {
      source: loaded.source,
      title: document.info?.title,
      version: document.info?.version,
      operations: operations.length,
    });

    return {
      document,
      source: loaded.source,
      title: document.info?.title ?? 'Control-M Automation API',
      version: document.info?.version ?? '9.22',
      operations,
    };
  }

  log.warn('openapi.load.notFound', {
    hint: 'Set CONTROLM_OPENAPI_PATH or CONTROLM_OPENAPI_URL to enable generated tools.',
  });
  return undefined;
}
