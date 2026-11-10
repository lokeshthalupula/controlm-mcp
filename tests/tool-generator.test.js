import assert from 'node:assert/strict';
import test from 'node:test';
import { generateToolsFromSpec, sanitizeToolName } from '../dist/tool-generator.js';

function operation(overrides = {}) {
  return {
    operationId: 'getJobStatus',
    method: 'GET',
    path: '/run/jobs/status',
    tags: ['run'],
    deprecated: false,
    pathParams: [],
    queryParams: [],
    headerParams: [],
    bodyRequired: false,
    multipart: false,
    formParams: [],
    ...overrides,
  };
}

function generate(operations, { readOnly = false } = {}) {
  const requests = [];
  const logger = {
    child: () => ({ info() {}, warn() {} }),
  };
  const config = {
    openapi: { include: [], exclude: [], maxTools: 100, toolPrefix: 'ctm_' },
    safety: { readOnly },
  };
  const client = {
    request: async (request) => {
      requests.push(request);
      return request;
    },
  };
  const result = generateToolsFromSpec({
    spec: { operations },
    client,
    config,
    logger,
    reservedNames: new Set(),
  });
  return { ...result, requests };
}

test('sanitizes OpenAPI operation IDs into discoverable tool names', () => {
  assert.equal(sanitizeToolName('ctm_', 'getJobStatus'), 'ctm_get_job_status');
});

test('generates a read tool and forwards its API request', async () => {
  const { tools, requests } = generate([operation()]);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'ctm_get_job_status');

  await tools[0].handler({});
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].path, '/run/jobs/status');
});

test('requires explicit confirmation before generated writes', async () => {
  const { tools, requests } = generate([
    operation({ operationId: 'deleteJob', method: 'DELETE', path: '/run/job/{jobId}', pathParams: [
      { name: 'jobId', in: 'path', required: true, type: 'string' },
    ] }),
  ]);
  const [tool] = tools;

  await assert.rejects(tool.handler({ jobId: 'job-1' }), /_confirm=true/);
  assert.equal(requests.length, 0);

  await tool.handler({ jobId: 'job-1', _confirm: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/run/job/job-1');
});

test('does not expose generated writes in read-only mode', () => {
  const { tools, skipped } = generate(
    [operation(), operation({ operationId: 'runJob', method: 'POST', path: '/run/job' })],
    { readOnly: true },
  );
  assert.deepEqual(tools.map((tool) => tool.name), ['ctm_get_job_status']);
  assert.equal(skipped, 1);
});
