import { canonical, digest } from '../../../src/platform/config/build-model.ts';
import { combineDatabaseEvidence } from '../../deploy/database-reader.mjs';
import { cloudTime } from '../../deploy/database-proof.mjs';
import { fail } from '../policy.mjs';
import {
  exact,
  fileReference,
  fresh,
  instant,
  sha256,
  validateReceipt,
} from './model.mjs';
import { jsonBytes } from './bundle.mjs';

// The future trusted writer must use this in the same process as both live reads.
// Serialized CLI results and offline observations cannot acquire this capability.
export function archiveDatabaseEvidence({
  history,
  runtime,
  expectedSql,
  now = Date.now(),
}) {
  const combined = combineDatabaseEvidence({
    history,
    runtime,
    expectedSql,
    now,
  });
  const bytes = jsonBytes(combined.evidence);
  return {
    database: combined.evidence,
    schemaVerification: combined.schemaVerification,
    databaseEvidence: fileReference(
      {
        filename: 'backend-staging-database.json',
        size: bytes.length,
        sha256: sha256(bytes),
      },
      'backend-staging-database.json',
    ),
  };
}

// Call only after the archive and original workflow attempt are authenticated.
// This validates the archived observations; it does not acquire fresh cloud trust.
export function assertArchivedDatabase({
  receipt,
  descriptor,
  database,
  build,
  expectedSql,
  run,
  config,
  policy,
  now = Date.now(),
  historical = false,
}) {
  receipt = validateReceipt(receipt);
  exact(database, ['schemaVersion', 'history', 'runtime']);
  if (database.schemaVersion !== 1) fail('INVALID_DATABASE_ARCHIVE');
  const issuedAt = instant(receipt.verifiedAt);
  const combined = combineDatabaseEvidence({
    history: database.history,
    runtime: database.runtime,
    expectedSql,
    now: issuedAt,
    requireLive: false,
  });
  if (
    canonical(combined.schemaVerification) !==
    canonical(receipt.schemaVerification)
  )
    fail('DATABASE_RECEIPT_DISAGREES');
  const started = instant(run.run_started_at),
    skew = policy.clockSkewSeconds * 1000;
  for (const proof of [database.history, database.runtime]) {
    if (proof.evidenceSource !== 'live-api')
      fail('LIVE_DATABASE_ARCHIVE_REQUIRED');
    if (!historical)
      fresh(
        proof.verifiedAt,
        now,
        policy.receiptMaxAgeSeconds,
        policy.clockSkewSeconds,
      );
    for (const [key, value] of Object.entries({
      environment: 'staging',
      builtFromSha: receipt.builtFromSha,
      applicationVersion: build.applicationVersion,
      contractVersion: build.contractVersion,
      contractSha256: build.contractSha256,
      runtimeInputDigest: build.runtimeInputDigest,
      sourceInputDigest: build.sourceInputDigest,
      configurationDigest: digest(build.configuration),
      image: descriptor.operationsImage,
    }))
      if (proof[key] !== value) fail('DATABASE_ARTIFACT_DISAGREES');
    if (
      canonical(proof.workflow) !==
      canonical({
        repositoryId: config.repositoryId,
        runId: receipt.workflowRunId,
        runAttempt: receipt.workflowRunAttempt,
        workflow: 'staging',
      })
    )
      fail('DATABASE_WORKFLOW_DISAGREES');
    if (
      !proof.observation.job.resourceName.startsWith(
        'projects/' + build.configuration.projectId + '/',
      )
    )
      fail('DATABASE_PROJECT_DISAGREES');
    if (
      cloudTime(proof.verifiedAt) < started ||
      cloudTime(proof.observedAt) < started ||
      cloudTime(proof.observation.execution.startTime) < started - skew ||
      cloudTime(proof.observation.execution.completionTime) > issuedAt + skew
    )
      fail('DATABASE_RUN_TIME_DISAGREES');
    if (
      canonical(proof.limitations) !==
      canonical([
        'Requires separately authenticated image/source provenance and provider IAM/resource/backup/rollout verification.',
      ])
    )
      fail('INVALID_DATABASE_ARCHIVE');
  }
  return {
    schemaVersion: 1,
    status: 'VERIFIED',
    scope: 'authenticated-archive-database',
    evidenceSource: 'github-workflow-artifact',
    schemaVerification: combined.schemaVerification,
  };
}
