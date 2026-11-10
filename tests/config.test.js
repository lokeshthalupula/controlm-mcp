import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('defaults to read-only with remediation disabled when safety variables are blank', () => {
  const script = [
    "import { loadConfig } from './dist/config.js';",
    'const { safety } = loadConfig();',
    'process.stdout.write(JSON.stringify(safety));',
  ].join(' ');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CONTROLM_BASE_URL: 'https://controlm.example.test/automation-api',
      CONTROLM_TOKEN: 'test-token',
      CONTROLM_READ_ONLY: '',
      CONTROLM_ALLOW_REMEDIATION: '',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { readOnly: true, allowRemediation: false });
});
