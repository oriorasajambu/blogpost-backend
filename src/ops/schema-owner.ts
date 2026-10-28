import pg, { type ClientBase } from 'pg';

/**
 * Creates `schema` owned by `owner` inside the caller's transaction.
 *
 * Cloud SQL's `postgres` is not a superuser, and PostgreSQL 16+ requires the
 * ability to SET ROLE to a schema's new owner, even when the schema already
 * exists. A role created by `postgres` grants it no such membership, so it is
 * granted without inheritance for this statement and revoked again.
 */
export async function createOwnedSchema(
  client: ClientBase,
  schema: string,
  owner: string,
): Promise<void> {
  const role = pg.escapeIdentifier(owner);
  await client.query(
    `GRANT ${role} TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`,
  );
  await client.query(
    `CREATE SCHEMA IF NOT EXISTS ${pg.escapeIdentifier(schema)} AUTHORIZATION ${role}`,
  );
  await client.query(`REVOKE ${role} FROM CURRENT_USER`);
}
