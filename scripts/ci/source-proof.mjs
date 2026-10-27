import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertPromotion,
  classify,
  fail,
  gitText,
  prRoute,
  sha,
  validateRun,
} from './policy.mjs';
import { githubReader } from './github-api.mjs';

export async function proveMergedSource(root, env, event, config, read) {
  const policy = validateRun(root, env, event, config);
  const branch = env.GITHUB_REF?.slice('refs/heads/'.length);
  const workflow = branch === 'rc' ? 'staging.yml' : 'release.yml';
  if (
    env.GITHUB_EVENT_NAME !== 'push' ||
    !['main', 'rc'].includes(branch) ||
    env.GITHUB_REPOSITORY !== config.fullName ||
    env.GITHUB_REPOSITORY_ID !== config.repositoryId ||
    env.GITHUB_WORKFLOW_REF !==
      config.fullName +
        '/.github/workflows/' +
        workflow +
        '@refs/heads/' +
        branch
  )
    fail('UNTRUSTED_DELIVERY_WORKFLOW');
  const parents = gitText(root, [
    'show',
    '-s',
    '--format=%P',
    policy.sourceSha,
  ]).split(' ');
  if (parents.length !== 2 || parents[0] !== policy.baseSha)
    fail('DELIVERY_REQUIRES_REVIEWED_SINGLE_MERGE');
  const candidates = await read(
    '/commits/' + policy.sourceSha + '/pulls?per_page=100',
  );
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    candidates.length >= 100 ||
    candidates.length > 20
  )
    fail('MERGED_PR_ASSOCIATION_UNAVAILABLE');
  const matching = [];
  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.number) || candidate.number < 1)
      fail('INVALID_PR_ASSOCIATION');
    const pr = await read('/pulls/' + candidate.number);
    if (
      pr.merge_commit_sha !== policy.sourceSha ||
      pr.merged !== true ||
      pr.state !== 'closed' ||
      !pr.merged_at
    )
      continue;
    const route = prRoute(pr, event.repository);
    if (pr.base.ref !== branch) continue;
    if (
      pr.draft !== false ||
      pr.auto_merge != null ||
      String(pr.merged_by?.id) !== config.ownerId
    )
      fail('OWNER_MANUAL_MERGE_REQUIRED');
    if (sha(pr.head.sha) !== parents[1]) fail('MERGED_PR_HEAD_DISAGREES');
    // The first Git parent is authoritative even if GitHub's current base ref has moved.
    if (branch === 'main' && !route.promotion) fail('MAIN_PROMOTION_REQUIRED');
    if (branch === 'rc' && route.promotion) fail('RC_WORK_OR_SYNC_REQUIRED');
    if (branch === 'main')
      assertPromotion(
        root,
        parents[0],
        parents[1],
        policy.sourceSha,
        classify(root, parents[0], policy.sourceSha),
        config,
      );
    matching.push({
      number: candidate.number,
      headSha: parents[1],
      baseSha: parents[0],
      route: route.route,
      promotion: route.promotion,
    });
  }
  if (matching.length !== 1) fail('MERGED_PR_ASSOCIATION_AMBIGUOUS');
  return {
    schemaVersion: 1,
    status: 'PASSED',
    sourceSha: policy.sourceSha,
    branch,
    repositoryId: config.repositoryId,
    ...matching[0],
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const event = JSON.parse(
      await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
    );
    const config = JSON.parse(await readFile('config/repository.json', 'utf8'));
    const proof = await proveMergedSource(
      process.cwd(),
      process.env,
      event,
      config,
      githubReader(config, process.env.GITHUB_TOKEN),
    );
    await mkdir('.local/ci', { recursive: true });
    await writeFile(
      '.local/ci/source-proof.json',
      JSON.stringify(proof, null, 2) + '\n',
    );
    console.log(JSON.stringify(proof));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'source_proof_failed',
        code:
          typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code)
            ? error.code
            : 'INVALID_SOURCE_PROOF',
      }),
    );
    process.exitCode = 1;
  }
}
