#!/usr/bin/env node
/**
 * Emits TypeScript interfaces for every schema in the Control-M OpenAPI document.
 * Usage: npm run build && npm run gen:types -- [outFile]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { initLogger } from '../logger.js';
import { jsonSchemaToTs, type JSONSchema } from '../schema-builder.js';
import { createResolver, loadSpec } from '../swagger-loader.js';

function toInterfaceName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  const pascal = cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return /^[0-9]/.test(pascal) ? `Schema${pascal}` : pascal || 'UnnamedSchema';
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = initLogger(config.logging.level, config.logging.pretty);

  const spec = await loadSpec(config, logger);
  if (!spec) {
    logger.error('gen-types.noSpec', {
      hint: 'Set CONTROLM_OPENAPI_PATH or CONTROLM_OPENAPI_URL before generating types.',
    });
    process.exit(1);
    return;
  }

  const schemas: Record<string, JSONSchema> =
    spec.document.components?.schemas ?? spec.document.definitions ?? {};
  const resolver = createResolver(spec.document);

  const lines: string[] = [
    '/* eslint-disable */',
    '// AUTO-GENERATED from the Control-M Automation API OpenAPI document.',
    `// Source: ${spec.source}`,
    `// Title: ${spec.title} ${spec.version}`,
    '// Do not edit by hand; run `npm run gen:types` instead.',
    '',
  ];

  const emitted = new Set<string>();
  for (const [name, schema] of Object.entries(schemas)) {
    let interfaceName = toInterfaceName(name);
    let suffix = 2;
    while (emitted.has(interfaceName)) {
      interfaceName = `${toInterfaceName(name)}${suffix}`;
      suffix += 1;
    }
    emitted.add(interfaceName);

    const resolved = resolver.deref(schema) ?? {};
    if (resolved.description) {
      lines.push(`/** ${resolved.description.replace(/\*\//g, '*\\/')} */`);
    }
    lines.push(`export type ${interfaceName} = ${jsonSchemaToTs(resolved)};`, '');
  }

  lines.push('/** Operation id -> { method, path } map for the discovered API surface. */');
  lines.push('export const CONTROLM_OPERATIONS = {');
  for (const operation of spec.operations) {
    lines.push(
      `  ${JSON.stringify(operation.operationId)}: { method: ${JSON.stringify(
        operation.method,
      )}, path: ${JSON.stringify(operation.path)} },`,
    );
  }
  lines.push('} as const;', '');
  lines.push('export type ControlMOperationId = keyof typeof CONTROLM_OPERATIONS;', '');

  const outFile = path.resolve(process.cwd(), process.argv[2] ?? 'src/generated/controlm-api.ts');
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, lines.join('\n'), 'utf8');

  logger.info('gen-types.done', {
    outFile,
    schemas: emitted.size,
    operations: spec.operations.length,
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).stack ?? String(error)}\n`);
  process.exit(1);
});
