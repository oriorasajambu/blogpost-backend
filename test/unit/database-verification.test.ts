import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  migrationState,
  type MigrationRow,
} from '../../src/ops/database-model.js';
import { databaseExecution } from '../../src/ops/database-receipt.js';
import type { AppConfig } from '../../src/platform/config/config.js';
import { cloudProvenance } from '../build-fixture.js';

const manifest = [
  { id: '202610250001_first', sha256: 'a'.repeat(64) },
  { id: '202610250002_next', sha256: 'b'.repeat(64) },
];
const row = (index: number): MigrationRow => ({
  id: randomUUID(),
  migration_name: manifest[index]!.id,
  checksum: manifest[index]!.sha256,
  started_at: new Date('2026-10-25T00:00:00Z'),
  finished_at: new Date('2026-10-25T00:01:00Z'),
  rolled_back_at: null,
  applied_steps_count: 1,
});
test('migration audit rejects altered, unresolved, duplicate, unknown and non-prefix applied history', () => {
  assert.deepEqual(
    migrationState(manifest, []).pending,
    manifest.map((m) => m.id),
  );
  assert.deepEqual(migrationState(manifest, [row(0)]).pending, [
    manifest[1]!.id,
  ]);
  assert.deepEqual(migrationState(manifest, [row(1), row(0)]).pending, []);
  for (const rows of [
    [{ ...row(0), checksum: 'c'.repeat(64) }],
    [{ ...row(0), finished_at: null }],
    [row(0), row(0)],
    [{ ...row(0), migration_name: '202610250003_unknown' }],
    [row(1)],
    [{ ...row(0), started_at: new Date('2026-10-26T00:00:00Z') }],
    [{ ...row(0), rolled_back_at: new Date('2026-10-25T00:02:00Z') }],
  ])
    assert.throws(() => migrationState(manifest, rows));
  const failed = {
    ...row(0),
    checksum: 'c'.repeat(64),
    finished_at: null,
    rolled_back_at: new Date('2026-10-25T00:02:00Z'),
  };
  const successful = [row(0), row(1)];
  const repaired = migrationState(manifest, [failed, ...successful]);
  assert.equal(repaired.resolvedAttempts, 1);
  assert.deepEqual(repaired.pending, []);
  assert.notEqual(
    repaired.historyDigest,
    migrationState(manifest, successful).historyDigest,
  );
});
test('cloud SQL receipts require one actual first-attempt job execution and cannot use development identity', () => {
  const config = {
    environment: 'staging',
    build: cloudProvenance,
  } as AppConfig;
  const env = {
    CLOUD_RUN_JOB: 'blogpost-verify',
    CLOUD_RUN_EXECUTION: 'blogpost-verify-abc12',
    CLOUD_RUN_TASK_INDEX: '0',
    CLOUD_RUN_TASK_ATTEMPT: '0',
    CLOUD_RUN_TASK_COUNT: '1',
  };
  assert.equal(
    databaseExecution(config, env),
    'projects/blogpost-staging/locations/asia-southeast2/jobs/blogpost-verify/executions/blogpost-verify-abc12',
  );
  for (const changed of [
    { ...env, CLOUD_RUN_JOB: '' },
    { ...env, CLOUD_RUN_JOB: 'bad\n' },
    { ...env, CLOUD_RUN_EXECUTION: 'another/path' },
    { ...env, CLOUD_RUN_TASK_INDEX: '1' },
    { ...env, CLOUD_RUN_TASK_ATTEMPT: '1' },
  ])
    assert.throws(() => databaseExecution(config, changed));
  assert.equal(
    databaseExecution({ ...config, environment: 'development' }, env),
    null,
  );
});
