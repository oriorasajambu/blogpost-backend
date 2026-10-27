import type { PoolClient } from 'pg';
import { databaseError, SCHEMA_LOCK } from './database-model.js';

/** Keep this dedicated session checked out until the complete operation has finished. */
export async function schemaLock(
  client: PoolClient,
  shared: boolean,
): Promise<void> {
  const functionName = shared
    ? 'pg_try_advisory_lock_shared'
    : 'pg_try_advisory_lock';
  const result = await client.query<{ acquired: boolean }>(
    `SELECT ${functionName}($1::bigint) AS acquired`,
    [SCHEMA_LOCK],
  );
  if (result.rows[0]?.acquired !== true) databaseError('SCHEMA_OPERATION_BUSY');
}
export async function releaseSchemaLock(
  client: PoolClient,
  shared: boolean,
): Promise<void> {
  const functionName = shared
    ? 'pg_advisory_unlock_shared'
    : 'pg_advisory_unlock';
  await client.query(`SELECT ${functionName}($1::bigint)`, [SCHEMA_LOCK]);
}
