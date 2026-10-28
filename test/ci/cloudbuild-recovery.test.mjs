import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, merged } from './fixtures.mjs';
import { recipeFixture, provider, observed } from './cloudbuild-fixtures.mjs';
import {
  recoveryBuilder,
  runRecovery,
  executeRecovery,
} from '../../scripts/cloudbuild/recover.mjs';
import { toolchain } from '../../scripts/cloudbuild/recipe.mjs';
import { prepareProvenance } from '../../scripts/build/inputs.mjs';

async function recovery(
  t,
  {
    profile = true,
    invalidRecipe = false,
    failCheck = false,
    sqlPatch = {},
    recoveryPatch = {},
    swapImage = false,
    catalogMode = 'INITIAL_DRAFT',
  } = {},
) {
  const template = recipeFixture();
  const selected = template.projects.staging;
  const example = JSON.parse(
    await readFile(
      new URL(
        '../../config/environments/staging.example.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const actual = JSON.parse(
    JSON.stringify(example).replaceAll(
      'example-blogpost-staging',
      selected.projectId,
    ),
  );
  actual.apiOrigin = selected.plannedOrigins.api;
  actual.webOrigin = selected.plannedOrigins.web;
  const operations = Array.from({ length: 52 }, (_, i) => ({
    operationId: 'syntheticOperation' + i,
  }));
  const f = await merged(t, 'rc', async (f) => {
    await f.write('config/cloud-projects.json', template.projects);
    await f.write('config/repository.json', config);
    await f.write('config/contract-baselines.json', {
      schemaVersion: 1,
      mode: catalogMode,
      baselines: [],
    });
    await f.write('contracts/openapi-v1.json', {
      info: { version: '1.0.0' },
      'x-contract-status': 'DRAFT',
    });
    await f.write('contracts/operation-inventory.json', operations);
    await f.write(
      'test/build/image-smoke.mjs',
      '// Synthetic stdin; never executed by the mock Docker transport.\n',
    );
    if (profile) await f.write('config/environments/staging.json', actual);
  });
  const cloud = recipeFixture('staging', f.merge),
    p = provider(cloud);
  if (invalidRecipe) cloud.build.steps[0].allowFailure = true;
  const workspaceRoot = resolve(f.root, '.local/recovery-workspace');
  await mkdir(workspaceRoot, { recursive: true });
  const calls = [],
    inspectCounts = new Map();
  // Provider/quality/Docker responses are synthetic. Only Git clones/history and snapshots are real.
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git') {
      if (
        args[0] === 'clone' &&
        args.at(-2) === 'https://github.com/fixture/backend.git'
      ) {
        const changed = [...args];
        changed[changed.length - 2] = f.root;
        await executeRecovery(command, changed, options);
        return executeRecovery(
          'git',
          [
            '-C',
            args.at(-1),
            'remote',
            'set-url',
            'origin',
            'https://github.com/fixture/backend.git',
          ],
          options,
        );
      }
      return executeRecovery(command, args, options);
    }
    if (command === 'npm') {
      if (failCheck && args.includes('test:identity'))
        throw Object.assign(new Error('synthetic check failure'), {
          code: 'RECOVERY_COMMAND_FAILED',
        });
      if (args.includes('test:identity')) {
        const { provenance } = await prepareProvenance(
          options.cwd,
          'development',
          null,
          {},
        );
        const report = {
          status: 'PASSED',
          complete: true,
          executed: 52,
          runId: 'abcdef012345',
          databaseOperatorTests: 11,
          candidate: provenance,
          artifact: provenance,
          observedOperations: operations.map(
            (operation) => operation.operationId,
          ),
          ...Object.fromEntries(
            [
              'identitySqlSuitePassed',
              'foundationIntegrationSuitePassed',
              'administrationSuitePassed',
              'editorialSuitePassed',
              'publicTaxonomySuitePassed',
              'mediaSuitePassed',
              'maintenanceSuitePassed',
              'databaseOperatorSuitePassed',
              'compiledOperationsSuitePassed',
            ].map((key) => [key, true]),
          ),
          ...sqlPatch,
        };
        await mkdir(resolve(options.cwd, '.local/conformance'), {
          recursive: true,
        });
        await writeFile(
          resolve(options.cwd, '.local/conformance/backend-identity.json'),
          JSON.stringify(report),
        );
      }
      if (args.includes('test:recovery')) {
        const { provenance } = await prepareProvenance(
          options.cwd,
          'development',
          null,
          {},
        );
        await writeFile(
          resolve(options.cwd, '.local/conformance/database-recovery.json'),
          JSON.stringify({
            schemaVersion: 1,
            status: 'PASSED',
            scope: 'disposable-development-recovery-rehearsal',
            runId: 'abcdef012345',
            checks: Array.from(
              { length: 15 },
              (_, i) => 'synthetic-recovery-check-' + i,
            ),
            mediaObjects: 3,
            artifact: provenance,
            candidateSource: provenance,
            ...recoveryPatch,
          }),
        );
      }
      return '';
    }
    if (command === 'docker' && args[0] === 'image') {
      const tag = args.at(-1),
        count = (inspectCounts.get(tag) ?? 0) + 1;
      inspectCounts.set(tag, count);
      return 'sha256:' + (swapImage && count > 1 ? 'b' : 'a').repeat(64);
    }
    return '';
  };
  const githubTransport = async (url) => {
    const path =
      new URL(url).pathname.replace('/repos/fixture/backend', '') +
      new URL(url).search;
    const value = path.startsWith('/git/ref/')
      ? { ref: 'refs/heads/rc', object: { type: 'commit', sha: f.merge } }
      : await f.read(path);
    return new Response(JSON.stringify(value));
  };
  const invoke = (phase, extra = {}) =>
    runRecovery({
      phase,
      request: cloud.request,
      bootstrapRoot: f.root,
      workspaceRoot,
      transport: p.transport,
      githubTransport,
      now: observed,
      execute,
      ...extra,
    });
  return { ...f, cloud, invoke, calls, workspaceRoot };
}
test('recovery captures real Git source once and two-target orchestration uses identical captured inputs after all checks', async (t) => {
  const f = await recovery(t);
  const captured = await f.invoke('capture');
  assert.equal(captured.status, 'SOURCE_CAPTURED');
  assert.equal(captured.sourceSha, f.merge);
  assert.equal(
    f.calls.some((call) => call.command === 'docker'),
    false,
  );
  const proof = await f.invoke('check-build');
  assert.equal(proof.status, 'CHECKS_PASSED_PUSH_PENDING');
  assert.equal(proof.sourceInputDigest, captured.sourceInputDigest);
  assert.equal(proof.runtimeInputDigest, captured.runtimeInputDigest);
  assert.equal(proof.images.length, 2);
  const builds = f.calls.filter(
    (call) => call.command === 'docker' && call.args[0] === 'build',
  );
  assert.equal(builds.length, 2);
  const builder = recoveryBuilder(f.cloud.request.buildId);
  const created = f.calls.findIndex(
    (call) =>
      call.command === 'docker' &&
      JSON.stringify(call.args) === JSON.stringify(builder.create),
  );
  const sqlCheck = f.calls.findIndex((call) =>
    call.args.includes('test:identity'),
  );
  assert.ok(created > 0 && created < sqlCheck);
  assert.equal(f.calls.at(-1).command, 'docker');
  assert.deepEqual(f.calls.at(-1).args, builder.remove);
  for (const call of [...builds, f.calls[sqlCheck]])
    assert.equal(call.options.env.BUILDX_BUILDER, builder.name);
  for (const build of builds) assert.ok(build.args.includes('--load'));
  assert.equal(builds[0].args.at(-1), builds[1].args.at(-1));
  assert.equal(
    builds[0].args[builds[0].args.indexOf('--build-context') + 1],
    builds[1].args[builds[1].args.indexOf('--build-context') + 1],
  );
  const sqlIndex = f.calls.findIndex((call) =>
    call.args.includes('test:identity'),
  );
  assert.ok(sqlIndex > 0 && sqlIndex < f.calls.indexOf(builds[0]));
  const recoveryIndex = f.calls.findIndex((call) =>
    call.args.includes('test:recovery'),
  );
  assert.ok(
    recoveryIndex > sqlIndex && recoveryIndex < f.calls.indexOf(builds[0]),
  );
  for (const smoke of f.calls.filter(
    (call) => call.command === 'docker' && call.args[0] === 'run',
  )) {
    assert.equal(smoke.args[smoke.args.indexOf('--network') + 1], 'none');
    assert.equal(smoke.options.env.SQL_ROOT_PASSWORD, undefined);
    assert.ok(Buffer.isBuffer(smoke.options.input));
    assert.ok(!smoke.args.includes('--mount'));
  }
  assert.ok(
    !f.calls.some(
      (call) => call.command === 'gcloud' || call.args[0] === 'push',
    ),
  );
  await assert.rejects(f.invoke('capture')); // existing invocation state is never overwritten
});
test('recovery cannot start clone/check commands with a modified actual build recipe', async (t) => {
  const f = await recovery(t, { invalidRecipe: true });
  await assert.rejects(f.invoke('capture'), {
    code: 'UNAPPROVED_CLOUD_BUILD_RECIPE',
  });
  assert.equal(f.calls.length, 0);
});
test('recovery refuses missing actual profile rather than selecting a synthetic example', async (t) => {
  const f = await recovery(t, { profile: false });
  await assert.rejects(f.invoke('capture'));
  assert.ok(f.calls.every((call) => call.command === 'git'));
});

