import 'dotenv/config';
import pg from 'pg';
import { readConfig } from '../platform/config/config.js';
import { connection } from '../platform/database/connection.js';
import { runJob } from './run.js';

await runJob(async () => {
  readConfig(process.env, 'verify');
  const pool = new pg.Pool({ ...connection('app'), max: 2 });
  try {
    const result = await pool.query(`SELECT
      (SELECT version FROM blogpost."SchemaMeta" WHERE id = 1) = 1 AS schema_ok,
      NOT has_schema_privilege(current_user, 'blogpost', 'CREATE') AS no_schema_ddl,
      NOT has_schema_privilege(current_user, 'public', 'CREATE') AS no_public_ddl,
      NOT has_database_privilege(current_user, current_database(), 'CREATE') AS no_database_ddl,
      NOT has_table_privilege(current_user, 'blogpost."Revision"', 'UPDATE') AS immutable_revision,
      NOT has_table_privilege(current_user, 'blogpost."SlugHistory"', 'DELETE') AS permanent_slugs,
      NOT has_table_privilege(current_user, 'blogpost."SchemaMeta"', 'UPDATE') AS readonly_schema,
      NOT has_table_privilege(current_user, 'blogpost._prisma_migrations', 'SELECT') AS private_migrations,
      has_table_privilege(current_user, 'blogpost."Member"', 'UPDATE') AS membership_access,
      (has_table_privilege(current_user, 'blogpost."MaintenanceCheckpoint"', 'SELECT') AND
       has_table_privilege(current_user, 'blogpost."MaintenanceCheckpoint"', 'INSERT') AND
       has_table_privilege(current_user, 'blogpost."MaintenanceCheckpoint"', 'UPDATE')) AS maintenance_access,
      (has_table_privilege(current_user, 'blogpost."MediaUploadAttempt"', 'SELECT') AND
       has_table_privilege(current_user, 'blogpost."MediaUploadAttempt"', 'INSERT') AND
       has_table_privilege(current_user, 'blogpost."MediaUploadAttempt"', 'UPDATE') AND
       has_table_privilege(current_user, 'blogpost."MediaUploadAttempt"', 'DELETE')) AS media_attempt_access,
      EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname = 'blogpost' AND tablename = 'PublishedSearch' AND indexdef LIKE '%USING gin%') AS search_index,
      NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)) AS safe_role,
      NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS no_role_membership`);
    if (
      !Object.values(result.rows[0] as object).every((value) => value === true)
    )
      throw new Error('Database verification failed');
    // Actual attempted DDL in a transaction; always roll it back if a grant regresses.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let denied = false;
      try {
        await client.query('CREATE TABLE blogpost.__ddl_probe (id int)');
      } catch (error) {
        denied = (error as { code?: string }).code === '42501';
      }
      await client.query('ROLLBACK');
      if (!denied) throw new Error('Runtime role can perform DDL');
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});
