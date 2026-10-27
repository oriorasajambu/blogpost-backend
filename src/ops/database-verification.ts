import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { canonical, digest } from '../platform/config/build-model.js';
import {
  APP_TABLES,
  TABLE_PRIVILEGES,
  databaseError,
  migrationState,
  tablePrivileges,
  type MigrationEntry,
  type MigrationRow,
} from './database-model.js';

export async function readMigrationState(
  client: PoolClient,
  manifest: MigrationEntry[],
) {
  const exists = await client.query(
    "SELECT to_regclass('blogpost._prisma_migrations') IS NOT NULL AS exists",
  );
  const result =
    exists.rows[0]?.exists === true
      ? await client.query<MigrationRow>(`SELECT id, migration_name, checksum, started_at,
      finished_at, rolled_back_at, applied_steps_count FROM blogpost._prisma_migrations
      ORDER BY started_at, id LIMIT 4097`)
      : { rows: [] };
  return migrationState(manifest, result.rows);
}

// Only definitions and catalog flags are read. No article, identity, credential,
// migration diagnostic logs, row values or changing sequence values enter a snapshot.
export async function schemaSnapshot(client: PoolClient) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query('SET LOCAL search_path=pg_catalog');
    const version = await client.query(
      "SELECT current_setting('server_version_num')::int / 10000 AS major",
    );
    if (version.rows[0]?.major !== 17)
      databaseError('UNSUPPORTED_DATABASE_MAJOR');
    const queries = {
      namespace: `SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='blogpost'`,
      relations: `SELECT c.relname AS name, c.relkind AS kind, pg_get_userbyid(c.relowner) AS owner,
        c.relpersistence AS persistence, c.relrowsecurity AS row_security,
        c.relforcerowsecurity AS force_row_security, c.relreplident AS replica_identity,
        coalesce(c.reloptions, ARRAY[]::text[]) AS options
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='blogpost' AND c.relkind IN ('r','p','v','m','S','f') ORDER BY c.relname`,
      columns: `SELECT c.relname AS relation, a.attnum AS position, a.attname AS name,
        format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required,
        a.attidentity AS identity, a.attgenerated AS generated,
        CASE WHEN a.attcollation=0 THEN NULL ELSE cn.nspname||'.'||co.collname END AS collation,
        pg_get_expr(d.adbin,d.adrelid) AS default_expression
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
        WHERE n.nspname='blogpost' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
        ORDER BY c.relname,a.attnum`,
      constraints: `SELECT co.conname AS name, c.relname AS relation, co.contype AS kind,
        co.condeferrable AS deferrable, co.condeferred AS deferred, co.convalidated AS validated,
        pg_get_constraintdef(co.oid,true) AS definition
        FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace
        LEFT JOIN pg_class c ON c.oid=co.conrelid WHERE n.nspname='blogpost'
        ORDER BY c.relname,co.conname`,
      indexes: `SELECT ic.relname AS name, c.relname AS relation, pg_get_indexdef(i.indexrelid) AS definition,
        i.indisvalid AS valid, i.indisready AS ready, i.indislive AS live,
        i.indisprimary AS primary, i.indisunique AS unique
        FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='blogpost' ORDER BY ic.relname`,
      functions: `SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments,
        p.prokind AS kind, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
        p.proleakproof AS leakproof, p.provolatile AS volatility, p.proparallel AS parallel,
        coalesce(p.proconfig, ARRAY[]::text[]) AS configuration,
        CASE WHEN p.prokind='a' THEN 'AGGREGATE' ELSE pg_get_functiondef(p.oid) END AS definition
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='blogpost'
        ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)`,
      triggers: `SELECT c.relname AS relation,
        CASE WHEN t.tgisinternal THEN coalesce(co.conname,'')||':'||p.proname||':'||t.tgtype::text ELSE t.tgname END AS name,
        t.tgenabled AS enabled, t.tgisinternal AS internal, t.tgdeferrable AS deferrable,
        t.tginitdeferred AS deferred, pn.nspname||'.'||p.proname AS function,
        CASE WHEN t.tgisinternal THEN NULL ELSE pg_get_triggerdef(t.oid,true) END AS definition FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
        LEFT JOIN pg_constraint co ON co.oid=t.tgconstraint
        WHERE n.nspname='blogpost' ORDER BY c.relname,t.tgname`,
      types: `SELECT t.typname AS name, t.typtype AS kind, pg_get_userbyid(t.typowner) AS owner,
        t.typnotnull AS required, t.typdefault AS default_expression,
        CASE WHEN t.typbasetype=0 THEN NULL ELSE format_type(t.typbasetype,t.typtypmod) END AS base_type,
        ARRAY(SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid=t.oid ORDER BY e.enumsortorder) AS labels
        FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname='blogpost' AND t.typtype IN ('e','d','c','r','m') ORDER BY t.typname`,
      sequences: `SELECT c.relname AS name, s.seqstart AS start, s.seqincrement AS increment,
        s.seqmax AS maximum, s.seqmin AS minimum, s.seqcache AS cache, s.seqcycle AS cycle
        FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='blogpost' ORDER BY c.relname`,
      policies: `SELECT c.relname AS relation, p.polname AS name, p.polcmd AS command,
        p.polpermissive AS permissive,
        ARRAY(SELECT CASE WHEN role=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role) END FROM unnest(p.polroles) role ORDER BY role) AS roles,
        pg_get_expr(p.polqual,p.polrelid) AS using_expression,
        pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
        FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='blogpost' ORDER BY c.relname,p.polname`,
    };
    const definitions: Record<string, unknown[]> = {};
    for (const [name, sql] of Object.entries(queries)) {
      const result = await client.query(sql + ' LIMIT 2001');
      if (result.rows.length > 2000) databaseError('DATABASE_CATALOG_LIMIT');
      definitions[name] = result.rows.sort((a, b) =>
        canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0,
      );
    }
    const encoded = canonical(definitions);
    if (Buffer.byteLength(encoded) > 1048576)
      databaseError('DATABASE_CATALOG_LIMIT');
    await client.query('COMMIT');
    return {
      schemaVersion: 1 as const,
      postgresMajor: 17 as const,
      definitions: JSON.parse(encoded) as Record<string, unknown[]>,
      schemaDigest: digest(JSON.parse(encoded)),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function expectedSchema() {
  const file = new URL(
    '../../config/database/schema-baseline.json',
    import.meta.url,
  );
  const bytes = await readFile(file);
  if (bytes.length > 1048576) databaseError('INVALID_SCHEMA_BASELINE');
  const baseline = JSON.parse(bytes.toString('utf8'));
  if (
    baseline.schemaVersion !== 1 ||
    baseline.postgresMajor !== 17 ||
    !/^[a-f0-9]{64}$/.test(baseline.migrationDigest ?? '') ||
    !/^[a-f0-9]{64}$/.test(baseline.permissionDigest ?? '') ||
    baseline.schemaDigest !== digest(baseline.definitions)
  )
    databaseError('INVALID_SCHEMA_BASELINE');
  return baseline as {
    schemaVersion: 1;
    postgresMajor: 17;
    migrationDigest: string;
    permissionDigest: string;
    schemaDigest: string;
    definitions: Record<string, unknown[]>;
  };
}

export async function runtimePermissions(client: PoolClient) {
  const roleResult =
    await client.query(`SELECT current_user AS name, session_user AS session,
    r.rolcanlogin AS login, r.rolsuper AS superuser, r.rolcreatedb AS create_db,
    r.rolcreaterole AS create_role, r.rolreplication AS replication, r.rolbypassrls AS bypass_rls,
    r.rolinherit AS inherit, (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
    has_database_privilege(current_user,current_database(),'CONNECT') AS connect,
    has_database_privilege(current_user,current_database(),'CREATE') AS create_schema,
    has_database_privilege(current_user,current_database(),'TEMP') AS temporary,
    has_schema_privilege(current_user,'blogpost','USAGE') AS schema_usage,
    has_schema_privilege(current_user,'blogpost','CREATE') AS schema_create,
    has_schema_privilege(current_user,'public','CREATE') AS public_create,
    (SELECT count(*)::int FROM pg_class WHERE relowner=r.oid) AS owned_relations,
    (SELECT count(*)::int FROM pg_proc WHERE proowner=r.oid) AS owned_functions,
    (SELECT count(*)::int FROM pg_type WHERE typowner=r.oid) AS owned_types,
    (SELECT count(*)::int FROM pg_namespace WHERE nspowner=r.oid) AS owned_schemas
    FROM pg_roles r WHERE r.rolname=current_user`);
  const role = roleResult.rows[0];
  if (
    !role ||
    role.name !== 'blogpost_app' ||
    role.session !== 'blogpost_app' ||
    role.login !== true ||
    role.connect !== true ||
    role.schema_usage !== true ||
    Object.entries(role).some(
      ([key, value]) =>
        !['name', 'session', 'login', 'connect', 'schema_usage'].includes(
          key,
        ) &&
        value !== false &&
        value !== 0,
    )
  )
    databaseError('UNSAFE_RUNTIME_ROLE');
  const tables = await client.query<{
    name: string;
  }>(`SELECT c.relname AS name FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='blogpost' AND c.relkind IN ('r','p') ORDER BY c.relname`);
  const names = tables.rows.map((row) => row.name).sort();
  if (
    canonical(names) !== canonical([...APP_TABLES, '_prisma_migrations'].sort())
  )
    databaseError('UNEXPECTED_DATABASE_TABLES');
  const permissions = [];
  for (const table of names) {
    const relation = 'blogpost."' + table + '"';
    const expected = tablePrivileges(table);
    const result = await client.query<{
      privilege: string;
      granted: boolean;
      column_granted: boolean;
    }>(
      `SELECT p AS privilege,
      has_table_privilege(current_user,$1,p) AS granted,
      CASE WHEN p IN ('SELECT','INSERT','UPDATE','REFERENCES')
        THEN has_any_column_privilege(current_user,$1,p) ELSE false END AS column_granted
      FROM unnest($2::text[]) p ORDER BY p`,
      [relation, TABLE_PRIVILEGES],
    );
    for (const row of result.rows) {
      if (
        row.granted !== expected.includes(row.privilege) ||
        (['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'].includes(row.privilege) &&
          row.column_granted !== expected.includes(row.privilege))
      )
        databaseError('RUNTIME_PRIVILEGE_DRIFT');
    }
    // Detect column-only grants as well as missing grants on just one column.
    const columns = await client.query<{
      name: string;
      privilege: string;
      granted: boolean;
    }>(
      `SELECT a.attname AS name,p AS privilege,
      has_column_privilege(current_user,a.attrelid,a.attnum,p) AS granted FROM pg_attribute a
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
      WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum,p`,
      [relation],
    );
    if (
      columns.rows.some(
        (row) => row.granted !== expected.includes(row.privilege),
      )
    )
      databaseError('RUNTIME_COLUMN_PRIVILEGE_DRIFT');
    permissions.push({ table, privileges: result.rows, columns: columns.rows });
  }
  const sequenceGrants =
    await client.query(`SELECT c.relname AS name, p AS privilege,
    has_sequence_privilege(current_user,c.oid,p) AS granted FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']) p
    WHERE n.nspname='blogpost' AND c.relkind='S' ORDER BY c.relname,p`);
  if (
    sequenceGrants.rows.some(
      (row) => row.granted !== (row.privilege !== 'UPDATE'),
    )
  )
    databaseError('RUNTIME_SEQUENCE_PRIVILEGE_DRIFT');
  const probes = [
    'CREATE TABLE blogpost.__ddl_probe (id int)',
    'CREATE TEMP TABLE __temporary_ddl_probe (id int)',
    'SELECT * FROM blogpost._prisma_migrations LIMIT 0',
    'UPDATE blogpost."SchemaMeta" SET version=version WHERE false',
  ];
  for (const sql of probes) {
    await client.query('BEGIN');
    let denied = false;
    try {
      await client.query(sql);
    } catch (error) {
      denied = (error as { code?: string }).code === '42501';
    } finally {
      await client.query('ROLLBACK');
    }
    if (!denied) databaseError('RUNTIME_DENIAL_PROBE_FAILED');
  }
  const version = await client.query(
    'SELECT version FROM blogpost."SchemaMeta" WHERE id=1',
  );
  if (version.rowCount !== 1 || version.rows[0]?.version !== 1)
    databaseError('SCHEMA_VERSION_MISMATCH');
  const budget =
    await client.query(`SELECT current_setting('max_connections')::int AS maximum,
    current_setting('superuser_reserved_connections')::int+current_setting('reserved_connections')::int AS reserved,
    (SELECT datconnlimit FROM pg_database WHERE datname=current_database()) AS database_limit,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS database_connections,
    (SELECT count(*)::int FROM pg_stat_activity) AS total_connections`);
  return {
    permissionDigest: digest({
      role,
      permissions,
      sequences: sequenceGrants.rows,
      deniedProbes: probes.length,
    }),
    deniedProbes: probes.length,
    connectionBudget: budget.rows[0],
  };
}
