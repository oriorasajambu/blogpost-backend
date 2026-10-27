import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, readFile, writeFile, unlink, chmod } from 'node:fs/promises';
import { prepareBuild } from '../build/prepare.mjs';

// All credentials and identities below belong only to this newly created, internal test network.
// No saved stack env file, published port or persistent volume is used.
const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
if (args.some((arg) => !['--build', '--compiled-operations'].includes(arg)))
  throw new Error(
    'Usage: npm run test:identity [-- --build] [--compiled-operations]',
  );
const hash = createHash('sha256')
  .update(root.toLowerCase())
  .digest('hex')
  .slice(0, 8);
const backend = `blogpost-dev-${hash}-backend:development`;
const authImage = `blogpost-dev-${hash}-auth:development`;
let backendArtifact = backend;
let authArtifact = authImage;
const postgres =
  'postgres:17.11-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27';
const suffix = randomBytes(6).toString('hex');
const operationsTag = 'blogpost-database-operations-' + suffix + ':check';
let operationsArtifact = null;
const network = `blogpost-identity-${suffix}`;
const project = `demo-blogpost-identity-${suffix}`;
const db = `${network}-db`;
const auth = `${network}-auth`;
const testContainer = `${network}-test`;
const reportDirectory = resolve(root, '.local/conformance');
await mkdir(reportDirectory, { recursive: true });
const reportPath = resolve(reportDirectory, 'backend-identity.json');
const observedPath = resolve(reportDirectory, `identity-${suffix}.json`);
const administrationPath = resolve(
  reportDirectory,
  `administration-${suffix}.json`,
);
const editorialPath = resolve(reportDirectory, `editorial-${suffix}.json`);
const publicPath = resolve(reportDirectory, `public-taxonomy-${suffix}.json`);
const mediaPath = resolve(reportDirectory, `media-${suffix}.json`);
const maintenancePath = resolve(reportDirectory, `maintenance-${suffix}.json`);
const databasePath = resolve(reportDirectory, `database-${suffix}.json`);
// Only this nonsecret, random evidence file needs container write access on Linux CI hosts.
await writeFile(observedPath, '{}\n', { flag: 'wx' });
await chmod(observedPath, 0o666);
await writeFile(administrationPath, '{}\n', { flag: 'wx' });
await chmod(administrationPath, 0o666);
await writeFile(editorialPath, '{}\n', { flag: 'wx' });
await chmod(editorialPath, 0o666);
await writeFile(publicPath, '{}\n', { flag: 'wx' });
await chmod(publicPath, 0o666);
await writeFile(mediaPath, '{}\n', { flag: 'wx' });
await chmod(mediaPath, 0o666);
await writeFile(maintenancePath, '{}\n', { flag: 'wx' });
await chmod(maintenancePath, 0o666);
await writeFile(databasePath, '{}\n', { flag: 'wx' });
await chmod(databasePath, 0o666);
await writeFile(
  reportPath,
  JSON.stringify(
    { status: 'RUNNING', runId: suffix, observedAt: new Date().toISOString() },
    null,
    2,
  ) + '\n',
);
function docker(arguments_, { capture = false, optional = false } = {}) {
  const result = spawnSync('docker', arguments_, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: 600_000,
  });
  if (!optional && (result.error || result.status !== 0))
    throw new Error(
      `Docker identity check failed (${arguments_[0]} ${arguments_[1] ?? ''}): ${result.error?.message ?? result.stderr?.trim().slice(-2000) ?? 'see command output'}`,
    );
  return capture
    ? result.status === 0
      ? result.stdout.trim()
      : null
    : result.status;
}
const appEnv = {
  APP_ENV: 'development',
  NODE_ENV: 'development',
  IDENTITY_PROJECT_ID: project,
  FIREBASE_AUTH_EMULATOR_HOST: 'auth:9099',
  MEDIA_ADAPTER: 'local',
  MEDIA_LOCAL_ROOT: '/data/media',
  API_ORIGIN: 'http://localhost:8080',
  WEB_ORIGIN: 'http://localhost:3000',
  SQL_HOST: 'db',
  SQL_DATABASE: 'blogpost',
  SQL_APP_PASSWORD: 'disposable-identity-app',
  CURSOR_SIGNING_KEY: '3'.repeat(64),
};
const envArgs = (env) =>
  Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
const mounts = [];
mounts.push(
  '--mount',
  `type=bind,source=${reportDirectory},target=/app/.local/conformance`,
);
const logs = [
  '--log-driver',
  'local',
  '--log-opt',
  'max-size=2m',
  '--log-opt',
  'max-file=2',
];
const run = (command, extraEnv = {}, artifact = backendArtifact) =>
  docker([
    'run',
    '--rm',
    '--pull',
    'never',
    '--name',
    testContainer,
    '--network',
    network,
    ...logs,
    '--tmpfs',
    '/data/media:rw,size=160m,uid=1000,gid=1000,mode=0700',
    ...envArgs({ ...appEnv, ...extraEnv }),
    ...mounts,
    artifact,
    ...command,
  ]);
