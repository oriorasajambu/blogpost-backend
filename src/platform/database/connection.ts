import type { PoolConfig } from 'pg';

export type DatabaseRole = 'app' | 'migrator' | 'root';
export function connection(
  role: DatabaseRole,
  env: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  const user =
    role === 'app'
      ? 'blogpost_app'
      : role === 'migrator'
        ? 'blogpost_migrator'
        : (env.SQL_ROOT_USER ?? 'postgres');
  const key = `SQL_${role.toUpperCase()}_PASSWORD`;
  for (const name of ['SQL_HOST', 'SQL_DATABASE', key]) {
    if (!env[name]) throw new Error(`Missing SQL configuration: ${name}`);
  }
  const port = Number(env.SQL_PORT ?? '5432');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid SQL_PORT');
  return {
    host: env.SQL_HOST,
    database: env.SQL_DATABASE,
    port,
    user,
    password: env[key],
    max: role === 'app' && env.APP_ENV !== 'staging' ? 3 : 2,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    options: '-c search_path=blogpost,public',
  };
}

export function migrationUrl(env: NodeJS.ProcessEnv = process.env): string {
  const config = connection('migrator', env);
  const url = new URL('postgresql://localhost');
  url.username = encodeURIComponent(config.user!);
  url.password = encodeURIComponent(config.password as string);
  url.pathname = `/${encodeURIComponent(config.database!)}`;
  url.port = String(config.port);
  if (config.host!.startsWith('/')) url.searchParams.set('host', config.host!);
  else url.hostname = config.host!;
  url.searchParams.set('schema', 'blogpost');
  return url.toString();
}
