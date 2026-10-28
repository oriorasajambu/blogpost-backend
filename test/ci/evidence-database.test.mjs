import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '../../src/platform/config/build-model.ts';
import {
  archiveDatabaseEvidence,
  assertArchivedDatabase,
} from '../../scripts/ci/evidence/database.mjs';
import { verifyLiveDatabaseExecution } from '../../scripts/deploy/database-reader.mjs';
import {
  databaseFixture,
  providerTransport,
  sql as providerSql,
  now as providerNow,
} from '../deploy/database-fixtures.mjs';
import {
  bundleFiles,
  decodeArchive,
  decodeBundle,
  jsonBytes,
} from '../../scripts/ci/evidence/bundle.mjs';
import { sha256, validateReceipt } from '../../scripts/ci/evidence/model.mjs';
import {
  evidenceFixture,
  now,
  policy,
  config,
  zip,
} from './evidence-fixtures.mjs';

const input = (f) => ({
  receipt: f.receipt,
  descriptor: f.descriptor,
  database: f.database,
  build: f.build,
  expectedSql: f.sql,
  run: f.run,
  config,
  policy,
  now,
});

function rehashRecord(proof) {
  proof.recordSha256 = digest({
    schemaVersion: 1,
    event: 'database_verification',
    application: 'backend',
    environment: proof.environment,
    kind: proof.kind,
    builtFromSha: proof.builtFromSha,
    runtimeInputDigest: proof.runtimeInputDigest,
    sourceInputDigest: proof.sourceInputDigest,
    configurationDigest: proof.configurationDigest,
    applicationVersion: proof.applicationVersion,
    contractVersion: proof.contractVersion,
    contractSha256: proof.contractSha256,
    execution: proof.observation.execution.name,
    verifiedAt: proof.verifiedAt,
    result: 'PASSED',
    evidence: proof.evidence,
  });
}

test('authenticated database archive binds both records, expected baselines and original staging attempt', () => {
  const f = evidenceFixture();
  const result = assertArchivedDatabase(input(f));
  assert.equal(result.evidenceSource, 'github-workflow-artifact');
  assert.deepEqual(result.schemaVerification, f.receipt.schemaVerification);
  assert.equal(
    f.receipt.databaseEvidence.sha256,
    sha256(jsonBytes(f.database)),
  );
  assert.notEqual(
    f.receipt.databaseEvidence.sha256,
    f.receipt.schemaVerification.evidenceSha256,
  );
  assert.notEqual(result.evidenceSource, 'live-api');
});

test('writer database archive requires live in-process reader results; serialized output cannot bootstrap trust', async () => {
  const h = databaseFixture(),
    r = databaseFixture('staging', 'verify');
  const history = await verifyLiveDatabaseExecution({
    ...h,
    ...providerTransport(h),
    accessToken: 'synthetic.access.token',
  });
  const runtime = await verifyLiveDatabaseExecution({
    ...r,
    ...providerTransport(r),
    accessToken: 'synthetic.access.token',
  });
  const options = {
    history,
    runtime,
    expectedSql: providerSql,
    now: providerNow,
  };
  const output = archiveDatabaseEvidence(options);
  assert.equal(
    output.databaseEvidence.sha256,
    sha256(jsonBytes(output.database)),
  );
  assert.equal(
    output.schemaVerification.evidenceSha256,
    digest(output.database),
  );
  assert.throws(
    () =>
      archiveDatabaseEvidence({
        ...options,
        history: structuredClone(history),
      }),
    { code: 'AUTHENTICATED_DATABASE_EVIDENCE_REQUIRED' },
  );
  runtime.evidence.connectionBudget.total_connections++;
  assert.throws(() => archiveDatabaseEvidence(options), {
    code: 'AUTHENTICATED_DATABASE_EVIDENCE_REQUIRED',
  });
});