let networkCreated = false;
try {
  const build = await prepareBuild(root);
  if (args.includes('--build')) {
    docker([
      'build',
      '--platform',
      'linux/amd64',
      '--target',
      'development',
      '--tag',
      backend,
      '--build-context',
      'blogpost_metadata=' + build.metadataDirectory,
      build.sourceDirectory,
    ]);
    docker(['build', '--tag', authImage, './docker/auth']);
    docker(['pull', postgres]);
  }
  for (const image of [backend, authImage, postgres])
    docker(['image', 'inspect', image], { capture: true });
  backendArtifact = docker(
    ['image', 'inspect', '--format', '{{.Id}}', backend],
    { capture: true },
  );
  authArtifact = docker(
    ['image', 'inspect', '--format', '{{.Id}}', authImage],
    { capture: true },
  );
  if (args.includes('--compiled-operations')) {
    if (
      docker(['image', 'inspect', operationsTag], {
        capture: true,
        optional: true,
      }) !== null
    )
      throw new Error('Temporary operations image unexpectedly exists');
    docker([
      'build',
      '--platform',
      'linux/amd64',
      '--target',
      'operations',
      '--tag',
      operationsTag,
      '--build-context',
      'blogpost_metadata=' + build.metadataDirectory,
      build.sourceDirectory,
    ]);
    operationsArtifact = docker(
      ['image', 'inspect', '--format', '{{.Id}}', operationsTag],
      { capture: true },
    );
  }
  const baked = JSON.parse(
    docker(
      [
        'run',
        '--rm',
        '--pull',
        'never',
        backendArtifact,
        'node',
        '--input-type=module',
        '-e',
        "import {readFileSync} from 'node:fs'; const b=JSON.parse(readFileSync('.build/provenance.json','utf8')); const {configuration,...safe}=b; console.log(JSON.stringify(safe));",
      ],
      { capture: true },
    ),
  );
  if (
    baked.environment !== 'development' ||
    baked.runtimeInputDigest !== build.provenance.runtimeInputDigest ||
    baked.contractSha256 !== build.provenance.contractSha256
  )
    throw new Error(
      'Shared image is stale; rerun with --build. Tests do not overlay source onto an older artifact.',
    );
  docker(
    [
      'network',
      'create',
      '--internal',
      '--label',
      'blogpost.purpose=disposable-identity-test',
      network,
    ],
    { capture: true },
  );
  networkCreated = true;
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
        POSTGRES_PASSWORD: 'disposable-identity-root',
      }),
      '--health-cmd',
      'pg_isready -U postgres -d blogpost',
      '--health-interval',
      '1s',
      '--health-retries',
      '30',
      postgres,
    ],
    { capture: true },
  );
  docker(
    [
      'run',
      '--detach',
      '--rm',
      '--pull',
      'never',
      '--name',
      auth,
      '--network',
      network,
      '--network-alias',
      'auth',
      ...logs,
      '--tmpfs',
      '/emulator/data:rw,size=32m',
      ...envArgs({ IDENTITY_PROJECT_ID: project }),
      authArtifact,
    ],
    { capture: true },
  );
  for (const name of [db, auth]) {
    const mounts_ = JSON.parse(
      docker(['inspect', '--format', '{{json .Mounts}}', name], {
        capture: true,
      }),
    );
    if (mounts_.some((mount) => mount.Type === 'volume'))
      throw new Error('Test container has a persistent volume');
  }
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (
      docker(['inspect', '--format', '{{.State.Health.Status}}', db], {
        capture: true,
      }) === 'healthy'
    ) {
      healthy = true;
      break;
    }
    await delay(500);
  }
  if (!healthy) throw new Error('Disposable PostgreSQL did not become healthy');
  run([
    'node',
    '--input-type=module',
    '-e',
    `for(let i=0;i<60;i++){try{const r=await fetch('http://auth:9099/emulator/v1/projects/${project}/config',{signal:AbortSignal.timeout(1000)});if(r.ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,500))}process.exit(1)`,
  ]);
  run(['npm', 'run', 'db:bootstrap'], {
    SQL_ROOT_PASSWORD: 'disposable-identity-root',
    SQL_MIGRATOR_PASSWORD: 'disposable-identity-migrator',
  });
  run(['npm', 'run', 'db:migrate'], {
    SQL_MIGRATOR_PASSWORD: 'disposable-identity-migrator',
  });
  run(['npm', 'run', 'db:verify']);
  if (operationsArtifact) {
    run(
      ['node', 'dist/ops/bootstrap-db.js'],
      {
        SQL_ROOT_PASSWORD: 'disposable-identity-root',
        SQL_MIGRATOR_PASSWORD: 'disposable-identity-migrator',
      },
      operationsArtifact,
    );
    for (let attempt = 0; attempt < 2; attempt++)
      run(
        ['node', 'dist/ops/migrate.js'],
        { SQL_MIGRATOR_PASSWORD: 'disposable-identity-migrator' },
        operationsArtifact,
      );
    run(['node', 'dist/ops/verify-db.js'], {}, operationsArtifact);
    run(['node', 'dist/ops/maintenance.js'], {}, operationsArtifact);
  }
  run(
    [
      'node',
      'node_modules/tsx/dist/cli.mjs',
      '--test',
      'test/operations/database.test.ts',
    ],
    {
      BLOGPOST_DISPOSABLE_DATABASE: '1',
      BLOGPOST_IDENTITY_RUN_ID: suffix,
      SQL_ROOT_PASSWORD: 'disposable-identity-root',
      SQL_MIGRATOR_PASSWORD: 'disposable-identity-migrator',
    },
  );
  const database = JSON.parse(await readFile(databasePath, 'utf8'));
  if (
    database.status !== 'PASSED' ||
    database.runId !== suffix ||
    database.runtimeInputDigest !== baked.runtimeInputDigest ||
    database.contractSha256 !== baked.contractSha256 ||
    database.operatorTests !== 10
  )
    throw new Error(
      'Database operator evidence is stale, incomplete or mismatched',
    );
  run(
    [
      'node',
      'node_modules/tsx/dist/cli.mjs',
      '--test',
      '--test-concurrency=1',
      'test/identity/identity.test.ts',
    ],
    { BLOGPOST_DISPOSABLE_IDENTITY: '1', BLOGPOST_IDENTITY_RUN_ID: suffix },
  );
  run(['npm', 'run', 'test:integration']);
  run(
    [
      'node',
      'node_modules/tsx/dist/cli.mjs',
      '--test',
      '--test-concurrency=1',
      'test/identity/administration.test.ts',
    ],
    { BLOGPOST_DISPOSABLE_IDENTITY: '1', BLOGPOST_IDENTITY_RUN_ID: suffix },
  );
  run(
    [
      'node',
      'node_modules/tsx/dist/cli.mjs',
      '--test',
      '--test-concurrency=1',
      'test/identity/editorial.test.ts',
    ],
    { BLOGPOST_DISPOSABLE_IDENTITY: '1', BLOGPOST_IDENTITY_RUN_ID: suffix },
  );
  run(
    [
      'node',
      'node_modules/tsx/dist/cli.mjs',
      '--test',
      '--test-concurrency=1',
      'test/identity/public-taxonomy.test.ts',
    ],
    { BLOGPOST_DISPOSABLE_IDENTITY: '1', BLOGPOST_IDENTITY_RUN_ID: suffix },
  );
  run(
    [
      'node',
      'node_modules/tsx/dist/cli.mjs',
      '--test',
      '--test-concurrency=1',
      'test/identity/media.test.ts',
    ],
    { BLOGPOST_DISPOSABLE_IDENTITY: '1', BLOGPOST_IDENTITY_RUN_ID: suffix },
  );
  // Earlier SQL projection tests intentionally seed descriptors without real objects.
  // Maintenance gets its own clean schema on this invocation's verified tmpfs database.
  // The random container name is owned here; no saved stack configuration is consulted.
  docker(
    [
      'exec',
      db,
      'psql',
      '-U',
      'postgres',
      '-d',
      'blogpost',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'DROP SCHEMA blogpost CASCADE; CREATE SCHEMA blogpost AUTHORIZATION blogpost_migrator;',
    ],
    { capture: true },
  );
  run(['npm', 'run', 'db:bootstrap'], {
    SQL_ROOT_PASSWORD: 'disposable-identity-root',
    SQL_MIGRATOR_PASSWORD: 'disposable-identity-migrator',
  });
  run(['npm', 'run', 'db:migrate'], {
    SQL_MIGRATOR_PASSWORD: 'disposable-identity-migrator',
  });
  run(['npm', 'run', 'db:verify']);
  run(
    [
      'node',
      'node_modules/tsx/dist/cli.mjs',
      '--test',
      '--test-concurrency=1',
      'test/identity/maintenance.test.ts',
    ],
    { BLOGPOST_DISPOSABLE_IDENTITY: '1', BLOGPOST_IDENTITY_RUN_ID: suffix },
  );
  const observed = JSON.parse(await readFile(observedPath, 'utf8'));
  const administration = JSON.parse(await readFile(administrationPath, 'utf8'));
  const editorial = JSON.parse(await readFile(editorialPath, 'utf8'));
  const publicTaxonomy = JSON.parse(await readFile(publicPath, 'utf8'));
  const media = JSON.parse(await readFile(mediaPath, 'utf8'));
  const maintenance = JSON.parse(await readFile(maintenancePath, 'utf8'));
  if (
    observed.runId !== suffix ||
    observed.testProject !== project ||
    observed.contractSha256 !== baked.contractSha256 ||
    observed.executed !== 4 ||
    observed.complete !== false
  )
    throw new Error('Unexpected isolated conformance evidence');
  if (
    administration.runId !== suffix ||
    administration.testProject !== project ||
    administration.contractSha256 !== observed.contractSha256
  )
    throw new Error(
      'Administrative conformance evidence is stale or mismatched',
    );
  if (
    editorial.runId !== suffix ||
    editorial.testProject !== project ||
    editorial.contractSha256 !== observed.contractSha256
  )
    throw new Error('Editorial conformance evidence is stale or mismatched');
  if (
    publicTaxonomy.runId !== suffix ||
    publicTaxonomy.testProject !== project ||
    publicTaxonomy.contractSha256 !== observed.contractSha256
  )
    throw new Error(
      'Public/taxonomy conformance evidence is stale or mismatched',
    );
  const executed = new Set([
    ...observed.observedOperations,
    ...administration.observedOperations,
    ...editorial.observedOperations,
    ...publicTaxonomy.observedOperations,
    ...media.observedOperations,
  ]);
  const inventory = JSON.parse(
    await readFile(
      resolve(build.sourceDirectory, 'contracts/operation-inventory.json'),
      'utf8',
    ),
  );
  const pending = inventory
    .filter((operation) => !executed.has(operation.operationId))
    .map((operation) => operation.operationId);
  if (
    media.runId !== suffix ||
    media.testProject !== project ||
    media.contractSha256 !== observed.contractSha256
  )
    throw new Error('Media conformance evidence is stale or mismatched');
  if (
    maintenance.runId !== suffix ||
    maintenance.testProject !== project ||
    maintenance.contractSha256 !== observed.contractSha256 ||
    maintenance.maintenanceSuitePassed !== true
  )
    throw new Error('Maintenance evidence is stale or mismatched');
  if (executed.size !== inventory.length || pending.length !== 0)
    throw new Error('Incomplete isolated backend operation coverage');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        ...observed,
        artifact: {
          ...baked,
          imageId: backendArtifact,
          authImageId: authArtifact,
        },
        candidate: {
          sourceSha: build.provenance.sourceSha,
          sourceRef: build.provenance.sourceRef,
          dirty: build.provenance.dirty,
          runtimeInputDigest: build.provenance.runtimeInputDigest,
          sourceInputDigest: build.provenance.sourceInputDigest,
        },
        executed: executed.size,
        complete: pending.length === 0,
        pending,
        observedOperations: [...executed],
        limitations: [
          'Emulator tokens are unsigned; real Google staging verification remains required.',
          'Operation success coverage does not establish actual GCS/IAM, cloud maintenance scheduling, client journeys or release readiness.',
        ],
        status: 'PASSED',
        identitySqlSuitePassed: true,
        foundationIntegrationSuitePassed: true,
        administrationSuitePassed: true,
        editorialSuitePassed: true,
        publicTaxonomySuitePassed: true,
        mediaSuitePassed: true,
        maintenanceSuitePassed: true,
        databaseOperatorSuitePassed: true,
        databaseOperatorTests: database.operatorTests,
        compiledOperationsSuitePassed: operationsArtifact !== null,
      },
      null,
      2,
    ) + '\n',
  );
  await unlink(observedPath);
  await unlink(administrationPath);
  await unlink(editorialPath);
  await unlink(publicPath);
  await unlink(mediaPath);
  await unlink(maintenancePath);
  await unlink(databasePath);
  console.log(
    `Isolated backend conformance: ${executed.size}/${observed.total}; ${pending.length} operations pending.`,
  );
} catch (error) {
  await writeFile(
    reportPath,
    JSON.stringify(
      { status: 'FAILED', runId: suffix, observedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  if (networkCreated) {
    for (const name of [testContainer, auth, db]) {
      // Only this invocation's random, exact resource names may be removed.
      if (
        docker(['container', 'inspect', name], {
          capture: true,
          optional: true,
        }) !== null
      )
        docker(['rm', '--force', name], { capture: true, optional: true });
    }
    docker(['network', 'rm', network], { capture: true });
  }
  if (operationsArtifact)
    docker(['image', 'rm', operationsTag], { capture: true });
}
