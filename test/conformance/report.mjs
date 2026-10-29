// Safe, independently verified operation/status evidence from one disposable run.
export const requiredErrorCodes = [
  'INVALID_CLIENT_METADATA',
  'AUTHENTICATION_REQUIRED',
  'AUTHENTICATION_EXPIRED',
  'INSUFFICIENT_PERMISSION',
  'RESOURCE_NOT_FOUND',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'VALIDATION_FAILED',
  'MALFORMED_JSON',
  'PAYLOAD_TOO_LARGE',
  'METHOD_NOT_ALLOWED',
  'INTERNAL_ERROR',
  'UPSTREAM_TIMEOUT',
  'DEPENDENCY_UNAVAILABLE',
  'RATE_LIMITED',
  'ACCESS_REVOKED',
  'AMBIGUOUS_CREDENTIALS',
  'CLIENT_DRAFT_ALREADY_EXISTS',
  'EXPECTED_VERSION_REQUIRED',
  'IDEMPOTENCY_IN_PROGRESS',
  'INVALID_CREDENTIAL',
  'INVALID_CURSOR',
  'INVALID_IDEMPOTENCY_KEY',
  'INVALID_EXPECTED_VERSION',
  'INVITATION_ACCOUNT_MISMATCH',
  'INVITATION_EXPIRED',
  'INVITATION_INVALID',
  'INVITATION_REVOKED',
  'INVITATION_USED',
  'LAST_ADMIN_REQUIRED',
  'MARKDOWN_UNSUPPORTED',
  'MEMBER_ALREADY_EXISTS',
  'RESOURCE_QUOTA_EXCEEDED',
  'SEARCH_QUERY_NOT_SEARCHABLE',
  'SLUG_CONFLICT',
  'UNSUPPORTED_MEDIA_TYPE',
  'UPLOAD_TOO_LARGE',
  'WORKFLOW_CONFLICT',
];
export const excludedErrorCodes = {
  CSRF_VALIDATION_FAILED:
    'Web BFF enforcement; backend accepts neither browser cookies nor CSRF tokens.',
  API_VERSION_RETIRED:
    'The initial v1 major is active; no retired major exists.',
};
export function fullConformanceReport({
  catalog,
  reports,
  boundary,
  runId,
  project,
  contractSha256,
}) {
  const ids = new Set(catalog.map((op) => op.operationId));
  const observations = [];
  for (const report of [...reports, boundary]) {
    if (
      report.runId !== runId ||
      report.testProject !== project ||
      report.contractSha256 !== contractSha256 ||
      !Array.isArray(report.verifiedObservations)
    )
      throw new Error('Stale or missing full conformance evidence');
    for (const item of report.verifiedObservations) {
      if (
        !ids.has(item.operationId) ||
        !Number.isInteger(item.status) ||
        item.status < 200 ||
        item.status > 599 ||
        !Number.isSafeInteger(item.count) ||
        item.count < 1 ||
        typeof item.replayed !== 'boolean' ||
        typeof item.binary !== 'boolean' ||
        (item.errorCode !== null && !/^[A-Z][A-Z_]+$/.test(item.errorCode))
      )
        throw new Error('Invalid verified conformance observation');
      observations.push({
        operationId: item.operationId,
        status: item.status,
        errorCode: item.errorCode,
        replayed: item.replayed,
        binary: item.binary,
        count: item.count,
      });
    }
  }
  const successes = new Set(
    observations.filter((o) => o.status < 300).map((o) => o.operationId),
  );
  const errors = new Set(observations.map((o) => o.errorCode).filter(Boolean));
  if (
    !Array.isArray(boundary.metadataRejected) ||
    !Array.isArray(boundary.anonymousRejected) ||
    JSON.stringify(boundary.injectedDependencyErrors) !==
      JSON.stringify(['INTERNAL_ERROR', 'UPSTREAM_TIMEOUT'])
  )
    throw new Error('Invalid boundary evidence');
  if (
    JSON.stringify(boundary.healthVerified) !==
    JSON.stringify(['/health/live', '/health/ready'])
  )
    throw new Error('Missing health conformance');
  const metadata = new Set(boundary.metadataRejected);
  const anonymous = new Set(boundary.anonymousRejected);
  const expectedAnonymous = catalog
    .filter((op) => op.access !== 'ANONYMOUS')
    .map((op) => op.operationId);
  if (
    boundary.wireBoundarySuitePassed !== true ||
    metadata.size !== ids.size ||
    [...ids].some(
      (id) =>
        !metadata.has(id) ||
        !boundary.verifiedObservations.some(
          (o) =>
            o.operationId === id &&
            o.status === 400 &&
            o.errorCode === 'INVALID_CLIENT_METADATA',
        ),
    ) ||
    anonymous.size !== expectedAnonymous.length ||
    expectedAnonymous.some(
      (id) =>
        !anonymous.has(id) ||
        !boundary.verifiedObservations.some(
          (o) => o.operationId === id && o.status === 401,
        ),
    ) ||
    successes.size !== ids.size ||
    [...ids].some((id) => !successes.has(id)) ||
    requiredErrorCodes.some((code) => !errors.has(code)) ||
    !observations.some((o) => o.replayed) ||
    !observations.some((o) => o.binary)
  )
    throw new Error('Incomplete full conformance evidence');
  return {
    schemaVersion: 1,
    scope: 'full-isolated-backend',
    status: 'PASSED',
    complete: true,
    runId,
    testProject: project,
    contractSha256,
    total: ids.size,
    executed: successes.size,
    pending: [],
    metadataRejectionOperations: metadata.size,
    anonymousRejectionOperations: anonymous.size,
    infrastructureOperations: 2,
    observedStatuses: [...new Set(observations.map((o) => o.status))].sort(
      (a, b) => a - b,
    ),
    observedErrorCodes: [...errors].sort(),
    requiredErrorCodes: [...requiredErrorCodes].sort(),
    excludedErrorCodes,
    verifiedObservations: observations,
    injectedDependencyErrors: boundary.injectedDependencyErrors,
    limitations: [
      'Local PostgreSQL, Authentication Emulator and filesystem media only.',
      'Injected dependency errors verify HTTP handling, not actual provider outages.',
      'Actual cloud/provider and web/Android release journeys remain separate gates.',
    ],
  };
}
