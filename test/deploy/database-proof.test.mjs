import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../../src/platform/config/build-model.ts';
import { verifyDatabaseExecution } from '../../scripts/deploy/database-proof.mjs';
import {
  verifyLiveDatabaseExecution,
  combineDatabaseEvidence,
  databaseLogQuery,
} from '../../scripts/deploy/database-reader.mjs';
import {
  databaseFixture,
  providerTransport,
  now,
  sql,
} from './database-fixtures.mjs';

for (const environment of ['staging', 'production'])
  for (const purpose of ['migrate', 'inspect', 'verify'])
    test(
      environment +
        ' ' +
        purpose +
        ' proof binds provider execution, task, captured config, record and workflow',
      () => {
        const f = databaseFixture(environment, purpose);
        const proof = verifyDatabaseExecution(f);
        assert.equal(proof.status, 'VERIFIED');
        assert.equal(proof.evidenceSource, 'provided-json');
        assert.equal(
          proof.recordSha256,
          digest(f.logPage.entries[0].jsonPayload),
        );
        assert.equal(proof.image, f.target.image);
        assert.ok(!JSON.stringify(proof).includes('SQL_MIGRATOR_PASSWORD'));
        assert.ok(
          !JSON.stringify(proof).includes(f.context.executorServiceAccount),
        );
      },
    );

