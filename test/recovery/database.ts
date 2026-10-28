import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/platform/config/config.js';
import { readProvenance } from '../../src/platform/config/provenance.js';
import { digest } from '../../src/platform/config/build-model.js';
import {
  connection,
  migrationUrl,
} from '../../src/platform/database/connection.js';
import {
  APP_TABLES,
  migrationManifest,
  tablePrivileges,
} from '../../src/ops/database-model.js';
import {
  readMigrationState,
  schemaSnapshot,
  expectedSchema,
} from '../../src/ops/database-verification.js';
import {
  StorageAdapter,
  hashBytes,
  type StoredObject,
} from '../../src/modules/media/storage.js';
import { normalizeImage } from '../../src/modules/media/image-normalizer.js';
import { type VariantObject } from '../../src/modules/media/media.repository.js';
import { metadata } from '../helpers.js';

// This command has no configurable destination. The outer runner owns both tmpfs servers.
const phases = [
  'initialize',
  'upgrade-source',
  'restored-prefix',
  'atomic-restore',
  'upgrade-restored',
];
const phase = process.argv[2]!;
assert.ok(phases.includes(phase));
assert.equal(process.argv.length, 3);
assert.equal(process.env.BLOGPOST_DISPOSABLE_RECOVERY, '1');
const runId = process.env.BLOGPOST_RECOVERY_RUN_ID!;
assert.match(runId, /^[a-f0-9]{12}$/);
assert.equal(process.env.SQL_HOST, 'db');
assert.equal(process.env.SQL_DATABASE, 'blogpost');
assert.equal(process.env.MEDIA_LOCAL_ROOT, '/data/media/source');
assert.equal(process.env.SQL_APP_PASSWORD, 'disposable-recovery-app');
assert.equal(process.env.SQL_MIGRATOR_PASSWORD, 'disposable-recovery-migrator');
assert.equal(process.env.SQL_ROOT_PASSWORD, 'disposable-recovery-root');
assert.equal(process.env.SQL_ROOT_USER ?? 'postgres', 'postgres');
assert.equal(process.env.SQL_PORT ?? '5432', '5432');
assert.equal(
  process.env.IDENTITY_PROJECT_ID,
  'demo-blogpost-recovery-' + runId,
);
assert.equal(readProvenance().environment, 'development');
const path = '/app/.local/recovery';
await mkdir(path, { recursive: true });
const manifest = await migrationManifest();
assert.deepEqual(
  manifest.map((item) => item.id),
  [
    '202610250001_foundation',
    '202610250002_invariants',
    '202610260003_english_search',
    '202610260004_media_upload_leases',
    '202610270005_maintenance_tombstones',
  ],
);
const tables = [...APP_TABLES]
  .filter((name) => name !== 'MaintenanceCheckpoint')
  .sort();
const ids = {
  post: '30000000-0000-4000-8000-000000000001',
  media: '50000000-0000-4000-8000-000000000001',
  attempt: '50000000-0000-4000-8000-000000000002',
  author: '10000000-0000-4000-8000-000000000002',
  late: '10000000-0000-4000-8000-000000000003',
};
type Columns = Record<string, string[]>;
type Snapshot = {
  dataDigest: string;
  counts: Record<string, number>;
  columns: Columns;
  schemaDigest: string;
  historyDigest: string;
  definitions: Record<string, unknown[]>;
};
type State = {
  runId: string;
  before: Snapshot;
  media: VariantObject[];
  checks: string[];
  castEquivalenceCases?: number;
};
const pool = (host: string) =>
  new pg.Pool({
    ...connection('root', { ...process.env, SQL_HOST: host }),
    max: 1,
  });
const source = pool('db'),
  restored = pool('restore-db');
