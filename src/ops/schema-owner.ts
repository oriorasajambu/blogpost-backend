import pg, { type ClientBase } from 'pg';

/**
 * Creates `schema` owned by `owner`, removes PUBLIC access and grants USAGE to
 * `usageRoles`, inside the caller's transaction.
 *
 * Cloud SQL's `postgres` is not a superuser. PostgreSQL 16+ requires the
 * ability to SET ROLE to a schema's new owner, even when the schema already
 * exists, and only the owner may change the schema's privileges. A role created
 * by `postgres` grants it no membership, so the owner is granted with SET and
 * INHERIT for these statements and revoked again before returning.
 */
export async function createOwnedSchema(
  client: ClientBase,
  schema: string,
  owner: string,
  usageRoles: readonly string[],
): Promise<void> {
  const role = pg.escapeIdentifier(owner);
  const name = pg.escapeIdentifier(schema);
  await client.query(
    `GRANT ${role} TO CURRENT_USER WITH INHERIT TRUE, SET TRUE`,
  );
  await client.query(
    `CREATE SCHEMA IF NOT EXISTS ${name} AUTHORIZATION ${role}`,
  );
  await client.query(`REVOKE ALL ON SCHEMA ${name} FROM PUBLIC`);
  for (const usage of usageRoles)
    await client.query(
      `GRANT USAGE ON SCHEMA ${name} TO ${pg.escapeIdentifier(usage)}`,
    );
  await client.query(`REVOKE ${role} FROM CURRENT_USER`);
}
