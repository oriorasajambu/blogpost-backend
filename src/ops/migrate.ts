import 'dotenv/config';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { readConfig } from '../platform/config/config.js';
import { digest } from '../platform/config/build-model.js';
import { connection, migrationUrl } from '../platform/database/connection.js';
import { runJob } from './run.js';
import {
  APP_TABLES,
  databaseError,
  migrationManifest,
  tablePrivileges,
} from './database-model.js';
import { schemaLock, releaseSchemaLock } from './database-lock.js';
import { expectedSchema, readMigrationState } from './database-verification.js';
import { databaseExecution, databaseReceipt } from './database-receipt.js';

await runJob(async () => {
  const config = readConfig(process.env, 'migrate');
  databaseExecution(config);
  const manifest = await migrationManifest();
  if (
    config.environment !== 'development' &&
    (await expectedSchema()).migrationDigest !== digest(manifest)
  )
    databaseError('STALE_SCHEMA_BASELINE');
  const cli = join(
    dirname(createRequire(import.meta.url).resolve('prisma/package.json')),
    'build/index.js',
  );
  const pool = new pg.Pool({
    ...connection('migrator'),
    max: 1,
    application_name: 'blogpost-migration-guard',
  });
  try {
    const client = await pool.connect();
    const cancellation = new AbortController();
    const lostConnection = () => cancellation.abort();
    client.on('error', lostConnection);
    let locked = false;
    try {
      await schemaLock(client, false);
      locked = true;
      const before = await readMigrationState(client, manifest);
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: migrationUrl(),
      };
      delete childEnv.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK;
      // Keep passwords out of argv/logs. The dedicated session fences migration
      // AND grants; losing its connection aborts the still-running CLI.
      await promisify(execFile)(process.execPath, [cli, 'migrate', 'deploy'], {
        env: childEnv,
        timeout: 120000,
        signal: cancellation.signal,
      });
      if (digest(await migrationManifest()) !== digest(manifest))
        databaseError('MIGRATION_INPUTS_CHANGED');
      const after = await readMigrationState(client, manifest);
      if (after.pending.length) databaseError('MIGRATIONS_STILL_PENDING');
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout='4s'");
        const tables = await client.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname='blogpost' AND tablename<>'_prisma_migrations'",
        );
        if (
          tables.rows.length !== APP_TABLES.length ||
          tables.rows.some(
            (row) => !(APP_TABLES as readonly string[]).includes(row.tablename),
          )
        )
          databaseError('UNEXPECTED_DATABASE_TABLES');
        for (const name of APP_TABLES) {
          const table = `blogpost.${pg.escapeIdentifier(name)}`;
          await client.query(`REVOKE ALL ON ${table} FROM blogpost_app`);
          await client.query(
            `GRANT ${tablePrivileges(name).join(', ')} ON ${table} TO blogpost_app`,
          );
        }
        await client.query(
          'REVOKE ALL ON ALL SEQUENCES IN SCHEMA blogpost FROM blogpost_app',
        );
        await client.query(
          'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA blogpost TO blogpost_app',
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      process.stdout.write(
        JSON.stringify(
          databaseReceipt(config, 'MIGRATIONS', {
            ...after,
            migrations: manifest,
            newlyApplied: before.pending,
          }),
        ) + '\n',
      );
    } finally {
      if (locked) await releaseSchemaLock(client, false).catch(() => {});
      client.removeListener('error', lostConnection);
      client.release(true);
    }
  } finally {
    await pool.end();
  }
});
