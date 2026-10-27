import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyStagingEvidence } from '../../scripts/ci/evidence/verify.mjs';
import { expectedCandidateInputs } from '../../scripts/ci/evidence/inputs.mjs';
import { assertOwnerValidation } from '../../scripts/ci/evidence/owner-validation.mjs';
import { bundleFiles, jsonBytes } from '../../scripts/ci/evidence/bundle.mjs';
import { sha256 } from '../../scripts/ci/evidence/model.mjs';
import { evidenceArtifactName } from '../../scripts/ci/evidence/github-proof.mjs';
import {
  config,
  evidenceFixture,
  now,
  policy,
  configuration,
  zip,
} from './evidence-fixtures.mjs';
import { fixture } from './fixtures.mjs';

function context(f) {
  const calls = [];
  const read = async (path) => {
    calls.push(path);
    if (path === '/git/ref/heads/rc')
      return {
        ref: 'refs/heads/rc',
        object: { type: 'commit', sha: f.build.sourceSha },
      };
    if (path.startsWith('/actions/workflows/'))
      return { total_count: 1, workflow_runs: [f.run] };
    if (path === '/actions/runs/100') return f.run;
    if (path === '/actions/runs/100/artifacts?per_page=100')
      return { total_count: 1, artifacts: [f.artifact] };
    if (path === '/actions/artifacts/200') return f.artifact;
    if (path === '/actions/runs/100/attempts/1/jobs?per_page=100')
      return f.jobs;
    throw Error('Unexpected fixed endpoint');
  };
  return {
    root: '.',
    candidateSha: f.build.sourceSha,
    profile: configuration,
    config,
    policy,
    now,
    read,
    calls,
    downloadArchive: async () => f.archive,
    readLive: async () => f.live,
    readOwner: async () => f.pr,
    promotionNumber: 9,
    expectations: async () => ({
      build: f.build,
      migrationDigest: f.receipt.schemaVerification.migrationDigest,
    }),
  };
}
test('complete evidence flow validates current RC before and after artifact/live/owner checks', async () => {
  const f = evidenceFixture();
  const options = context(f);
  const result = await verifyStagingEvidence(options);
  assert.equal(result.result, 'PASSED');
  assert.equal(result.staging.receiptSha256, sha256(jsonBytes(f.receipt)));
  assert.equal(options.calls[0], '/git/ref/heads/rc');
  assert.equal(options.calls.at(-1), '/git/ref/heads/rc');
});
test('evidence must remain fresh at completion after slow remote reads', async () => {
  for (const type of [
    'artifact-expired',
    'receipt-expired',
    'live-stale',
    'fresh',
  ]) {
    const f = evidenceFixture();
    const options = context(f);
    let at = now;
    options.now = () => at;
    options.readOwner = async () => {
      at += type === 'receipt-expired' ? 86400000 : 120000;
      return f.pr;
    };
    if (type === 'artifact-expired')
      f.artifact.expires_at = new Date(now + 60000).toISOString();
    if (type === 'fresh')
      options.readOwner = async () => {
        at += 30000;
        return f.pr;
      };
    if (type === 'fresh') {
      const result = await verifyStagingEvidence(options);
      assert.equal(result.verifiedAt, new Date(at).toISOString());
    } else {
      await assert.rejects(verifyStagingEvidence(options), {
        code:
          type === 'artifact-expired'
            ? 'STAGING_ARTIFACT_UNAVAILABLE'
            : 'EVIDENCE_EXPIRED_OR_FUTURE',
      });
    }
  }
});
test('unavailable evidence, ambiguity, source movement and absent owner validation fail closed', async () => {
  for (const type of [
    'missing-run',
    'ambiguous-run',
    'expired-artifact',
    'bad-archive',
    'rc-advanced',
    'missing-manual',
  ]) {
    const f = evidenceFixture();
    const options = context(f);
    const read = options.read;
    if (type === 'missing-run')
      options.read = async (path) =>
        path.startsWith('/actions/workflows/')
          ? { total_count: 0, workflow_runs: [] }
          : read(path);
    if (type === 'ambiguous-run')
      options.read = async (path) =>
        path.startsWith('/actions/workflows/')
          ? { total_count: 2, workflow_runs: [f.run, f.run] }
          : read(path);
    if (type === 'expired-artifact') f.artifact.expired = true;
    if (type === 'bad-archive')
      options.downloadArchive = async () =>
        Buffer.from('Not the original archive');
    if (type === 'rc-advanced') {
      let refs = 0;
      options.read = async (path) =>
        path === '/git/ref/heads/rc' && ++refs > 1
          ? {
              ref: 'refs/heads/rc',
              object: { type: 'commit', sha: '9'.repeat(40) },
            }
          : read(path);
    }
    if (type === 'missing-manual') f.pr.body = 'No manual evidence recorded.';
    await assert.rejects(verifyStagingEvidence(options), type);
  }
});
test('candidate expectations use immutable Git blobs and share the build manifest docs exclusion', async (t) => {
  const f = await fixture(t, '0.1.0');
  await f.write(
    'prisma/migrations/20261027_fixture/migration.sql',
    'SELECT 1;\n',
  );
  const before = f.commit();
  const first = await expectedCandidateInputs(f.root, before, configuration);
  await f.write('docs/guide.md', '# Documentation\n');
  const docs = f.commit();
  const second = await expectedCandidateInputs(f.root, docs, configuration);
  assert.equal(first.build.runtimeInputDigest, second.build.runtimeInputDigest);
  assert.notEqual(first.build.sourceSha, second.build.sourceSha);
  await f.write(
    'prisma/migrations/20261027_fixture/migration.sql',
    'SELECT 2;\n',
  );
  const changed = f.commit();
  const next = await expectedCandidateInputs(f.root, changed, configuration);
  assert.notEqual(
    next.build.runtimeInputDigest,
    second.build.runtimeInputDigest,
  );
  assert.notEqual(next.migrationDigest, second.migrationDigest);
});
test('manual evidence may retain its actual tested SHA through more than one verified docs-only receipt', () => {
  const f = evidenceFixture();
  const reference = {
    candidateSha: f.receipt.candidateSha,
    runId: '100',
    runAttempt: 1,
    artifactId: '200',
    archiveSha256: f.artifact.digest.slice(7),
    receiptSha256: sha256(jsonBytes(f.receipt)),
  };
  const current = structuredClone(f.receipt);
  current.mode = 'EQUIVALENT_REUSE';
  current.candidateSha = '9'.repeat(40);
  current.workflowRunId = '102';
  current.supersedes = {
    ...reference,
    candidateSha: '8'.repeat(40),
    runId: '101',
    artifactId: '201',
  };
  const validation = structuredClone(f.validation);
  validation.candidateSha = current.candidateSha;
  validation.carriedForward = reference;
  const pr = {
    ...f.pr,
    headRefOid: current.candidateSha,
    body: f.ownerBody(validation),
  };
  const tree = {
    receipt: current,
    previous: {
      receipt: { ...f.receipt, candidateSha: '8'.repeat(40) },
      reference: current.supersedes,
      previous: { receipt: f.receipt, reference, previous: null },
    },
  };
  assert.equal(
    assertOwnerValidation(pr, config, current, f.descriptor, now, policy, tree)
      .testedCandidateSha,
    f.receipt.candidateSha,
  );
  assert.throws(() =>
    assertOwnerValidation(pr, config, current, f.descriptor, now, policy),
  );
  tree.previous.previous.reference = {
    ...reference,
    archiveSha256: '0'.repeat(64),
  };
  assert.throws(() =>
    assertOwnerValidation(pr, config, current, f.descriptor, now, policy, tree),
  );
});
test('verified docs reuse walks actual Git ancestry and authenticates historical archives before carrying manual evidence', async (t) => {
  const repo = await fixture(t, '0.1.0');
  await repo.write(
    'prisma/migrations/20261027_fixture/migration.sql',
    'SELECT 1;\n',
  );
  const firstSha = repo.commit();
  await repo.write('docs/one.md', '# First guide\n');
  const middleSha = repo.commit();
  await repo.write('docs/two.md', '# Second guide\n');
  const currentSha = repo.commit();
  const firstInputs = await expectedCandidateInputs(
    repo.root,
    firstSha,
    configuration,
  );
  const f = evidenceFixture();
  Object.assign(f.descriptor, {
    sourceSha: firstSha,
    runtimeInputDigest: firstInputs.build.runtimeInputDigest,
    sourceInputDigest: firstInputs.build.sourceInputDigest,
    contractSha256: firstInputs.build.contractSha256,
  });
  const records = new Map();
  let previous = null;
  for (const [index, sourceSha] of [
    firstSha,
    middleSha,
    currentSha,
  ].entries()) {
    const day = 25 + index;
    const runId = String(100 + index);
    const artifactId = String(200 + index);
    const receipt = structuredClone(f.receipt);
    Object.assign(receipt, {
      candidateSha: sourceSha,
      builtFromSha: firstSha,
      runtimeInputDigest: firstInputs.build.runtimeInputDigest,
      sourceInputDigest: firstInputs.build.sourceInputDigest,
      contractSha256: firstInputs.build.contractSha256,
      mode: index ? 'EQUIVALENT_REUSE' : 'DEPLOYED',
      workflowRunId: runId,
      deployedAt: '2026-10-25T08:00:00Z',
      verifiedAt: '2026-10-' + day + 'T08:30:00Z',
      supersedes: previous?.reference ?? null,
    });
    receipt.schemaVerification.migrationDigest = firstInputs.migrationDigest;
    receipt.schemaVerification.verifiedAt = '2026-10-' + day + 'T08:20:00Z';
    receipt.counterparts.forEach((c) => {
      c.contractSha256 = receipt.contractSha256;
    });
    receipt.artifact = {
      filename: 'backend-staging-artifact.json',
      size: jsonBytes(f.descriptor).length,
      sha256: sha256(jsonBytes(f.descriptor)),
    };
    const archive = zip(bundleFiles(receipt, f.descriptor));
    const run = {
      ...f.run,
      id: Number(runId),
      head_sha: sourceSha,
      created_at: '2026-10-' + day + 'T07:50:00Z',
      run_started_at: '2026-10-' + day + 'T07:50:01Z',
      updated_at: '2026-10-' + day + 'T08:31:00Z',
      html_url: 'https://github.com/fixture/backend/actions/runs/' + runId,
    };
    const jobs = structuredClone(f.jobs);
    jobs.jobs.forEach((job) => {
      job.run_id = Number(runId);
      job.head_sha = sourceSha;
    });
    const artifact = {
      ...f.artifact,
      id: Number(artifactId),
      name: evidenceArtifactName(sourceSha, runId, 1),
      digest: 'sha256:' + sha256(archive),
      size_in_bytes: archive.length,
      created_at: '2026-10-' + day + 'T08:30:30Z',
      workflow_run: {
        ...f.artifact.workflow_run,
        id: Number(runId),
        head_sha: sourceSha,
      },
    };
    const reference = {
      candidateSha: sourceSha,
      runId,
      runAttempt: 1,
      artifactId,
      archiveSha256: sha256(archive),
      receiptSha256: sha256(jsonBytes(receipt)),
    };
    previous = { receipt, archive, run, jobs, artifact, reference };
    records.set(runId, previous);
  }
  const current = records.get('102');
  const original = records.get('100');
  const validation = {
    ...f.validation,
    candidateSha: currentSha,
    testedCandidateSha: firstSha,
    testedAt: '2026-10-25T08:40:00Z',
    runtimeInputDigest: firstInputs.build.runtimeInputDigest,
    contractSha256: firstInputs.build.contractSha256,
    counterparts: current.receipt.counterparts,
    carriedForward: original.reference,
  };
  const options = {
    root: repo.root,
    candidateSha: currentSha,
    profile: configuration,
    config,
    policy,
    now,
    promotionNumber: 9,
    read: async (path) => {
      if (path === '/git/ref/heads/rc')
        return {
          ref: 'refs/heads/rc',
          object: { type: 'commit', sha: currentSha },
        };
      if (path.startsWith('/actions/workflows/'))
        return { total_count: 1, workflow_runs: [current.run] };
      const run = path.match(/^\/actions\/runs\/(\d+)/)?.[1];
      if (run) {
        const entry = records.get(run);
        return path.includes('/jobs?')
          ? entry.jobs
          : path.includes('/artifacts?')
            ? { total_count: 1, artifacts: [entry.artifact] }
            : entry.run;
      }
      const artifactId = path.match(/^\/actions\/artifacts\/(\d+)$/)?.[1];
      if (artifactId)
        return [...records.values()].find(
          (entry) => String(entry.artifact.id) === artifactId,
        ).artifact;
      throw Error('Unexpected evidence endpoint');
    },
    downloadArchive: async (artifactId) =>
      [...records.values()].find(
        (entry) => String(entry.artifact.id) === artifactId,
      ).archive,
    readLive: async () => ({
      ...f.live,
      metadata: {
        ...f.live.metadata,
        buildSha: firstSha,
        deployment: {
          ...f.live.metadata.deployment,
          runtimeInputDigest: firstInputs.build.runtimeInputDigest,
        },
      },
    }),
    readOwner: async () => ({
      ...f.pr,
      headRefOid: currentSha,
      body: f.ownerBody(validation),
    }),
  };
  const verified = await verifyStagingEvidence(options);
  assert.equal(verified.mode, 'EQUIVALENT_REUSE');
  assert.equal(verified.builtFromSha, firstSha);
  assert.equal(verified.manual.testedCandidateSha, firstSha);
  records.get('101').artifact.expired = true;
  await assert.rejects(
    verifyStagingEvidence(options),
    /STAGING_ARTIFACT_UNAVAILABLE/,
  );
});
