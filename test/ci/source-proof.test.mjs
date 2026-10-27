import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proveMergedSource } from '../../scripts/ci/source-proof.mjs';
import {
  currentBranchSha,
  githubReader,
} from '../../scripts/ci/github-api.mjs';
import { config, fixture, pushEvent, repository } from './fixtures.mjs';

async function merged(t, target = 'rc') {
  const f = await fixture(t);
  const headRef = target === 'main' ? 'rc' : 'chore/ci-foundation';
  f.run([
    'checkout',
    headRef === 'rc' ? 'rc' : '-b',
    ...(headRef === 'rc' ? [] : [headRef]),
  ]);
  await f.release(target === 'main' ? '0.1.0' : '0.0.0', target === 'main');
  await f.write('src/main.ts', 'export const value = 2;\n');
  const head = f.commit();
  f.run(['checkout', target]);
  f.run(['merge', '--no-ff', headRef, '-m', 'Synthetic reviewed merge']);
  const merge = f.run(['rev-parse', 'HEAD']);
  const { env, event } = pushEvent(merge, f.base, target);
  const pr = {
    number: 9,
    merged: true,
    state: 'closed',
    merged_at: '2026-10-27T00:00:00Z',
    merge_commit_sha: merge,
    base: { ref: target, repo: repository, sha: merge },
    head: { ref: headRef, repo: repository, sha: head },
    draft: false,
    auto_merge: null,
    merged_by: { id: 7 },
  };
  const read = async (path) =>
    path.startsWith('/commits/') ? [{ number: 9 }] : pr;
  return { ...f, merge, env, event, pr, read };
}
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
