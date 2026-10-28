import { canonical, digest } from '../../src/platform/config/build-model.ts';
import { currentBranchSha, githubReader } from '../ci/github-api.mjs';
import { proveReviewedMerge } from '../ci/source-proof.mjs';
import { fail, gitText } from '../ci/policy.mjs';
import { uniqueJson } from '../ci/evidence/unique-json.mjs';
import { cloudBuildTime, inspectCompletedCloudBuild } from './context.mjs';
import { recoveryResultInputs } from './result-inputs.mjs';
import {
  completedContext,
  completedResultProof,
  completedBuildImages,
  provenanceListUrl,
  registryPrefix,
} from './result-model.mjs';
import {
  provenanceKeyNames,
  verifySignedBuildOccurrence,
} from './provenance.mjs';

const liveResults = new WeakMap();
function occurrences(observations) {
  if (
    !Array.isArray(observations.occurrencePages) ||
    observations.occurrencePages.length !== 2 ||
    observations.occurrencePages.some(
      (page) =>
        !page ||
        page.nextPageToken ||
        !Array.isArray(page.occurrences) ||
        page.occurrences.length !== 1,
    )
  )
    fail('UNAMBIGUOUS_BUILD_PROVENANCE_REQUIRED');
  return observations.occurrencePages.map((page) => page.occurrences[0]);
}
export function verifyRecoveryResult(inputs, observations, now = Date.now()) {
  if (
    !observations ||
    typeof observations !== 'object' ||
    Array.isArray(observations) ||
    canonical(Object.keys(observations).sort()) !==
      canonical(
        [
          'project',
          'build',
          'trigger',
          'repository',
          'registry',
          'images',
          'occurrencePages',
          'keys',
        ].sort(),
      )
  )
    fail('INVALID_RECOVERY_RESULT_OBSERVATIONS');
  const context = completedContext({ ...observations, ...inputs, now });
  const signed = occurrences(observations);
  const provenance = signed.map((occurrence, index) =>
    verifySignedBuildOccurrence({
      occurrence,
      keys: observations.keys,
      context,
      image: context.images[index],
      build: observations.build,
      now,
    }),
  );
  return completedResultProof(context, provenance, inputs.expected.build);
}
async function googleJson(url, accessToken, transport) {
  // URLs originate only from validated routing and fixed Google resource names.
  try {
    const response = await transport(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json',
      },
    });
    if (
      response.status !== 200 ||
      response.redirected ||
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers.get('content-type') ?? '',
      )
    )
      fail('RECOVERY_RESULT_READ_FAILED');
    const reader = response.body?.getReader();
    if (!reader) fail('RECOVERY_RESULT_READ_FAILED');
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2097152) fail('RECOVERY_RESULT_READ_FAILED');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return uniqueJson(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    fail('RECOVERY_RESULT_READ_FAILED');
  }
}
async function observe(inputs, get, now) {
  const { plan, request, projects, sourceSha } = inputs;
  const project = await get(
    'https://cloudresourcemanager.googleapis.com/v1/projects/' + plan.projectId,
  );
  const build = await get(
    'https://cloudbuild.googleapis.com/v1/projects/' +
      plan.projectId +
      '/locations/' +
      plan.region +
      '/builds/' +
      plan.buildId,
  );
  const refs = inspectCompletedCloudBuild(request, projects, build, now());
  const result = completedBuildImages(
    request,
    projects,
    build,
    sourceSha,
    now(),
  );
  const [trigger, repository, registry, images, occurrencePages] =
    await Promise.all([
      get('https://cloudbuild.googleapis.com/v1/' + refs.triggerName),
      get('https://cloudbuild.googleapis.com/v2/' + refs.connectedRepository),
      get('https://artifactregistry.googleapis.com/v1/' + registryPrefix(plan)),
      Promise.all(
        result.images.map((image) =>
          get(
            'https://artifactregistry.googleapis.com/v1/' +
              registryPrefix(plan) +
              '/dockerImages/' +
              encodeURIComponent(image.name + '@' + image.digest),
          ),
        ),
      ),
      Promise.all(
        result.images.map((image) =>
          get(provenanceListUrl(plan, refs.buildName, image)),
        ),
      ),
    ]);
  const observations = {
    project,
    build,
    trigger,
    repository,
    registry,
    images,
    occurrencePages,
  };
  const names = [
    ...new Set(
      occurrences(observations).flatMap((occurrence) =>
        provenanceKeyNames(occurrence.envelope),
      ),
    ),
  ];
  if (names.length > 4) fail('TOO_MANY_GOOGLE_BUILD_PUBLIC_KEYS');
  // provenanceKeyNames accepts only the Google-owned verified-builder KMS namespace.
  observations.keys = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        name,
        await get('https://cloudkms.googleapis.com/v1/' + name + '/publicKey'),
      ]),
    ),
  );
  return observations;
}
export async function verifyLiveRecoveryResult({
  root,
  request,
  sourceSha,
  accessToken,
  transport = fetch,
  githubTransport = fetch,
  now = Date.now,
}) {
  if (
    typeof accessToken !== 'string' ||
    /^[A-Za-z0-9._~+/=-]{1,4096}$/.exec(accessToken)?.[0] !== accessToken
  )
    fail('INVALID_RECOVERY_RESULT_CREDENTIAL');
  const clock = typeof now === 'function' ? now : () => now;
  const started = clock();
  const inputs = await recoveryResultInputs(root, request, sourceSha);
  const { plan, repositoryConfig } = inputs;
  const assertVerifier = () => {
    if (
      gitText(root, ['rev-parse', 'HEAD']) !== inputs.head ||
      gitText(root, ['status', '--porcelain', '--untracked-files=all'])
    )
      fail('RESULT_VERIFIER_CHECKOUT_CHANGED');
    if (
      ![
        'https://github.com/' + repositoryConfig.fullName,
        'https://github.com/' + repositoryConfig.fullName + '.git',
      ].includes(gitText(root, ['config', '--get', 'remote.origin.url']))
    )
      fail('RESULT_GIT_ORIGIN_DISAGREES');
  };
  assertVerifier();
  // The Google token is never passed to GitHub; this repository is public.
  const read = githubReader(repositoryConfig, null, githubTransport);
  const current = await currentBranchSha(read, plan.branch);
  if (gitText(root, ['merge-base', sourceSha, current]) !== sourceSha)
    fail('RESULT_SOURCE_NOT_ON_AUTHORIZED_BRANCH');
  const parents = gitText(root, ['show', '-s', '--format=%P', sourceSha]).split(
    ' ',
  );
  if (parents.length !== 2) fail('DELIVERY_REQUIRES_REVIEWED_SINGLE_MERGE');
  const reviewedSource = await proveReviewedMerge(
    root,
    {
      branch: plan.branch,
      sourceSha,
      baseSha: parents[0],
    },
    repositoryConfig,
    read,
  );
  const get = (url) => googleJson(url, accessToken, transport);
  const first = await observe(inputs, get, clock);
  verifyRecoveryResult(inputs, first, clock());
  const last = await observe(inputs, get, clock);
  const verified = verifyRecoveryResult(inputs, last, clock());
  if (canonical(first) !== canonical(last))
    fail('RECOVERY_RESULT_OBSERVATIONS_CHANGED');
  if ((await currentBranchSha(read, plan.branch)) !== current)
    fail('RECOVERY_RESULT_AUTHORIZED_BRANCH_ADVANCED');
  assertVerifier();
  if (
    !Number.isFinite(clock()) ||
    clock() < started ||
    clock() - started > 120000
  )
    fail('RECOVERY_RESULT_OBSERVATIONS_EXPIRED');
  const proof = {
    ...verified,
    evidenceSource: 'live-api',
    reviewedSource,
    observedAt: new Date(clock()).toISOString(),
    images: verified.images.map((image) => ({
      ...image,
      provenance: { ...image.provenance, keyAuthority: 'live-google-kms' },
    })),
    limitations: [
      'Read-only live provider and signed provenance verification. Expected baked metadata is recomputed from Git, not read from the image filesystem. Does not establish human invocation, effective IAM, scanning/SBOM, schema compatibility, rollout or release/client acceptance; does not authorize deployment.',
    ],
  };
  liveResults.set(proof, digest(proof));
  return proof;
}
export function requireLiveRecoveryResult(proof, now = Date.now()) {
  if (
    !proof ||
    liveResults.get(proof) !== digest(proof) ||
    proof.evidenceSource !== 'live-api'
  )
    fail('AUTHENTICATED_RECOVERY_RESULT_REQUIRED');
  const observed = cloudBuildTime(proof.observedAt);
  if (
    !Number.isFinite(now) ||
    observed > now + 300000 ||
    observed < now - 60000
  )
    fail('RECOVERY_RESULT_PROOF_EXPIRED');
  return proof;
}
