import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { refuse } from './rollout-client.mjs';

const SHA = /^[a-f0-9]{40}$/;
const IMAGE = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-z][a-z0-9-]{0,62}$/;

// The caller must independently authenticate a complete, fresh snapshot of
// successful deployment records and the actual positive-traffic revisions.
// This evaluator is not a provider collector or authorization by itself.
export function evaluateDeploymentAncestry(root, snapshot) {
  if (
    !snapshot ||
    snapshot.schemaVersion !== 1 ||
    !['staging', 'production'].includes(snapshot.environment) ||
    typeof snapshot.projectId !== 'string' ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(snapshot.projectId) ||
    snapshot.region !== 'asia-southeast2' ||
    snapshot.serviceId !== 'blogpost-api' ||
    !SHA.test(snapshot.candidate?.sourceSha ?? '') ||
    !IMAGE.test(snapshot.candidate?.imageDigest ?? '') ||
    !Array.isArray(snapshot.successful) ||
    snapshot.successful.length > 500 ||
    !Array.isArray(snapshot.serving) ||
    snapshot.serving.length < 1 ||
    snapshot.serving.length > 40
  )
    refuse('ANCESTRY_INPUT_INVALID');
  const scope = (entry) =>
    entry &&
    entry.environment === snapshot.environment &&
    entry.projectId === snapshot.projectId &&
    entry.region === snapshot.region &&
    entry.serviceId === snapshot.serviceId &&
    SHA.test(entry.sourceSha ?? '') &&
    IMAGE.test(entry.imageDigest ?? '') &&
    REVISION.test(entry.revision ?? '');
  if (
    snapshot.successful.some(
      (entry) => !scope(entry) || entry.status !== 'succeeded',
    ) ||
    snapshot.serving.some(
      (entry) =>
        !scope(entry) ||
        !Number.isInteger(entry.percent) ||
        entry.percent <= 0 ||
        entry.percent > 100,
    ) ||
    snapshot.serving.reduce((sum, entry) => sum + entry.percent, 0) !== 100 ||
    new Set(snapshot.serving.map((entry) => entry.revision)).size !==
      snapshot.serving.length
  )
    refuse('ANCESTRY_SNAPSHOT_INVALID');
  const bindings = new Map();
  const sourceImages = new Map([
    [snapshot.candidate.sourceSha, snapshot.candidate.imageDigest],
  ]);
  for (const entry of [...snapshot.successful, ...snapshot.serving]) {
    const binding = entry.sourceSha + ':' + entry.imageDigest;
    if (
      bindings.has(entry.revision) &&
      bindings.get(entry.revision) !== binding
    )
      refuse('ANCESTRY_REVISION_CONFLICT');
    bindings.set(entry.revision, binding);
    if (
      sourceImages.has(entry.sourceSha) &&
      sourceImages.get(entry.sourceSha) !== entry.imageDigest
    )
      refuse('ANCESTRY_IMAGE_CONFLICT');
    sourceImages.set(entry.sourceSha, entry.imageDigest);
  }
  const env = {
    ...process.env,
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_SHALLOW_FILE',
    'GIT_REPLACE_REF_BASE',
    'GIT_CONFIG_COUNT',
  ])
    delete env[key];
  const deadline = performance.now() + 30000;
  const git = (args, input) => {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) refuse('ANCESTRY_GIT_UNAVAILABLE');
    const result = spawnSync(
      'git',
      ['--no-replace-objects', '-C', root, ...args],
      {
        env,
        encoding: 'utf8',
        input,
        timeout: Math.min(5000, remaining),
        maxBuffer: 65536,
        windowsHide: true,
      },
    );
    if (
      result.error ||
      result.signal ||
      performance.now() > deadline ||
      ![0, 1].includes(result.status)
    )
      refuse('ANCESTRY_GIT_UNAVAILABLE');
    return result;
  };
  const shallow = git(['rev-parse', '--is-shallow-repository']);
  if (shallow.status !== 0 || shallow.stdout.trim() !== 'false')
    refuse('ANCESTRY_INCOMPLETE_HISTORY');
  const graft = git(['rev-parse', '--git-path', 'info/grafts']);
  if (graft.status !== 0) refuse('ANCESTRY_GIT_UNAVAILABLE');
  const graftPath = graft.stdout.trim();
  if (!graftPath) refuse('ANCESTRY_GIT_UNAVAILABLE');
  try {
    lstatSync(isAbsolute(graftPath) ? graftPath : resolve(root, graftPath));
    refuse('ANCESTRY_INCOMPLETE_HISTORY');
  } catch (error) {
    if (error.code !== 'ENOENT') refuse('ANCESTRY_INCOMPLETE_HISTORY');
  }
  const sources = [
    ...new Set([
      snapshot.candidate.sourceSha,
      ...snapshot.successful.map((entry) => entry.sourceSha),
      ...snapshot.serving.map((entry) => entry.sourceSha),
    ]),
  ];
  for (const source of sources) {
    const result = git(
      ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
      source + '\n',
    );
    if (result.status !== 0 || result.stdout.trim() !== source + ' commit')
      refuse('ANCESTRY_COMMIT_UNAVAILABLE');
  }
  let stale = false;
  for (const source of sources) {
    if (source === snapshot.candidate.sourceSha) continue;
    const candidateIsAncestor =
      git(['merge-base', '--is-ancestor', snapshot.candidate.sourceSha, source])
        .status === 0;
    const sourceIsAncestor =
      git(['merge-base', '--is-ancestor', source, snapshot.candidate.sourceSha])
        .status === 0;
    if (candidateIsAncestor === sourceIsAncestor)
      refuse('ANCESTRY_UNRELATED_OR_AMBIGUOUS');
    if (candidateIsAncestor) stale = true;
  }
  return {
    schemaVersion: 1,
    decision: stale ? 'skipped_stale' : 'eligible',
    candidateSha: snapshot.candidate.sourceSha,
    comparedSources: sources.length,
    evidenceAuthority: 'caller-supplied-unverified',
  };
}
