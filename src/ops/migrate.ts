import 'dotenv/config';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { readConfig } from '../platform/config/config.js';
import { connection, migrationUrl } from '../platform/database/connection.js';
import { runJob } from './run.js';

await runJob(async () => {
  readConfig(process.env, 'migrate');
  const cli = join(
    dirname(createRequire(import.meta.url).resolve('prisma/package.json')),
    'build/index.js',
  );
  // Keep passwords out of argv/logs; Prisma output is intentionally not emitted.
  await promisify(execFile)(process.execPath, [cli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: migrationUrl() },
    timeout: 120000,
  });
  const pool = new pg.Pool(connection('migrator'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'blogpost' AND tablename <> '_prisma_migrations'",
    );
    for (const { tablename } of tables.rows) {
      const table = `blogpost.${pg.escapeIdentifier(tablename)}`;
      await client.query(`REVOKE ALL ON ${table} FROM blogpost_app`);
      await client.query(`GRANT SELECT ON ${table} TO blogpost_app`);
      if (tablename !== 'SchemaMeta') {
        await client.query(`GRANT INSERT ON ${table} TO blogpost_app`);
        if (
          !['Revision', 'RevisionMedia', 'RevisionTag', 'SlugHistory'].includes(
            tablename,
          )
        )
          await client.query(`GRANT DELETE ON ${table} TO blogpost_app`);
        if (
          ![
            'Revision',
            'RevisionMedia',
            'RevisionTag',
            'ReviewEvent',
            'AuditEvent',
          ].includes(tablename)
        )
          await client.query(`GRANT UPDATE ON ${table} TO blogpost_app`);
      }
    }
    await client.query(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA blogpost TO blogpost_app',
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
});
