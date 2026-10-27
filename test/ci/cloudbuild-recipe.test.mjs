import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { recipeFixture, observed, provider } from './cloudbuild-fixtures.mjs';
import {
  recoveryRecipe,
  toolchain,
  verifyRecoveryRecipe,
} from '../../scripts/cloudbuild/recipe.mjs';
import {
  requireRecoveryRecipe,
  verifyLiveCloudBuildContext,
} from '../../scripts/cloudbuild/reader.mjs';
import {
  recoveryArguments,
  recoveryChecks,
  recoveryEnvironment,
  executeRecovery,
} from '../../scripts/cloudbuild/recover.mjs';

test('checked-in recovery YAML exactly matches pinned model and tools Dockerfile inputs', async () => {
  const yaml = parse(
    await readFile(new URL('../../cloudbuild.yaml', import.meta.url), 'utf8'),
  );
  assert.deepEqual(yaml, recoveryRecipe());
  const file = await readFile(
    new URL('../../docker/cloudbuild/Dockerfile', import.meta.url),
    'utf8',
  );
  const sources = [...file.matchAll(/^FROM (\S+)/gm)].map((match) => match[1]);
  assert.deepEqual(sources, [toolchain.docker, toolchain.java, toolchain.node]);
  for (const image of Object.values(toolchain).filter(
    (value) => typeof value === 'string' && value.includes('@'),
  ))
    assert.match(image, /@sha256:[a-f0-9]{64}$/);
});
for (const environment of ['staging', 'production'])
  test(
    'recovery recipe ' +
      environment +
      ' is bound to actual live build and exact image destinations',
    async () => {
      const f = recipeFixture(environment),
        p = provider(f);
      assert.equal(
        verifyRecoveryRecipe(f.build, f.request, f.projects).status,
        'VERIFIED',
      );
      const context = await verifyLiveCloudBuildContext({
        ...f,
        transport: p.transport,
      });
      assert.equal(
        requireRecoveryRecipe(context, f.request, f.projects, observed).scope,
        'cloud-build-recipe',
      );
      await assert.rejects(async () =>
        requireRecoveryRecipe(
          structuredClone(context),
          f.request,
          f.projects,
          observed,
        ),
      );
      assert.throws(() =>
        requireRecoveryRecipe(
          context,
          { ...f.request, buildId: f.trigger.id },
          f.projects,
          observed,
        ),
      );
    },
  );
