import { spawn } from 'node:child_process';
import { mkdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  canonical,
  digest,
  normalizeCloudProfile,
} from '../../src/platform/config/build-model.ts';
import { prepareBuild } from '../build/prepare.mjs';
import { githubReader } from '../ci/github-api.mjs';
import { fail, metadata } from '../ci/policy.mjs';
import { compatibilityCatalog } from './compatibility.mjs';
import { cloudBuildRequest } from './context.mjs';
import {
  verifyLiveCloudBuildContext,
  requireRecoveryRecipe,
} from './reader.mjs';
import { recoveryRecipe } from './recipe.mjs';
import { proveCloudBuildSource } from './source.mjs';

export function recoveryArguments(args) {
  const [phase, ...rest] = args;
  const names = {
    '--project-id': 'projectId',
    '--build-id': 'buildId',
    '--region': 'region',
    '--environment': 'environment',
  };
  const request = {};
  if (!['capture', 'check-build'].includes(phase) || rest.length !== 8)
    fail('INVALID_RECOVERY_ARGUMENTS');
  for (let i = 0; i < rest.length; i += 2) {
    if (!Object.hasOwn(names, rest[i])) fail('INVALID_RECOVERY_ARGUMENTS');
    const key = names[rest[i]],
      value = rest[i + 1];
    if (!key || Object.hasOwn(request, key) || typeof value !== 'string')
      fail('INVALID_RECOVERY_ARGUMENTS');
    request[key] = value;
  }
  return { phase, request };
}
export function recoveryEnvironment(input = process.env) {
  const environment = {};
  for (const key of [
    'PATH',
    'HOME',
    'USERPROFILE',
    'TMP',
    'TEMP',
    'TMPDIR',
    'SYSTEMROOT',
    'WINDIR',
    'JAVA_HOME',
    'BLOGPOST_JAVA_HOME',
    'DOCKER_HOST',
    'DOCKER_CONFIG',
  ])
    if (typeof input[key] === 'string') environment[key] = input[key];
  return {
    ...environment,
    CI: 'true',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
}
export async function executeRecovery(
  command,
  args,
  { cwd, env, capture = false, timeout = 600000, input } = {},
) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      timeout,
      stdio: [
        input === undefined ? 'ignore' : 'pipe',
        capture ? 'pipe' : 'inherit',
        capture ? 'pipe' : 'inherit',
      ],
    });
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    let size = 0;
    const chunks = [];
    if (capture) {
      child.stdout.on('data', (bytes) => {
        size += bytes.length;
        if (size > 1048576) child.kill();
        else chunks.push(bytes);
      });
      child.stderr.resume();
    }
    child.once('error', () =>
      reject(
        Object.assign(new Error('RECOVERY_COMMAND_FAILED'), {
          code: 'RECOVERY_COMMAND_FAILED',
        }),
      ),
    );
    child.once('close', (code) => {
      if (code !== 0 || size > 1048576)
        reject(
          Object.assign(new Error('RECOVERY_COMMAND_FAILED'), {
            code: 'RECOVERY_COMMAND_FAILED',
          }),
        );
      else {
        try {
          accept(
            capture
              ? new TextDecoder('utf-8', { fatal: true })
                  .decode(Buffer.concat(chunks))
                  .trimEnd()
              : '',
          );
        } catch {
          reject(
            Object.assign(new Error('RECOVERY_COMMAND_FAILED'), {
              code: 'RECOVERY_COMMAND_FAILED',
            }),
          );
        }
      }
    });
  });
}
async function directory(root, path, fresh = false) {
  root = resolve(root);
  path = resolve(path);
  if (!path.startsWith(root + sep)) fail('UNSAFE_RECOVERY_DIRECTORY');
  let current = root;
  if (
    !(await lstat(current)).isDirectory() ||
    (await lstat(current)).isSymbolicLink()
  )
    fail('UNSAFE_RECOVERY_DIRECTORY');
  for (const part of path.slice(root.length + 1).split(sep)) {
    current = resolve(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== 'EEXIST' || (fresh && current === path)) throw error;
    }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail('UNSAFE_RECOVERY_DIRECTORY');
  }
  return path;
}
async function json(path, limit = 1048576) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    fail('INVALID_RECOVERY_INPUT');
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)),
  );
}
export function recoveryChecks(environment, baseSha) {
  return [
    ['npm', ['ci', '--no-audit']],
    ['npm', ['run', 'build:native']],
    ...[
      'test:ci',
      'security:check',
      'security:test',
      'test:build',
      'test:deploy',
      'db:validate',
      'db:generate',
    ].map((script) => ['npm', ['run', script]]),
    ...['contract:build', 'contract:typescript', 'contract:kotlin'].map(
      (script) => ['npm', ['run', script, '--', '--check']],
    ),
    ['npm', ['run', 'contract:kotlin:test']],
    ['npm', ['run', 'contract:compatibility:test']],
    [
      'node',
      [
        'scripts/cloudbuild/compatibility.mjs',
        '--environment',
        environment,
        '--base-sha',
        baseSha,
      ],
    ],
    ...['format:check', 'docs:check', 'typecheck', 'mock:smoke'].map(
      (script) => ['npm', ['run', script]],
    ),
    ['npm', ['test']],
    ['node', ['scripts/contract-manifest.mjs', '--check']],
    [
      'npm',
      [
        'run',
        'test:identity',
        '--',
        '--build',
        '--compiled-operations',
        '--copy-reports',
      ],
    ],
    ['npm', ['run', 'test:recovery']],
    ['npm', ['run', 'build']],
    ...[
      [],
      ['--prefix', 'docker/auth'],
      ['--prefix', 'docker/operations'],
      ['--prefix', 'tools/mock'],
    ].map((prefix) => ['npm', ['audit', ...prefix, '--audit-level=moderate']]),
  ];
}
export async function runRecovery({
  phase,
  request,
  bootstrapRoot = process.cwd(),
  workspaceRoot = '/workspace',
  transport = fetch,
  githubTransport = fetch,
  now = Date.now,
  execute = executeRecovery,
}) {
  if (!['capture', 'check-build'].includes(phase))
    fail('INVALID_RECOVERY_ARGUMENTS');
  bootstrapRoot = resolve(bootstrapRoot);
  workspaceRoot = resolve(workspaceRoot);
  const projects = await json(
    resolve(bootstrapRoot, 'config/cloud-projects.json'),
  );
  const config = await json(resolve(bootstrapRoot, 'config/repository.json'));
  const plan = cloudBuildRequest(request, projects),
    clock = typeof now === 'function' ? now : () => now;
  const env = recoveryEnvironment();
  const run = (command, args, extra = {}) =>
    execute(command, args, { env, cwd: workspaceRoot, ...extra });
  const observe = async () => {
    const context = await verifyLiveCloudBuildContext({
      request,
      projects,
      repositoryConfig: config,
      transport,
      now: clock,
    });
    const recipe = requireRecoveryRecipe(context, request, projects, clock());
    return { context, recipe };
  };
  const location = resolve(workspaceRoot, '.local/cloudbuild', plan.buildId);
  const source = resolve(location, 'source');
  const first = await observe();
  if (phase === 'capture') {
    await directory(workspaceRoot, location, true);
    await run(
      'git',
      [
        'clone',
        '--no-hardlinks',
        '--no-checkout',
        '--no-single-branch',
        '--',
        'https://github.com/' + config.fullName + '.git',
        source,
      ],
      { capture: true },
    );
    await run(
      'git',
      ['-C', source, 'checkout', '-B', plan.branch, first.context.sourceSha],
      { capture: true },
    );
  } else await directory(workspaceRoot, source);
  const { context, recipe } = await observe();
  const sourceProof = await proveCloudBuildSource({
    root: source,
    context,
    config,
    read: githubReader(config, null, githubTransport),
    now: clock,
  });
  if (
    context.sourceSha !== first.context.sourceSha ||
    context.configurationDigest !== first.context.configurationDigest ||
    recipe.recipeDigest !== first.recipe.recipeDigest
  )
    fail('RECOVERY_CAPTURE_DISAGREES');
  if (
    canonical(await json(resolve(source, 'config/cloud-projects.json'))) !==
      canonical(projects) ||
    canonical(await json(resolve(source, 'config/repository.json'))) !==
      canonical(config)
  )
    fail('RECOVERY_SOURCE_CONFIGURATION_DISAGREES');
  const profile = normalizeCloudProfile(
    await json(
      resolve(source, 'config/environments', plan.environment + '.json'),
      16384,
    ),
  );
  const selected = projects[plan.environment];
  if (
    profile.environment !== plan.environment ||
    profile.projectId !== plan.projectId ||
    profile.apiOrigin !== selected.plannedOrigins.api ||
    profile.webOrigin !== selected.plannedOrigins.web ||
    profile.sql.instanceConnectionName.split(':')[1] !== plan.region
  )
    fail('RECOVERY_PROFILE_DESTINATION_DISAGREES');
  const release = metadata(source, context.sourceSha);
  const contract = await json(
    resolve(source, 'contracts/openapi-v1.json'),
    4 * 1024 * 1024,
  );
  compatibilityCatalog(
    await json(resolve(source, 'config/contract-baselines.json')),
    {
      environment: plan.environment,
      version: release.version,
      publish: release.publish,
      contractStatus: contract['x-contract-status'],
    },
  );
  const build = await prepareBuild(source, plan.environment, profile, {});
  const identity = {
    sourceSha: context.sourceSha,
    environment: plan.environment,
    sourceInputDigest: build.provenance.sourceInputDigest,
    runtimeInputDigest: build.provenance.runtimeInputDigest,
    configurationDigest: digest(profile),
    recipeDigest: recipe.recipeDigest,
    contextDigest: context.configurationDigest,
    cloudBuild: context.observation.build.name,
  };
  if (phase === 'capture') {
    await writeFile(
      resolve(location, 'capture.json'),
      canonical({ ...identity, status: 'SOURCE_CAPTURED' }) + '\n',
      { flag: 'wx' },
    );
    return { ...identity, status: 'SOURCE_CAPTURED' };
  }
  const checks = resolve(location, 'checks');
  // A clean work branch at the same SHA lets Development-only isolated tests retain their real identity.
  await run(
    'git',
    ['clone', '--no-hardlinks', '--no-checkout', '--', source, checks],
    { capture: true },
  );
  await run(
    'git',
    [
      '-C',
      checks,
      'checkout',
      '-b',
      'chore/cloud-build-check',
      context.sourceSha,
    ],
    { capture: true },
  );
  const checkEnv = {
    ...env,
    APP_ENV: 'development',
    NODE_ENV: 'test',
    IDENTITY_PROJECT_ID: 'demo-blogpost-recovery',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    MEDIA_ADAPTER: 'local',
    MEDIA_LOCAL_ROOT: '.local/media',
    API_ORIGIN: 'http://localhost:8080',
    WEB_ORIGIN: 'http://localhost:3000',
    SQL_HOST: '127.0.0.1',
    SQL_DATABASE: 'blogpost',
    SQL_APP_PASSWORD: 'disposable-recovery-app',
    CURSOR_SIGNING_KEY: '3'.repeat(64),
  };
  for (const [command, args] of recoveryChecks(
    plan.environment,
    sourceProof.baseSha,
  ))
    await run(command, args, { cwd: checks, env: checkEnv, timeout: 1200000 });
  const sql = await json(
    resolve(checks, '.local/conformance/backend-identity.json'),
  );
  const inventory = await json(
    resolve(source, 'contracts/operation-inventory.json'),
  );
  const expectedOperations = inventory
    .map((operation) => operation.operationId)
    .sort();
  if (
    sql.status !== 'PASSED' ||
    sql.complete !== true ||
    sql.executed !== 52 ||
    ![
      'identitySqlSuitePassed',
      'foundationIntegrationSuitePassed',
      'administrationSuitePassed',
      'editorialSuitePassed',
      'publicTaxonomySuitePassed',
      'mediaSuitePassed',
      'maintenanceSuitePassed',
      'databaseOperatorSuitePassed',
      'compiledOperationsSuitePassed',
    ].every((key) => sql[key] === true) ||
    sql.databaseOperatorTests !== 11 ||
    typeof sql.runId !== 'string' ||
    /^[a-f0-9]{12}$/.exec(sql.runId)?.[0] !== sql.runId ||
    !Array.isArray(sql.observedOperations) ||
    canonical([...sql.observedOperations].sort()) !==
      canonical(expectedOperations) ||
    sql.candidate?.sourceSha !== identity.sourceSha ||
    sql.candidate?.sourceInputDigest !== identity.sourceInputDigest ||
    sql.candidate?.dirty !== false ||
    sql.artifact?.sourceSha !== identity.sourceSha ||
    sql.artifact?.sourceInputDigest !== identity.sourceInputDigest ||
    sql.artifact?.dirty !== false ||
    sql.artifact?.environment !== 'development' ||
    sql.artifact?.runtimeInputDigest !== sql.candidate.runtimeInputDigest
  )
    fail('RECOVERY_SQL_ARTIFACT_DISAGREES');
  const rehearsal = await json(
    resolve(checks, '.local/conformance/database-recovery.json'),
  );
  if (
    rehearsal.schemaVersion !== 1 ||
    rehearsal.status !== 'PASSED' ||
    rehearsal.scope !== 'disposable-development-recovery-rehearsal' ||
    typeof rehearsal.runId !== 'string' ||
    /^[a-f0-9]{12}$/.exec(rehearsal.runId)?.[0] !== rehearsal.runId ||
    !Array.isArray(rehearsal.checks) ||
    rehearsal.checks.length !== 15 ||
    new Set(rehearsal.checks).size !== 15 ||
    rehearsal.mediaObjects !== 3 ||
    rehearsal.artifact?.sourceSha !== identity.sourceSha ||
    rehearsal.artifact?.sourceInputDigest !== identity.sourceInputDigest ||
    rehearsal.artifact?.runtimeInputDigest !==
      sql.artifact.runtimeInputDigest ||
    rehearsal.artifact?.dirty !== false ||
    rehearsal.artifact?.environment !== 'development' ||
    rehearsal.candidateSource?.sourceSha !== identity.sourceSha ||
    rehearsal.candidateSource?.sourceInputDigest !==
      identity.sourceInputDigest ||
    rehearsal.candidateSource?.dirty !== false ||
    rehearsal.candidateSource?.runtimeInputDigest !==
      sql.artifact.runtimeInputDigest
  )
    fail('RECOVERY_DATABASE_REHEARSAL_DISAGREES');
  const images = [];
  for (const [index, target] of ['runtime', 'operations'].entries()) {
    const tag = recoveryRecipe(request).images[index];
    await run('docker', [
      'build',
      '--platform',
      'linux/amd64',
      '--target',
      target,
      '--tag',
      tag,
      '--build-context',
      'blogpost_metadata=' + build.metadataDirectory,
      build.sourceDirectory,
    ]);
    const imageId = await run(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', tag],
      { capture: true },
    );
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId) || imageId.length !== 71)
      fail('INVALID_RECOVERY_IMAGE_ID');
    await run(
      'docker',
      [
        'run',
        '--rm',
        '--pull',
        'never',
        '--interactive',
        '--network',
        'none',
        imageId,
        'node',
        '--input-type=module',
        '-',
        ...(target === 'operations' ? ['--operations'] : []),
        '--expected',
        canonical({
          environment: plan.environment,
          sourceSha: identity.sourceSha,
          sourceInputDigest: identity.sourceInputDigest,
          runtimeInputDigest: identity.runtimeInputDigest,
          contractSha256: build.provenance.contractSha256,
          configurationDigest: identity.configurationDigest,
        }),
      ],
      { input: await readFile(resolve(source, 'test/build/image-smoke.mjs')) },
    );
    images.push({ target, tag, imageId });
  }
  const final = await observe();
  await proveCloudBuildSource({
    root: source,
    context: final.context,
    config,
    read: githubReader(config, null, githubTransport),
    now: clock,
  });
  const frozen = await prepareBuild(source, plan.environment, profile, {});
  if (
    final.context.sourceSha !== identity.sourceSha ||
    final.context.configurationDigest !== identity.contextDigest ||
    final.recipe.recipeDigest !== identity.recipeDigest ||
    canonical(frozen.provenance) !== canonical(build.provenance)
  )
    fail('RECOVERY_FINAL_INPUTS_DISAGREE');
  for (const image of images)
    if (
      (await run(
        'docker',
        ['image', 'inspect', '--format', '{{.Id}}', image.tag],
        { capture: true },
      )) !== image.imageId
    )
      fail('RECOVERY_FINAL_IMAGE_DISAGREES');
  const result = {
    schemaVersion: 1,
    status: 'CHECKS_PASSED_PUSH_PENDING',
    ...identity,
    images,
    sqlRunId: sql.runId,
    limitations: [
      'Cloud Build must still complete its managed image push and provide results/provenance. This record is not release, deployment or actual-provider/client acceptance.',
    ],
  };
  await writeFile(resolve(location, 'result.json'), canonical(result) + '\n', {
    flag: 'wx',
  });
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (resolve(process.cwd()) !== '/workspace')
      fail('RECOVERY_REQUIRES_CLOUD_BUILD_WORKSPACE');
    const args = recoveryArguments(process.argv.slice(2));
    const bootstrapRoot =
      args.phase === 'capture'
        ? process.cwd()
        : resolve(import.meta.dirname, '../..');
    console.log(JSON.stringify(await runRecovery({ ...args, bootstrapRoot })));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'cloud_build_recovery_failed',
        code:
          typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code)
            ? error.code
            : 'INVALID_RECOVERY_EVIDENCE',
      }),
    );
    process.exitCode = 1;
  }
}