test('recovery rejects incomplete compatibility inputs before building tools or running quality commands', async (t) => {
  const f = await recovery(t, { catalogMode: 'REVIEWED_HASHED_BASELINES' });
  await assert.rejects(f.invoke('capture'), {
    code: 'SUPPORTED_COMPATIBILITY_BASELINES_REQUIRED',
  });
  assert.ok(f.calls.every((call) => call.command === 'git'));
});
test('recovery does not build publication images after a failed disposable SQL check or mismatched SQL evidence', async (t) => {
  for (const options of [
    { failCheck: true },
    { sqlPatch: { compiledOperationsSuitePassed: false } },
    { sqlPatch: { observedOperations: [] } },
    { sqlPatch: { candidate: { sourceSha: 'b'.repeat(40) } } },
    { recoveryPatch: { checks: [] } },
    { recoveryPatch: { artifact: { sourceSha: 'b'.repeat(40) } } },
  ]) {
    const f = await recovery(t, options);
    await f.invoke('capture');
    await assert.rejects(f.invoke('check-build'));
    assert.ok(
      !f.calls.some(
        (call) => call.command === 'docker' && call.args[0] === 'build',
      ),
    );
    // The pinned builder is still removed after a failed check.
    assert.deepEqual(
      f.calls.at(-1).args,
      recoveryBuilder(f.cloud.request.buildId).remove,
    );
  }
});
test('recovery rechecks final Docker tag identity before allowing managed publication', async (t) => {
  const f = await recovery(t, { swapImage: true });
  await f.invoke('capture');
  await assert.rejects(f.invoke('check-build'), {
    code: 'RECOVERY_FINAL_IMAGE_DISAGREES',
  });
});

test('recovery builder is a per-build docker-container builder on pinned BuildKit', () => {
  const builder = recoveryBuilder('11111111-1111-4111-8111-111111111111');
  assert.equal(
    builder.name,
    'blogpost-recovery-11111111-1111-4111-8111-111111111111',
  );
  assert.deepEqual(builder.create, [
    'buildx',
    'create',
    '--name',
    builder.name,
    '--driver',
    'docker-container',
    '--driver-opt',
    'image=' + toolchain.buildkit,
    '--bootstrap',
  ]);
  assert.match(
    toolchain.buildkit,
    /^moby\/buildkit:v[0-9.]+@sha256:[a-f0-9]{64}$/,
  );
  assert.deepEqual(builder.remove, ['buildx', 'rm', '--force', builder.name]);
});
