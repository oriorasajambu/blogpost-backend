import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  isForbiddenSourcePath,
  isNonexecutingDocumentation,
} from '../../src/platform/config/input-policy.ts';
import { assertGate } from '../../scripts/ci/gate.mjs';
import {
  assertIntroducedHistory,
  assertSourceTree,
  classify,
  metadata,
  prRoute,
  stableVersion,
  validateRun,
} from '../../scripts/ci/policy.mjs';
import {
  fixture,
  pushEvent,
  prEvent,
  config,
  repository,
} from './fixtures.mjs';

test('branch policy accepts work forks, synchronization and promotion only', () => {
  const pr = prEvent('a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)).event
    .pull_request;
  assert.equal(prRoute(pr, repository).route, 'work');
  assert.equal(
    prRoute(
      {
        ...pr,
        head: { ...pr.head, repo: { full_name: 'fork/backend', id: 99 } },
      },
      repository,
    ).route,
    'work',
  );
  assert.equal(
    prRoute({ ...pr, head: { ...pr.head, ref: 'main' } }, repository).route,
    'synchronization',
  );
  assert.equal(
    prRoute(
      {
        ...pr,
        base: { ...pr.base, ref: 'main' },
        head: { ...pr.head, ref: 'rc' },
      },
      repository,
    ).promotion,
    true,
  );
  for (const change of [
    { base: { ...pr.base, ref: 'main' } },
    { head: { ...pr.head, ref: 'master' } },
    { head: { ...pr.head, ref: 'feature/a\n' } },
    {
      head: {
        ...pr.head,
        ref: 'main',
        repo: { full_name: 'fork/backend', id: 99 },
      },
    },
    { base: { ...pr.base, repo: { ...repository, id: 99 } } },
  ])
    assert.throws(() => prRoute({ ...pr, ...change }, repository));
});
test('path policy shares conservative docs classification with the builder', () => {
  for (const path of [
    'README.md',
    'LICENSE',
    'LICENSE.md',
    'docs/runbook.md',
    'docs/adr/001.md',
  ])
    assert.equal(isNonexecutingDocumentation(path), true, path);
  for (const path of [
    'API_CONTRACT_V1.md',
    'docs/API_CONTRACT_V1.md',
    'docs/check.mjs',
    'contracts/README.md',
    '.github/check.md',
    'unknown.txt',
  ])
    assert.equal(isNonexecutingDocumentation(path), false, path);
  assert.equal(isForbiddenSourcePath('.env.example'), false);
  for (const path of [
    '.env',
    '.ENV.local',
    'nested/.env.example',
    'src//a',
    '../x',
    'a\\b',
    '.git/config',
    'x/.ssh/id_rsa',
    'x/service.key',
    'gha-creds-one.json',
    'key.properties',
    'dist/main.js',
    'src/generated/client.ts',
    '.gitleaksignore',
  ])
    assert.equal(isForbiddenSourcePath(path), true, path);
});
test('release metadata is full, locked and stable; invalid or bootstrap publication fails', async (t) => {
  const f = await fixture(t);
  assert.equal(metadata(f.root, f.base).publish, false);
  for (const bad of [
    '01.0.0',
    '1.0.0\n',
    '1.0.0-rc.1',
    '1.0.0+build',
    '9007199254740992.0.0',
  ])
    assert.throws(() => stableVersion(bad));
  await f.write('.release/release.json', {
    application: 'backend',
    version: '0.0.0',
    publish: true,
    apiContractVersion: '1.0.0',
  });
  assert.throws(() => metadata(f.root, f.commit()), /BOOTSTRAP_VERSION/);
  await f.release('0.1.0');
  await f.write('package-lock.json', {
    version: '0.1.0',
    packages: {
      '': {
        name: 'fixture-backend',
        version: '0.1.0',
        dependencies: { a: '9.0.0' },
      },
    },
  });
  assert.throws(
    () => metadata(f.root, f.commit()),
    /DEPENDENCY_LOCK_DISAGREES/,
  );
});
test('docs changes plus publish false are docs; contract, marker or unknown changes select code', async (t) => {
  const f = await fixture(t, '0.1.0');
  await f.write('docs/guide.md', '# Guide\n');
  const docs = f.commit();
  assert.equal(classify(f.root, f.base, docs).docsOnly, true);
  await f.release('0.1.0', true);
  const publish = f.commit();
  assert.equal(classify(f.root, docs, publish).docsOnly, false);
  await f.release('0.1.0', false);
  const unpublished = f.commit();
  assert.equal(classify(f.root, publish, unpublished).docsOnly, true);
  await f.write('docs/API_CONTRACT_V1.md', '# Authoritative\n');
  assert.equal(classify(f.root, unpublished, f.commit()).docsOnly, false);
});
test('history catches a deleted environment file and rename source; tree rejects links and case collisions', async (t) => {
  const f = await fixture(t);
  await f.write('nested/.ENV.production', 'SYNTHETIC=true\n');
  f.commit();
  f.run(['mv', 'nested/.ENV.production', 'renamed.txt']);
  const head = f.commit();
  assertSourceTree(f.root, head);
  assert.throws(
    () => assertIntroducedHistory(f.root, f.base, head),
    /FORBIDDEN/,
  );
  const g = await fixture(t);
  const blob = g.run(['hash-object', '-w', '--stdin'], '../outside');
  g.run(['update-index', '--add', '--cacheinfo', '120000,' + blob + ',link']);
  g.run(['commit', '-m', 'Synthetic link']);
  assert.throws(
    () => assertSourceTree(g.root, g.run(['rev-parse', 'HEAD'])),
    /UNSUPPORTED_SOURCE/,
  );
  const h = await fixture(t);
  const collidingBlob = h.run(
    ['hash-object', '-w', '--stdin'],
    'Synthetic collision',
  );
  h.run([
    'update-index',
    '--add',
    '--cacheinfo',
    '100644,' + collidingBlob + ',Readme.md',
  ]);
  h.run([
    'update-index',
    '--add',
    '--cacheinfo',
    '100644,' + collidingBlob + ',README.md',
  ]);
  h.run(['commit', '-m', 'Synthetic colliding paths']);
  assert.throws(
    () => assertSourceTree(h.root, h.run(['rev-parse', 'HEAD'])),
    /CASE_COLLIDING/,
  );
});
test('work pushes bind event SHA and use actual parent or permanent branch merge base', async (t) => {
  const f = await fixture(t);
  f.run(['checkout', '-b', 'chore/ci-foundation']);
  await f.write('src/main.ts', 'export const value = 2;\n');
  const head = f.commit();
  const { env, event } = pushEvent(head, f.base);
  assert.equal(validateRun(f.root, env, event, config).classification, 'code');
  for (const patch of [
    { GITHUB_SHA: f.base },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_REF: 'refs/tags/v0.1.0' },
  ])
    assert.throws(() =>
      validateRun(f.root, { ...env, ...patch }, event, config),
    );
  f.run(['update-ref', 'refs/remotes/origin/rc', f.base]);
  assert.equal(
    validateRun(f.root, env, { ...event, before: '0'.repeat(40) }, config)
      .baseSha,
    f.base,
  );
  const permanent = pushEvent(head, '0'.repeat(40), 'rc');
  assert.throws(
    () => validateRun(f.root, permanent.env, permanent.event, config),
    /BRANCH_CREATION/,
  );
});
test('PR validation binds exact synthetic merge parents, PR number and draft state', async (t) => {
  const f = await fixture(t);
  f.run(['checkout', '-b', 'chore/ci-foundation']);
  await f.write('docs/guide.md', '# Guide\n');
  const head = f.commit();
  f.run(['checkout', 'rc']);
  f.run([
    'merge',
    '--no-ff',
    'chore/ci-foundation',
    '-m',
    'Synthetic PR merge',
  ]);
  const merge = f.run(['rev-parse', 'HEAD']);
  const { env, event } = prEvent(f.base, head, merge);
  assert.equal(validateRun(f.root, env, event, config).docsOnly, true);
  assert.equal(
    validateRun(
      f.root,
      env,
      { ...event, pull_request: { ...event.pull_request, draft: true } },
      config,
    ).draft,
    true,
  );
  assert.throws(
    () => validateRun(f.root, env, { ...event, number: 8 }, config),
    /PR_EVENT/,
  );
  assert.throws(() =>
    validateRun(
      f.root,
      { ...env, GITHUB_REF: env.GITHUB_REF + '\n' },
      event,
      config,
    ),
  );
  assert.throws(
    () =>
      validateRun(
        f.root,
        env,
        {
          ...event,
          pull_request: {
            ...event.pull_request,
            base: { ...event.pull_request.base, sha: head },
          },
        },
        config,
      ),
    /ANCESTRY/,
  );
});
test('first code promotion requires 0.1.0, publish intent and identical RC result tree', async (t) => {
  const f = await fixture(t);
  f.run(['checkout', 'rc']);
  await f.release('0.1.0', true);
  const head = f.commit();
  f.run(['checkout', 'main']);
  f.run(['merge', '--no-ff', 'rc', '-m', 'Synthetic promotion']);
  const merge = f.run(['rev-parse', 'HEAD']);
  const { env, event } = prEvent(f.base, head, merge, {
    base: { ref: 'main', sha: f.base, repo: repository },
    head: { ref: 'rc', sha: head, repo: repository },
  });
  assert.equal(validateRun(f.root, env, event, config).promotion, true);
  await f.write('unknown.txt', 'merge-only content');
  const changed = f.commit();
  assert.throws(
    () => validateRun(f.root, { ...env, GITHUB_SHA: changed }, event, config),
    /ANCESTRY/,
  );
});
function needs(docs = false, promotion = false) {
  return {
    policy: {
      result: 'success',
      outputs: {
        docs_only: String(docs),
        classification: docs ? 'docs' : 'code',
        promotion: String(promotion),
        draft: 'false',
      },
    },
    docs: { result: 'success' },
    foundation: { result: docs ? 'skipped' : 'success' },
    'identity-sql': { result: docs ? 'skipped' : 'success' },
    'kotlin-contract': { result: docs ? 'skipped' : 'success' },
    'promotion-evidence': { result: promotion ? 'success' : 'skipped' },
    'source-proof': { result: 'success' },
    delivery: { result: 'success' },
  };
}
test('aggregate gates reject every failed, cancelled, missing or unexpectedly skipped dependency', () => {
  for (const kind of ['pull_request', 'push', 'staging', 'release']) {
    assert.doesNotThrow(() => assertGate(needs(), kind));
    assert.doesNotThrow(() => assertGate(needs(true), kind));
    for (const job of [
      'policy',
      'docs',
      'foundation',
      'identity-sql',
      'kotlin-contract',
      ...(['staging', 'release'].includes(kind)
        ? ['source-proof', 'delivery']
        : []),
    ]) {
      for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
        const n = needs();
        n[job] = status ? { ...n[job], result: status } : undefined;
        assert.throws(
          () => assertGate(n, kind),
          kind + '/' + job + '/' + status,
        );
      }
    }
  }
  const draft = needs();
  draft.policy.outputs.draft = 'true';
  assert.throws(() => assertGate(draft, 'pull_request'));
  const promotion = needs(false, true);
  promotion['promotion-evidence'].result = 'skipped';
  assert.throws(() => assertGate(promotion, 'pull_request'));
  const inconsistent = needs(true);
  inconsistent.policy.outputs.classification = 'code';
  assert.throws(() => assertGate(inconsistent, 'push'));
});
test('gate CLI executes on Windows paths and exits nonzero for skipped code', () => {
  const n = needs();
  n.foundation.result = 'skipped';
  assert.throws(() =>
    execFileSync(process.execPath, [resolve('scripts/ci/gate.mjs')], {
      env: {
        ...process.env,
        CI_GATE_KIND: 'push',
        CI_NEEDS_JSON: JSON.stringify(n),
      },
      stdio: 'pipe',
    }),
  );
  execFileSync(process.execPath, [resolve('scripts/ci/gate.mjs')], {
    env: {
      ...process.env,
      CI_GATE_KIND: 'push',
      CI_NEEDS_JSON: JSON.stringify(needs()),
    },
    stdio: 'pipe',
  });
});
