import 'dotenv/config';
import pg from 'pg';
import { readConfig } from '../platform/config/config.js';
import { connection } from '../platform/database/connection.js';
import { runJob } from './run.js';
import { createOwnedSchema } from './schema-owner.js';

await runJob(async () => {
  readConfig(process.env, 'bootstrap-db');
  const pool = new pg.Pool(connection('root'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(78201901)');
    for (const [role, key] of [
      ['blogpost_migrator', 'SQL_MIGRATOR_PASSWORD'],
      ['blogpost_app', 'SQL_APP_PASSWORD'],
    ] as const) {
      const password = process.env[key];
      if (!password) throw new Error('Missing role password');
      const existing = await client.query(
        'SELECT 1 FROM pg_roles WHERE rolname = $1',
        [role],
      );
      if (!existing.rowCount)
        await client.query(
          `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${pg.escapeLiteral(password)}`,
        );
      const memberships = await client.query(
        'SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = $1)',
        [role],
      );
      const attributes = await client.query(
        'SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication, rolinherit, NOT rolcanlogin AS cannot_login FROM pg_roles WHERE rolname = $1',
        [role],
      );
      if (
        memberships.rowCount ||
        Object.values(attributes.rows[0] as object).some(Boolean)
      )
        throw new Error('Existing role is privileged');
    }
    await createOwnedSchema(client, 'blogpost', 'blogpost_migrator', [
      'blogpost_app',
    ]);
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    const database = pg.escapeIdentifier(connection('root').database!);
    await client.query(
      `REVOKE CREATE, TEMPORARY ON DATABASE ${database} FROM PUBLIC`,
    );
    for (const role of ['blogpost_migrator', 'blogpost_app'])
      await client.query(
        `REVOKE CREATE, TEMPORARY ON DATABASE ${database} FROM ${role}`,
      );
    await client.query(
      `ALTER ROLE blogpost_migrator IN DATABASE ${database} SET lock_timeout='4s'`,
    );
    await client.query(
      `ALTER ROLE blogpost_migrator IN DATABASE ${database} SET statement_timeout='60s'`,
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
