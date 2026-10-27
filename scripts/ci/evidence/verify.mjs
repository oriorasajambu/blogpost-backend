import { canonical } from '../../../src/platform/config/build-model.ts';
import { currentBranchSha } from '../github-api.mjs';
import { classify, fail, gitText, sha } from '../policy.mjs';
import { decodeArchive } from './bundle.mjs';
import {
  assertTrustedGithubEvidence,
  evidenceArtifactName,
} from './github-proof.mjs';
import { expectedCandidateInputs } from './inputs.mjs';
import {
  assertEquivalentReuse,
  assertLiveMetadata,
  assertReceiptMatches,
  evidencePolicy,
  id,
  receiptReference,
} from './model.mjs';
import { assertOwnerValidation } from './owner-validation.mjs';

export async function verifyStagingEvidence({
  root,
  candidateSha,
  profile,
  config,
  policy,
  read,
  downloadArchive,
  readLive,
  readOwner,
  promotionNumber,
  now = Date.now,
  requireCurrentRc = true,
  expectations = expectedCandidateInputs,
}) {
  sha(candidateSha);
  policy = evidencePolicy(policy);
  const clock = typeof now === 'function' ? now : () => now;
  const proofs = [];
  if (requireCurrentRc && (await currentBranchSha(read, 'rc')) !== candidateSha)
    fail('RC_CANDIDATE_ADVANCED');
  const runs = await read(
    '/actions/workflows/staging.yml/runs?branch=rc&event=push&head_sha=' +
      candidateSha +
      '&per_page=100',
  );
  if (
    !runs ||
    !Number.isSafeInteger(runs.total_count) ||
    runs.total_count < 1 ||
    runs.total_count > 100 ||
    !Array.isArray(runs.workflow_runs) ||
    runs.workflow_runs.length !== runs.total_count
  )
    fail('CURRENT_RC_STAGING_RUN_MISSING');
  const eligible = runs.workflow_runs.filter(
    (run) =>
      run.head_sha === candidateSha &&
      run.head_branch === 'rc' &&
      run.event === 'push' &&
      run.path === '.github/workflows/staging.yml',
  );
  if (eligible.length !== 1) fail('CURRENT_RC_STAGING_RUN_AMBIGUOUS');
  const visited = new Set();
  const load = async (runId, suppliedArtifactId, requiredReference, depth) => {
    if (depth >= policy.maxReuseDepth) fail('EVIDENCE_REUSE_DEPTH_EXCEEDED');
    runId = id(runId);
    if (visited.has(runId)) fail('EVIDENCE_REUSE_CYCLE');
    visited.add(runId);
    const run = await read('/actions/runs/' + runId);
    if (
      id(run.id) !== runId ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 1 ||
      run.status !== 'completed' ||
      run.conclusion !== 'success'
    )
      fail('STAGING_RUN_NOT_SUCCESSFUL');
    let artifactId = suppliedArtifactId;
    if (!artifactId) {
      const artifacts = await read(
        '/actions/runs/' + runId + '/artifacts?per_page=100',
      );
      if (
        !Number.isSafeInteger(artifacts?.total_count) ||
        artifacts.total_count > 100 ||
        !Array.isArray(artifacts.artifacts) ||
        artifacts.artifacts.length !== artifacts.total_count
      )
        fail('STAGING_ARTIFACT_LIST_INCOMPLETE');
      const matches = artifacts.artifacts.filter(
        (artifact) =>
          artifact.name ===
          evidenceArtifactName(run.head_sha, runId, run.run_attempt),
      );
      if (matches.length !== 1)
        fail('CURRENT_STAGING_RECEIPT_MISSING_OR_AMBIGUOUS');
      artifactId = id(matches[0].id);
    }
    const artifact = await read('/actions/artifacts/' + id(artifactId));
    if (id(artifact.id) !== id(artifactId))
      fail('STAGING_ARTIFACT_ID_DISAGREES');
    const archive = await downloadArchive(id(artifactId));
    if (!Buffer.isBuffer(archive) || archive.length !== artifact.size_in_bytes)
      fail('STAGING_ARCHIVE_SIZE_DISAGREES');
    const decoded = decodeArchive(
      archive,
      String(artifact.digest).slice(7),
      policy,
    );
    const { receipt, descriptor } = decoded;
    const jobs = await read(
      '/actions/runs/' +
        runId +
        '/attempts/' +
        run.run_attempt +
        '/jobs?per_page=100',
    );
    const proof = assertTrustedGithubEvidence(
      config,
      receipt,
      run,
      jobs,
      artifact,
      clock(),
      policy,
    );
    proofs.push({ receipt, run, jobs, artifact });
    const reference = { ...proof, receiptSha256: decoded.receiptSha256 };
    if (
      requiredReference &&
      canonical(reference) !== canonical(receiptReference(requiredReference))
    )
      fail('SUPERSEDED_ARTIFACT_REFERENCE_DISAGREES');
    const expected = await expectations(root, receipt.candidateSha, profile);
    assertReceiptMatches(
      receipt,
      descriptor,
      expected.build,
      expected.migrationDigest,
      clock(),
      policy,
      { historical: depth > 0 },
    );
    const node = { receipt, descriptor, reference, expected, previous: null };
    if (receipt.mode === 'EQUIVALENT_REUSE') {
      node.previous = await load(
        receipt.supersedes.runId,
        receipt.supersedes.artifactId,
        receipt.supersedes,
        depth + 1,
      );
      // Digest equality alone is insufficient: the change must also be an approved docs-only descendant.
      if (
        gitText(root, [
          'merge-base',
          receipt.supersedes.candidateSha,
          receipt.candidateSha,
        ]) !== receipt.supersedes.candidateSha ||
        !classify(root, receipt.supersedes.candidateSha, receipt.candidateSha)
          .docsOnly
      )
        fail('REUSE_CHANGE_IS_NOT_DOCUMENTATION_ONLY');
      assertEquivalentReuse(receipt, node.previous.receipt);
    }
    return node;
  };
  const current = await load(id(eligible[0].id), null, null, 0);
  if (current.receipt.candidateSha !== candidateSha)
    fail('CURRENT_RECEIPT_CANDIDATE_DISAGREES');
  const observation = await readLive(profile);
  const owner = await readOwner(promotionNumber);
  if (requireCurrentRc && (await currentBranchSha(read, 'rc')) !== candidateSha)
    fail('RC_CANDIDATE_ADVANCED');
  // Network and history reads can outlast an expiry boundary. Recheck every archived
  // reference and the current live/manual evidence against completion time.
  const completedAt = clock();
  for (const { receipt, run, jobs, artifact } of proofs)
    assertTrustedGithubEvidence(
      config,
      receipt,
      run,
      jobs,
      artifact,
      completedAt,
      policy,
    );
  assertReceiptMatches(
    current.receipt,
    current.descriptor,
    current.expected.build,
    current.expected.migrationDigest,
    completedAt,
    policy,
  );
  assertLiveMetadata(current.receipt, observation, completedAt, policy);
  const manual = assertOwnerValidation(
    owner,
    config,
    current.receipt,
    current.descriptor,
    completedAt,
    policy,
    current,
  );
  return {
    schemaVersion: 1,
    application: 'backend',
    candidateSha,
    mode: current.receipt.mode,
    builtFromSha: current.receipt.builtFromSha,
    runtimeInputDigest: current.receipt.runtimeInputDigest,
    configurationDigest: current.receipt.configurationDigest,
    artifactDigest: current.descriptor.apiImage,
    servingRevision: current.receipt.servingRevision,
    staging: current.reference,
    manual,
    verifiedAt: new Date(completedAt).toISOString(),
    result: 'PASSED',
  };
}