test('archive rejects offline observations, another attempt, another operations image and hidden data', () => {
  for (const mutate of [
    (f) => {
      for (const p of [f.database.history, f.database.runtime]) {
        p.evidenceSource = 'provided-json';
        delete p.observedAt;
      }
    },
    (f) => {
      for (const p of [f.database.history, f.database.runtime])
        p.workflow.runAttempt = 2;
    },
    (f) => {
      for (const p of [f.database.history, f.database.runtime])
        p.workflow.runId = '101';
    },
    (f) => {
      for (const p of [f.database.history, f.database.runtime])
        p.workflow.repositoryId = '43';
    },
    (f) => {
      for (const p of [f.database.history, f.database.runtime])
        p.image = p.image.replace('f'.repeat(64), 'e'.repeat(64));
    },
    (f) => {
      for (const p of [f.database.history, f.database.runtime]) {
        p.builtFromSha = '9'.repeat(40);
        rehashRecord(p);
      }
    },
    (f) => {
      f.database.runtime.limitations = ['PRIVATE_UNEXPECTED_DIAGNOSTIC'];
    },
    (f) => {
      f.database.runtime.rawEnvironment = {
        SQL_APP_PASSWORD: 'PRIVATE_SYNTHETIC_VALUE',
      };
    },
    (f) => {
      f.database.runtime.evidence.schemaDigest = '9'.repeat(64);
      rehashRecord(f.database.runtime);
    },
    (f) => {
      f.database.history.evidence.applied.pop();
      f.database.history.evidence.pending = [f.sql.migrations.at(-1).id];
      rehashRecord(f.database.history);
    },
    (f) => {
      f.receipt.schemaVerification.evidenceSha256 = '9'.repeat(64);
    },
    (f) => {
      f.receipt.schemaVerification.historyDigest = '9'.repeat(64);
    },
    (f) => {
      f.receipt.workflowRunId = '101';
    },
    (f) => {
      f.receipt.schemaVersion = 1;
    },
    (f) => {
      f.database.schemaVersion = 2;
    },
  ]) {
    const f = evidenceFixture();
    mutate(f);
    assert.throws(() => assertArchivedDatabase(input(f)));
  }
});

test('SQL observations must belong to this run and stay fresh at promotion completion; historical chains retain real times', () => {
  const f = evidenceFixture();
  const at =
    Date.parse(f.database.history.verifiedAt) +
    policy.receiptMaxAgeSeconds * 1000 +
    1;
  assert.throws(() => assertArchivedDatabase({ ...input(f), now: at }), {
    code: 'EVIDENCE_EXPIRED_OR_FUTURE',
  });
  assert.equal(
    assertArchivedDatabase({ ...input(f), now: at, historical: true }).status,
    'VERIFIED',
  );
  f.run.run_started_at = '2026-10-27T08:19:00Z';
  assert.throws(() => assertArchivedDatabase(input(f)), {
    code: 'DATABASE_RUN_TIME_DISAGREES',
  });
  const late = evidenceFixture();
  late.database.history.observedAt = '2026-10-27T08:20:00Z';
  assert.throws(() => assertArchivedDatabase(input(late)), {
    code: 'DATABASE_LIVE_OBSERVATION_EXPIRED',
  });
});

test('schema-v2 bundle mandates the exact database file, checksums, canonical JSON and bounded four-entry ZIP', () => {
  const f = evidenceFixture();
  const files = bundleFiles(f.receipt, f.descriptor, f.database);
  assert.equal(files.size, 4);
  assert.deepEqual(decodeBundle(files, policy).database, f.database);
  const missing = new Map(files);
  missing.delete('backend-staging-database.json');
  assert.throws(() => decodeBundle(missing, policy), {
    code: 'UNEXPECTED_STAGING_BUNDLE_FILES',
  });
  const archive = zip(missing);
  assert.throws(() => decodeArchive(archive, sha256(archive), policy));
  const edited = new Map(files);
  edited.set(
    'backend-staging-database.json',
    jsonBytes({ ...f.database, schemaVersion: 2 }),
  );
  assert.throws(() => decodeBundle(edited, policy), {
    code: 'DATABASE_FILE_DISAGREES',
  });
  const duplicate = new Map(files);
  duplicate.set(
    'backend-staging-database.json',
    Buffer.from(
      canonical(f.database).replace(
        '"schemaVersion":1',
        '"schemaVersion":9,"schemaVersion":1',
      ) + '\n',
    ),
  );
  assert.throws(() => decodeBundle(duplicate, policy), {
    code: 'NONCANONICAL_EVIDENCE_JSON',
  });
  const legacy = structuredClone(f.receipt);
  legacy.schemaVersion = 1;
  assert.throws(() => validateReceipt(legacy));
  const foreign = structuredClone(f.receipt);
  foreign.schemaVerification.historyExecution =
    foreign.schemaVerification.execution;
  assert.throws(() => validateReceipt(foreign), {
    code: 'DISTINCT_DATABASE_EXECUTIONS_REQUIRED',
  });
});
