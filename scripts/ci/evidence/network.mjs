import { normalizeCloudProfile } from '../../../src/platform/config/build-model.ts';
import { fail } from '../policy.mjs';
import { evidencePolicy, id } from './model.mjs';
import { uniqueJson } from './unique-json.mjs';
import {
  abortable,
  cancelQuietly,
  discardResponse,
} from '../../deploy/transport-deadline.mjs';

export async function boundedBody(response, limit, signal) {
  const reader = response.body?.getReader();
  if (!reader) fail('EVIDENCE_BODY_UNAVAILABLE');
  const chunks = [];
  let size = 0;
  const abort = () => cancelQuietly(reader);
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail('EVIDENCE_RESPONSE_LIMIT');
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener('abort', abort);
    cancelQuietly(reader);
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
function repository(config) {
  if (
    typeof config.fullName !== 'string' ||
    config.fullName.length > 200 ||
    config.fullName.trim() !== config.fullName ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.fullName) ||
    config.fullName.split('/').some((part) => part === '.' || part === '..')
  )
    fail('INVALID_GITHUB_REPOSITORY');
  return config.fullName.split('/');
}
const headers = (token) => ({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(token ? { Authorization: 'Bearer ' + token } : {}),
});
const options = () => ({
  redirect: 'error',
  credentials: 'omit',
  signal: AbortSignal.timeout(15000),
});
export async function readArtifactArchive(
  config,
  artifactId,
  token,
  policy,
  transport = fetch,
) {
  repository(config);
  id(artifactId);
  policy = evidencePolicy(policy);
  let response;
  let download;
  try {
    const requestOptions = options();
    response = await abortable(
      transport(
        'https://api.github.com/repos/' +
          config.fullName +
          '/actions/artifacts/' +
          artifactId +
          '/zip',
        {
          ...requestOptions,
          method: 'GET',
          redirect: 'manual',
          headers: headers(token),
        },
      ),
      requestOptions.signal,
      discardResponse,
    );
    if (response.status !== 302) fail('ARTIFACT_DOWNLOAD_UNAVAILABLE');
    const target = new URL(response.headers.get('location'));
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      target.port ||
      !(
        target.hostname === 'github.com' ||
        target.hostname.endsWith('.githubusercontent.com') ||
        /^[a-z0-9]+\.blob\.core\.windows\.net$/.test(target.hostname)
      )
    )
      fail('UNAPPROVED_ARTIFACT_LOCATION');
    // The signed storage URL never receives GitHub credentials, cookies or caller headers.
    const downloadOptions = options();
    download = await abortable(
      transport(target.href, {
        ...downloadOptions,
        method: 'GET',
      }),
      downloadOptions.signal,
      discardResponse,
    );
    if (!download.ok || download.redirected)
      fail('ARTIFACT_DOWNLOAD_UNAVAILABLE');
    return await boundedBody(
      download,
      policy.maxArchiveBytes,
      downloadOptions.signal,
    );
  } catch {
    fail('ARTIFACT_DOWNLOAD_UNAVAILABLE');
  } finally {
    discardResponse(response);
    discardResponse(download);
  }
}
export const OWNER_QUERY = `query BackendPromotionOwner($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    databaseId nameWithOwner owner { __typename ... on User { databaseId } ... on Organization { databaseId } }
    pullRequest(number: $number) {
      number state body baseRefName headRefName headRefOid lastEditedAt createdAt
      author { __typename ... on User { databaseId } }
      editor { __typename ... on User { databaseId } }
      headRepository { databaseId }
    }
  }
}`;
export async function readOwnerPullRequest(
  config,
  number,
  token,
  transport = fetch,
) {
  const [owner, name] = repository(config);
  if (!Number.isSafeInteger(number) || number < 1)
    fail('INVALID_PROMOTION_NUMBER');
  let response;
  try {
    const requestOptions = options();
    response = await abortable(
      transport('https://api.github.com/graphql', {
        ...requestOptions,
        method: 'POST',
        headers: { ...headers(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: OWNER_QUERY,
          variables: { owner, name, number },
        }),
      }),
      requestOptions.signal,
      discardResponse,
    );
    if (!response.ok || response.redirected)
      fail('OWNER_ATTRIBUTION_UNAVAILABLE');
    const value = uniqueJson(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await boundedBody(response, 131072, requestOptions.signal),
      ),
    );
    const repo = value.data?.repository;
    if (
      value.errors?.length ||
      !repo?.pullRequest ||
      repo.pullRequest.number !== number
    )
      fail('OWNER_ATTRIBUTION_UNAVAILABLE');
    return {
      ...repo.pullRequest,
      repository: {
        databaseId: repo.databaseId,
        nameWithOwner: repo.nameWithOwner,
        owner: repo.owner,
      },
    };
  } catch {
    fail('OWNER_ATTRIBUTION_UNAVAILABLE');
  } finally {
    discardResponse(response);
  }
}
export async function readPublicStaging(profile, transport = fetch) {
  profile = normalizeCloudProfile(profile);
  if (profile.environment !== 'staging') fail('STAGING_PROFILE_REQUIRED');
  const observation = { origin: profile.apiOrigin };
  try {
    for (const [key, path] of [
      ['liveStatus', '/health/live'],
      ['readyStatus', '/health/ready'],
      ['metadataStatus', '/v1/meta'],
    ]) {
      const requestOptions = options();
      let response;
      try {
        response = await abortable(
          transport(profile.apiOrigin + path, {
            ...requestOptions,
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'Cache-Control': 'no-cache',
              'X-Device-ID': '10000000-0000-4000-8000-000000000001',
              'X-Device-OS': 'WEB',
              'X-Device-Version': 'unknown',
              'X-App-Version': '0.0.0+staging-gate',
              'X-App-Language': 'en',
            },
          }),
          requestOptions.signal,
          discardResponse,
        );
        if (response.redirected) fail('STAGING_PUBLIC_PROBE_REDIRECTED');
        observation[key] = response.status;
        const bytes = await boundedBody(response, 65536, requestOptions.signal);
        if (response.status !== 200) fail('STAGING_PUBLIC_PROBE_FAILED');
        if (key === 'metadataStatus') {
          if (
            !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(
              response.headers.get('cache-control') ?? '',
            )
          )
            fail('STAGING_METADATA_CACHE_UNSAFE');
          const envelope = uniqueJson(
            new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          );
          if (
            envelope.statusCode !== 200 ||
            envelope.responseKey !== 'SUCCESS' ||
            !envelope.data
          )
            fail('STAGING_METADATA_ENVELOPE_INVALID');
          observation.metadata = envelope.data;
        }
      } finally {
        discardResponse(response);
      }
    }
    return { ...observation, observedAt: new Date().toISOString() };
  } catch {
    fail('STAGING_PUBLIC_PROBE_FAILED');
  }
}
