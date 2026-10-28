import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proveCloudBuildSource } from '../../scripts/cloudbuild/source.mjs';
import { verifyLiveCloudBuildContext } from '../../scripts/cloudbuild/reader.mjs';
import { proveMergedSource } from '../../scripts/ci/source-proof.mjs';
import { cloudFixture, observed, provider } from './cloudbuild-fixtures.mjs';
import { config, merged } from './fixtures.mjs';

async function prepared(t, branch = 'rc') {
  const f = await merged(t, branch);
  f.run(['remote', 'add', 'origin', 'https://github.com/fixture/backend.git']);
  const cloud = cloudFixture(
    branch === 'rc' ? 'staging' : 'production',
    f.merge,
  );
  const p = provider(cloud);
  const context = await verifyLiveCloudBuildContext({
    ...cloud,
    transport: p.transport,
  });
  const read = async (path) =>
    path.startsWith('/git/ref/')
      ? {
          ref: 'refs/heads/' + branch,
          object: { type: 'commit', sha: f.run(['rev-parse', branch]) },
        }
      : f.read(path);
  return { ...f, context, read };
}
const prove = (f, overrides = {}) =>
  proveCloudBuildSource({
    root: f.root,
    context: f.context,
    config,
    read: f.read,
    now: observed,
    ...overrides,
  });

for (const branch of ['rc', 'main'])
  test(
    'Cloud Build ' +
      branch +
      ' source requires clean Git and actual owner merged-PR association',
    async (t) => {
      const f = await prepared(t, branch);
      const proof = await prove(f);
      assert.equal(proof.scope, 'cloud-build-reviewed-source');
      assert.equal(proof.sourceSha, f.merge);
      assert.equal(proof.promotion, branch === 'main');
      assert.equal(proof.cloudBuild, f.context.observation.build.name);
      assert.equal(proof.contextDigest, f.context.configurationDigest);
      // The shared merge helper does not turn a Cloud Build context into an Actions event.
      await assert.rejects(
        proveMergedSource(f.root, {}, f.event, config, f.read),
      );
      for (const patch of [
        { merged: false },
        { draft: true },
        { merged_by: { id: 99 } },
        { auto_merge: { enabled_by: { id: 7 } } },
        { head: { ...f.pr.head, sha: f.base } },
      ]) {
        await assert.rejects(
          prove(f, {
            read: async (path) =>
              path.startsWith('/git/ref/')
                ? f.read(path)
                : path.startsWith('/commits/')
                  ? [{ number: 9 }]
                  : { ...f.pr, ...patch },
          }),
        );
      }
      await assert.rejects(
        prove(f, { config: { ...config, repositoryId: '99' } }),
        { code: 'CLOUD_BUILD_REVIEW_REPOSITORY_DISAGREES' },
      );
      await assert.rejects(
        prove(f, {
          context: structuredClone(f.context),
          read: () => {
            throw new Error('must reject before API');
          },
        }),
        { code: 'AUTHENTICATED_CLOUD_BUILD_CONTEXT_REQUIRED' },
      );
      await assert.rejects(prove(f, { now: observed + 60001 }), {
        code: 'CLOUD_BUILD_CONTEXT_EXPIRED',
      });
      await f.write('src/main.ts', 'export const value = 3;\n');
      await assert.rejects(prove(f), /clean authorized source/);
      f.run(['checkout', '--', 'src/main.ts']);
      f.run([
        'remote',
        'set-url',
        'origin',
        'https://github.com/other/backend.git',
      ]);
      await assert.rejects(prove(f), {
        code: 'CLOUD_BUILD_GIT_ORIGIN_DISAGREES',
      });
    },
  );

test('Cloud Build allows a reviewed recovery ancestor, but refuses an orphan or moving branch', async (t) => {
  const f = await prepared(t);
  await f.write('docs/recovery.md', 'Synthetic later change\n');
  const later = f.commit();
  f.run(['reset', '--hard', f.merge]);
  const ref = (sha) => ({
    ref: 'refs/heads/rc',
    object: { type: 'commit', sha },
  });
  const read = (sha) => async (path) =>
    path.startsWith('/git/ref/') ? ref(sha) : f.read(path);
  assert.equal((await prove(f, { read: read(later) })).sourceSha, f.merge);
  await assert.rejects(prove(f, { read: read(f.base) }), {
    code: 'CLOUD_BUILD_SOURCE_NOT_ON_AUTHORIZED_BRANCH',
  });
  let reads = 0;
  await assert.rejects(
    prove(f, {
      read: async (path) =>
        path.startsWith('/git/ref/')
          ? ref(++reads === 1 ? f.merge : later)
          : f.read(path),
    }),
    { code: 'CLOUD_BUILD_AUTHORIZED_BRANCH_ADVANCED' },
  );
  let clocks = 0;
  await assert.rejects(
    prove(f, { now: () => observed + (++clocks === 1 ? 0 : 60001) }),
    { code: 'CLOUD_BUILD_CONTEXT_EXPIRED' },
  );
});

test('Cloud Build refuses a clean checkout at a different ref/SHA and non-merge delivery', async (t) => {
  const f = await prepared(t);
  f.run(['checkout', '-b', 'chore/forged-context']);
  await assert.rejects(prove(f), /clean authorized source/);
  f.run(['checkout', 'rc']);
  f.run(['reset', '--hard', f.base]);
  await assert.rejects(prove(f), { code: 'CLOUD_BUILD_CHECKOUT_DISAGREES' });
  const cloud = cloudFixture('staging', f.base),
    p = provider(cloud);
  const context = await verifyLiveCloudBuildContext({
    ...cloud,
    transport: p.transport,
  });
  await assert.rejects(prove(f, { context }), {
    code: 'DELIVERY_REQUIRES_REVIEWED_SINGLE_MERGE',
  });
});

test('Cloud Build source rechecks local source and origin after remote evidence reads', async (t) => {
  const f = await prepared(t);
  let references = 0;
  await assert.rejects(
    prove(f, {
      read: async (path) => {
        const result = await f.read(path);
        if (path.startsWith('/git/ref/') && ++references === 2)
          await f.write(
            'src/main.ts',
            'export const changedDuringRead = true;\n',
          );
        return result;
      },
    }),
    /clean authorized source/,
  );
  f.run(['checkout', '--', 'src/main.ts']);
  references = 0;
  await assert.rejects(
    prove(f, {
      read: async (path) => {
        const result = await f.read(path);
        if (path.startsWith('/git/ref/') && ++references === 2)
          f.run([
            'remote',
            'set-url',
            'origin',
            'https://github.com/other/backend.git',
          ]);
        return result;
      },
    }),
    { code: 'CLOUD_BUILD_GIT_ORIGIN_DISAGREES' },
  );
});
