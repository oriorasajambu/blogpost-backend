import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../../src/platform/config/build-model.ts';
import {
  assertEquivalentReuse,
  assertLiveMetadata,
  assertReceiptMatches,
  fresh,
  instant,
  sha256,
  validateReceipt,
} from '../../scripts/ci/evidence/model.mjs';
import { assertTrustedGithubEvidence } from '../../scripts/ci/evidence/github-proof.mjs';
import {
  assertOwnerValidation,
  parseOwnerValidation,
  OWNER_START,
} from '../../scripts/ci/evidence/owner-validation.mjs';
import {
  bundleFiles,
  decodeArchive,
  decodeBundle,
  jsonBytes,
} from '../../scripts/ci/evidence/bundle.mjs';
import {
  config,
  evidenceFixture,
  now,
  policy,
  zip,
} from './evidence-fixtures.mjs';

test('staging receipt binds candidate inputs, both image targets, schema and counterpart pins', () => {
  const f = evidenceFixture();
  assert.equal(
    assertReceiptMatches(
      f.receipt,
      f.descriptor,
      f.build,
      '1'.repeat(64),
      now,
      policy,
    ).candidateSha,
    f.build.sourceSha,
  );
  assertLiveMetadata(f.receipt, f.live, now, policy);
  for (const mutate of [
    (f) => {
      f.receipt.candidateSha = '9'.repeat(40);
    },
    (f) => {
      f.receipt.configurationDigest = '9'.repeat(64);
    },
    (f) => {
      f.receipt.runtimeInputDigest = '9'.repeat(64);
    },
    (f) => {
      f.receipt.contractVersion = '2.0.0';
    },
    (f) => {
      f.receipt.schemaVerification.migrationDigest = '9'.repeat(64);
    },
    (f) => {
      f.receipt.schemaVerification.execution =
        f.receipt.schemaVerification.execution.replace(
          'example-blogpost-staging',
          'another-project',
        );
    },
    (f) => {
      f.receipt.counterparts[0].contractSha256 = '9'.repeat(64);
    },
    (f) => {
      f.descriptor.sourceSha = '9'.repeat(40);
    },
    (f) => {
      f.descriptor.apiImage = f.descriptor.apiImage.replace(
        'example-blogpost-staging',
        'another-project',
      );
    },
    (f) => {
      f.descriptor.apiImage = f.descriptor.apiImage.replace(
        /@sha256:.*/,
        ':latest',
      );
    },
    (f) => {
      f.descriptor.operationsImage = f.descriptor.apiImage;
    },
    (f) => {
      f.receipt.verifiedAt = '2026-10-25T08:30:00Z';
    },
    (f) => {
      f.receipt.verifiedAt = '2026-10-28T08:30:00Z';
    },
    (f) => {
      f.receipt.SQL_APP_PASSWORD = 'synthetic-not-a-credential';
    },
  ]) {
    const changed = evidenceFixture();
    mutate(changed);
    assert.throws(() =>
      assertReceiptMatches(
        changed.receipt,
        changed.descriptor,
        changed.build,
        '1'.repeat(64),
        now,
        policy,
      ),
    );
  }
});
test('live staging metadata detects environment, revision, build, input and health drift', () => {
  for (const mutate of [
    (f) => {
      f.live.origin = 'https://another.example.test';
    },
    (f) => {
      f.live.readyStatus = 503;
    },
    (f) => {
      f.live.metadata.buildSha = '9'.repeat(40);
    },
    (f) => {
      f.live.metadata.contractVersion = '2.0.0';
    },
    (f) => {
      f.live.metadata.deployment.environment = 'production';
    },
    (f) => {
      f.live.metadata.deployment.revision = 'backend-api-other';
    },
    (f) => {
      f.live.metadata.deployment.configurationDigest = '9'.repeat(64);
    },
    (f) => {
      f.live.metadata.deployment.runtimeInputDigest = '9'.repeat(64);
    },
  ]) {
    const f = evidenceFixture();
    mutate(f);
    assert.throws(
      () => assertLiveMetadata(f.receipt, f.live, now, policy),
      /LIVE_STAGING_DRIFT/,
    );
  }
});
test('receipt timestamps reject invalid calendar dates, newline input and future/expired observations', () => {
  assert.equal(instant('2026-10-27T09:00:00Z'), now);
  for (const value of [
    '2026-02-30T00:00:00Z',
    '2026-10-27T09:00:00Z\n',
    '2026-10-27',
    '2026-10-27T09:00:00+00:00',
  ])
    assert.throws(() => instant(value));
  assert.throws(() => fresh('2026-10-28T00:00:00Z', now, 86400, 300));
  const f = evidenceFixture();
  f.receipt.servingRevision += '\n';
  assert.throws(() => validateReceipt(f.receipt));
});
test('GitHub proof requires exact original RC push workflow, successful current attempt jobs and an available matching artifact', () => {
  const f = evidenceFixture();
  assert.equal(
    assertTrustedGithubEvidence(
      config,
      f.receipt,
      f.run,
      f.jobs,
      f.artifact,
      now,
      policy,
    ).artifactId,
    '200',
  );
  for (const mutate of [
    (f) => {
      f.run.repository = { ...f.run.repository, id: 99 };
    },
    (f) => {
      f.run.head_repository = { ...f.run.head_repository, id: 99 };
    },
    (f) => {
      f.run.event = 'pull_request';
    },
    (f) => {
      f.run.path = '.github/workflows/ci.yml';
    },
    (f) => {
      f.run.head_branch = 'main';
    },
    (f) => {
      f.run.head_sha = '9'.repeat(40);
    },
    (f) => {
      f.run.conclusion = 'failure';
    },
    (f) => {
      f.run.run_attempt = 2;
    },
    (f) => {
      f.jobs.jobs[0].run_attempt = 2;
    },
    (f) => {
      f.jobs.jobs[0].conclusion = 'skipped';
    },
    (f) => {
      f.jobs.jobs.find((j) => j.name === 'foundation').conclusion = 'skipped';
    },
    (f) => {
      f.jobs.jobs.pop();
    },
    (f) => {
      f.jobs.jobs.push(f.jobs.jobs[0]);
      f.jobs.total_count++;
    },
    (f) => {
      f.artifact.expired = true;
    },
    (f) => {
      f.artifact.name = 'coincidentally-green';
    },
    (f) => {
      f.artifact.workflow_run.head_repository_id = 99;
    },
    (f) => {
      f.artifact.expires_at = '2026-10-26T00:00:00Z';
    },
    (f) => {
      f.artifact.digest = null;
    },
  ]) {
    const changed = evidenceFixture();
    mutate(changed);
    assert.throws(() =>
      assertTrustedGithubEvidence(
        config,
        changed.receipt,
        changed.run,
        changed.jobs,
        changed.artifact,
        now,
        policy,
      ),
    );
  }
});
test('equivalent reuse preserves the actual artifact identity and requires explicit superseded evidence', () => {
  const f = evidenceFixture();
  const current = structuredClone(f.receipt);
  current.candidateSha = '9'.repeat(40);
  current.mode = 'EQUIVALENT_REUSE';
  current.workflowRunId = '101';
  current.verifiedAt = '2026-10-27T08:50:00Z';
  current.supersedes = {
    candidateSha: f.receipt.candidateSha,
    runId: '100',
    runAttempt: 1,
    artifactId: '200',
    archiveSha256: f.artifact.digest.slice(7),
    receiptSha256: sha256(jsonBytes(f.receipt)),
  };
  assertEquivalentReuse(current, f.receipt);
  const candidateBuild = { ...f.build, sourceSha: current.candidateSha };
  assertReceiptMatches(
    current,
    f.descriptor,
    candidateBuild,
    '1'.repeat(64),
    now,
    policy,
  );
  for (const key of [
    'builtFromSha',
    'runtimeInputDigest',
    'servingRevision',
    'deployedAt',
  ]) {
    const changed = structuredClone(current);
    changed[key] =
      key === 'deployedAt'
        ? '2026-10-27T08:01:00Z'
        : key === 'servingRevision'
          ? 'other-revision'
          : '7'.repeat(key === 'builtFromSha' ? 40 : 64);
    assert.throws(() => assertEquivalentReuse(changed, f.receipt));
  }
});
test('owner validation requires owner-attributed current PR content, completed observed scenarios and matching deployed identity', () => {
  const f = evidenceFixture();
  assert.equal(
    assertOwnerValidation(f.pr, config, f.receipt, f.descriptor, now, policy)
      .ownerId,
    '7',
  );
  for (const mutate of [
    (f) => {
      f.pr.author.databaseId = 99;
    },
    (f) => {
      f.pr.lastEditedAt = '2026-10-27T08:50:00Z';
      f.pr.editor = { __typename: 'User', databaseId: 99 };
    },
    (f) => {
      f.pr.headRefOid = '9'.repeat(40);
    },
    (f) => {
      f.pr.body = 'Owner says approved';
    },
    (f) => {
      f.pr.body += '\n' + OWNER_START;
    },
    (f) => {
      f.validation.runtimeInputDigest = '9'.repeat(64);
      f.pr.body = f.ownerBody(f.validation);
    },
    (f) => {
      f.validation.servingRevision = 'another-revision';
      f.pr.body = f.ownerBody(f.validation);
    },
    (f) => {
      f.validation.testedAt = '2026-10-27T07:00:00Z';
      f.pr.body = f.ownerBody(f.validation);
    },
    (f) => {
      f.validation.scenarios.realGoogleSignIn.result = 'NOT_AFFECTED';
      f.pr.body = f.ownerBody(f.validation);
    },
    (f) => {
      f.validation.scenarios.mediaWithdrawal.observation = '';
      f.pr.body = f.ownerBody(f.validation);
    },
    (f) => {
      delete f.validation.scenarios.crossClientEditorial;
      f.pr.body = f.ownerBody(f.validation);
    },
    (f) => {
      f.validation.counterparts[0].applicationVersion = '0.2.0';
      f.pr.body = f.ownerBody(f.validation);
      f.receipt.counterparts = structuredClone(
        evidenceFixture().receipt.counterparts,
      );
    },
  ]) {
    const changed = evidenceFixture();
    mutate(changed);
    assert.throws(() =>
      assertOwnerValidation(
        changed.pr,
        config,
        changed.receipt,
        changed.descriptor,
        now,
        policy,
      ),
    );
  }
});
test('canonical artifact bundle binds file names, exact bytes and checksum manifest', () => {
  const f = evidenceFixture();
  const files = bundleFiles(f.receipt, f.descriptor);
  assert.equal(
    decodeBundle(files, policy).receiptSha256,
    sha256(jsonBytes(f.receipt)),
  );
  const broken = new Map(files);
  broken.set(
    'backend-staging-artifact.json',
    jsonBytes({ ...f.descriptor, sourceSha: '9'.repeat(40) }),
  );
  assert.throws(() => decodeBundle(broken, policy));
  const duplicate = new Map(files);
  duplicate.set(
    'staging-evidence.json',
    Buffer.from(
      canonical(f.receipt).replace(
        '"schemaVersion":1',
        '"schemaVersion":2,"schemaVersion":1',
      ) + '\n',
    ),
  );
  assert.throws(() => decodeBundle(duplicate, policy), /NONCANONICAL/);
  const extra = new Map(files);
  extra.set('.env', Buffer.from('SYNTHETIC=true'));
  assert.throws(() => decodeBundle(extra, policy));
});
test('ZIP decoder handles bounded stored/deflated entries and data descriptors without extracting paths', () => {
  const f = evidenceFixture();
  const files = bundleFiles(f.receipt, f.descriptor);
  for (const compressed of [true, false])
    for (const descriptors of [true, false]) {
      const archive = zip(files, { compressed, descriptors });
      assert.equal(
        decodeArchive(archive, sha256(archive), policy).receipt.candidateSha,
        f.receipt.candidateSha,
      );
    }
  const changed = Buffer.from(f.archive);
  changed[45] ^= 1;
  assert.throws(
    () => decodeArchive(changed, f.artifact.digest.slice(7), policy),
    /DIGEST/,
  );
  for (const mutate of [
    (b) => {
      b.writeUInt16LE(1, 6);
    },
    (b) => {
      b.writeUInt32LE(9, 14);
    },
    (b) => {
      b.writeUInt16LE(1, b.length - 22 + 4);
    },
    (b) => {
      b.writeUInt16LE(4, b.length - 22 + 10);
    },
    (b) => {
      b.writeUInt32LE(0xffffffff, b.length - 22 + 16);
    },
    (b) => {
      const start = b.readUInt32LE(b.length - 22 + 16);
      b.writeUInt32LE(0xa0000000, start + 38);
    },
    (b) => {
      const start = b.readUInt32LE(b.length - 22 + 16);
      b.writeUInt32LE(65537, start + 24);
    },
  ]) {
    const b = Buffer.from(f.archive);
    mutate(b);
    assert.throws(() => decodeArchive(b, sha256(b), policy));
  }
  const traversal = new Map(files);
  traversal.delete('SHA256SUMS');
  traversal.set('../SHA256SUMS', files.get('SHA256SUMS'));
  const archive = zip(traversal);
  assert.throws(() => decodeArchive(archive, sha256(archive), policy));
});