let state: State;
async function job(
  name: 'bootstrap-db' | 'migrate' | 'inspect-db' | 'verify-db',
  host: string,
) {
  const env: NodeJS.ProcessEnv = { ...process.env, SQL_HOST: host };
  if (name !== 'bootstrap-db') delete env.SQL_ROOT_PASSWORD;
  if (name === 'verify-db') delete env.SQL_MIGRATOR_PASSWORD;
  const result = await promisify(execFile)(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/ops/' + name + '.ts'],
    { env, timeout: 150000, maxBuffer: 1048576 },
  );
  for (const name of [
    'SQL_APP_PASSWORD',
    'SQL_MIGRATOR_PASSWORD',
    'SQL_ROOT_PASSWORD',
  ])
    assert.ok(!result.stdout.includes(process.env[name]!));
  const records = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((line) => line.event === 'database_verification');
  if (name === 'bootstrap-db') return;
  assert.equal(records.length, 1);
  assert.equal(records[0].result, 'PASSED');
  assert.equal(records[0].builtFromSha, readProvenance().sourceSha);
  assert.equal(
    records[0].sourceInputDigest,
    readProvenance().sourceInputDigest,
  );
  return records[0];
}
async function snapshot(db: pg.Pool, columns?: Columns): Promise<Snapshot> {
  const client = await db.connect();
  try {
    if (!columns) {
      const inventory = await client.query<{
        table_name: string;
        column_name: string;
      }>(
        "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='blogpost' AND table_name=ANY($1) ORDER BY table_name,ordinal_position",
        [tables],
      );
      columns = Object.fromEntries(
        tables.map((name) => [
          name,
          inventory.rows
            .filter((row) => row.table_name === name)
            .map((row) => row.column_name),
        ]),
      );
    }
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const values = [],
      counts: Record<string, number> = {};
    for (const name of tables) {
      assert.ok(columns[name]?.length);
      const projection = columns[name]!.flatMap((column) => [
        pg.escapeLiteral(column),
        pg.escapeIdentifier(column),
      ]).join(',');
      const rows = (
        await client.query<{ row: string }>(
          'SELECT jsonb_build_object(' +
            projection +
            ')::text AS row FROM blogpost.' +
            pg.escapeIdentifier(name),
        )
      ).rows
        .map((row) => row.row)
        .sort();
      assert.ok(rows.length > 0 && rows.length <= 100);
      values.push({ table: name, rows });
      counts[name] = rows.length;
    }
    const history = await readMigrationState(client, manifest);
    await client.query('COMMIT');
    const schema = await schemaSnapshot(client);
    return {
      columns,
      counts,
      dataDigest: digest(values),
      schemaDigest: schema.schemaDigest,
      historyDigest: history.historyDigest,
      definitions: schema.definitions,
    };
  } finally {
    client.release(true);
  }
}
async function unchanged(db: pg.Pool, prefix = false) {
  const actual = await snapshot(db, state.before.columns);
  assert.equal(
    actual.dataDigest,
    state.before.dataDigest,
    'Existing application rows changed',
  );
  assert.deepEqual(actual.counts, state.before.counts);
  if (prefix) {
    for (const name of Object.keys(state.before.definitions)) {
      const observed = actual.definitions[name]!,
        expected = state.before.definitions[name]!;
      if (digest(observed) === digest(expected)) continue;
      const priorHashes = new Set(expected.map((row) => digest(row))),
        nextHashes = new Set(observed.map((row) => digest(row)));
      const changed = observed.find((row) => !priorHashes.has(digest(row))) as
        Record<string, unknown> | undefined;
      const prior =
        expected.find((row) => {
          const item = row as Record<string, unknown>;
          return (
            !nextHashes.has(digest(row)) &&
            item.name === changed?.name &&
            item.relation === changed?.relation
          );
        }) ?? expected.find((row) => !nextHashes.has(digest(row)));
      assert.deepEqual(changed, prior, 'Restored schema differs: ' + name);
    }
    assert.equal(actual.schemaDigest, state.before.schemaDigest);
    assert.equal(actual.historyDigest, state.before.historyDigest);
  } else
    assert.equal(actual.schemaDigest, (await expectedSchema()).schemaDigest);
  return actual;
}
async function mimeConstraintResults(db: pg.Pool) {
  const definition = (
    await db.query<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE conrelid='blogpost.\"MediaAsset\"'::regclass AND conname='media_ready'",
    )
  ).rows[0]!.definition;
  assert.ok(definition.startsWith('CHECK (') && definition.endsWith(')'));
  // Evaluate each real catalog expression against the same typed truth matrix;
  // no application rows or persisted constraints are changed by this query.
  const expression = definition.slice(7, -1);
  const results = await db.query<{
    value: boolean | null;
  }>(`SELECT (${expression}) AS value
    FROM unnest(ARRAY[NULL,'PROCESSING','READY','DELETING']::blogpost."MediaState"[]) WITH ORDINALITY AS s(state,si)
    CROSS JOIN unnest(ARRAY[NULL,0,1]::integer[]) WITH ORDINALITY AS w(width,wi)
    CROSS JOIN unnest(ARRAY[NULL,0,1]::integer[]) WITH ORDINALITY AS h(height,hi)
    CROSS JOIN unnest(ARRAY[NULL,'image/jpeg','image/png','image/webp','text/plain']::varchar(32)[]) WITH ORDINALITY AS m("mimeType",mi)
    CROSS JOIN unnest(ARRAY['[]','[{}]','[{},{},{}]','[{},{},{},{}]']::jsonb[]) WITH ORDINALITY AS v(variants,vi)
    ORDER BY si,wi,hi,mi,vi`);
  assert.equal(results.rows.length, 720);
  return results.rows.map((row) => row.value);
}
function apiConfig() {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.SQL_ROOT_PASSWORD;
  delete env.SQL_MIGRATOR_PASSWORD;
  return readConfig(env);
}
const storage = (root: 'source' | 'restored') =>
  new StorageAdapter({
    ...apiConfig(),
    media: { adapter: 'local', localRoot: '/data/media/' + root, bucket: null },
  });
