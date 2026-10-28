import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  digest,
  normalizeCloudProfile,
  validateProvenance,
} from '../../src/platform/config/build-model.ts';
import {
  inputManifest,
  prepareProvenance,
  sourceFacts,
} from '../../scripts/build/inputs.mjs';
import {
  prepareBuild,
  writeNativeProvenance,
} from '../../scripts/build/prepare.mjs';

const runGit = (root, args, input) =>
  execFileSync('git', ['-C', root, ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
async function fixture(t, branch = 'main') {
  const root = await mkdtemp(join(tmpdir(), 'blogpost-build-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  t.after(() => rm(root, { recursive: true, force: true }));
  runGit(root, ['init', '--initial-branch=' + branch]);
  runGit(root, ['config', 'user.name', 'Build Fixture']);
  runGit(root, ['config', 'user.email', 'build-fixture@example.test']);
  runGit(root, ['config', 'core.autocrlf', 'false']);
  const write = async (path, value) => {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), value);
  };
  await write('.gitignore', '.local/\n.build/\nnode_modules/\n');
  await write('package.json', '{"version":"0.1.0"}\n');
  await write(
    '.release/release.json',
    '{"application":"backend","version":"0.1.0","publish":false,"apiContractVersion":"1.0.0"}\n',
  );
  await write('contracts/openapi-v1.json', '{"info":{"version":"1.0.0"}}\n');
  await write('src/main.ts', 'export const value = 1;\n');
  const commit = () => {
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-m', 'Synthetic build fixture']);
    return runGit(root, ['rev-parse', 'HEAD']);
  };
  return { root, write, commit };
}
function profile(environment = 'staging') {
  const p = 'blogpost-' + environment;
  return {
    schemaVersion: 1,
    environment,
    projectId: p,
    apiOrigin: 'https://api.' + environment + '.example.test',
    webOrigin: 'https://web.' + environment + '.example.test',
    identity: {
      audience: p,
      idTokenIssuer: 'https://securetoken.google.com/' + p,
      sessionIssuer: 'https://session.firebase.google.com/' + p,
    },
    sql: {
      instanceConnectionName: p + ':asia-southeast2:db',
      database: 'blogpost',
      schema: 'blogpost',
    },
    media: { adapter: 'gcs', bucket: p + '-media', projectId: p },
    serviceAccounts: Object.fromEntries(
      ['api', 'migrator', 'ops', 'bootstrap'].map((role) => [
        role,
        'blogpost-' + role + '@' + p + '.iam.gserviceaccount.com',
      ]),
    ),
    secretVersions: Object.fromEntries(
      [
        'SQL_APP_PASSWORD',
        'SQL_MIGRATOR_PASSWORD',
        'SQL_ROOT_PASSWORD',
        'CURSOR_SIGNING_KEY',
      ].map((name) => [
        name,
        'projects/' + p + '/secrets/' + name.toLowerCase() + '/versions/1',
      ]),
    ),
  };
}
test('unborn development is explicit; frozen snapshots exclude approved docs and publish intent', async (t) => {
  const f = await fixture(t);
  await f.write('README.md', 'First documentation');
  await f.write('docs/guide.md', 'First guide');
  const first = await prepareBuild(f.root, 'development', null, {});
  assert.equal(first.provenance.sourceSha, null);
  assert.equal(first.provenance.dirty, true);
  assert.equal(first.provenance.sourceRef, 'unborn:main');
  await f.write('README.md', 'Changed documentation');
  await f.write('docs/guide.md', 'Changed guide');
  await f.write(
    '.release/release.json',
    '{"application":"backend","publish":true,"version":"0.1.0","apiContractVersion":"1.0.0"}\n',
  );
  const second = await prepareBuild(f.root, 'development', null, {});
  assert.equal(
    first.provenance.runtimeInputDigest,
    second.provenance.runtimeInputDigest,
  );
  assert.equal(first.metadataDirectory, second.metadataDirectory);
  assert.equal(
    await readFile(join(first.sourceDirectory, 'src/main.ts'), 'utf8'),
    'export const value = 1;\n',
  );
  for (const path of ['README.md', 'docs/guide.md', '.release/release.json'])
    await assert.rejects(readFile(join(first.sourceDirectory, path)), {
      code: 'ENOENT',
    });
  await assert.rejects(
    prepareBuild(f.root, 'staging', profile(), {}),
    /Unborn/,
  );
});
test('unknown paths, workflow, lock, contract and executable docs edits invalidate equivalence', async (t) => {
  const f = await fixture(t);
  let previous = digest(await inputManifest(f.root, 'development'));
  for (const path of [
    'unknown.txt',
    'docs/check.mjs',
    'docs/API_CONTRACT_V1.md',
    '.github/workflows/checks.yaml',
    'package-lock.json',
    'contracts/README.md',
    'prisma/migrations/new.sql',
  ]) {
    await f.write(path, 'runtime-relevant input');
    const current = digest(await inputManifest(f.root, 'development'));
    assert.notEqual(current, previous, path);
    previous = current;
  }
  await f.write(
    '.release/release.json',
    '{"application":"backend","version":"0.2.0","publish":false,"apiContractVersion":"1.0.0"}\n',
  );
  assert.notEqual(digest(await inputManifest(f.root, 'development')), previous);
  await assert.rejects(
    prepareProvenance(f.root, 'development', null, {}),
    /versions differ/,
  );
});
test('development requires work branches after bootstrap and cloud source must be clean and authorized', async (t) => {
  const f = await fixture(t);
  const sha = f.commit();
  assert.throws(() => sourceFacts(f.root, 'development', {}), /work branch/);
  assert.throws(() => sourceFacts(f.root, 'staging', {}), /authorized source/);
  const production = await prepareProvenance(
    f.root,
    'production',
    profile('production'),
    {},
  );
  assert.equal(production.provenance.sourceSha, sha);
  assert.equal(production.provenance.dirty, false);
  runGit(f.root, ['checkout', '-b', 'feature/provenance']);
  assert.equal(sourceFacts(f.root, 'development', {}).sourceSha, sha);
  await f.write('src/main.ts', 'export const value = 2;\n');
  assert.equal(sourceFacts(f.root, 'development', {}).dirty, true);
  assert.throws(
    () => sourceFacts(f.root, 'production', {}),
    /authorized source/,
  );
});
test('cloud snapshots read commit blobs and retain truthful source SHA across docs-only commits', async (t) => {
  const f = await fixture(t, 'rc');
  runGit(f.root, ['config', 'core.autocrlf', 'true']);
  await f.write('src/main.ts', 'export const value = 1;\r\n');
  const sha = f.commit();
  const first = await prepareBuild(f.root, 'staging', profile(), {});
  assert.equal(first.provenance.sourceSha, sha);
  assert.equal(
    await readFile(join(first.sourceDirectory, 'src/main.ts'), 'utf8'),
    'export const value = 1;\n',
  );
  await f.write('README.md', 'Documentation-only candidate');
  const nextSha = f.commit();
  const next = await prepareBuild(f.root, 'staging', profile(), {});
  assert.equal(next.provenance.sourceSha, nextSha);
  assert.notEqual(nextSha, sha);
  assert.equal(
    next.provenance.runtimeInputDigest,
    first.provenance.runtimeInputDigest,
  );
  assert.equal(
    next.provenance.sourceInputDigest,
    first.provenance.sourceInputDigest,
  );
});
test('CI must match event, checkout SHA, workflow and branch before cloud artifacts are prepared', async (t) => {
  const f = await fixture(t, 'rc');
  const sha = f.commit();
  const ci = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_SHA: sha,
    GITHUB_REF: 'refs/heads/rc',
    GITHUB_REPOSITORY: 'fixture/backend',
    GITHUB_WORKFLOW_REF:
      'fixture/backend/.github/workflows/staging.yml@refs/heads/rc',
  };
  assert.equal(sourceFacts(f.root, 'staging', ci).sourceSha, sha);
  for (const patch of [
    { GITHUB_SHA: '0'.repeat(40) },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/main' },
    {
      GITHUB_WORKFLOW_REF:
        'fixture/backend/.github/workflows/ci.yml@refs/heads/rc',
    },
  ])
    assert.throws(() => sourceFacts(f.root, 'staging', { ...ci, ...patch }));
  runGit(f.root, ['checkout', '--detach']);
  assert.equal(sourceFacts(f.root, 'staging', ci).sourceRef, 'refs/heads/rc');
  assert.throws(() => sourceFacts(f.root, 'staging', {}));
});
test('committed symlinks and real environment files fail without reading external targets', async (t) => {
  const f = await fixture(t, 'rc');
  runGit(f.root, ['config', 'core.symlinks', 'false']);
  const oid = runGit(
    f.root,
    ['hash-object', '-w', '--stdin'],
    '../outside-secret',
  );
  runGit(f.root, [
    'update-index',
    '--add',
    '--cacheinfo',
    '120000,' + oid + ',unsafe-link',
  ]);
  runGit(f.root, ['checkout', '--', 'unsafe-link']);
  f.commit();
  await assert.rejects(
    prepareProvenance(f.root, 'staging', profile(), {}),
    /Unsupported committed/,
  );
  const g = await fixture(t);
  await g.write('.env', 'PRIVATE_FIXTURE_VALUE=do-not-publish\n');
  await assert.rejects(
    prepareBuild(g.root, 'development', null, {}),
    /environment files/,
  );
});
test('cloud profile hashing includes numeric references and rejects secret values and mixed destinations', () => {
  const p = profile();
  const first = normalizeCloudProfile(p);
  assert.equal(digest(first), digest(JSON.parse(JSON.stringify(p))));
  const next = structuredClone(p);
  next.secretVersions.SQL_APP_PASSWORD =
    next.secretVersions.SQL_APP_PASSWORD.replace('/1', '/2');
  assert.notEqual(digest(normalizeCloudProfile(next)), digest(first));
  for (const mutate of [
    (p) => {
      p.apiOrigin = 'https://user:private@example.test';
    },
    (p) => {
      p.identity.audience = 'another-project';
    },
    (p) => {
      p.sql.instanceConnectionName = 'other-project:asia-southeast2:db';
    },
    (p) => {
      p.secretVersions.SQL_APP_PASSWORD = 'plaintext-private-fixture';
    },
    (p) => {
      p.secretVersions.SQL_ROOT_PASSWORD =
        p.secretVersions.SQL_ROOT_PASSWORD.replace('/1', '/latest');
    },
    (p) => {
      p.serviceAccounts.api =
        'blogpost-api@other-project.iam.gserviceaccount.com';
    },
    (p) => {
      p.serviceAccounts.api =
        'blogpost-api@injected@blogpost-staging.iam.gserviceaccount.com';
    },
    (p) => {
      p.serviceAccounts.api = p.serviceAccounts.ops;
    },
    (p) => {
      p.serviceAccounts.api =
        'blogpost-api\n@blogpost-staging.iam.gserviceaccount.com';
    },
    (p) => {
      p.secretVersions.SQL_APP_PASSWORD += '\n';
    },
    (p) => {
      p.password = 'plaintext-private-fixture';
    },
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    assert.throws(
      () => normalizeCloudProfile(changed),
      (error) => error.message === 'Invalid build or environment profile',
    );
  }
});
test('validation metadata cannot masquerade as a cloud artifact', async (t) => {
  const f = await fixture(t);
  const { provenance } = await prepareProvenance(
    f.root,
    'development',
    null,
    {},
  );
  assert.throws(() =>
    validateProvenance({ ...provenance, kind: 'VALIDATION' }),
  );
  assert.equal(
    validateProvenance({ ...provenance, kind: 'VALIDATION' }, true).kind,
    'VALIDATION',
  );
  assert.throws(() =>
    validateProvenance(
      {
        ...provenance,
        kind: 'VALIDATION',
        environment: 'staging',
        configuration: profile(),
      },
      true,
    ),
  );
});

test('native metadata replaces ordinary files atomically and rejects linked output directories', async (t) => {
  const f = await fixture(t);
  const { provenance } = await prepareProvenance(
    f.root,
    'development',
    null,
    {},
  );
  await writeNativeProvenance(f.root, provenance);
  const next = { ...provenance, runtimeInputDigest: '1'.repeat(64) };
  await writeNativeProvenance(f.root, next);
  assert.deepEqual(
    JSON.parse(await readFile(join(f.root, '.build/provenance.json'), 'utf8')),
    next,
  );
  const g = await fixture(t);
  await g.write('unrelated/provenance.json', 'protected fixture');
  await symlink(join(g.root, 'unrelated'), join(g.root, '.build'), 'junction');
  await assert.rejects(
    writeNativeProvenance(g.root, provenance),
    /Unsafe build output/,
  );
  assert.equal(
    await readFile(join(g.root, 'unrelated/provenance.json'), 'utf8'),
    'protected fixture',
  );
});

test('provenance rejects malformed SemVer and inconsistent unborn source claims', async (t) => {
  const f = await fixture(t);
  const { provenance } = await prepareProvenance(
    f.root,
    'development',
    null,
    {},
  );
  for (const applicationVersion of [
    '01.0.0',
    '1.0.0-01',
    '1.0.0-alpha..1',
    '1.0.0+build..1',
    '1.0.0-',
    '1.0.0+',
    '1.0.0\n',
  ])
    assert.throws(() =>
      validateProvenance({ ...provenance, applicationVersion }),
    );
  for (const applicationVersion of [
    '0.0.0',
    '1.2.3-rc.0+build.01',
    '1.0.0-01alpha',
  ])
    assert.equal(
      validateProvenance({ ...provenance, applicationVersion })
        .applicationVersion,
      applicationVersion,
    );
  assert.throws(() =>
    validateProvenance({ ...provenance, sourceSha: 'a'.repeat(40) }),
  );
  assert.throws(() =>
    validateProvenance({ ...provenance, sourceRef: 'unborn:feature/test' }),
  );
});

test('reusing a snapshot rejects unexpected files rather than baking unrecorded inputs', async (t) => {
  const f = await fixture(t);
  const first = await prepareBuild(f.root, 'development', null, {});
  await mkdir(join(first.sourceDirectory, 'prisma'), { recursive: true });
  await writeFile(
    join(first.sourceDirectory, 'prisma/unrecorded.sql'),
    'select 1;',
  );
  await assert.rejects(
    prepareBuild(f.root, 'development', null, {}),
    /Unexpected snapshot/,
  );
});

test('checked-in cloud profiles are synthetic, distinct and valid', async () => {
  const profiles = [];
  for (const name of ['staging', 'production']) {
    const profile = normalizeCloudProfile(
      JSON.parse(
        await readFile(
          new URL(
            '../../config/environments/' + name + '.example.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
    );
    assert.equal(profile.environment, name);
    assert.ok(profile.apiOrigin.endsWith('.test'));
    profiles.push(profile);
  }
  assert.notEqual(profiles[0].projectId, profiles[1].projectId);
  assert.notEqual(digest(profiles[0]), digest(profiles[1]));
});
