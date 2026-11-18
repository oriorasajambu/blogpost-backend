import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { auditExceptions, auditFailures } from '../../scripts/ci/audit.mjs';

const now = new Date('2026-11-18T00:00:00Z');
const exception = {
  prefix: 'docker/auth',
  advisory: 'GHSA-fc5q-39xc-vjpf',
  package: 'picomatch',
  reason: 'No patched release; dev/CI-only emulator dependency.',
  expires: '2027-01-18',
};
const policy = (...exceptions) => ({ schemaVersion: 1, exceptions });
const advisory = (name, id, severity) => ({
  source: 1,
  name,
  severity,
  url: 'https://github.com/advisories/' + id,
});
const report = (...vias) => ({
  vulnerabilities: Object.fromEntries(
    vias.map((via, index) => [
      via.name + index,
      { name: via.name, severity: via.severity, via: [via, 'other-package'] },
    ]),
  ),
});
const picomatch = advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high');

test('the committed audit exception policy is valid', async () => {
  const committed = JSON.parse(
    await readFile('config/ci/audit-exceptions.json', 'utf8'),
  );
  assert.ok(auditExceptions(committed).length <= 10);
});

test('an excepted advisory passes while other advisories at or above the level fail', () => {
  assert.deepEqual(
    auditFailures(
      report(picomatch),
      policy(exception),
      'docker/auth',
      'high',
      now,
    ),
    [],
  );
  assert.deepEqual(
    auditFailures(
      report(
        picomatch,
        advisory('hono', 'GHSA-4m76-xfj5-7975', 'moderate'),
        advisory('glob', 'GHSA-3g3m-2fjr-6pw4', 'critical'),
      ),
      policy(exception),
      'docker/auth',
      'high',
      now,
    ),
    ['glob: GHSA-3g3m-2fjr-6pw4 (critical)'],
  );
});

test('an exception is scoped to its package and advisory', () => {
  assert.deepEqual(
    auditFailures(
      report(advisory('minimatch', 'GHSA-fc5q-39xc-vjpf', 'high')),
      policy(exception),
      'docker/auth',
      'high',
      now,
    ),
    [
      'GHSA-fc5q-39xc-vjpf for picomatch is no longer reported; remove its exception.',
      'minimatch: GHSA-fc5q-39xc-vjpf (high)',
    ],
  );
});

test('a stale exception fails so it is removed once the fix ships', () => {
  assert.deepEqual(
    auditFailures(report(), policy(exception), 'docker/auth', 'high', now),
    [
      'GHSA-fc5q-39xc-vjpf for picomatch is no longer reported; remove its exception.',
    ],
  );
});

test('expired, malformed, duplicated or out-of-scope exceptions are rejected', () => {
  for (const bad of [
    policy({ ...exception, expires: '2026-11-17' }),
    policy({ ...exception, prefix: '.' }),
    policy({ ...exception, advisory: 'CVE-2026-0001' }),
    policy({ ...exception, reason: 'short' }),
    policy({ ...exception, extra: true }),
    policy(exception, exception),
    { schemaVersion: 2, exceptions: [] },
  ])
    assert.throws(() => auditExceptions(bad, now));
});

test('an unreadable or failed audit report fails closed', () => {
  for (const bad of [null, {}, { error: { code: 'ENOLOCK' } }])
    assert.throws(() =>
      auditFailures(bad, policy(), 'docker/auth', 'high', now),
    );
  assert.throws(() =>
    auditFailures(report(), policy(), 'docker/auth', 'severe', now),
  );
});