test('recovery rejects modified graph, tools, commands, soft failures, environment injection and image/artifact writes', () => {
  const changes = [
    (b) => b.steps.pop(),
    (b) => b.steps.reverse(),
    (b) => {
      b.steps[0].name = 'node:latest';
    },
    (b) => {
      b.steps[1].waitFor = ['-'];
    },
    (b) => {
      b.steps[2].entrypoint = 'bash';
    },
    (b) => {
      b.steps[2].args[1] = 'skip-tests';
    },
    (b) => {
      b.steps[0].allowFailure = true;
    },
    (b) => {
      b.steps[0].allowExitCodes = [1];
    },
    (b) => {
      b.steps[0].automapSubstitutions = true;
    },
    (b) => {
      b.steps[0].env = ['NODE_OPTIONS=--import=/tmp/untrusted.mjs'];
    },
    (b) => {
      b.steps[1].volumes = [{ name: 'untrusted', path: '/workspace' }];
    },
    (b) => {
      b.steps[2].script = 'true';
    },
    (b) => {
      b.images.push('unapproved.example/image:tag');
    },
    (b) => {
      b.images[0] = b.images[0].replace('/blogpost/', '/other/');
    },
    (b) => {
      b.images[0] = b.images[0].replace(/:build-.+$/, ':latest');
    },
    (b) => {
      b.options.env = ['GITHUB_ACTIONS=true'];
    },
    (b) => {
      b.options.requestedVerifyOption = 'NOT_VERIFIED';
    },
    (b) => {
      b.options.sourceProvenanceHash = [];
    },
    (b) => {
      b.options.automapSubstitutions = true;
    },
    (b) => {
      b.options.volumes = [{}];
    },
    (b) => {
      b.dependencies = [{}];
    },
    (b) => {
      b.logsBucket = 'gs://other';
    },
    (b) => {
      b.substitutions._SKIP = 'true';
    },
    (b) => {
      b.artifacts = { objects: { location: 'gs://other' } };
    },
    (b) => {
      b.artifacts = { images: ['unapproved'] };
    },
    (b) => {
      b.timeout = '7200s';
    },
  ];
  for (const [i, mutate] of changes.entries()) {
    const f = recipeFixture();
    mutate(f.build);
    assert.throws(
      () => verifyRecoveryRecipe(f.build, f.request, f.projects),
      undefined,
      'modified recipe ' + i,
    );
  }
});
test('recovery command routing is strict and child checks cannot inherit ambient cloud/Actions/SQL credentials', () => {
  const args = [
    'capture',
    '--project-id',
    'blogpost-staging',
    '--build-id',
    '11111111-1111-4111-8111-111111111111',
    '--region',
    'asia-southeast2',
    '--environment',
    'staging',
  ];
  assert.equal(recoveryArguments(args).request.environment, 'staging');
  for (const bad of [
    [],
    ['deploy', ...args.slice(1)],
    [...args, '--skip', 'true'],
    args.map((v) => (v === '--region' ? '--environment' : v)),
    args.map((v) => (v === '--region' ? '__proto__' : v)),
  ])
    assert.throws(() => recoveryArguments(bad));
  const env = recoveryEnvironment({
    PATH: 'synthetic-path',
    HOME: 'synthetic-home',
    JAVA_HOME: 'synthetic-java',
    GITHUB_TOKEN: 'private',
    GOOGLE_APPLICATION_CREDENTIALS: '/private',
    NODE_OPTIONS: '--import=private',
    SQL_ROOT_PASSWORD: 'private',
    APP_ENV: 'production',
    GITHUB_ACTIONS: 'true',
    BLOGPOST_GRADLE_HOME: '/untrusted',
  });
  assert.deepEqual(
    Object.keys(env).sort(),
    [
      'CI',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_NOSYSTEM',
      'GIT_TERMINAL_PROMPT',
      'HOME',
      'JAVA_HOME',
      'PATH',
    ].sort(),
  );
  const checks = recoveryChecks('production', 'a'.repeat(40));
  assert.ok(
    checks.some(
      ([command, values]) => command === 'npm' && values.includes('ci'),
    ),
  );
  assert.ok(
    checks.some(
      ([, values]) =>
        values.includes('test:identity') &&
        values.includes('--compiled-operations') &&
        values.includes('--copy-reports'),
    ),
  );
  for (const forbidden of [
    'db:migrate',
    'db:bootstrap',
    'deploy',
    'push',
    'gcloud',
  ])
    assert.ok(
      !checks.some(
        ([cmd, values]) => cmd === forbidden || values.includes(forbidden),
      ),
    );
});
test('recovery subprocess capture bounds output, rejects invalid UTF-8/timeouts and hides child diagnostics', async () => {
  assert.equal(
    await executeRecovery(
      process.execPath,
      ['-e', 'process.stdin.pipe(process.stdout)'],
      { capture: true, input: Buffer.from('safe stdin') },
    ),
    'safe stdin',
  );
  assert.equal(
    await executeRecovery(
      process.execPath,
      ['-e', "process.stdout.write('safe')"],
      { capture: true },
    ),
    'safe',
  );
  for (const code of [
    "process.stderr.write('private diagnostic');process.exit(1)",
    'process.stdout.write(Buffer.from([255]))',
    "process.stdout.write('x'.repeat(1048577))",
    'setInterval(()=>{},1000)',
  ])
    await assert.rejects(
      executeRecovery(process.execPath, ['-e', code], {
        capture: true,
        timeout: 1000,
      }),
      (error) =>
        error.code === 'RECOVERY_COMMAND_FAILED' &&
        !error.message.includes('private'),
    );
});
