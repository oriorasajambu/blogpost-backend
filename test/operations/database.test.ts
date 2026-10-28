import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { connection } from '../../src/platform/database/connection.js';
import { readProvenance } from '../../src/platform/config/provenance.js';
import { digest } from '../../src/platform/config/build-model.js';
import {
  migrationManifest,
  SCHEMA_LOCK,
} from '../../src/ops/database-model.js';
import {
  expectedSchema,
  readMigrationState,
  runtimePermissions,
  schemaSnapshot,
} from '../../src/ops/database-verification.js';
import { MaintenanceService } from '../../src/modules/operations/maintenance.service.js';
import { createOwnedSchema } from '../../src/ops/schema-owner.js';
import type { MediaStorage } from '../../src/modules/media/storage.js';

// This operator fixture requires its invocation-owned tmpfs database. It never
// loads saved stack env files and is not a shared Staging/Production test.
test(
  'migration audit, exact schema, least privilege and schema/maintenance coordination',
  { timeout: 120000 },
  async (t) => {
    assert.equal(process.env.BLOGPOST_DISPOSABLE_DATABASE, '1');
    assert.match(process.env.BLOGPOST_IDENTITY_RUN_ID!, /^[a-f0-9]{12}$/);
    assert.equal(process.env.SQL_HOST, 'db');
    assert.match(process.env.IDENTITY_PROJECT_ID!, /^demo-blogpost-identity-/);
    const root = new pg.Pool({ ...connection('root'), max: 2 });
    const app = new pg.Pool({ ...connection('app'), max: 2 });
    t.after(async () => {
      await app.end();
      await root.end();
    });
    const manifest = await migrationManifest();
    const originalEnv = { ...process.env };
    const execute = async (
      job: 'migrate' | 'inspect-db' | 'verify-db',
      success = true,
      code?: string,
    ) => {
      const env = { ...originalEnv };
      delete env.SQL_ROOT_PASSWORD;
      if (!['migrate', 'inspect-db'].includes(job))
        delete env.SQL_MIGRATOR_PASSWORD;
      let result: { stdout: string; stderr: string };
      try {
        result = await promisify(execFile)(
          process.execPath,
          ['node_modules/tsx/dist/cli.mjs', 'src/ops/' + job + '.ts'],
          { env, timeout: 20000 },
        );
      } catch (error) {
        if (success) throw error;
        const failure = error as { stdout?: string; stderr?: string };
        assert.equal(
          (failure.stdout ?? '').includes('"result":"PASSED"'),
          false,
        );
        const failed = JSON.parse(
          (failure.stderr ?? '').trim().split('\n').at(-1)!,
        );
        assert.equal(failed.event, 'job_failed');
        if (code) assert.equal(failed.code, code);
        return;
      }
      assert.equal(success, true, 'An unsafe SQL job unexpectedly succeeded');
      const lines = result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const records = lines.filter(
        (line) => line.event === 'database_verification',
      );
      assert.equal(records.length, 1);
      assert.equal(records[0].result, 'PASSED');
      assert.equal(records[0].environment, 'development');
      assert.equal(records[0].builtFromSha, readProvenance().sourceSha);
      assert.equal(
        records[0].runtimeInputDigest,
        readProvenance().runtimeInputDigest,
      );
      assert.equal(records[0].execution, null);
      for (const key of [
        'SQL_ROOT_PASSWORD',
        'SQL_MIGRATOR_PASSWORD',
        'SQL_APP_PASSWORD',
      ])
        assert.equal(result.stdout.includes(originalEnv[key]!), false);
      return records[0];
    };
    await t.test(
      'schema and complete runtime permissions agree with the fresh-migration baseline',
      async () => {
        const client = await app.connect();
        try {
          const expected = await expectedSchema();
          const observed = await schemaSnapshot(client);
          assert.equal(expected.migrationDigest, digest(manifest));
          assert.equal(observed.schemaDigest, expected.schemaDigest);
          const permissions = await runtimePermissions(client);
          assert.match(permissions.permissionDigest, /^[a-f0-9]{64}$/);
          assert.equal(permissions.deniedProbes, 4);
          assert.ok(
            permissions.connectionBudget.maximum >
              permissions.connectionBudget.reserved,
          );
        } finally {
          client.release(true);
        }
      },
    );
    await t.test(
      'actual entrypoints emit sanitized records and migration reruns preserve history',
      async () => {
        const first = await execute('migrate');
        const second = await execute('migrate');
        assert.deepEqual(second.evidence.pending, []);
        assert.deepEqual(second.evidence.newlyApplied, []);
        assert.equal(
          second.evidence.historyDigest,
          first.evidence.historyDigest,
        );
        const runtime = await execute('verify-db');
        assert.equal(
          runtime.evidence.migrationDigest,
          first.evidence.migrationDigest,
        );
      },
    );
    await t.test(
      'read-only history inspection observes pending work without SQL or grant mutation',
      async () => {
        const initial = await execute('inspect-db');
        assert.equal(initial.kind, 'HISTORY');
        assert.deepEqual(initial.evidence.pending, []);
        await root.query(
          'REVOKE SELECT ON blogpost."Member" FROM blogpost_app',
        );
        try {
          await execute('inspect-db');
          assert.equal(
            (
              await root.query(
                "SELECT has_table_privilege('blogpost_app','blogpost.\"Member\"','SELECT') AS allowed",
              )
            ).rows[0].allowed,
            false,
          );
        } finally {
          await root.query('GRANT SELECT ON blogpost."Member" TO blogpost_app');
        }
        const saved = (
          await root.query(
            'SELECT row_to_json(m) AS row FROM blogpost._prisma_migrations m ORDER BY migration_name DESC LIMIT 1',
          )
        ).rows[0].row;
        await root.query(
          'DELETE FROM blogpost._prisma_migrations WHERE id=$1',
          [saved.id],
        );
        try {
          const pending = await execute('inspect-db');
          assert.deepEqual(pending.evidence.pending, [manifest.at(-1)!.id]);
        } finally {
          await root.query(
            'INSERT INTO blogpost._prisma_migrations SELECT * FROM json_populate_record(NULL::blogpost._prisma_migrations,$1::json)',
            [JSON.stringify(saved)],
          );
        }
        assert.equal(
          (await execute('inspect-db')).evidence.historyDigest,
          initial.evidence.historyDigest,
        );
      },
    );
    await t.test(
      'a changed applied checksum is rejected before Prisma can treat it as a warning',
      async () => {
        const saved = (
          await root.query(
            'SELECT id,checksum FROM blogpost._prisma_migrations ORDER BY migration_name LIMIT 1',
          )
        ).rows[0];
        await root.query(
          'UPDATE blogpost._prisma_migrations SET checksum=$1 WHERE id=$2',
          ['0'.repeat(64), saved.id],
        );
        try {
          await execute('migrate', false, 'MIGRATION_CHECKSUM_MISMATCH');
        } finally {
          await root.query(
            'UPDATE blogpost._prisma_migrations SET checksum=$1 WHERE id=$2',
            [saved.checksum, saved.id],
          );
        }
      },
    );
    await t.test(
      'an unresolved failed attempt blocks; explicitly rolled-back repair remains auditable',
      async () => {
        const id = randomUUID();
        await root.query(
          `INSERT INTO blogpost._prisma_migrations(id,checksum,migration_name,started_at,applied_steps_count)
      VALUES($1,$2,$3,now()-interval '1 minute',0)`,
          [id, '0'.repeat(64), manifest[0]!.id],
        );
        try {
          await execute('migrate', false, 'UNRESOLVED_MIGRATION');
          await root.query(
            'UPDATE blogpost._prisma_migrations SET rolled_back_at=now() WHERE id=$1',
            [id],
          );
          const repaired = await execute('migrate');
          assert.equal(repaired.evidence.resolvedAttempts, 1);
        } finally {
          await root.query(
            'DELETE FROM blogpost._prisma_migrations WHERE id=$1',
            [id],
          );
        }
      },
    );
    await t.test(
      'column-only grants and temporary DDL rights cannot evade runtime verification',
      async () => {
        await root.query(
          'GRANT UPDATE(title) ON blogpost."Revision" TO blogpost_app',
        );
        try {
          await execute('verify-db', false, 'RUNTIME_PRIVILEGE_DRIFT');
        } finally {
          await root.query(
            'REVOKE UPDATE(title) ON blogpost."Revision" FROM blogpost_app',
          );
        }
        await root.query(
          'GRANT TEMPORARY ON DATABASE blogpost TO blogpost_app',
        );
        try {
          await execute('verify-db', false, 'UNSAFE_RUNTIME_ROLE');
        } finally {
          await root.query(
            'REVOKE TEMPORARY ON DATABASE blogpost FROM blogpost_app',
          );
        }
      },
    );
    await t.test(
      'uncontrolled columns, trigger state and function definitions invalidate the schema',
      async () => {
        await root.query(
          'ALTER TABLE blogpost."Member" ADD COLUMN unexpected text',
        );
        try {
          await execute('verify-db', false, 'DATABASE_SCHEMA_DRIFT');
        } finally {
          await root.query(
            'ALTER TABLE blogpost."Member" DROP COLUMN unexpected',
          );
        }
        for (const internal of [false, true]) {
          const trigger = (
            await root.query(
              `SELECT tgname FROM pg_trigger WHERE tgrelid='blogpost."Revision"'::regclass AND tgisinternal=$1 LIMIT 1`,
              [internal],
            )
          ).rows[0];
          assert.ok(trigger);
          const identifier = pg.escapeIdentifier(trigger.tgname);
          await root.query(
            'ALTER TABLE blogpost."Revision" DISABLE TRIGGER ' + identifier,
          );
          try {
            await execute('verify-db', false, 'DATABASE_SCHEMA_DRIFT');
          } finally {
            await root.query(
              'ALTER TABLE blogpost."Revision" ENABLE TRIGGER ' + identifier,
            );
          }
        }
        await root.query(
          'CREATE FUNCTION blogpost.unreviewed_function() RETURNS int LANGUAGE sql AS $$SELECT 1$$',
        );
        try {
          await execute('verify-db', false, 'DATABASE_SCHEMA_DRIFT');
        } finally {
          await root.query('DROP FUNCTION blogpost.unreviewed_function()');
        }
        await root.query(
          "CREATE FUNCTION blogpost.line_endings() RETURNS text LANGUAGE sql AS $$SELECT 'first\r\nsecond'$$",
        );
        const snapshotClient = await app.connect();
        try {
          const before = await schemaSnapshot(snapshotClient);
          await root.query(
            "CREATE OR REPLACE FUNCTION blogpost.line_endings() RETURNS text LANGUAGE sql AS $$SELECT 'first\nsecond'$$",
          );
          assert.notEqual(
            (await schemaSnapshot(snapshotClient)).schemaDigest,
            before.schemaDigest,
          );
        } finally {
          snapshotClient.release(true);
          await root.query('DROP FUNCTION blogpost.line_endings()');
        }
      },
    );
    const storage: MediaStorage = {
      put: async () => {
        throw Error('unexpected write');
      },
      open: async () => {
        throw Error('unexpected read');
      },
      remove: async () => {
        throw Error('unexpected delete');
      },
      list: async () => ({ objects: [], nextCursor: null }),
    };
    await t.test(
      'schema fencing excludes migration during maintenance and skips maintenance during migration',
      async () => {
        const holder = await root.connect();
        try {
          await holder.query('SELECT pg_advisory_lock_shared($1::bigint)', [
            SCHEMA_LOCK,
          ]);
          await execute('migrate', false, 'SCHEMA_OPERATION_BUSY');
          await holder.query('SELECT pg_advisory_unlock_shared($1::bigint)', [
            SCHEMA_LOCK,
          ]);
          await holder.query('SELECT pg_advisory_lock($1::bigint)', [
            SCHEMA_LOCK,
          ]);
          assert.equal(
            (
              await new MaintenanceService(
                app,
                storage,
                'database-operator-fixture',
              ).run()
            ).acquired,
            false,
          );
          await execute('verify-db', false, 'SCHEMA_OPERATION_BUSY');
          await execute('inspect-db', false, 'SCHEMA_OPERATION_BUSY');
        } finally {
          await holder.query('SELECT pg_advisory_unlock_all()');
          holder.release(true);
        }
      },
    );
    await t.test(
      'maintenance also skips an unfenced surviving migration session',
      async () => {
        const migration = new pg.Pool({ ...connection('migrator'), max: 1 });
        const client = await migration.connect();
        try {
          assert.equal(
            (
              await new MaintenanceService(
                app,
                storage,
                'database-operator-fixture',
              ).run()
            ).acquired,
            false,
          );
        } finally {
          client.release(true);
          await migration.end();
        }
      },
    );
    await t.test(
      'migration-role defaults bound blocked SQL with statement and lock timeouts',
      async () => {
        const migration = new pg.Pool({
          ...connection('migrator'),
          statement_timeout: undefined,
          max: 1,
        });
        try {
          assert.equal(
            (await migration.query('SHOW lock_timeout')).rows[0].lock_timeout,
            '4s',
          );
          assert.equal(
            (await migration.query('SHOW statement_timeout')).rows[0]
              .statement_timeout,
            '1min',
          );
          const client = await migration.connect();
          try {
            assert.deepEqual(
              (await readMigrationState(client, manifest)).pending,
              [],
            );
          } finally {
            client.release(true);
          }
        } finally {
          await migration.end();
        }
        const holder = await root.connect();
        const blocked = new pg.Pool({
          ...connection('migrator'),
          statement_timeout: undefined,
          max: 1,
        });
        try {
          await holder.query('BEGIN');
          await holder.query(
            'LOCK TABLE blogpost."Member" IN ACCESS EXCLUSIVE MODE',
          );
          const start = performance.now();
          await assert.rejects(
            blocked.query(
              'ALTER TABLE blogpost."Member" ADD COLUMN timeout_probe int',
            ),
            { code: '55P03' },
          );
          assert.ok(performance.now() - start < 15000);
        } finally {
          await holder.query('ROLLBACK');
          holder.release(true);
          await blocked.end();
        }
      },
    );
    await t.test(
      'losing the migration fence aborts the CLI and releases the supervising session',
      async () => {
        const holder = await root.connect();
        try {
          // The pinned Prisma engine's own lock holds its CLI open before any mutation.
          await holder.query('SELECT pg_advisory_lock(72707369)');
          const pending = execute('migrate', false, 'ABORT_ERR');
          let pid: number | undefined;
          for (let i = 0; i < 60; i++) {
            const state =
              await holder.query(`SELECT pid,application_name FROM pg_stat_activity
          WHERE datname=current_database() AND usename='blogpost_migrator'`);
            if (state.rows.length >= 2) {
              pid = state.rows.find(
                (r) => r.application_name === 'blogpost-migration-guard',
              )?.pid;
              break;
            }
            await delay(50);
          }
          assert.ok(
            pid,
            'The actual migration CLI and supervising session must be live',
          );
          await holder.query('SELECT pg_terminate_backend($1)', [pid]);
          await pending;
        } finally {
          await holder.query('SELECT pg_advisory_unlock_all()');
          holder.release(true);
        }
      },
    );
    await t.test(
      'schema ownership works for a non-superuser CREATEROLE root as on Cloud SQL',
      async () => {
        const client = await root.connect();
        const id = randomUUID().replaceAll('-', '').slice(0, 12);
        const actor = 'cloudsql_root_' + id,
          owner = 'cloudsql_owner_' + id,
          reader = 'cloudsql_app_' + id,
          schema = 'cloudsql_schema_' + id;
        try {
          await client.query('BEGIN');
          const database = (
            await client.query<{ name: string }>(
              'SELECT current_database() AS name',
            )
          ).rows[0]!.name;
          await client.query(
            `CREATE ROLE ${actor} NOLOGIN NOSUPERUSER CREATEROLE`,
          );
          await client.query(
            `GRANT CREATE ON DATABASE ${pg.escapeIdentifier(database)} TO ${actor}`,
          );
          await client.query(`SET ROLE ${actor}`);
          await client.query(`CREATE ROLE ${owner} NOLOGIN NOINHERIT`);
          await client.query(`CREATE ROLE ${reader} NOLOGIN NOINHERIT`);
          await client.query('SAVEPOINT plain');
          await assert.rejects(
            client.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${owner}`),
            { code: '42501' },
          );
          await client.query('ROLLBACK TO plain');
          // Only the owner may change schema privileges, so a SET-only grant
          // revoked before them is not enough.
          await client.query(
            `GRANT ${owner} TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`,
          );
          await client.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${owner}`);
          await client.query(`REVOKE ${owner} FROM CURRENT_USER`);
          await assert.rejects(
            client.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`),
            { code: '42501' },
          );
          await client.query('ROLLBACK TO plain');
          await createOwnedSchema(client, schema, owner, [reader]);
          // Reruns on an existing schema still need the temporary grant.
          await createOwnedSchema(client, schema, owner, [reader]);
          const owned = await client.query<{ owner: string; acl: string }>(
            `SELECT pg_get_userbyid(nspowner) AS owner, nspacl::text AS acl
               FROM pg_namespace WHERE nspname = $1`,
            [schema],
          );
          assert.equal(owned.rows[0]?.owner, owner);
          assert.doesNotMatch(owned.rows[0]!.acl, /[{,]=/);
          const access = await client.query<{
            usage: boolean;
            create: boolean;
          }>(
            `SELECT has_schema_privilege($1, $2, 'USAGE') AS usage,
                    has_schema_privilege($1, $2, 'CREATE') AS create`,
            [reader, schema],
          );
          assert.deepEqual(access.rows[0], { usage: true, create: false });
          const residual = await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM pg_auth_members
              WHERE (roleid = $1::regrole AND (set_option OR inherit_option))
                 OR member IN ($1::regrole, $2::regrole)`,
            [owner, reader],
          );
          assert.equal(residual.rows[0]?.count, 0);
        } finally {
          await client.query('ROLLBACK');
          client.release(true);
        }
      },
    );
    await execute('verify-db');
    await writeFile(
      '/app/.local/conformance/database-' +
        process.env.BLOGPOST_IDENTITY_RUN_ID +
        '.json',
      JSON.stringify({
        status: 'PASSED',
        runId: process.env.BLOGPOST_IDENTITY_RUN_ID,
        runtimeInputDigest: readProvenance().runtimeInputDigest,
        contractSha256: readProvenance().contractSha256,
        operatorTests: 12,
        observedAt: new Date().toISOString(),
      }) + '\n',
    );
  },
);
