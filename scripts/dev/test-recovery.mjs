import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareBuild } from '../build/prepare.mjs';

// No destination, credentials, archive or saved stack can be selected by the caller.
const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== '--build'))
  throw new Error('Usage: npm run test:recovery [-- --build]');
const runId = randomBytes(6).toString('hex');
const prefix = 'blogpost-recovery-' + runId;
const hash = createHash('sha256')
  .update(root.toLowerCase())
  .digest('hex')
  .slice(0, 8);
const shared = 'blogpost-dev-' + hash + '-backend:development';
const postgres =
  'postgres:17.11-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27';
const source = prefix + '-db',
  restored = prefix + '-restored',
  worker = prefix + '-worker';
const directory = resolve(root, '.local/conformance');
await mkdir(directory, { recursive: true });
const output = resolve(directory, 'database-recovery.json');
const runOutput = resolve(directory, 'database-recovery-' + runId + '.json');
const created = [];
let networkCreated = false;
function docker(
  args,
  { binary = false, input, optional = false, timeout = 600000 } = {},
) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: binary ? undefined : 'utf8',
    input,
    windowsHide: true,
    timeout,
    maxBuffer: binary ? 20 * 1024 * 1024 : 2 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    if (optional) return null;
    const diagnostic = String(result.stderr ?? '')
      .slice(-16000)
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[REDACTED_DATABASE_URL]')
      .replaceAll('disposable-recovery-root', '[REDACTED]')
      .replaceAll('disposable-recovery-migrator', '[REDACTED]')
      .replaceAll('disposable-recovery-app', '[REDACTED]');
    writeFileSync(
      resolve(directory, 'database-recovery-' + runId + '.log'),
      diagnostic,
    );
    // Database contents, process environment and child diagnostics never enter a receipt/log.
    throw new Error(
      'Disposable recovery command failed: ' + args[0] + ' ' + (args[1] ?? ''),
    );
  }
  return binary ? result.stdout : result.stdout.trim();
}
const envArgs = (values) =>
  Object.entries(values).flatMap(([key, value]) => [
    '--env',
    key + '=' + value,
  ]);
