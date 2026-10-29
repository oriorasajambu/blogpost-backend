import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fullConformanceReport,
  requiredErrorCodes,
  excludedErrorCodes,
} from '../conformance/report.mjs';
import { readdir, readFile } from 'node:fs/promises';
const catalog = [
  { operationId: 'read', access: 'ANONYMOUS' },
  { operationId: 'write', access: 'STAFF' },
];
test('every contract error family has an explicit backend coverage requirement or scoped exclusion', async () => {
  const files = await readdir('contracts/fixtures/errors');
  const codes = await Promise.all(
    files.map(
      async (file) =>
        JSON.parse(await readFile('contracts/fixtures/errors/' + file, 'utf8'))
          .error.code,
    ),
  );
  assert.deepEqual(
    [
      ...new Set([...requiredErrorCodes, ...Object.keys(excludedErrorCodes)]),
    ].sort(),
    codes.sort(),
  );
  assert.equal(new Set(requiredErrorCodes).size, requiredErrorCodes.length);
});
const observation = (operationId, status, errorCode = null) => ({
  operationId,
  status,
  errorCode,
  replayed: false,
  binary: false,
  count: 1,
});
function input() {
  const identity = {
    runId: 'a'.repeat(12),
    testProject: 'demo-fixture',
    contractSha256: 'b'.repeat(64),
  };
  return {
    catalog,
    ...identity,
    project: identity.testProject,
    reports: [
      {
        ...identity,
        verifiedObservations: [
          { ...observation('read', 200), binary: true },
          { ...observation('write', 200), replayed: true },
          ...requiredErrorCodes.map((code) => observation('write', 400, code)),
        ],
      },
    ],
    boundary: {
      ...identity,
      wireBoundarySuitePassed: true,
      healthVerified: ['/health/live', '/health/ready'],
      metadataRejected: ['read', 'write'],
      anonymousRejected: ['write'],
      injectedDependencyErrors: ['INTERNAL_ERROR', 'UPSTREAM_TIMEOUT'],
      verifiedObservations: [
        observation('read', 400, 'INVALID_CLIENT_METADATA'),
        observation('write', 400, 'INVALID_CLIENT_METADATA'),
        observation('write', 401, 'AUTHENTICATION_REQUIRED'),
      ],
    },
  };
}
test('full conformance requires same-run positive, boundary, replay, binary and error-family evidence', () => {
  assert.equal(fullConformanceReport(input()).status, 'PASSED');
  for (const mutate of [
    (i) => {
      i.reports[0].runId = 'stale';
    },
    (i) => {
      i.boundary.verifiedObservations.pop();
    },
    (i) => {
      i.reports[0].verifiedObservations.shift();
    },
    (i) => {
      i.reports[0].verifiedObservations =
        i.reports[0].verifiedObservations.filter(
          (o) => o.errorCode !== 'RATE_LIMITED',
        );
    },
    (i) => {
      i.boundary.metadataRejected.pop();
    },
  ]) {
    const i = input();
    mutate(i);
    assert.throws(() => fullConformanceReport(i));
  }
  const i = input();
  i.reports[0].verifiedObservations[0].diagnostic = 'private-diagnostic';
  assert.ok(
    !JSON.stringify(fullConformanceReport(i)).includes('private-diagnostic'),
  );
});
