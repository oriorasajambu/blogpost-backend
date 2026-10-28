import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  proveMergedSource,
  proveReviewedMerge,
} from '../../scripts/ci/source-proof.mjs';
import {
  currentBranchSha,
  githubReader,
} from '../../scripts/ci/github-api.mjs';
import { config, merged } from './fixtures.mjs';

test('shared reviewed-source guard rejects malformed repository identity before Git or API reads', async () => {
  for (const patch of [
    { fullName: 'fixture/backend\n' },
    { repositoryId: '42\n' },
    { ownerId: '7\n' },
    { ownerId: 7 },
  ])
    await assert.rejects(
      proveReviewedMerge(
        'unused-invalid-root',
        { branch: 'rc', sourceSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) },
        { ...config, ...patch },
        async () => {
          throw new Error('must reject before API');
        },
      ),
      { code: 'INVALID_REVIEWED_SOURCE_CONTEXT' },
    );
});
for (const target of ['rc', 'main'])
  test(
    'trusted ' +
      target +
      ' source requires exact actual merge and live merged-PR association',
    async (t) => {
      const f = await merged(t, target);
      const proof = await proveMergedSource(
        f.root,
        f.env,
        f.event,
        config,
        f.read,
      );
      assert.equal(proof.sourceSha, f.merge);
      assert.equal(proof.promotion, target === 'main');
      for (const patch of [
        { merged: false },
        { merge_commit_sha: f.base },
        { head: { ...f.pr.head, sha: f.base } },
        { merged_by: { id: 99 } },
        { auto_merge: { enabled_by: { id: 7 } } },
      ])
        await assert.rejects(
          proveMergedSource(f.root, f.env, f.event, config, async (path) =>
            path.startsWith('/commits/')
              ? [{ number: 9 }]
              : { ...f.pr, ...patch },
          ),
        );
      await assert.rejects(
        proveMergedSource(f.root, f.env, f.event, config, async () => []),
      );
      await assert.rejects(
        proveMergedSource(
          f.root,
          {
            ...f.env,
            GITHUB_WORKFLOW_REF: f.env.GITHUB_WORKFLOW_REF.replace(
              '.yml',
              '-other.yml',
            ),
          },
          f.event,
          config,
          f.read,
        ),
      );
    },
  );
test('GitHub evidence reader uses bounded, nonredirecting GETs and never reads arbitrary paths', async () => {
  const calls = [];
  const read = githubReader(
    config,
    'synthetic-test-token',
    async (url, options) => {
      calls.push({ url, options });
      return new Response(
        JSON.stringify({
          ref: 'refs/heads/rc',
          object: { type: 'commit', sha: 'a'.repeat(40) },
        }),
      );
    },
  );
  assert.equal(await currentBranchSha(read, 'rc'), 'a'.repeat(40));
  assert.equal(
    calls[0].url,
    'https://api.github.com/repos/fixture/backend/git/ref/heads/rc',
  );
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  for (const suffix of [
    'https://evil.test',
    '/pulls/1/comments',
    '/pulls/1\n',
    '/git/ref/heads/work',
  ])
    await assert.rejects(read(suffix));
  await assert.rejects(
    githubReader(
      config,
      null,
      async () => new Response('private failure body', { status: 403 }),
    )('/pulls/1'),
    (error) => !error.message.includes('private failure body'),
  );
  await assert.rejects(
    githubReader(
      config,
      null,
      async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    )('/pulls/1'),
  );
});
