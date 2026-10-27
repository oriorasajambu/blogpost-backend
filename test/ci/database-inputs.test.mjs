import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { digest } from '../../src/platform/config/build-model.ts';
import { expectedDatabaseSql } from '../../scripts/ci/evidence/database-inputs.mjs';
import { fixture } from './fixtures.mjs';
import { databaseFixture, sql, now } from '../deploy/database-fixtures.mjs';

test('database expectations bind immutable SQL/baseline Git blobs rather than working files or caller hashes', async (t) => {
  const f = await fixture(t, '0.1.0');
  const id = '202610270001_fixture',
    bytes = 'SELECT 1;\n';
  const migrations = [
    { id, sha256: createHash('sha256').update(bytes).digest('hex') },
  ];
  const definitions = { relations: [] };
  const baseline = {
    schemaVersion: 1,
    postgresMajor: 17,
    definitions,
    schemaDigest: digest(definitions),
    migrationDigest: digest(migrations),
    permissionDigest: 'a'.repeat(64),
  };
  await f.write('prisma/migrations/' + id + '/migration.sql', bytes);
  await f.write(
    'config/database/schema-baseline.json',
    JSON.stringify(baseline),
  );
  const initial = f.commit();
  const expected = expectedDatabaseSql(f.root, initial);
  assert.deepEqual(expected.migrations, migrations);
  assert.equal(expected.permissionDigest, baseline.permissionDigest);
  await f.write(
    'config/database/schema-baseline.json',
    'PRIVATE_MALFORMED_INPUT',
  );
  await f.write('prisma/migrations/' + id + '/migration.sql', 'SELECT 2;\n');
  assert.deepEqual(expectedDatabaseSql(f.root, initial), expected);
  const malformed = f.commit();
  assert.throws(() => expectedDatabaseSql(f.root, malformed));
  await f.write(
    'config/database/schema-baseline.json',
    JSON.stringify(baseline),
  );
  const mismatched = f.commit();
  assert.throws(() => expectedDatabaseSql(f.root, mismatched), {
    code: 'EXPECTED_MIGRATIONS_DISAGREE',
  });
  assert.throws(() => expectedDatabaseSql(f.root, initial + '\n'));
});
test('database CLI distinguishes file observations and rejects ambiguous/private input without cloud access', async (t) => {
  const repo = await fixture(t, '0.1.0');
  for (const migration of sql.migrations)
    await repo.write(
      'prisma/migrations/' + migration.id + '/migration.sql',
      await readFile(
        'prisma/migrations/' + migration.id + '/migration.sql',
        'utf8',
      ),
    );
  await repo.write(
    'config/database/schema-baseline.json',
    await readFile('config/database/schema-baseline.json', 'utf8'),
  );
  const sha = repo.commit();
  const f = databaseFixture();
  f.provenance.sourceSha = sha;
  f.job.template.labels['blogpost-source-sha'] = sha;
  f.execution.labels['blogpost-source-sha'] = sha;
  f.logPage.entries[0].jsonPayload.builtFromSha = sha;
  const offset = Date.now() - now;
  const shift = (v) => new Date(Date.parse(v) + offset).toISOString();
  f.context.notBefore = shift(f.context.notBefore);
  for (const resource of [f.execution, f.tasks.tasks[0]])
    for (const key of [
      'createTime',
      'startTime',
      'completionTime',
      'updateTime',
    ])
      if (resource[key]) resource[key] = shift(resource[key]);
  for (const key of ['timestamp', 'receiveTimestamp'])
    f.logPage.entries[0][key] = shift(f.logPage.entries[0][key]);
  f.logPage.entries[0].jsonPayload.verifiedAt = shift(
    f.logPage.entries[0].jsonPayload.verifiedAt,
  );
  const paths = new Map();
  for (const [name, value] of [
    ['provenance', f.provenance],
    ['target', f.target],
    ['context', f.context],
    [
      'observations',
      {
        project: f.project,
        job: f.job,
        execution: f.execution,
        tasks: f.tasks,
        logPage: f.logPage,
      },
    ],
  ]) {
    const path = resolve(repo.root, name + '.json');
    await writeFile(path, JSON.stringify(value));
    paths.set(name, path);
  }
  const args = [...paths].flatMap(([name, path]) => ['--' + name, path]);
  const script = resolve('scripts/ci/verify-database.mjs');
  const result = await promisify(execFile)(
    process.execPath,
    [script, ...args],
    { cwd: repo.root },
  );
  assert.equal(JSON.parse(result.stdout).evidenceSource, 'provided-json');
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [script, ...args, '--access-token-file', 'unread-secret'],
      { cwd: repo.root },
    ),
    (error) => {
      assert.equal(error.stdout, '');
      assert.equal(JSON.parse(error.stderr).code, 'INVALID_DATABASE_INPUT');
      return true;
    },
  );
  await writeFile(paths.get('observations'), 'PRIVATE_DIAGNOSTIC');
  await assert.rejects(
    promisify(execFile)(process.execPath, [script, ...args], {
      cwd: repo.root,
    }),
    (error) => {
      assert.equal(error.stdout, '');
      assert.ok(!error.stderr.includes('PRIVATE_DIAGNOSTIC'));
      return true;
    },
  );
});
