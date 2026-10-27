import { createHash } from 'node:crypto';
import {
  canonical,
  digest,
  validateProvenance,
} from '../../../src/platform/config/build-model.ts';
import { fail, sha, stableVersion } from '../policy.mjs';
import { sqlExpectations } from '../../deploy/database-proof.mjs';

export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
export const CODE_JOBS = ['foundation', 'identity-sql', 'kotlin-contract'];
export const ALWAYS_JOBS = [
  'policy',
  'docs',
  'source-proof',
  'delivery',
  'staging-evidence',
];
export const SCENARIOS = [
  'realGoogleSignIn',
  'membershipRoles',
  'crossClientEditorial',
  'draftReviewConflictRecovery',
  'mediaWithdrawal',
  'environmentShareOrigins',
  'accessibility',
  'upgradeContinuity',
];
export function exact(value, keys, code = 'INVALID_STAGING_EVIDENCE') {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    canonical(Object.keys(value).sort()) !== canonical([...keys].sort())
  )
    fail(code);
  return value;
}
export function text(
  value,
  pattern,
  max = 512,
  code = 'INVALID_STAGING_EVIDENCE',
) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    !pattern.test(value)
  )
    fail(code);
  return value;
}
export const hash = (value) => text(value, /^[a-f0-9]{64}$/, 64);
export function id(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1))
    fail('INVALID_EVIDENCE_ID');
  return text(
    typeof value === 'number' ? String(value) : value,
    /^[1-9][0-9]{0,19}$/,
    20,
    'INVALID_EVIDENCE_ID',
  );
}
export function instant(value) {
  text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/, 24);
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().replace('.000Z', 'Z') !==
      value.replace('.000Z', 'Z')
  )
    fail('INVALID_EVIDENCE_TIME');
  return milliseconds;
}
export function fresh(value, now, seconds, skewSeconds) {
  const at = instant(value);
  if (at > now + skewSeconds * 1000 || at < now - seconds * 1000)
    fail('EVIDENCE_EXPIRED_OR_FUTURE');
  return at;
}
export function evidencePolicy(value) {
  exact(value, [
    'schemaVersion',
    'receiptMaxAgeSeconds',
    'manualMaxAgeSeconds',
    'clockSkewSeconds',
    'maxArchiveBytes',
    'maxReceiptBytes',
    'maxReuseDepth',
  ]);
  if (value.schemaVersion !== 1) fail('INVALID_EVIDENCE_POLICY');
  for (const [key, maximum] of Object.entries({
    receiptMaxAgeSeconds: 604800,
    manualMaxAgeSeconds: 2592000,
    clockSkewSeconds: 300,
    maxArchiveBytes: 1048576,
    maxReceiptBytes: 65536,
    maxReuseDepth: 32,
  })) {
    if (
      !Number.isSafeInteger(value[key]) ||
      value[key] < 1 ||
      value[key] > maximum
    )
      fail('INVALID_EVIDENCE_POLICY');
  }
  return value;
}
export function imageUri(value, projectId) {
  text(value, /^[a-z0-9./_@:-]+$/, 512);
  if (
    !new RegExp(
      '^asia-southeast2-docker\\.pkg\\.dev/' +
        projectId +
        '/[a-z][a-z0-9_-]*/[a-z][a-z0-9_-]*@sha256:[a-f0-9]{64}$',
    ).test(value)
  )
    fail('WRONG_STAGING_IMAGE');
  return value;
}
export function artifactDescriptor(build, apiImage, operationsImage) {
  build = validateProvenance(build);
  if (build.environment !== 'staging' || build.kind !== 'ARTIFACT')
    fail('STAGING_ARTIFACT_REQUIRED');
  imageUri(apiImage, build.configuration.projectId);
  imageUri(operationsImage, build.configuration.projectId);
  if (apiImage === operationsImage) fail('DISTINCT_IMAGE_TARGETS_REQUIRED');
  return {
    schemaVersion: 1,
    application: 'backend',
    environment: 'staging',
    sourceSha: build.sourceSha,
    sourceRef: build.sourceRef,
    applicationVersion: build.applicationVersion,
    contractVersion: build.contractVersion,
    contractSha256: build.contractSha256,
    runtimeInputDigest: build.runtimeInputDigest,
    sourceInputDigest: build.sourceInputDigest,
    configurationDigest: digest(build.configuration),
    targetPlatform: build.targetPlatform,
    apiImage,
    operationsImage,
  };
}
export function fileReference(value, filename) {
  exact(value, ['filename', 'size', 'sha256']);
  if (
    value.filename !== filename ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > 65536
  )
    fail('INVALID_EVIDENCE_FILE');
  hash(value.sha256);
  return value;
}
export function receiptReference(value) {
  exact(value, [
    'candidateSha',
    'runId',
    'runAttempt',
    'artifactId',
    'archiveSha256',
    'receiptSha256',
  ]);
  sha(value.candidateSha);
  id(value.runId);
  id(value.artifactId);
  hash(value.archiveSha256);
  hash(value.receiptSha256);
  if (!Number.isSafeInteger(value.runAttempt) || value.runAttempt < 1)
    fail('INVALID_EVIDENCE_ATTEMPT');
  return value;
}
export function validateReceipt(value) {
  exact(value, [
    'schemaVersion',
    'application',
    'environment',
    'candidateSha',
    'builtFromSha',
    'mode',
    'applicationVersion',
    'contractVersion',
    'contractSha256',
    'runtimeInputDigest',
    'sourceInputDigest',
    'configurationDigest',
    'apiOrigin',
    'servingRevision',
    'workflowRunId',
    'workflowRunAttempt',
    'deployedAt',
    'verifiedAt',
    'result',
    'artifact',
    'databaseEvidence',
    'schemaVerification',
    'counterparts',
    'supersedes',
  ]);
  if (
    value.schemaVersion !== 2 ||
    value.application !== 'backend' ||
    value.environment !== 'staging' ||
    value.result !== 'PASSED' ||
    !['DEPLOYED', 'EQUIVALENT_REUSE'].includes(value.mode)
  )
    fail('INVALID_STAGING_EVIDENCE');
  sha(value.candidateSha);
  sha(value.builtFromSha);
  if (id(value.workflowRunId) !== value.workflowRunId)
    fail('INVALID_EVIDENCE_ID');
  if (
    !Number.isSafeInteger(value.workflowRunAttempt) ||
    value.workflowRunAttempt < 1
  )
    fail('INVALID_EVIDENCE_ATTEMPT');
  for (const key of [
    'contractSha256',
    'runtimeInputDigest',
    'sourceInputDigest',
    'configurationDigest',
  ])
    hash(value[key]);
  stableVersion(value.applicationVersion);
  stableVersion(value.contractVersion);
  text(value.servingRevision, /^[a-z][a-z0-9-]{0,62}$/, 63);
  const origin = new URL(value.apiOrigin);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== value.apiOrigin ||
    origin.username ||
    origin.password
  )
    fail('INVALID_STAGING_ORIGIN');
  if (instant(value.deployedAt) > instant(value.verifiedAt))
    fail('EVIDENCE_TIME_DISAGREES');
  fileReference(value.artifact, 'backend-staging-artifact.json');
  fileReference(value.databaseEvidence, 'backend-staging-database.json');
  exact(value.schemaVerification, [
    'execution',
    'historyExecution',
    'verifiedAt',
    'migrationDigest',
    'historyDigest',
    'schemaDigest',
    'permissionDigest',
    'evidenceSha256',
  ]);
  for (const key of ['execution', 'historyExecution'])
    text(
      value.schemaVerification[key],
      /^projects\/[a-z][a-z0-9-]+\/locations\/asia-southeast2\/jobs\/[a-z][a-z0-9-]+\/executions\/[a-z][a-z0-9-]+$/,
      512,
    );
  if (
    value.schemaVerification.execution ===
    value.schemaVerification.historyExecution
  )
    fail('DISTINCT_DATABASE_EXECUTIONS_REQUIRED');
  if (instant(value.schemaVerification.verifiedAt) > instant(value.verifiedAt))
    fail('EVIDENCE_TIME_DISAGREES');
  for (const key of [
    'migrationDigest',
    'historyDigest',
    'schemaDigest',
    'permissionDigest',
    'evidenceSha256',
  ])
    hash(value.schemaVerification[key]);
  if (!Array.isArray(value.counterparts) || value.counterparts.length !== 2)
    fail('COUNTERPART_EVIDENCE_REQUIRED');
  const counterparts = new Set();
  for (const c of value.counterparts) {
    exact(c, [
      'application',
      'applicationVersion',
      'sourceSha',
      'runtimeInputDigest',
      'configurationDigest',
      'apiMajor',
      'contractVersion',
      'contractSha256',
      'verifiedBackendContract',
      'capabilityDigest',
      'verificationSha256',
      ...(c.application === 'web'
        ? ['origin', 'servingRevision', 'image']
        : [
            'applicationId',
            'versionCode',
            'signingCertificateSha256',
            'artifact',
          ]),
    ]);
    if (
      !['web', 'android'].includes(c.application) ||
      counterparts.has(c.application) ||
      c.apiMajor !== 1
    )
      fail('INVALID_COUNTERPART_EVIDENCE');
    counterparts.add(c.application);
    stableVersion(c.applicationVersion);
    stableVersion(c.contractVersion);
    sha(c.sourceSha);
    exact(c.verifiedBackendContract, ['version', 'sha256']);
    stableVersion(c.verifiedBackendContract.version);
    hash(c.verifiedBackendContract.sha256);
    for (const key of [
      'contractSha256',
      'runtimeInputDigest',
      'configurationDigest',
      'capabilityDigest',
      'verificationSha256',
    ])
      hash(c[key]);
    if (c.application === 'web') {
      const webOrigin = new URL(c.origin);
      if (webOrigin.protocol !== 'https:' || webOrigin.origin !== c.origin)
        fail('INVALID_COUNTERPART_ORIGIN');
      text(c.servingRevision, /^[a-z][a-z0-9-]{0,62}$/, 63);
      text(c.image, /^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/, 512);
    } else {
      text(
        c.applicationId,
        /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+\.staging$/,
        255,
      );
      if (
        !Number.isSafeInteger(c.versionCode) ||
        c.versionCode < 1 ||
        c.versionCode > 2100000000
      )
        fail('INVALID_COUNTERPART_VERSION_CODE');
      hash(c.signingCertificateSha256);
      exact(c.artifact, ['filename', 'mediaType', 'size', 'sha256']);
      text(c.artifact.filename, /^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/, 128);
      hash(c.artifact.sha256);
      if (
        c.artifact.mediaType !== 'application/vnd.android.package-archive' ||
        !Number.isSafeInteger(c.artifact.size) ||
        c.artifact.size < 1 ||
        c.artifact.size > 1073741824
      )
        fail('INVALID_COUNTERPART_APK');
    }
  }
  if (value.mode === 'DEPLOYED') {
    if (value.builtFromSha !== value.candidateSha || value.supersedes !== null)
      fail('INVALID_DEPLOYED_SOURCE');
  } else {
    receiptReference(value.supersedes);
    if (
      value.builtFromSha === value.candidateSha ||
      value.supersedes.candidateSha === value.candidateSha
    )
      fail('INVALID_REUSED_SOURCE');
  }
  return JSON.parse(canonical(value));
}
export function assertReceiptMatches(
  receipt,
  descriptor,
  build,
  expectedSql,
  now,
  policy,
  { historical = false } = {},
) {
  receipt = validateReceipt(receipt);
  expectedSql = sqlExpectations(expectedSql);
  policy = evidencePolicy(policy);
  build = validateProvenance(build);
  if (build.environment !== 'staging' || build.kind !== 'ARTIFACT')
    fail('STAGING_ARTIFACT_REQUIRED');
  const expected = artifactDescriptor(
    { ...build, sourceSha: receipt.builtFromSha },
    descriptor.apiImage,
    descriptor.operationsImage,
  );
  exact(descriptor, Object.keys(expected));
  if (canonical(descriptor) !== canonical(expected))
    fail('ARTIFACT_PROVENANCE_DISAGREES');
  for (const key of [
    'applicationVersion',
    'contractVersion',
    'contractSha256',
    'runtimeInputDigest',
    'sourceInputDigest',
  ])
    if (receipt[key] !== build[key]) fail('CANDIDATE_INPUTS_DISAGREE');
  if (
    receipt.configurationDigest !== digest(build.configuration) ||
    receipt.apiOrigin !== build.configuration.apiOrigin ||
    receipt.candidateSha !== build.sourceSha ||
    ['migrationDigest', 'schemaDigest', 'permissionDigest'].some(
      (key) => receipt.schemaVerification[key] !== expectedSql[key],
    ) ||
    ['execution', 'historyExecution'].some(
      (key) =>
        !receipt.schemaVerification[key].startsWith(
          'projects/' + build.configuration.projectId + '/',
        ),
    )
  )
    fail('CANDIDATE_CONFIGURATION_DISAGREES');
  if (!historical)
    fresh(
      receipt.verifiedAt,
      now,
      policy.receiptMaxAgeSeconds,
      policy.clockSkewSeconds,
    );
  else if (instant(receipt.verifiedAt) > now + policy.clockSkewSeconds * 1000)
    fail('EVIDENCE_EXPIRED_OR_FUTURE');
  for (const c of receipt.counterparts)
    if (
      c.verifiedBackendContract.version !== receipt.contractVersion ||
      c.verifiedBackendContract.sha256 !== receipt.contractSha256
    )
      fail('COUNTERPART_CONTRACT_DISAGREES');
    else if (c.application === 'web') {
      if (c.origin !== build.configuration.webOrigin)
        fail('COUNTERPART_ORIGIN_DISAGREES');
      imageUri(c.image, build.configuration.projectId);
    }
  return receipt;
}
export function assertEquivalentReuse(current, previous) {
  current = validateReceipt(current);
  previous = validateReceipt(previous);
  if (
    current.mode !== 'EQUIVALENT_REUSE' ||
    current.supersedes.candidateSha !== previous.candidateSha ||
    current.supersedes.runId !== previous.workflowRunId ||
    current.supersedes.runAttempt !== previous.workflowRunAttempt
  )
    fail('WRONG_SUPERSEDED_RECEIPT');
  for (const key of [
    'builtFromSha',
    'applicationVersion',
    'contractVersion',
    'contractSha256',
    'runtimeInputDigest',
    'sourceInputDigest',
    'configurationDigest',
    'apiOrigin',
    'servingRevision',
    'deployedAt',
    'artifact',
    'counterparts',
  ])
    if (canonical(current[key]) !== canonical(previous[key]))
      fail('REUSE_INPUTS_OR_ARTIFACT_DISAGREE');
  if (instant(current.verifiedAt) < instant(previous.verifiedAt))
    fail('REUSE_PRECEDES_PRIOR_EVIDENCE');
  for (const key of [
    'migrationDigest',
    'historyDigest',
    'schemaDigest',
    'permissionDigest',
  ])
    if (current.schemaVerification[key] !== previous.schemaVerification[key])
      fail('REUSE_SCHEMA_OR_PERMISSIONS_DISAGREE');
}
export function assertLiveMetadata(receipt, observation, now, policy) {
  receipt = validateReceipt(receipt);
  policy = evidencePolicy(policy);
  exact(observation, [
    'origin',
    'liveStatus',
    'readyStatus',
    'metadataStatus',
    'metadata',
    'observedAt',
  ]);
  const meta = observation.metadata;
  fresh(observation.observedAt, now, 60, policy.clockSkewSeconds);
  if (
    observation.origin !== receipt.apiOrigin ||
    observation.liveStatus !== 200 ||
    observation.readyStatus !== 200 ||
    observation.metadataStatus !== 200 ||
    meta?.apiMajor !== 1 ||
    meta.contractVersion !== receipt.contractVersion ||
    meta.buildSha !== receipt.builtFromSha ||
    meta.deployment?.environment !== 'staging' ||
    meta.deployment.revision !== receipt.servingRevision ||
    meta.deployment.runtimeInputDigest !== receipt.runtimeInputDigest ||
    meta.deployment.configurationDigest !== receipt.configurationDigest
  )
    fail('LIVE_STAGING_DRIFT');
}
