import { canonical, digest } from '../../../src/platform/config/build-model.ts';
import { fail, sha } from '../policy.mjs';
import { uniqueJson } from './unique-json.mjs';
import {
  SCENARIOS,
  exact,
  evidencePolicy,
  fresh,
  hash,
  id,
  instant,
  receiptReference,
  text,
  validateReceipt,
} from './model.mjs';

export const OWNER_START = '<!-- blogpost-owner-validation:v1 -->';
export const OWNER_END = '<!-- /blogpost-owner-validation -->';
export function parseOwnerValidation(body) {
  if (
    typeof body !== 'string' ||
    Buffer.byteLength(body, 'utf8') > 65536 ||
    body.split(OWNER_START).length !== 2 ||
    body.split(OWNER_END).length !== 2
  )
    fail('OWNER_VALIDATION_SECTION_REQUIRED');
  const start = body.indexOf(OWNER_START) + OWNER_START.length;
  const end = body.indexOf(OWNER_END);
  if (end < start) fail('OWNER_VALIDATION_SECTION_REQUIRED');
  const content = body.slice(start, end).trim();
  const match = /^```json\r?\n([\s\S]+)\r?\n```$/.exec(content);
  if (!match) fail('INVALID_OWNER_VALIDATION_SECTION');
  let value;
  try {
    value = uniqueJson(match[1]);
  } catch {
    fail('INVALID_OWNER_VALIDATION_JSON');
  }
  exact(value, [
    'schemaVersion',
    'application',
    'candidateSha',
    'testedCandidateSha',
    'runtimeInputDigest',
    'configurationDigest',
    'artifactDigest',
    'servingRevision',
    'contractVersion',
    'contractSha256',
    'testedAt',
    'counterparts',
    'scenarios',
    'carriedForward',
  ]);
  if (value.schemaVersion !== 1 || value.application !== 'backend')
    fail('INVALID_OWNER_VALIDATION');
  sha(value.candidateSha);
  sha(value.testedCandidateSha);
  for (const key of [
    'runtimeInputDigest',
    'configurationDigest',
    'artifactDigest',
    'contractSha256',
  ])
    hash(value[key]);
  text(value.servingRevision, /^[a-z][a-z0-9-]{0,62}$/, 63);
  instant(value.testedAt);
  exact(value.scenarios, SCENARIOS);
  for (const name of SCENARIOS) {
    const scenario = exact(value.scenarios[name], ['result', 'observation']);
    if (!(
      scenario.result === 'PASSED' ||
      (['accessibility', 'upgradeContinuity'].includes(name) &&
        scenario.result === 'NOT_AFFECTED')
    ))
      fail('MANUAL_SCENARIO_INCOMPLETE');
    text(scenario.observation, /\S/, 1000, 'MANUAL_OBSERVATION_REQUIRED');
    if (scenario.observation.length < 20) fail('MANUAL_OBSERVATION_REQUIRED');
  }
  if (value.carriedForward !== null) receiptReference(value.carriedForward);
  return value;
}
export function assertOwnerValidation(
  pr,
  config,
  receipt,
  descriptor,
  now,
  policy,
  reuseTree = null,
) {
  receipt = validateReceipt(receipt);
  policy = evidencePolicy(policy);
  if (
    String(pr.repository?.databaseId) !== config.repositoryId ||
    pr.repository?.nameWithOwner !== config.fullName ||
    String(pr.repository.owner?.databaseId) !== config.ownerId ||
    String(pr.headRepository?.databaseId) !== config.repositoryId ||
    pr.baseRefName !== 'main' ||
    pr.headRefName !== 'rc' ||
    pr.headRefOid !== receipt.candidateSha ||
    !['OPEN', 'MERGED'].includes(pr.state)
  )
    fail('WRONG_PROMOTION_VALIDATION_SOURCE');
  const actor = pr.lastEditedAt ? pr.editor : pr.author;
  if (actor?.__typename !== 'User' || id(actor.databaseId) !== config.ownerId)
    fail('OWNER_BODY_ATTRIBUTION_REQUIRED');
  const bodyTime = instant(pr.lastEditedAt ?? pr.createdAt);
  const validation = parseOwnerValidation(pr.body);
  const testedAt = fresh(
    validation.testedAt,
    now,
    policy.manualMaxAgeSeconds,
    policy.clockSkewSeconds,
  );
  if (
    testedAt < instant(receipt.deployedAt) ||
    testedAt > bodyTime + policy.clockSkewSeconds * 1000 ||
    validation.candidateSha !== receipt.candidateSha ||
    validation.runtimeInputDigest !== receipt.runtimeInputDigest ||
    validation.configurationDigest !== receipt.configurationDigest ||
    validation.artifactDigest !== descriptor.apiImage.split('@sha256:')[1] ||
    validation.servingRevision !== receipt.servingRevision ||
    validation.contractVersion !== receipt.contractVersion ||
    validation.contractSha256 !== receipt.contractSha256 ||
    canonical(validation.counterparts) !== canonical(receipt.counterparts)
  )
    fail('MANUAL_VALIDATION_DOES_NOT_MATCH');
  if (validation.testedCandidateSha === receipt.candidateSha) {
    if (validation.carriedForward !== null)
      fail('UNEXPECTED_MANUAL_CARRY_FORWARD');
  } else {
    if (
      receipt.mode !== 'EQUIVALENT_REUSE' ||
      !validation.carriedForward ||
      reuseTree?.receipt.candidateSha !== receipt.candidateSha
    )
      fail('MANUAL_CARRY_FORWARD_UNPROVEN');
    let node = reuseTree.previous;
    let matched = false;
    let depth = 0;
    while (node) {
      if (++depth > policy.maxReuseDepth) fail('EVIDENCE_REUSE_DEPTH_EXCEEDED');
      if (
        node.receipt.candidateSha === validation.testedCandidateSha &&
        canonical(node.reference) === canonical(validation.carriedForward)
      )
        matched = true;
      node = node.previous;
    }
    if (!matched) fail('MANUAL_CARRY_FORWARD_UNPROVEN');
  }
  return {
    ownerId: config.ownerId,
    candidateSha: receipt.candidateSha,
    testedCandidateSha: validation.testedCandidateSha,
    testedAt: validation.testedAt,
    bodySha256: digest({
      body: pr.body,
      editorId: config.ownerId,
      editedAt: pr.lastEditedAt ?? pr.createdAt,
    }),
  };
}
