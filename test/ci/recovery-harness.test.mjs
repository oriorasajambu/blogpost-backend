import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('recovery rehearsal rejects destinations, supplied archives and ambiguous flags before Docker or database access', () => {
  const script = fileURLToPath(
    new URL('../../scripts/dev/test-recovery.mjs', import.meta.url),
  );
  for (const args of [
    ['--host', 'unapproved-destination'],
    ['--database-url', 'unapproved-destination'],
    ['--archive', 'unapproved-archive'],
    ['--build', '--build'],
    ['--build', '--output', 'unapproved-output'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      env: { ...process.env, SQL_HOST: 'unapproved-destination' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: npm run test:recovery/);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('unapproved-'));
  }
});
