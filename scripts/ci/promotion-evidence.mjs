import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { githubReader } from './github-api.mjs';
import { fail, jsonAt, validateRun } from './policy.mjs';
import {
  readArtifactArchive,
  readOwnerPullRequest,
  readPublicStaging,
} from './evidence/network.mjs';
import { verifyStagingEvidence } from './evidence/verify.mjs';

try {
  const config = JSON.parse(await readFile('config/repository.json', 'utf8'));
  const policy = JSON.parse(
    await readFile('config/ci/evidence-policy.json', 'utf8'),
  );
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'),
  );
  const source = validateRun(process.cwd(), process.env, event, config);
  if (
    !source.promotion ||
    process.env.GITHUB_EVENT_NAME !== 'pull_request' ||
    process.env.GITHUB_REPOSITORY !== config.fullName ||
    process.env.GITHUB_REPOSITORY_ID !== config.repositoryId ||
    String(event.repository.owner?.id) !== config.ownerId
  )
    fail('ORIGINAL_REPOSITORY_PROMOTION_REQUIRED');
  let profile;
  try {
    profile = jsonAt(
      process.cwd(),
      source.headSha,
      'config/environments/staging.json',
    );
  } catch {
    fail('REVIEWED_STAGING_PROFILE_REQUIRED');
  }
  const token = process.env.GITHUB_TOKEN;
  const result = await verifyStagingEvidence({
    root: process.cwd(),
    candidateSha: source.headSha,
    profile,
    config,
    policy,
    read: githubReader(config, token),
    downloadArchive: (artifactId) =>
      readArtifactArchive(config, artifactId, token, policy),
    readLive: readPublicStaging,
    readOwner: (number) => readOwnerPullRequest(config, number, token),
    promotionNumber: event.number,
  });
  await mkdir('.local/ci', { recursive: true });
  await writeFile(
    '.local/ci/promotion-evidence.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(
    JSON.stringify({
      event: 'promotion_evidence_failed',
      code:
        typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code)
          ? error.code
          : 'INVALID_PROMOTION_EVIDENCE',
    }),
  );
  process.exitCode = 1;
}
