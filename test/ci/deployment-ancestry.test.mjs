import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixtures.mjs';
import { evaluateDeploymentAncestry } from '../../scripts/deploy/deployment-ancestry.mjs';

const image = (digit) => 'sha256:' + digit.repeat(64);
const scope = {
  environment: 'production',
  projectId: 'blogpost-512905',
  region: 'asia-southeast2',
  serviceId: 'blogpost-api',
};
const deployment = (sourceSha, digit, revision) => ({
  ...scope,
  sourceSha,
  imageDigest: image(digit),
  revision,
  status: 'succeeded',
});
const serving = (sourceSha, digit, revision, percent = 100) => ({
  ...scope,
  sourceSha,
  imageDigest: image(digit),
  revision,
  percent,
});
const snapshot = (sourceSha, digit, successful, live) => ({
  schemaVersion: 1,
  ...scope,
  candidate: { sourceSha, imageDigest: image(digit) },
  successful,
  serving: live,
});

test('real commit ancestry permits forward progress and skips a stale rerun', async (t) => {
  const f = await fixture(t);
  const newer = f.commit();
  const latest = f.commit();
  const oldRecord = deployment(f.base, 'a', 'blogpost-api-old');
  const live = serving(newer, 'b', 'blogpost-api-new');
  const forward = evaluateDeploymentAncestry(
    f.root,
    snapshot(latest, 'c', [oldRecord], [live]),
  );
  assert.equal(forward.decision, 'eligible');
  assert.equal(forward.evidenceAuthority, 'caller-supplied-unverified');
  const stale = evaluateDeploymentAncestry(
    f.root,
    snapshot(f.base, 'a', [oldRecord], [live]),
  );
  assert.equal(stale.decision, 'skipped_stale');
  const recordedOnly = evaluateDeploymentAncestry(
    f.root,
    snapshot(
      newer,
      'b',
      [deployment(latest, 'c', 'blogpost-api-latest')],
      [live],
    ),
  );
  assert.equal(recordedOnly.decision, 'skipped_stale');
  assert.equal(
    evaluateDeploymentAncestry(f.root, snapshot(newer, 'b', [], [live]))
      .decision,
    'eligible',
  );
});

test('unrelated or mixed histories fail instead of masking ambiguity as stale', async (t) => {
  const f = await fixture(t);
  const candidate = f.commit();
  const descendant = f.commit();
  f.run(['checkout', '-b', 'other', f.base]);
  await f.write('src/divergent.ts', 'export const unrelated = true;\n');
  const unrelated = f.commit();
  assert.throws(
    () =>
      evaluateDeploymentAncestry(
        f.root,
        snapshot(
          candidate,
          'a',
          [deployment(descendant, 'b', 'blogpost-api-new')],
          [serving(unrelated, 'c', 'blogpost-api-other')],
        ),
      ),
    { code: 'ANCESTRY_UNRELATED_OR_AMBIGUOUS' },
  );
});

test('scope, split traffic, image and revision identity mismatches fail closed', async (t) => {
  const f = await fixture(t);
  const live = serving(f.base, 'a', 'blogpost-api-old');
  const base = snapshot(f.base, 'a', [], [live]);
  for (const changed of [
    { ...base, serving: [{ ...live, projectId: 'other-project' }] },
    { ...base, serving: [{ ...live, percent: 99 }] },
    {
      ...base,
      serving: [
        { ...live, percent: 50 },
        { ...live, percent: 50 },
      ],
    },
    {
      ...base,
      successful: [
        { ...deployment(f.base, 'a', 'blogpost-api-old'), status: 'failed' },
      ],
    },
  ])
    assert.throws(() => evaluateDeploymentAncestry(f.root, changed), {
      code: 'ANCESTRY_SNAPSHOT_INVALID',
    });
  assert.throws(
    () => evaluateDeploymentAncestry(f.root, snapshot(f.base, 'b', [], [live])),
    { code: 'ANCESTRY_IMAGE_CONFLICT' },
  );
  const child = f.commit();
  assert.throws(
    () =>
      evaluateDeploymentAncestry(
        f.root,
        snapshot(
          child,
          'c',
          [deployment(f.base, 'a', 'blogpost-api-old')],
          [serving(f.base, 'b', 'blogpost-api-other')],
        ),
      ),
    { code: 'ANCESTRY_IMAGE_CONFLICT' },
  );
  assert.throws(
    () =>
      evaluateDeploymentAncestry(
        f.root,
        snapshot(f.base, 'a', [deployment(f.base, 'b', live.revision)], [live]),
      ),
    { code: 'ANCESTRY_IMAGE_CONFLICT' },
  );
  assert.throws(
    () =>
      evaluateDeploymentAncestry(
        f.root,
        snapshot('f'.repeat(40), 'b', [], [live]),
      ),
    { code: 'ANCESTRY_COMMIT_UNAVAILABLE' },
  );
});

test('shallow histories and legacy grafts cannot authorize an ancestry result', async (t) => {
  const f = await fixture(t);
  const data = snapshot(
    f.base,
    'a',
    [],
    [serving(f.base, 'a', 'blogpost-api-old')],
  );
  const gitDir = f.run(['rev-parse', '--absolute-git-dir']);
  await mkdir(join(gitDir, 'info'), { recursive: true });
  await writeFile(join(gitDir, 'info', 'grafts'), f.base + '\n');
  assert.throws(() => evaluateDeploymentAncestry(f.root, data), {
    code: 'ANCESTRY_INCOMPLETE_HISTORY',
  });
});

test('shallow repository cannot produce an ancestry result', async (t) => {
  const f = await fixture(t);
  const gitDir = f.run(['rev-parse', '--absolute-git-dir']);
  await writeFile(join(gitDir, 'shallow'), f.base + '\n');
  assert.throws(
    () =>
      evaluateDeploymentAncestry(
        f.root,
        snapshot(f.base, 'a', [], [serving(f.base, 'a', 'blogpost-api-old')]),
      ),
    { code: 'ANCESTRY_INCOMPLETE_HISTORY' },
  );
});

test('Git replacement references cannot rewrite ancestry decisions', async (t) => {
  const f = await fixture(t);
  const candidate = f.commit();
  const newer = f.commit();
  f.run(['replace', f.base, newer]);
  const result = evaluateDeploymentAncestry(
    f.root,
    snapshot(candidate, 'b', [], [serving(f.base, 'a', 'blogpost-api-old')]),
  );
  assert.equal(result.decision, 'eligible');
});
