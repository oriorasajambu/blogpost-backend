import { sourceFacts } from '../build/inputs.mjs';
import { currentBranchSha } from '../ci/github-api.mjs';
import { proveReviewedMerge } from '../ci/source-proof.mjs';
import { fail, gitText } from '../ci/policy.mjs';
import { requireLiveCloudBuildContext } from './reader.mjs';

export async function proveCloudBuildSource({
  root,
  context,
  config,
  read,
  now = Date.now,
}) {
  const clock = typeof now === 'function' ? now : () => now;
  requireLiveCloudBuildContext(context, clock());
  if (
    context.repositoryFullName !== config.fullName ||
    context.repositoryId !== config.repositoryId ||
    context.ownerId !== config.ownerId
  )
    fail('CLOUD_BUILD_REVIEW_REPOSITORY_DISAGREES');
  const assertCheckout = () => {
    const facts = sourceFacts(root, context.environment, {});
    if (
      facts.sourceSha !== context.sourceSha ||
      facts.sourceRef !== context.sourceRef
    )
      fail('CLOUD_BUILD_CHECKOUT_DISAGREES');
    if (
      ![
        'https://github.com/' + config.fullName,
        'https://github.com/' + config.fullName + '.git',
      ].includes(gitText(root, ['config', '--get', 'remote.origin.url']))
    )
      fail('CLOUD_BUILD_GIT_ORIGIN_DISAGREES');
  };
  assertCheckout();
  const branch = context.sourceRef.slice('refs/heads/'.length);
  const current = await currentBranchSha(read, branch);
  if (
    gitText(root, ['merge-base', context.sourceSha, current]) !==
    context.sourceSha
  )
    fail('CLOUD_BUILD_SOURCE_NOT_ON_AUTHORIZED_BRANCH');
  const parents = gitText(root, [
    'show',
    '-s',
    '--format=%P',
    context.sourceSha,
  ]).split(' ');
  if (parents.length !== 2) fail('DELIVERY_REQUIRES_REVIEWED_SINGLE_MERGE');
  const proof = await proveReviewedMerge(
    root,
    { branch, sourceSha: context.sourceSha, baseSha: parents[0] },
    config,
    read,
  );
  if ((await currentBranchSha(read, branch)) !== current)
    fail('CLOUD_BUILD_AUTHORIZED_BRANCH_ADVANCED');
  assertCheckout();
  requireLiveCloudBuildContext(context, clock());
  return {
    ...proof,
    scope: 'cloud-build-reviewed-source',
    cloudBuild: context.observation.build.name,
    contextDigest: context.configurationDigest,
    observedAt: new Date(clock()).toISOString(),
  };
}