async function publicChecks(host: string, mediaReady: boolean) {
  const original = process.env.SQL_HOST,
    originalRoot = process.env.MEDIA_LOCAL_ROOT,
    rootPassword = process.env.SQL_ROOT_PASSWORD!,
    migratorPassword = process.env.SQL_MIGRATOR_PASSWORD!;
  delete process.env.SQL_ROOT_PASSWORD;
  delete process.env.SQL_MIGRATOR_PASSWORD;
  process.env.SQL_HOST = host;
  process.env.MEDIA_LOCAL_ROOT =
    '/data/media/' + (host === 'db' ? 'source' : 'restored');
  const app = await createApp(readConfig());
  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://127.0.0.1:' + address.port;
    const article = await fetch(origin + '/v1/public/posts/' + ids.post, {
      headers: metadata,
    });
    assert.equal(article.status, 200);
    const text = await article.text();
    assert.ok(text.includes('Reliable recovery'));
    assert.ok(!text.includes('PRIVATE_RECOVERY_DRAFT'));
    const redirect = await fetch(
      origin + '/v1/public/posts/by-slug/recovery-old-url',
      {
        headers: metadata,
        redirect: 'manual',
      },
    );
    assert.equal(redirect.status, 200);
    const resolution = (await redirect.json()) as {
      data: { resolution: string; canonicalPath: string; post: null };
    };
    assert.equal(resolution.data.resolution, 'REDIRECT');
    assert.equal(resolution.data.canonicalPath, '/posts/reliable-recovery');
    assert.equal(resolution.data.post, null);
    for (const object of state.media) {
      const response = await fetch(
        origin +
          '/v1/public/posts/' +
          ids.post +
          '/media/' +
          ids.media +
          '/' +
          object.name,
        { headers: metadata },
      );
      assert.equal(response.status, mediaReady ? 200 : 503);
      if (mediaReady)
        assert.equal(
          hashBytes(Buffer.from(await response.arrayBuffer())),
          object.sha256,
        );
      else await response.arrayBuffer();
    }
  } finally {
    await app.close();
    process.env.SQL_HOST = original;
    process.env.MEDIA_LOCAL_ROOT = originalRoot;
    process.env.SQL_ROOT_PASSWORD = rootPassword;
    process.env.SQL_MIGRATOR_PASSWORD = migratorPassword;
  }
}
async function upgraded(db: pg.Pool, host: string) {
  const before = await job('inspect-db', host);
  assert.deepEqual(before.evidence.pending, [manifest.at(-1)!.id]);
  const migrated = await job('migrate', host);
  assert.deepEqual(migrated.evidence.newlyApplied, [manifest.at(-1)!.id]);
  const verified = await job('verify-db', host);
  assert.equal(verified.evidence.deniedProbes, 4);
  assert.equal(
    verified.evidence.permissionDigest,
    (await expectedSchema()).permissionDigest,
  );
  const again = await job('migrate', host);
  assert.deepEqual(again.evidence.newlyApplied, []);
  assert.equal(again.evidence.historyDigest, migrated.evidence.historyDigest);
  await unchanged(db);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS count FROM blogpost."MediaAsset" WHERE "deletionAfter" IS NOT NULL OR "objectsDeletedAt" IS NOT NULL',
      )
    ).rows[0].count,
    0,
  );
  const app = new pg.Pool({
    ...connection('app', { ...process.env, SQL_HOST: host }),
    max: 1,
  });
  try {
    await assert.rejects(
      app.query('UPDATE blogpost."Revision" SET title=title'),
      (error: { code: string }) => error.code === '42501',
    );
    await app.query('BEGIN');
    try {
      const post = '30000000-0000-4000-8000-000000000099';
      await app.query(
        'INSERT INTO blogpost."Post" (id,"authorId","creatorId","clientDraftId","updatedAt") VALUES($1,$2,$2,$1,now())',
        [post, ids.author],
      );
      await app.query(
        'INSERT INTO blogpost."SlugHistory"(slug,"postId",canonical) VALUES(\'recovery-tombstone\',$1,true)',
        [post],
      );
      await app.query(
        'UPDATE blogpost."Post" SET "canonicalSlug"=\'recovery-tombstone\' WHERE id=$1',
        [post],
      );
      await app.query('DELETE FROM blogpost."Post" WHERE id=$1', [post]);
      assert.deepEqual(
        (
          await app.query(
            'SELECT "postId",canonical FROM blogpost."SlugHistory" WHERE slug=\'recovery-tombstone\'',
          )
        ).rows,
        [{ postId: null, canonical: false }],
      );
    } finally {
      await app.query('ROLLBACK');
    }
  } finally {
    await app.end();
  }
  await unchanged(db);
}
try {
  const identities = [];
  for (const db of [source, restored]) {
    assert.deepEqual(
      (
        await db.query(
          'SELECT run_id FROM public.blogpost_disposable_recovery_run',
        )
      ).rows,
      [{ run_id: runId }],
    );
    identities.push(
      (
        await db.query(
          'SELECT system_identifier::text AS id FROM pg_control_system()',
        )
      ).rows[0].id,
    );
  }
  assert.notEqual(
    identities[0],
    identities[1],
    'Recovery requires distinct disposable PostgreSQL clusters',
  );
  if (phase === 'initialize') {
    for (const db of [source, restored])
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='blogpost'",
          )
        ).rows[0].count,
        0,
      );
    await job('bootstrap-db', 'db');
    await job('bootstrap-db', 'restore-db');
    const prefix = path + '/prefix/migrations';
    await mkdir(prefix, { recursive: true });
    await copyFile(
      'prisma/migrations/migration_lock.toml',
      prefix + '/migration_lock.toml',
    );
    for (const item of manifest.slice(0, 4)) {
      await mkdir(prefix + '/' + item.id);
      await copyFile(
        'prisma/migrations/' + item.id + '/migration.sql',
        prefix + '/' + item.id + '/migration.sql',
      );
    }
    assert.deepEqual(
      await migrationManifest(pathToFileURL(prefix + '/')),
      manifest.slice(0, 4),
    );
    await writeFile(
      path + '/prefix.config.ts',
      "import {defineConfig} from 'prisma/config'; export default defineConfig({schema:'/app/prisma/schema.prisma',migrations:{path:'/app/.local/recovery/prefix/migrations'},datasource:{url:process.env.DATABASE_URL!}});\n",
    );
    await promisify(execFile)(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        path + '/prefix.config.ts',
      ],
      {
        env: { ...process.env, DATABASE_URL: migrationUrl() },
        timeout: 120000,
        maxBuffer: 1048576,
      },
    );
    for (const table of tables)
      await source.query(
        'GRANT ' +
          tablePrivileges(table).join(',') +
          ' ON blogpost.' +
          pg.escapeIdentifier(table) +
          ' TO blogpost_app',
      );
    await source.query(await readFile('test/recovery/seed.sql', 'utf8'));
    const normalized = await normalizeImage(
      await readFile('contracts/fixtures/media/pixel.png'),
      'image/png',
    );
    const local = storage('source'),
      media: VariantObject[] = [];
    try {
      for (const variant of normalized.variants) {
        const plan = {
          name: variant.name,
          width: variant.width,
          height: variant.height,
          objectName:
            'blogpost/posts/' +
            ids.post +
            '/' +
            ids.media +
            '/' +
            ids.attempt +
            '/' +
            variant.name +
            '.png',
          mimeType: normalized.mimeType,
          sha256: hashBytes(variant.bytes),
          byteSize: variant.bytes.length,
        };
        media.push({ ...plan, ...(await local.put(plan, variant.bytes)) });
      }
    } finally {
      await local.onModuleDestroy();
    }
    await source.query(
      'INSERT INTO blogpost."MediaAsset" (id,"postId","uploaderId",state,"mimeType","byteSize",width,height,variants,"uploadAttemptId") VALUES($1,$2,$3,\'READY\',$4,$5,$6,$7,$8::jsonb,$9)',
      [
        ids.media,
        ids.post,
        ids.author,
        normalized.mimeType,
        media.reduce((total, item) => total + item.byteSize, 0),
        normalized.width,
        normalized.height,
        JSON.stringify(media),
        ids.attempt,
      ],
    );
    await source.query(
      'INSERT INTO blogpost."MediaUploadAttempt" (id,"mediaId",objects,"leaseExpiresAt","cleanupAfter","completedAt") VALUES($1,$2,$3::jsonb,\'2026-10-01T00:00:00Z\',\'2099-01-01T00:00:00Z\',\'2026-10-01T00:00:00Z\')',
      [ids.attempt, ids.media, JSON.stringify(media)],
    );
    await source.query(
      'INSERT INTO blogpost."RevisionMedia"("postId","revisionId","mediaId") VALUES($1,\'40000000-0000-4000-8000-000000000001\',$2)',
      [ids.post, ids.media],
    );
    state = {
      runId,
      before: await snapshot(source),
      media,
      checks: ['populated-prefix', 'normalized-source-media'],
    };
    assert.equal(Object.keys(state.before.counts).length, 17);
    const history = await job('inspect-db', 'db');
    assert.deepEqual(history.evidence.pending, [manifest.at(-1)!.id]);
    await unchanged(source, true);
  } else {
    state = JSON.parse(await readFile(path + '/state.json', 'utf8')) as State;
    assert.equal(state.runId, runId);
    if (phase === 'upgrade-source') {
      await upgraded(source, 'db');
      await publicChecks('db', true);
      await source.query(
        "INSERT INTO blogpost.\"Member\"(id,\"identityUid\",email,\"displayName\",handle,role,\"updatedAt\") VALUES($1,'after-backup','after-backup@recovery.example.test','After backup','after-backup','AUTHOR',now())",
        [ids.late],
      );
      state.checks.push(
        'populated-upgrade',
        'source-runtime-grants',
        'source-public-snapshot-media',
        'post-backup-write',
      );
    } else if (phase === 'restored-prefix' || phase === 'atomic-restore') {
      await unchanged(restored, true);
      assert.equal(
        (
          await restored.query(
            'SELECT count(*)::int AS count FROM blogpost."Member" WHERE id=$1',
            [ids.late],
          )
        ).rows[0].count,
        0,
      );
      if (phase === 'restored-prefix') {
        const originalTruth = await mimeConstraintResults(source),
          restoredTruth = await mimeConstraintResults(restored);
        assert.deepEqual(restoredTruth, originalTruth);
        assert.ok(
          originalTruth.includes(true) &&
            originalTruth.includes(false) &&
            originalTruth.includes(null),
        );
        state.castEquivalenceCases = originalTruth.length;
        const local = storage('restored');
        try {
          await assert.rejects(local.open(state.media[0] as StoredObject), {
            code: 'DEPENDENCY_UNAVAILABLE',
            status: 503,
          });
        } finally {
          await local.onModuleDestroy();
        }
        state.checks.push(
          'restored-prefix-schema-data-history',
          'backup-cutoff',
          'sql-backup-excludes-media',
        );
      } else state.checks.push('failed-restore-transaction-rollback');
    } else {
      await upgraded(restored, 'restore-db');
      await publicChecks('restore-db', false);
      const from = storage('source'),
        to = storage('restored');
      try {
        for (const object of state.media) {
          const chunks = [];
          for await (const chunk of await from.open(object as StoredObject))
            chunks.push(Buffer.from(chunk));
          const bytes = Buffer.concat(chunks);
          assert.equal(hashBytes(bytes), object.sha256);
          assert.deepEqual(await to.put(object, bytes), {
            objectName: object.objectName,
            generation: object.generation,
            sha256: object.sha256,
            byteSize: object.byteSize,
          });
        }
      } finally {
        await from.onModuleDestroy();
        await to.onModuleDestroy();
      }
      await publicChecks('restore-db', true);
      await unchanged(restored);
      state.checks.push(
        'restored-populated-upgrade',
        'restored-runtime-grants',
        'missing-media-api-failure',
        'restored-media-digests',
        'restored-public-snapshot-media',
      );
      await writeFile(
        path + '/report.json',
        JSON.stringify(
          {
            schemaVersion: 1,
            status: 'PASSED',
            scope: 'disposable-development-recovery-rehearsal',
            runId,
            artifact: readProvenance(),
            predecessor: {
              migrationIds: manifest.slice(0, 4).map((item) => item.id),
              migrationDigest: digest(manifest.slice(0, 4)),
              dataDigest: state.before.dataDigest,
              counts: state.before.counts,
              columns: state.before.columns,
              schemaDigest: state.before.schemaDigest,
              historyDigest: state.before.historyDigest,
            },
            candidate: {
              migrationDigest: digest(manifest),
              schemaDigest: (await expectedSchema()).schemaDigest,
            },
            mediaObjects: state.media.length,
            castEquivalenceCases: state.castEquivalenceCases,
            checks: state.checks,
            limitations: [
              'Synthetic populated four-to-five migration boundary, not a previous supported release.',
              'Local logical PostgreSQL dump/restore and filesystem media copy; does not prove Cloud SQL backups, GCS restore, human recovery approval, measured RPO/RTO or traffic rollback.',
            ],
          },
          null,
          2,
        ) + '\n',
      );
    }
  }
  await writeFile(path + '/state.json', JSON.stringify(state) + '\n');
  console.log(JSON.stringify({ phase, status: 'PASSED', runId }));
} finally {
  await source.end();
  await restored.end();
}
