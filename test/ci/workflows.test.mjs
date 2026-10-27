import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parse } from 'yaml';

const read = async (path) => parse(await readFile(path, 'utf8'));
const selected = [
  'policy',
  'docs',
  'foundation',
  'identity-sql',
  'kotlin-contract',
];
test('only the three approved workflows exist and their event boundaries cannot overlap', async () => {
  const files = (await readdir('.github/workflows')).sort();
  assert.deepEqual(files, ['ci.yml', 'release.yml', 'staging.yml']);
  const ci = await read('.github/workflows/ci.yml');
  assert.deepEqual(Object.keys(ci.on).sort(), ['pull_request', 'push']);
  assert.deepEqual(ci.on.push, {
    branches: ['feature/**', 'bug/**', 'chore/**', 'docs/**'],
  });
  assert.deepEqual(ci.on.pull_request, {
    branches: ['rc', 'main'],
    types: ['opened', 'synchronize', 'reopened', 'ready_for_review', 'edited'],
  });
  assert.equal(ci.concurrency['cancel-in-progress'], true);
  for (const [file, branch] of [
    ['staging.yml', 'rc'],
    ['release.yml', 'main'],
  ]) {
    const workflow = await read('.github/workflows/' + file);
    assert.deepEqual(workflow.on, { push: { branches: [branch] } });
    assert.equal(workflow.concurrency.queue, 'max');
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
  }
});
test('all aggregate checks run after cancellation/failure and enumerate every mandatory dependency', async () => {
  for (const [file, name, extra] of [
    ['ci.yml', 'ci-gate', ['promotion-evidence']],
    ['ci.yml', 'push-gate', []],
    ['staging.yml', 'staging-evidence', ['source-proof', 'delivery']],
    ['release.yml', 'release-validation', ['source-proof', 'delivery']],
  ]) {
    const workflow = await read('.github/workflows/' + file);
    const gate = workflow.jobs[name];
    assert.ok(gate.if.startsWith('always()'));
    assert.deepEqual([...gate.needs].sort(), [...selected, ...extra].sort());
    assert.equal(gate.steps.at(-1).run, 'node scripts/ci/gate.mjs');
    for (const code of ['foundation', 'identity-sql', 'kotlin-contract'])
      assert.equal(
        workflow.jobs[code].if,
        "needs.policy.outputs.docs_only == 'false'",
      );
    assert.deepEqual(workflow.jobs.docs.needs, ['policy']);
  }
});
test('checks pin actions and immutable checkouts; no work/fork or unfinished delivery job receives cloud/write permissions', async () => {
  for (const file of ['ci.yml', 'staging.yml', 'release.yml']) {
    const workflow = await read('.github/workflows/' + file);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      assert.equal(job['runs-on'], 'ubuntu-24.04');
      const checkout = job.steps.find((step) =>
        step.uses?.startsWith('actions/checkout@'),
      );
      assert.equal(checkout.with.ref, '${{ github.sha }}');
      assert.equal(checkout.with['fetch-depth'], 0);
      assert.equal(checkout.with['persist-credentials'], false);
      if (job.permissions)
        assert.deepEqual(job.permissions, {
          contents: 'read',
          'pull-requests': 'read',
        });
      for (const step of job.steps) {
        if (step.uses && !step.uses.startsWith('./.github/actions/'))
          assert.match(step.uses, /^[a-zA-Z0-9_/-]+@[a-f0-9]{40}$/);
        assert.ok(!JSON.stringify(step).includes('secrets.'));
      }
      if (name === 'delivery' || name === 'promotion-evidence')
        assert.equal(
          job.steps.at(-1).run,
          'node scripts/ci/delivery-unavailable.mjs',
        );
    }
  }
});
test('root and migration fixture credentials exist only in the disposable database and appropriate operator steps', async () => {
  for (const file of ['ci.yml', 'staging.yml', 'release.yml']) {
    const foundation = (await read('.github/workflows/' + file)).jobs
      .foundation;
    assert.equal(foundation.env.SQL_ROOT_PASSWORD, undefined);
    assert.equal(foundation.env.SQL_MIGRATOR_PASSWORD, undefined);
    assert.equal(
      foundation.services.postgres.env.POSTGRES_PASSWORD,
      'disposable-ci-root',
    );
    assert.match(
      foundation.services.postgres.options,
      /^--health-cmd pg_isready --health-interval 3s --health-timeout 3s --health-retries 20$/,
    );
  }
  const quality = await read('.github/actions/quality/action.yml');
  for (const step of quality.runs.steps) {
    if (step.env?.SQL_ROOT_PASSWORD)
      assert.equal(step.run, 'npm run db:bootstrap');
    if (step.env?.SQL_MIGRATOR_PASSWORD)
      assert.ok(
        ['npm run db:bootstrap', 'npm run db:migrate'].includes(step.run),
      );
  }
  for (const command of [
    'npm run test:ci',
    'npm run security:test',
    'npm run test:build',
    'npm run test:deploy',
    'npm run test:integration',
  ])
    assert.ok(quality.runs.steps.some((step) => step.run === command));
});
