import { z } from 'zod';
import type { ControlMClient } from '../controlm-client.js';
import { toMultipartFiles, type ToolDefinition } from '../tool-generator.js';

const FileSchema = z.object({
  field: z
    .string()
    .optional()
    .describe('Multipart field name. Defaults to "definitionsFile".'),
  filename: z.string().min(1).describe('File name, e.g. "AccountsPayable.json".'),
  content: z.string().min(1).describe('File content. JSON job definitions, or base64 when encoding is "base64".'),
  encoding: z.enum(['utf8', 'base64']).optional().describe('Encoding of `content`. Default "utf8".'),
  contentType: z.string().optional().describe('MIME type. Default "application/json".'),
});

type FileInput = z.infer<typeof FileSchema>;

function normalizeFiles(files: FileInput[]) {
  return toMultipartFiles(
    files.map((file) => ({
      field: file.field ?? 'definitionsFile',
      filename: file.filename,
      content: file.content,
      encoding: file.encoding ?? 'utf8',
      contentType: file.contentType ?? 'application/json',
    })),
  );
}

function summarize(results: unknown) {
  const list = Array.isArray(results) ? results : [results];
  const errors = list.flatMap((item) => {
    const record = item as Record<string, unknown> | null;
    return Array.isArray(record?.errors) ? record.errors : [];
  });
  const warnings = list.flatMap((item) => {
    const record = item as Record<string, unknown> | null;
    return Array.isArray(record?.warnings) ? record.warnings : [];
  });
  return {
    success: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    results: list,
  };
}

export function createDeployTools(client: ControlMClient): ToolDefinition[] {
  return [
    {
      name: 'build',
      description:
        'Validates Control-M job/folder definition files without deploying them. ' +
        'Returns per-file counts plus any validation errors and warnings.',
      inputShape: {
        files: z.array(FileSchema).min(1).describe('Definition files to validate.'),
      },
      annotations: { title: 'Build (validate) Control-M definitions', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) =>
        summarize(await client.build(normalizeFiles(args.files as FileInput[]))),
    },
    {
      name: 'deploy',
      description:
        'Deploys Control-M job, folder, connection-profile or driver definitions to a Control-M/Server. ' +
        'Run `build` first to validate.',
      inputShape: {
        files: z.array(FileSchema).min(1).describe('Definition files to deploy.'),
        deployDescriptorFile: z
          .string()
          .optional()
          .describe('Optional deploy descriptor JSON content applied to the deployment.'),
        fields: z
          .record(z.string())
          .optional()
          .describe('Additional multipart form fields accepted by the deploy endpoint.'),
      },
      annotations: { title: 'Deploy Control-M definitions' },
      handler: async (args: Record<string, unknown>) => {
        const files = normalizeFiles(args.files as FileInput[]);
        if (typeof args.deployDescriptorFile === 'string') {
          files.push({
            field: 'deployDescriptorFile',
            filename: 'deployDescriptor.json',
            content: Buffer.from(args.deployDescriptorFile, 'utf8'),
            contentType: 'application/json',
          });
        }
        const fields = (args.fields as Record<string, string> | undefined) ?? {};
        return summarize(await client.deploy(files, fields));
      },
    },
    {
      name: 'deploy_status',
      description: 'Retrieves the status of a previously submitted asynchronous deployment.',
      inputShape: {
        deploymentId: z.string().min(1).describe('Deployment id returned by the deploy operation.'),
      },
      annotations: { title: 'Deployment status', readOnlyHint: true, idempotentHint: true },
      handler: async (args: Record<string, unknown>) => client.getDeployStatus(String(args.deploymentId)),
    },
  ];
}