const logs = [
  '--log-driver',
  'local',
  '--log-opt',
  'max-size=2m',
  '--log-opt',
  'max-file=2',
];
const owned = (name) => {
  const label = docker([
    'inspect',
    '--format',
    '{{index .Config.Labels "blogpost.recovery-run"}}',
    name,
  ]);
  if (label !== runId || !created.includes(name))
    throw new Error('Recovery container ownership disagrees');
};
const exec = (name, command, options) => {
  owned(name);
  return docker(
    ['exec', ...(options?.input ? ['-i'] : []), name, ...command],
    options,
  );
};
const pgRestore = () => [
  'pg_restore',
  '--username=postgres',
  '--dbname=blogpost',
  '--single-transaction',
  '--exit-on-error',
  '--clean',
  '--if-exists',
  '/backup/pre-upgrade.dump',
];
const phase = (name) => {
  const value = exec(worker, [
    'node',
    'node_modules/tsx/dist/cli.mjs',
    'test/recovery/database.ts',
    name,
  ]);
  const observations = value
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((record) => record.phase === name);
  if (observations.length !== 1)
    throw new Error('Recovery phase completion record is ambiguous');
  const observation = observations[0];
  if (
    observation.phase !== name ||
    observation.status !== 'PASSED' ||
    observation.runId !== runId
  )
    throw new Error('Recovery worker phase disagrees');
  console.log('Database recovery: ' + name + ' passed.');
};
try {
  await writeFile(
    output,
    JSON.stringify({
      schemaVersion: 1,
      runId,
      status: 'RUNNING',
      observedAt: new Date().toISOString(),
    }) + '\n',
  );
  const build = await prepareBuild(root);
  if (args.includes('--build')) {
    console.log(
      'Refreshing the shared development image for the recovery rehearsal.',
    );
    docker([
      'build',
      '--load',
      '--platform',
      'linux/amd64',
      '--target',
      'development',
      '--tag',
      shared,
      '--build-context',
      'blogpost_metadata=' + build.metadataDirectory,
      build.sourceDirectory,
    ]);
  }
  const image = docker(['image', 'inspect', '--format', '{{.Id}}', shared]);
  const baked = JSON.parse(
    docker([
      'run',
      '--rm',
      '--pull',
      'never',
      '--network',
      'none',
      image,
      'node',
      '--input-type=module',
      '-e',
      "import {readFileSync} from 'node:fs'; console.log(readFileSync('.build/provenance.json','utf8'));",
    ]),
  );
  if (
    baked.environment !== 'development' ||
    baked.runtimeInputDigest !== build.provenance.runtimeInputDigest ||
    baked.sourceInputDigest !== build.provenance.sourceInputDigest ||
    baked.contractSha256 !== build.provenance.contractSha256
  )
    throw new Error(
      'Shared development image is stale; rerun with --build. Source is never overlaid onto an older artifact.',
    );
  docker(['image', 'inspect', postgres]);
  docker([
    'network',
    'create',
    '--internal',
    '--label',
    'blogpost.purpose=disposable-recovery',
    '--label',
    'blogpost.recovery-run=' + runId,
    prefix,
  ]);
  networkCreated = true;
  for (const [name, alias] of [
    [source, 'db'],
    [restored, 'restore-db'],
  ]) {
    if (docker(['container', 'inspect', name], { optional: true }) !== null)
      throw new Error('Recovery container name already exists');
    docker([
      'run',
      '--detach',
      '--rm',
      '--pull',
      'never',
      '--name',
      name,
      '--network',
      prefix,
      '--network-alias',
      alias,
      '--label',
      'blogpost.recovery-run=' + runId,
      ...logs,
      '--memory',
      '384m',
      '--tmpfs',
      '/var/lib/postgresql/data:rw,size=256m',
      '--tmpfs',
      '/backup:rw,size=16m,mode=0700',
      ...envArgs({
        POSTGRES_DB: 'blogpost',
        POSTGRES_PASSWORD: 'disposable-recovery-root',
        POSTGRES_INITDB_ARGS: '--encoding=UTF8 --locale=C.UTF-8',
      }),
      '--health-cmd',
      'pg_isready -U postgres -d blogpost',
      '--health-interval',
      '1s',
      '--health-retries',
      '30',
      postgres,
      '-c',
      'max_connections=30',
      '-c',
      'shared_buffers=32MB',
    ]);
    created.push(name);
  }
  for (const name of [source, restored]) {
    let healthy = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        docker(['inspect', '--format', '{{.State.Health.Status}}', name]) ===
        'healthy'
      ) {
        healthy = true;
        break;
      }
      await delay(500);
    }
    if (!healthy)
      throw new Error('Disposable recovery database did not become healthy');
    exec(name, [
      'psql',
      '--username=postgres',
      '--dbname=blogpost',
      '--set=ON_ERROR_STOP=1',
      '--command',
      "CREATE TABLE public.blogpost_disposable_recovery_run(run_id varchar(12) PRIMARY KEY); INSERT INTO public.blogpost_disposable_recovery_run VALUES('" +
        runId +
        "');",
    ]);
  }
  if (docker(['container', 'inspect', worker], { optional: true }) !== null)
    throw new Error('Recovery worker name already exists');
  docker([
    'run',
    '--detach',
    '--rm',
    '--pull',
    'never',
    '--name',
    worker,
    '--network',
    prefix,
    '--label',
    'blogpost.recovery-run=' + runId,
    ...logs,
    '--memory',
    '768m',
    '--tmpfs',
    '/app/.local:rw,size=32m,uid=1000,gid=1000,mode=0700',
    '--tmpfs',
    '/data/media:rw,size=32m,uid=1000,gid=1000,mode=0700',
    ...envArgs({
      APP_ENV: 'development',
      NODE_ENV: 'development',
      IDENTITY_PROJECT_ID: 'demo-blogpost-recovery-' + runId,
      FIREBASE_AUTH_EMULATOR_HOST: 'auth:9099',
      MEDIA_ADAPTER: 'local',
      MEDIA_LOCAL_ROOT: '/data/media/source',
      API_ORIGIN: 'http://localhost:8080',
      WEB_ORIGIN: 'http://localhost:3000',
      SQL_HOST: 'db',
      SQL_DATABASE: 'blogpost',
      SQL_APP_PASSWORD: 'disposable-recovery-app',
      SQL_MIGRATOR_PASSWORD: 'disposable-recovery-migrator',
      SQL_ROOT_PASSWORD: 'disposable-recovery-root',
      CURSOR_SIGNING_KEY: '3'.repeat(64),
      BLOGPOST_DISPOSABLE_RECOVERY: '1',
      BLOGPOST_RECOVERY_RUN_ID: runId,
    }),
    image,
    'node',
    '--input-type=module',
    '-e',
    'setInterval(()=>{},1000)',
  ]);
  created.push(worker);
  for (const name of created) {
    const mounts = JSON.parse(
      docker(['inspect', '--format', '{{json .Mounts}}', name]),
    );
    if (mounts.some((mount) => mount.Type !== 'tmpfs'))
      throw new Error(
        'Recovery fixture unexpectedly has persistent/bind storage',
      );
    if (
      docker([
        'inspect',
        '--format',
        '{{json .HostConfig.PortBindings}}',
        name,
      ]) !== '{}'
    )
      throw new Error('Recovery fixture publishes a port');
  }
  phase('initialize');
  exec(source, [
    'pg_dump',
    '--username=postgres',
    '--dbname=blogpost',
    '--format=custom',
    '--compress=0',
    '--schema=blogpost',
    '--file=/backup/pre-upgrade.dump',
  ]);
  const archiveHash = exec(source, [
    'sha256sum',
    '/backup/pre-upgrade.dump',
  ]).split(/\s/)[0];
  const archiveBytes = Number(
    exec(source, ['stat', '--format=%s', '/backup/pre-upgrade.dump']),
  );
  if (
    !/^[a-f0-9]{64}$/.test(archiveHash) ||
    !Number.isSafeInteger(archiveBytes) ||
    archiveBytes < 100 ||
    archiveBytes > 16 * 1024 * 1024
  )
    throw new Error('Recovery archive is invalid or oversized');
  // Docker cp cannot archive these tmpfs mounts. Transfer bounded binary bytes
  // through exec stdin/stdout without a shell pipeline or a host dump file.
  const archive = exec(source, ['cat', '/backup/pre-upgrade.dump'], {
    binary: true,
  });
  exec(
    restored,
    ['dd', 'of=/backup/pre-upgrade.dump', 'bs=65536', 'status=none'],
    { input: archive },
  );
  if (
    exec(restored, ['sha256sum', '/backup/pre-upgrade.dump']).split(/\s/)[0] !==
    archiveHash
  )
    throw new Error('Copied recovery archive changed');
  phase('upgrade-source');
  exec(restored, pgRestore());
  phase('restored-prefix');
  exec(restored, [
    'psql',
    '--username=postgres',
    '--dbname=blogpost',
    '--set=ON_ERROR_STOP=1',
    '--command',
    "CREATE FUNCTION public.recovery_fail_restore() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic interrupted restore'; END $$; CREATE EVENT TRIGGER recovery_fail_restore ON ddl_command_start WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.recovery_fail_restore();",
  ]);
  if (exec(restored, pgRestore(), { optional: true }) !== null)
    throw new Error('Interrupted restore unexpectedly succeeded');
  exec(restored, [
    'psql',
    '--username=postgres',
    '--dbname=blogpost',
    '--set=ON_ERROR_STOP=1',
    '--command',
    'DROP EVENT TRIGGER recovery_fail_restore; DROP FUNCTION public.recovery_fail_restore();',
  ]);
  phase('atomic-restore');
  phase('upgrade-restored');
  const reportBytes = exec(worker, ['cat', '/app/.local/recovery/report.json']);
  if (Buffer.byteLength(reportBytes) > 65536)
    throw new Error('Recovery report is oversized');
  const result = JSON.parse(reportBytes);
  if (
    result.status !== 'PASSED' ||
    result.runId !== runId ||
    result.artifact?.sourceInputDigest !== baked.sourceInputDigest ||
    result.artifact?.runtimeInputDigest !== baked.runtimeInputDigest ||
    result.checks?.length !== 15 ||
    result.mediaObjects !== 3
  )
    throw new Error(
      'Recovery result is incomplete or belongs to another artifact',
    );
  const receipt = {
    ...result,
    observedAt: new Date().toISOString(),
    artifact: { ...baked, imageId: image },
    candidateSource: build.provenance,
    archive: {
      format: 'postgres-custom',
      sha256: archiveHash,
      byteSize: archiveBytes,
      location: 'disposable-tmpfs-only',
    },
  };
  await writeFile(runOutput, JSON.stringify(receipt, null, 2) + '\n');
  await writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(
    'Populated database upgrade, backup/restore and media recovery: 15 checks passed.',
  );
} catch (error) {
  await writeFile(
    output,
    JSON.stringify({
      schemaVersion: 1,
      status: 'FAILED',
      runId,
      observedAt: new Date().toISOString(),
    }) + '\n',
  );
  throw error;
} finally {
  try {
    for (const name of [...created].reverse()) {
      if (docker(['container', 'inspect', name], { optional: true }) !== null) {
        owned(name);
        docker(['rm', '--force', name]);
      }
    }
    if (networkCreated) docker(['network', 'rm', prefix]);
  } catch (error) {
    const failed =
      JSON.stringify({
        schemaVersion: 1,
        status: 'FAILED',
        phase: 'cleanup',
        runId,
        observedAt: new Date().toISOString(),
      }) + '\n';
    await writeFile(output, failed);
    await writeFile(runOutput, failed);
    throw error;
  }
}
