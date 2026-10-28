import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { prepareBuild } from '../build/prepare.mjs';
import { digest } from '../../src/platform/config/build-model.ts';

// Synthetic clean repositories and network-disabled containers only. No saved stack inputs.
const root = resolve(import.meta.dirname, '../..');
const localRoot = resolve(root, '.local');
await mkdir(localRoot, { recursive: true });
const temporaryDirectory = await mkdtemp(
  resolve(localRoot, 'cloud-build-fixture-'),
);
const fixture = resolve(temporaryDirectory, 'repository');
if (!temporaryDirectory.startsWith(localRoot + sep))
  throw new Error('Unsafe fixture path');
const report = resolve(localRoot, 'conformance/build-images.json');
await mkdir(resolve(localRoot, 'conformance'), { recursive: true });
const tags = ['blogpost-api:check', 'blogpost-operations:check'];
const created = new Set();
const results = [];
function docker(args, capture = false, optional = false, input) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture
      ? ['ignore', 'pipe', 'pipe']
      : input === undefined
        ? 'inherit'
        : ['pipe', 'inherit', 'inherit'],
    input,
    windowsHide: true,
  });
  if (!optional && (result.error || result.status !== 0))
    throw new Error('Build image verification failed');
  return capture
    ? result.status === 0
      ? result.stdout.trim()
      : null
    : result.status;
}
const git = (...args) =>
  execFileSync('git', ['-C', fixture, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
async function save(status) {
  await writeFile(
    report,
    JSON.stringify(
      {
        schemaVersion: 1,
        synthetic: true,
        status,
        results,
        limitations: [
          'Clean synthetic Git fixture, not the application repository release SHA.',
          'No GCP API, actual provider identity, SQL socket, GCS IAM or deployment evidence.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
}
try {
  await save('RUNNING');
  for (const tag of tags)
    if (docker(['image', 'inspect', tag], true, true) !== null)
      throw new Error('Temporary verification tag already exists');
  const source = await prepareBuild(root);
  await cp(source.sourceDirectory, fixture, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await mkdir(resolve(fixture, '.release'));
  await writeFile(
    resolve(fixture, '.release/release.json'),
    JSON.stringify({
      version: source.provenance.applicationVersion,
      publish: false,
      application: 'backend',
      apiContractVersion: source.provenance.contractVersion,
    }) + '\n',
  );
  git('init', '--initial-branch=rc');
  git('config', 'user.name', 'Synthetic Build Fixture');
  git('config', 'user.email', 'build-fixture@example.test');
  git('config', 'core.autocrlf', 'false');
  git('add', '.');
  git('commit', '-m', 'Synthetic isolated build verification');
  let first;
  for (const environment of ['staging', 'production']) {
    if (environment === 'production') git('checkout', '-b', 'main');
    const profile = JSON.parse(
      await readFile(
        resolve(
          fixture,
          'config/environments/' + environment + '.example.json',
        ),
        'utf8',
      ),
    );
    const build = await prepareBuild(fixture, environment, profile, {});
    if (
      first &&
      (first.sourceInputDigest !== build.provenance.sourceInputDigest ||
        first.runtimeInputDigest === build.provenance.runtimeInputDigest)
    )
      throw new Error('Cross-environment input identity mismatch');
    first ??= build.provenance;
    for (const target of ['runtime', 'operations']) {
      const tag = tags[target === 'runtime' ? 0 : 1];
      docker([
        'build',
        '--load',
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
      created.add(tag);
      const imageId = docker(
        ['image', 'inspect', '--format', '{{.Id}}', tag],
        true,
      );
      docker(
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
          JSON.stringify({
            environment,
            sourceSha: build.provenance.sourceSha,
            runtimeInputDigest: build.provenance.runtimeInputDigest,
            sourceInputDigest: build.provenance.sourceInputDigest,
            contractSha256: build.provenance.contractSha256,
            configurationDigest: digest(build.provenance.configuration),
          }),
        ],
        false,
        false,
        await readFile(resolve(root, 'test/build/image-smoke.mjs')),
      );
      const { configuration, ...provenance } = build.provenance;
      results.push({
        environment,
        target,
        imageId,
        configurationDigest: digest(configuration),
        provenance,
        status: 'PASSED',
      });
      await save('RUNNING');
    }
  }
  await save('PASSED');
  console.log(
    'Synthetic Staging/Production runtime and operations image checks passed.',
  );
} catch (error) {
  await save('FAILED');
  throw error;
} finally {
  for (const tag of created) docker(['image', 'rm', tag]);
  // The exact mkdtemp result is verified inside this checkout's ignored directory.
  if (!temporaryDirectory.startsWith(localRoot + sep + 'cloud-build-fixture-'))
    throw new Error('Unsafe fixture cleanup');
  await rm(temporaryDirectory, { recursive: true, force: true });
}
