import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareBuild } from '../build/prepare.mjs';

// Deliberate regeneration only, from an invocation-owned empty tmpfs database.
// No saved env file, volume, published port, identity emulator or cloud is used.
if (process.argv.slice(2).join(' ') !== '--write')
  throw new Error('Usage: node scripts/dev/database-baseline.mjs --write');
const root = resolve(import.meta.dirname, '../..');
const hash = createHash('sha256')
  .update(root.toLowerCase())
  .digest('hex')
  .slice(0, 8);
const image = `blogpost-dev-${hash}-backend:development`;
const postgres =
  'postgres:17.11-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27';
const suffix = randomBytes(6).toString('hex');
const network = 'blogpost-schema-' + suffix;
const db = network + '-db';
const worker = network + '-job';
const output = resolve(root, 'config/database');
await mkdir(output, { recursive: true });
function docker(args, capture = false, optional = false) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: 600000,
  });
  if (!optional && (result.error || result.status !== 0))
    throw new Error(
      'Disposable schema baseline failed: ' +
        (capture
          ? (result.stdout + result.stderr).slice(-2000)
          : 'see command output'),
    );
  return capture
    ? result.status === 0
      ? result.stdout.trim()
      : null
    : result.status;
}
const envArgs = (env) =>
  Object.entries(env).flatMap(([key, value]) => ['--env', key + '=' + value]);
const appEnv = {
  APP_ENV: 'development',
  NODE_ENV: 'development',
  IDENTITY_PROJECT_ID: 'demo-blogpost-baseline-' + suffix,
  FIREBASE_AUTH_EMULATOR_HOST: 'auth:9099',
  MEDIA_ADAPTER: 'local',
  MEDIA_LOCAL_ROOT: '/data/media',
  API_ORIGIN: 'http://localhost:8080',
  WEB_ORIGIN: 'http://localhost:3000',
  SQL_HOST: 'db',
  SQL_DATABASE: 'blogpost',
  SQL_APP_PASSWORD: 'disposable-baseline-app',
};
const logs = [
  '--log-driver',
  'local',
  '--log-opt',
  'max-size=2m',
  '--log-opt',
  'max-file=2',
];
let created = false;
try {
  const build = await prepareBuild(root);
  docker([
    'build',
    '--platform',
    'linux/amd64',
    '--target',
    'development',
    '--tag',
    image,
    '--build-context',
    'blogpost_metadata=' + build.metadataDirectory,
    build.sourceDirectory,
  ]);
  const imageId = docker(
    ['image', 'inspect', '--format', '{{.Id}}', image],
    true,
  );
  if (docker(['image', 'inspect', postgres], true, true) === null)
    docker(['pull', postgres]);
  docker(
    [
      'network',
      'create',
      '--internal',
      '--label',
      'blogpost.purpose=disposable-schema-baseline',
      network,
    ],
    true,
  );
  created = true;
  docker(
    [
      'run',
      '--detach',
      '--rm',
      '--pull',
      'never',
      '--name',
      db,
      '--network',
      network,
      '--network-alias',
      'db',
      ...logs,
      '--tmpfs',
      '/var/lib/postgresql/data:rw,size=256m',
      ...envArgs({
        POSTGRES_DB: 'blogpost',
        POSTGRES_PASSWORD: 'disposable-baseline-root',
      }),
      '--health-cmd',
      'pg_isready -U postgres -d blogpost',
      '--health-interval',
      '1s',
      '--health-retries',
      '30',
      postgres,
    ],
    true,
  );
  const mounts = JSON.parse(
    docker(['inspect', '--format', '{{json .Mounts}}', db], true),
  );
  if (mounts.some((mount) => mount.Type === 'volume'))
    throw new Error('Baseline fixture unexpectedly has persistent data');
  let healthy = false;
  for (let i = 0; i < 40; i++) {
    if (
      docker(['inspect', '--format', '{{.State.Health.Status}}', db], true) ===
      'healthy'
    ) {
      healthy = true;
      break;
    }
    await delay(500);
  }
  if (!healthy)
    throw new Error('Disposable schema database did not become healthy');
  const run = (script, extra = {}, mount = []) =>
    docker([
      'run',
      '--rm',
      '--pull',
      'never',
      '--name',
      worker,
      '--network',
      network,
      ...logs,
      ...envArgs({ ...appEnv, ...extra }),
      ...mount,
      imageId,
      'node',
      'node_modules/tsx/dist/cli.mjs',
      'src/ops/' + script + '.ts',
      ...(script === 'schema-baseline' ? ['--write'] : []),
    ]);
  run('bootstrap-db', {
    SQL_ROOT_PASSWORD: 'disposable-baseline-root',
    SQL_MIGRATOR_PASSWORD: 'disposable-baseline-migrator',
  });
  run('migrate', { SQL_MIGRATOR_PASSWORD: 'disposable-baseline-migrator' });
  run('schema-baseline', { BLOGPOST_DISPOSABLE_DATABASE: '1' }, [
    '--mount',
    'type=bind,source=' + output + ',target=/app/config/database',
  ]);
  const baseline = JSON.parse(
    await readFile(resolve(output, 'schema-baseline.json'), 'utf8'),
  );
  console.log(
    JSON.stringify({
      event: 'fresh_schema_baseline_written',
      schemaDigest: baseline.schemaDigest,
      migrationDigest: baseline.migrationDigest,
    }),
  );
} finally {
  if (created) {
    for (const name of [worker, db])
      if (docker(['container', 'inspect', name], true, true) !== null)
        docker(['rm', '--force', name], true, true);
    docker(['network', 'rm', network], true);
  }
}
