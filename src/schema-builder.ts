import { z, type ZodTypeAny } from 'zod';

export interface JSONSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema | JSONSchema[];
  additionalProperties?: boolean | JSONSchema;
  allOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  example?: unknown;
  [key: string]: unknown;
}

const MAX_DEPTH = 12;

function first<T>(values: T[] | undefined): T | undefined {
  return values && values.length > 0 ? values[0] : undefined;
}

function mergeAllOf(schemas: JSONSchema[]): JSONSchema {
  const merged: JSONSchema = { type: 'object', properties: {}, required: [] };
  for (const schema of schemas) {
    if (schema.properties) Object.assign(merged.properties!, schema.properties);
    if (schema.required) merged.required!.push(...schema.required);
    if (schema.description && !merged.description) merged.description = schema.description;
    if (schema.additionalProperties !== undefined && merged.additionalProperties === undefined) {
      merged.additionalProperties = schema.additionalProperties;
    }
  }
  merged.required = Array.from(new Set(merged.required));
  return merged;
}

function applyStringConstraints(base: z.ZodString, schema: JSONSchema): ZodTypeAny {
  let out = base;
  if (typeof schema.minLength === 'number') out = out.min(schema.minLength);
  if (typeof schema.maxLength === 'number') out = out.max(schema.maxLength);
  if (typeof schema.pattern === 'string') {
    try {
      out = out.regex(new RegExp(schema.pattern));
    } catch {
      // An invalid or unsupported ECMAScript pattern must not break tool generation.
    }
  }
  switch (schema.format) {
    case 'date-time':
    case 'date':
    case 'uri':
    case 'email':
    case 'uuid':
      // Keep formats advisory: Control-M emits several non-RFC date shapes.
      break;
    default:
      break;
  }
  return out;
}

function applyNumberConstraints(base: z.ZodNumber, schema: JSONSchema): ZodTypeAny {
  let out = base;
  if (typeof schema.minimum === 'number') out = out.min(schema.minimum);
  if (typeof schema.maximum === 'number') out = out.max(schema.maximum);
  return out;
}

function primaryType(schema: JSONSchema): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((entry) => entry !== 'null');
  }
  return schema.type;
}

/**
 * Converts an (already dereferenced) JSON Schema fragment into a Zod schema.
 * Unknown or unsupported constructs degrade to `z.unknown()` rather than throwing,
 * so a single odd definition can never take down tool generation.
 */
export function jsonSchemaToZod(schema: JSONSchema | undefined, depth = 0): ZodTypeAny {
  if (!schema || depth > MAX_DEPTH) return z.unknown();

  if (schema.const !== undefined) {
    return z.literal(schema.const as never);
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum.filter((value) => typeof value === 'string') as string[];
    if (values.length === schema.enum.length && values.length > 0) {
      return values.length === 1
        ? z.literal(values[0]!)
        : z.enum(values as [string, ...string[]]);
    }
    return z.unknown();
  }

  if (schema.allOf?.length) {
    return jsonSchemaToZod(mergeAllOf(schema.allOf), depth + 1);
  }

  const union = schema.oneOf ?? schema.anyOf;
  if (union?.length) {
    const members = union.slice(0, 8).map((entry) => jsonSchemaToZod(entry, depth + 1));
    if (members.length === 1) return members[0]!;
    return z.union(members as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  const type = primaryType(schema);

  switch (type) {
    case 'string':
      return applyStringConstraints(z.string(), schema);
    case 'integer':
      return applyNumberConstraints(z.number().int(), schema);
    case 'number':
      return applyNumberConstraints(z.number(), schema);
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array': {
      const itemSchema = Array.isArray(schema.items) ? first(schema.items) : schema.items;
      let arr = z.array(jsonSchemaToZod(itemSchema, depth + 1));
      if (typeof schema.minItems === 'number') arr = arr.min(schema.minItems);
      if (typeof schema.maxItems === 'number') arr = arr.max(schema.maxItems);
      return arr;
    }
    case 'object':
    case undefined: {
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          return z.record(jsonSchemaToZod(schema.additionalProperties, depth + 1));
        }
        return type === 'object' ? z.record(z.unknown()) : z.unknown();
      }
      const required = new Set(schema.required ?? []);
      const shape: Record<string, ZodTypeAny> = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        const child = describe(jsonSchemaToZod(value, depth + 1), value);
        shape[key] = required.has(key) ? child : child.optional();
      }
      const object = z.object(shape);
      return schema.additionalProperties === false ? object.strict() : object.passthrough();
    }
    default:
      return z.unknown();
  }
}

export function describe(schema: ZodTypeAny, source: JSONSchema | undefined): ZodTypeAny {
  if (!source) return schema;
  const parts: string[] = [];
  if (source.description) parts.push(source.description);
  else if (source.title) parts.push(source.title);
  if (source.format) parts.push(`format: ${source.format}`);
  if (source.default !== undefined) parts.push(`default: ${JSON.stringify(source.default)}`);
  if (source.example !== undefined) parts.push(`example: ${JSON.stringify(source.example)}`);
  return parts.length > 0 ? schema.describe(parts.join(' | ')) : schema;
}

/** Emits a TypeScript type literal for an OpenAPI schema (used by `gen:types`). */
export function jsonSchemaToTs(schema: JSONSchema | undefined, depth = 0): string {
  if (!schema || depth > MAX_DEPTH) return 'unknown';

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  }

  if (schema.allOf?.length) {
    return schema.allOf.map((entry) => jsonSchemaToTs(entry, depth + 1)).join(' & ');
  }

  const union = schema.oneOf ?? schema.anyOf;
  if (union?.length) {
    return union.map((entry) => jsonSchemaToTs(entry, depth + 1)).join(' | ');
  }

  const type = primaryType(schema);
  const nullSuffix = schema.nullable || (Array.isArray(schema.type) && schema.type.includes('null')) ? ' | null' : '';

  switch (type) {
    case 'string':
      return `string${nullSuffix}`;
    case 'integer':
    case 'number':
      return `number${nullSuffix}`;
    case 'boolean':
      return `boolean${nullSuffix}`;
    case 'array': {
      const itemSchema = Array.isArray(schema.items) ? first(schema.items) : schema.items;
      return `Array<${jsonSchemaToTs(itemSchema, depth + 1)}>${nullSuffix}`;
    }
    case 'object':
    case undefined: {
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        return `Record<string, unknown>${nullSuffix}`;
      }
      const required = new Set(schema.required ?? []);
      const lines = Object.entries(schema.properties).map(([key, value]) => {
        const optional = required.has(key) ? '' : '?';
        const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
        return `  ${safeKey}${optional}: ${jsonSchemaToTs(value, depth + 1)};`;
      });
      return `{\n${lines.join('\n')}\n}${nullSuffix}`;
    }
    default:
      return 'unknown';
  }
}