test('execution/task failures, replacement, overrides and workflow reuse cannot produce evidence', () => {
  for (const mutate of [
    (f) => {
      f.context.jobUid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    },
    (f) => {
      f.context.executionUid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    },
    (f) => {
      f.execution.creator = f.provenance.configuration.serviceAccounts.api;
    },
    (f) => {
      f.execution.job = f.execution.job.replace('/jobs/', '/jobs/other-');
    },
    (f) => {
      f.execution.labels = {
        ...f.execution.labels,
        'blogpost-workflow-attempt': '2',
      };
    },
    (f) => {
      f.job.template.labels = {
        ...f.job.template.labels,
        'blogpost-source-sha': '0'.repeat(40),
      };
    },
    (f) => {
      f.execution.conditions[0].state = 'CONDITION_FAILED';
    },
    (f) => {
      f.execution.conditions = [];
    },
    (f) => {
      f.execution.conditions.push(f.execution.conditions[0]);
    },
    (f) => {
      f.execution.reconciling = true;
    },
    (f) => {
      f.execution.deleteTime = '2026-10-27T15:06:00Z';
    },
    (f) => {
      f.execution.failedCount = 1;
    },
    (f) => {
      f.execution.retriedCount = 1;
    },
    (f) => {
      f.execution.template.containers[0].args = ['dist/ops/migrate.js'];
    },
    (f) => {
      f.execution.template.containers[0].env[0].value = 'production';
    },
    (f) => {
      f.execution.template.serviceAccount =
        f.provenance.configuration.serviceAccounts.api;
    },
    (f) => {
      f.tasks.nextPageToken = 'another';
    },
    (f) => {
      f.tasks.tasks.push(f.tasks.tasks[0]);
    },
    (f) => {
      f.tasks.tasks[0].retried = 1;
    },
    (f) => {
      f.tasks.tasks[0].index = 1;
    },
    (f) => {
      f.tasks.tasks[0].execution += '-other';
    },
    (f) => {
      f.tasks.tasks[0].lastAttemptResult.exitCode = 1;
    },
    (f) => {
      f.tasks.tasks[0].lastAttemptResult.termSignal = 15;
    },
    (f) => {
      f.tasks.tasks[0].lastAttemptResult.status = {
        code: 7,
        message: 'PRIVATE_DIAGNOSTIC',
      };
    },
    (f) => {
      f.tasks.tasks[0].containers[0].image = f.target.image.replace(
        /@sha256:.*/,
        ':latest',
      );
    },
    (f) => {
      f.tasks.tasks[0].maxRetries = 1;
    },
  ]) {
    const f = databaseFixture();
    mutate(f);
    assert.throws(
      () => verifyDatabaseExecution(f),
      (error) => {
        assert.ok(!error.message.includes('PRIVATE_DIAGNOSTIC'));
        return true;
      },
    );
  }
});
test('missing, duplicated, private, stale and mislabeled logs or records fail closed', () => {
  for (const mutate of [
    (f) => {
      f.logPage.entries = [];
    },
    (f) => {
      f.logPage.entries.push(f.logPage.entries[0]);
    },
    (f) => {
      f.logPage.nextPageToken = 'incomplete';
    },
    (f) => {
      f.logPage.entries[0].resource.labels.project_id = 'other-project';
    },
    (f) => {
      f.logPage.entries[0].labels['run.googleapis.com/task_attempt'] = '1';
    },
    (f) => {
      f.logPage.entries[0].labels['run.googleapis.com/execution_name'] =
        'another';
    },
    (f) => {
      f.logPage.entries[0].severity = 'ERROR';
    },
    (f) => {
      f.logPage.entries[0].textPayload = 'PRIVATE_DIAGNOSTIC';
    },
    (f) => {
      f.logPage.entries[0].timestamp = '2026-10-26T15:00:00Z';
    },
    (f) => {
      f.logPage.entries[0].timestamp = '2026-02-30T15:00:00Z';
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.builtFromSha = '0'.repeat(40);
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.runtimeInputDigest = '0'.repeat(64);
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.execution += '-other';
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.extraCredential = 'PRIVATE_DIAGNOSTIC';
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.verifiedAt = '2026-10-27T13:00:00Z';
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.evidence.applied.reverse();
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.evidence.historyDigest = 'not-a-hash';
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.evidence.migrations = [];
    },
  ]) {
    const f = databaseFixture();
    mutate(f);
    assert.throws(() => verifyDatabaseExecution(f));
  }
  for (const mutate of [
    (f) => {
      f.logPage.entries[0].jsonPayload.evidence.permissionDigest = '0'.repeat(
        64,
      );
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.evidence.schemaDigest = '0'.repeat(64);
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.evidence.deniedProbes = 3;
    },
    (f) => {
      f.logPage.entries[0].jsonPayload.evidence.connectionBudget.reserved = 101;
    },
  ]) {
    const f = databaseFixture('staging', 'verify');
    mutate(f);
    assert.throws(() => verifyDatabaseExecution(f));
  }
});
test('the live adapter uses fixed bounded reads, a fixed log query and fresh immutable identity rereads', async () => {
  const f = databaseFixture();
  const { transport, calls } = providerTransport(f);
  const proof = await verifyLiveDatabaseExecution({
    ...f,
    accessToken: 'synthetic.access.token',
    transport,
  });
  assert.equal(proof.evidenceSource, 'live-api');
  assert.equal(calls.length, 8);
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(
      call.options.headers.Authorization,
      'Bearer synthetic.access.token',
    );
    assert.equal(call.options.headers.Cookie, undefined);
    assert.equal(
      call.options.method,
      call.url.includes('logging.googleapis.com') ? 'POST' : 'GET',
    );
  }
  const log = calls.find((call) => call.url.includes('logging.googleapis.com'));
  assert.deepEqual(
    JSON.parse(log.options.body),
    databaseLogQuery(f.provenance, f.target, f.context, f.execution),
  );
  assert.match(
    JSON.parse(log.options.body).filter,
    /jsonPayload.event="database_verification"/,
  );
});
test('live provider errors and drift never expose token/diagnostics or fall back to supplied JSON', async () => {
  for (const mode of [
    'error',
    'redirect',
    'oversized',
    'not-json',
    'job-replaced',
    'execution-replaced',
    'stale-at-completion',
  ]) {
    const f = databaseFixture();
    let clock = now;
    const { transport } = providerTransport(f, (response, call) => {
      if (mode === 'error' && call.index === 1) {
        response.status = 403;
        response.value = { private: 'PRIVATE_DIAGNOSTIC' };
      }
      if (mode === 'redirect' && call.index === 1) {
        response.status = 302;
        response.headers.Location = 'https://untrusted.example.test';
      }
      if (mode === 'oversized' && call.index === 5)
        response.body = ' '.repeat(262145);
      if (mode === 'not-json' && call.index === 5)
        response.body = 'PRIVATE_DIAGNOSTIC';
      if (mode === 'job-replaced' && call.index === 6)
        response.value.uid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      if (mode === 'execution-replaced' && call.index === 7)
        response.value.etag = 'other-etag';
      if (mode === 'stale-at-completion' && call.index === 8) clock += 86400001;
    });
    await assert.rejects(
      verifyLiveDatabaseExecution({
        ...f,
        accessToken: 'synthetic.access.token',
        transport,
        now: () => clock,
      }),
      (error) => {
        assert.ok(!error.message.includes('PRIVATE_DIAGNOSTIC'));
        assert.ok(!error.message.includes('synthetic.access.token'));
        return true;
      },
    );
  }
  const f = databaseFixture();
  let called = false;
  f.target.resourceId = 'bad?query=private';
  await assert.rejects(
    verifyLiveDatabaseExecution({
      ...f,
      accessToken: 'synthetic.access.token',
      transport: async () => {
        called = true;
      },
    }),
  );
  assert.equal(called, false);
});
test('fresh live history/runtime proofs join by code, workflow and SQL baselines; serialized or changed proofs cannot acquire trust', async () => {
  const h = databaseFixture();
  const r = databaseFixture('staging', 'verify');
  const history = await verifyLiveDatabaseExecution({
    ...h,
    accessToken: 'synthetic.access.token',
    ...providerTransport(h),
  });
  const runtime = await verifyLiveDatabaseExecution({
    ...r,
    accessToken: 'synthetic.access.token',
    ...providerTransport(r),
  });
  const combined = combineDatabaseEvidence({
    history,
    runtime,
    expectedSql: sql,
    now,
  });
  assert.equal(
    combined.schemaVerification.historyExecution,
    history.observation.execution.name,
  );
  assert.equal(
    combined.schemaVerification.execution,
    runtime.observation.execution.name,
  );
  assert.equal(
    combined.schemaVerification.permissionDigest,
    sql.permissionDigest,
  );
  assert.equal(
    combined.schemaVerification.evidenceSha256,
    digest(combined.evidence),
  );
  assert.throws(() =>
    combineDatabaseEvidence({
      history: structuredClone(history),
      runtime,
      expectedSql: sql,
      now,
    }),
  );
  const original = history.recordSha256;
  history.recordSha256 = '0'.repeat(64);
  assert.throws(() =>
    combineDatabaseEvidence({ history, runtime, expectedSql: sql, now }),
  );
  history.recordSha256 = original;
  const pending = databaseFixture();
  pending.logPage.entries[0].jsonPayload.evidence.applied = sql.migrations
    .slice(0, -1)
    .map((m) => m.id);
  pending.logPage.entries[0].jsonPayload.evidence.pending = [
    sql.migrations.at(-1).id,
  ];
  const pendingProof = await verifyLiveDatabaseExecution({
    ...pending,
    accessToken: 'synthetic.access.token',
    ...providerTransport(pending),
  });
  assert.throws(
    () =>
      combineDatabaseEvidence({
        history: pendingProof,
        runtime,
        expectedSql: sql,
        now,
      }),
    { code: 'DATABASE_STATE_NOT_READY' },
  );
});
