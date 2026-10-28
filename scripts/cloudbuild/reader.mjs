import { canonical, digest } from '../../src/platform/config/build-model.ts';
import { fail } from '../ci/policy.mjs';
import {
  cloudBuildRepositoryName,
  cloudBuildRequest,
  cloudBuildTime,
  inspectCloudBuild,
  verifyCloudBuildContext,
} from './context.mjs';
import { verifyRecoveryRecipe } from './recipe.mjs';

const liveContexts = new WeakMap();
const metadata =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/';
async function read(
  url,
  {
    transport,
    accessToken,
    metadataRequest = false,
    text = false,
    limit = 1048576,
  },
) {
  try {
    const response = await transport(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000),
      headers: metadataRequest
        ? { 'Metadata-Flavor': 'Google' }
        : {
            Authorization: 'Bearer ' + accessToken,
            Accept: 'application/json',
          },
    });
    if (
      response.status !== 200 ||
      response.redirected ||
      (metadataRequest &&
        response.headers.get('metadata-flavor') !== 'Google') ||
      (!text &&
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get('content-type') ?? '',
        ))
    )
      fail('CLOUD_BUILD_READ_FAILED');
    const reader = response.body?.getReader();
    if (!reader) fail('CLOUD_BUILD_READ_FAILED');
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) fail('CLOUD_BUILD_READ_FAILED');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const value = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    return text ? value : JSON.parse(value);
  } catch {
    fail('CLOUD_BUILD_READ_FAILED');
  }
}
export async function verifyLiveCloudBuildContext({
  request,
  projects,
  repositoryConfig,
  transport = fetch,
  now = Date.now,
}) {
  const plan = cloudBuildRequest(request, projects),
    clock = typeof now === 'function' ? now : () => now;
  const metadataEmail = await read(metadata + 'email', {
    transport,
    metadataRequest: true,
    text: true,
    limit: 256,
  });
  if (metadataEmail !== plan.serviceAccount)
    fail('CLOUD_BUILD_METADATA_ACCOUNT_DISAGREES');
  const credential = await read(metadata + 'token', {
    transport,
    metadataRequest: true,
    limit: 16384,
  });
  if (
    typeof credential?.access_token !== 'string' ||
    credential.access_token.length > 4096 ||
    /^[A-Za-z0-9._~+/=-]{1,4096}$/.exec(credential.access_token)?.[0] !==
      credential.access_token ||
    credential.token_type !== 'Bearer' ||
    !Number.isSafeInteger(credential.expires_in) ||
    credential.expires_in < 60
  )
    fail('INVALID_CLOUD_BUILD_CREDENTIAL');
  const accessToken = credential.access_token;
  const get = (url) => read(url, { transport, accessToken });
  const project = await get(
    'https://cloudresourcemanager.googleapis.com/v1/projects/' + plan.projectId,
  );
  if (
    project?.projectId !== plan.projectId ||
    project.projectNumber !== plan.projectNumber ||
    project.lifecycleState !== 'ACTIVE'
  )
    fail('CLOUD_BUILD_PROJECT_IDENTITY_DISAGREES');
  const buildUrl =
    'https://cloudbuild.googleapis.com/v1/projects/' +
    plan.projectId +
    '/locations/' +
    plan.region +
    '/builds/' +
    plan.buildId;
  const build = await get(buildUrl);
  const refs = inspectCloudBuild(request, projects, build, clock());
  const triggerUrl = 'https://cloudbuild.googleapis.com/v1/' + refs.triggerName;
  const trigger = await get(triggerUrl);
  const repositoryUrl =
    'https://cloudbuild.googleapis.com/v2/' +
    cloudBuildRepositoryName(refs, trigger);
  const repository = await get(repositoryUrl);
  const input = { request, projects, repositoryConfig, metadataEmail, project };
  const first = verifyCloudBuildContext({
    ...input,
    build,
    trigger,
    repository,
    now: clock(),
  });
  const finalBuild = await get(buildUrl),
    finalTrigger = await get(triggerUrl),
    finalRepository = await get(repositoryUrl);
  const last = verifyCloudBuildContext({
    ...input,
    build: finalBuild,
    trigger: finalTrigger,
    repository: finalRepository,
    now: clock(),
  });
  if (canonical(first) !== canonical(last)) fail('CLOUD_BUILD_CONTEXT_CHANGED');
  if (
    (await read(metadata + 'email', {
      transport,
      metadataRequest: true,
      text: true,
      limit: 256,
    })) !== metadataEmail
  )
    fail('CLOUD_BUILD_METADATA_ACCOUNT_DISAGREES');
  const proof = {
    ...last,
    evidenceSource: 'live-api',
    observedAt: new Date(clock()).toISOString(),
  };
  liveContexts.set(proof, {
    digest: digest(proof),
    build: structuredClone(finalBuild),
  });
  return proof;
}
export function requireLiveCloudBuildContext(proof, now = Date.now()) {
  if (
    !proof ||
    liveContexts.get(proof)?.digest !== digest(proof) ||
    proof.evidenceSource !== 'live-api'
  )
    fail('AUTHENTICATED_CLOUD_BUILD_CONTEXT_REQUIRED');
  const at = cloudBuildTime(proof.observedAt);
  if (at > now + 300000 || at < now - 60000)
    fail('CLOUD_BUILD_CONTEXT_EXPIRED');
  return proof;
}
export function requireRecoveryRecipe(
  proof,
  request,
  projects,
  now = Date.now(),
) {
  requireLiveCloudBuildContext(proof, now);
  const build = liveContexts.get(proof).build;
  // Rebind routing to this exact live observation before inspecting its recipe.
  if (
    inspectCloudBuild(request, projects, build, now).buildName !==
    proof.observation.build.name
  )
    fail('CLOUD_BUILD_RECIPE_CONTEXT_DISAGREES');
  return verifyRecoveryRecipe(build, request, projects);
}
