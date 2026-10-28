import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { digest } from '../../src/platform/config/build-model.ts';
import { cloudRunExpectations } from './cloud-run-config.mjs';
import { createWireVerifier, ConformanceError } from './wire-contract.mjs';
import { refuse, RolloutError } from './rollout-client.mjs';
import { gitMetadataPolicyReader } from './metadata-policy.mjs';
import {
  abortable,
  cancelQuietly,
  discardResponse,
} from './transport-deadline.mjs';

const REQUEST_TIMEOUT = 5000;
const ROUND_TIMEOUT = 25000;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEDIA =
  /^\/v1\/public\/posts\/([a-f0-9-]{36})\/media\/([a-f0-9-]{36})\/(w480|w960|w1600)$/;
const READS = [
  ['getApiMeta', '/v1/meta'],
  ['listPublicPosts', '/v1/public/posts'],
  ['searchPublicPosts', '/v1/public/search'],
  ['resolvePublicPostSlug', '/v1/public/posts/by-slug/{slug}'],
  ['getMe', '/v1/me'],
  ['listWorkspacePosts', '/v1/posts'],
  ['getPublicPostMedia', '/v1/public/posts/{postId}/media/{mediaId}/{variant}'],
];
const standardContract = readFileSync(
  new URL('../../contracts/openapi-v1.json', import.meta.url),
);
function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    refuse('INVALID_PROBE_FIXTURE');
}
function mediaFixture(value, publicImage) {
  if (!value) return null;
  exact(
    value,
    publicImage ? ['path', 'sha256', 'byteSize', 'mimeType'] : ['path'],
  );
  const parts = typeof value.path === 'string' && MEDIA.exec(value.path);
  if (!parts || !UUID.test(parts[1]) || !UUID.test(parts[2]))
    refuse('INVALID_PROBE_FIXTURE');
  if (
    publicImage &&
    (!/^[a-f0-9]{64}$/.test(value.sha256 ?? '') ||
      !Number.isSafeInteger(value.byteSize) ||
      value.byteSize < 1 ||
      value.byteSize > 6291456 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType))
  )
    refuse('INVALID_PROBE_FIXTURE');
  return structuredClone(value);
}
function fixtures(value) {
  if (value === undefined)
    return Object.freeze({
      publicSlug: null,
      publicImage: null,
      withdrawnImage: null,
    });
  exact(value, ['publicSlug', 'publicImage', 'withdrawnImage']);
  if (
    value.publicSlug !== null &&
    (typeof value.publicSlug !== 'string' ||
      value.publicSlug.length > 120 ||
      !SLUG.test(value.publicSlug))
  )
    refuse('INVALID_PROBE_FIXTURE');
  const publicImage = mediaFixture(value.publicImage, true);
  const withdrawnImage = mediaFixture(value.withdrawnImage, false);
  if (publicImage && publicImage.path === withdrawnImage?.path)
    refuse('INVALID_PROBE_FIXTURE');
  return Object.freeze({
    publicSlug: value.publicSlug,
    publicImage,
    withdrawnImage,
  });
}
function contract(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 4194304)
    refuse('PROBE_CONTRACT_INVALID');
  let document;
  try {
    document = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  } catch {
    refuse('PROBE_CONTRACT_INVALID');
  }
  const catalog = READS.map(([operationId, path]) => {
    if (document.paths?.[path]?.get?.operationId !== operationId)
      refuse('PROBE_CONTRACT_INVALID');
    return {
      method: 'GET',
      path,
      operationId,
      access:
        path.startsWith('/v1/public/') || path === '/v1/meta'
          ? 'ANONYMOUS'
          : 'AUTHENTICATED',
      expectedVersion: false,
      idempotent: false,
    };
  });
  return {
    sha256: sha(bytes),
    version: document.info.version,
    verifier: createWireVerifier(bytes, catalog),
  };
}
function expected(input, documents) {
  if (
    !input ||
    ![
      'candidate',
      'convergence',
      'observation',
      'rollback',
      'recovery_previous',
    ].includes(input.phase) ||
    !Array.isArray(input.artifacts) ||
    !input.artifacts.length ||
    input.artifacts.length > 20
  )
    refuse('INVALID_PROBE_INPUT');
  const request = structuredClone(input.request);
  const { build, profile, kind } = cloudRunExpectations(
    request.provenance,
    request.target,
  );
  if (
    kind !== 'services' ||
    request.target.resourceId !== 'blogpost-api' ||
    input.record?.id !== request.attemptId ||
    input.record.serviceId !== request.target.resourceId ||
    input.record.sourceSha !== build.sourceSha ||
    input.record.image !== request.target.image
  )
    refuse('PROBE_ROLLOUT_MISMATCH');
  let origin;
  try {
    origin = new URL(input.origin);
  } catch {
    refuse('INVALID_PROBE_ORIGIN');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== input.origin ||
    origin.username ||
    origin.password ||
    origin.port
  )
    refuse('INVALID_PROBE_ORIGIN');
  const candidate = input.phase === 'candidate';
  if (candidate) {
    if (
      input.record.tag !== 'candidate-' + request.attemptId ||
      !origin.hostname.endsWith('.run.app') ||
      !origin.hostname.startsWith(
        input.record.tag + '---' + request.target.resourceId + '-',
      )
    )
      refuse('INVALID_PROBE_ORIGIN');
  } else if (input.origin !== profile.apiOrigin) refuse('INVALID_PROBE_ORIGIN');
  const artifacts = input.artifacts.map((artifact) => {
    const { build: item, kind: type } = cloudRunExpectations(
      artifact.provenance,
      artifact.target,
    );
    if (
      type !== 'services' ||
      !/^[a-z][a-z0-9-]{0,62}$/.test(artifact.revision ?? '') ||
      digest(item.configuration) !== digest(profile) ||
      artifact.target.resourceId !== request.target.resourceId ||
      artifact.target.region !== request.target.region
    )
      refuse('PROBE_ARTIFACT_MISMATCH');
    const document = documents.get(item.contractSha256);
    if (!document || document.version !== item.contractVersion)
      refuse('PROBE_CONTRACT_UNAVAILABLE');
    if (['candidate', 'convergence', 'observation'].includes(input.phase)) {
      if (
        artifact.revision !== input.record.candidateRevision ||
        digest(artifact.provenance) !== digest(request.provenance) ||
        digest(artifact.target) !== digest(request.target)
      )
        refuse('PROBE_ARTIFACT_MISMATCH');
    } else {
      const previous = request.previous?.find(
        (entry) => entry.revision === artifact.revision,
      );
      if (!previous || digest(previous) !== digest(artifact))
        refuse('PROBE_ARTIFACT_MISMATCH');
    }
    return { artifact: structuredClone(artifact), build: item, document };
  });
  if (
    new Set(artifacts.map((item) => item.artifact.revision)).size !==
      artifacts.length ||
    (candidate && artifacts.length !== 1)
  )
    refuse('PROBE_ARTIFACT_MISMATCH');
  return {
    request,
    origin: origin.origin,
    artifacts,
    environment: build.environment,
  };
}
async function body(response, limit, signal) {
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > limit)
  )
    refuse('PROBE_BODY_LIMIT');
  const reader = response.body?.getReader();
  if (!reader) refuse('PROBE_BODY_UNAVAILABLE');
  const abort = () => {
    cancelQuietly(reader);
  };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) refuse('PROBE_BODY_LIMIT');
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    signal.removeEventListener('abort', abort);
    cancelQuietly(reader);
    reader.releaseLock();
  }
  if (
    length !== null &&
    !response.headers.has('content-encoding') &&
    size !== Number(length)
  )
    refuse('PROBE_BODY_LENGTH');
  return Buffer.concat(chunks);
}
async function read(
  origin,
  path,
  metadata,
  transport,
  roundSignal,
  limit = 1048576,
  environment,
) {
  const url = new URL(path, origin);
  if (
    url.origin !== origin ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    url.hash
  )
    refuse('PROBE_PATH_SCOPE');
  const signal = AbortSignal.any([
    roundSignal,
    AbortSignal.timeout(REQUEST_TIMEOUT),
  ]);
  let response;
  try {
    response = await abortable(
      transport(url.href, {
        method: 'GET',
        headers: {
          Accept: path.includes('/media/')
            ? 'image/png, image/jpeg, image/webp, application/json'
            : 'application/json',
          'Cache-Control': 'no-cache',
          ...metadata,
        },
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal,
      }),
      signal,
      discardResponse,
    );
    signal.throwIfAborted();
    if (
      response.redirected ||
      (response.url && response.url !== url.href) ||
      response.status < 200 ||
      (response.status >= 300 && ![401, 404].includes(response.status))
    )
      refuse('PROBE_HTTP_STATUS');
    if (
      response.headers.has('set-cookie') ||
      response.headers.get('cache-control') !== 'no-store' ||
      response.headers.get('x-content-type-options') !== 'nosniff' ||
      response.headers.get('referrer-policy') !== 'no-referrer'
    )
      refuse('PROBE_RESPONSE_HEADERS');
    if (
      environment === 'staging' &&
      response.headers.get('x-robots-tag') !== 'noindex, nofollow, noarchive'
    )
      refuse('PROBE_RESPONSE_HEADERS');
    return {
      method: 'GET',
      path: url.pathname,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await body(response, limit, signal),
    };
  } catch (error) {
    if (signal.aborted)
      refuse(
        roundSignal.aborted ? 'PROBE_ROUND_TIMEOUT' : 'PROBE_REQUEST_TIMEOUT',
      );
    throw error;
  } finally {
    discardResponse(response);
  }
}
function wire(plan, id, exchange) {
  let last;
  for (const item of plan.artifacts) {
    try {
      return {
        value: item.document.verifier.assertConforms(id, exchange),
        item,
      };
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
function metadata(plan, exchange) {
  for (const item of plan.artifacts) {
    try {
      const data = item.document.verifier.assertConforms(
        'getApiMeta',
        exchange,
      ).data;
      const { buildSha, deployment, ...capabilities } = data;
      if (
        buildSha === item.build.sourceSha &&
        digest(capabilities) === digest(item.policy) &&
        digest(deployment) ===
          digest({
            environment: item.build.environment,
            revision: item.artifact.revision,
            runtimeInputDigest: item.build.runtimeInputDigest,
            configurationDigest: digest(item.build.configuration),
          })
      )
        return item;
    } catch {
      /* Try another explicitly expected serving artifact. */
    }
  }
  refuse('PROBE_METADATA_MISMATCH');
}

// Read-only collection only. Expected artifacts/contracts still require an
// independently trusted caller; an HTTP response cannot attest an image digest.
export function createReadOnlyRolloutProbe({
  contractDocuments = [standardContract],
  knownFixtures,
  fetchImpl = fetch,
  now = Date.now,
  root = process.cwd(),
  readMetadataPolicy,
} = {}) {
  if (
    !Array.isArray(contractDocuments) ||
    !contractDocuments.length ||
    contractDocuments.length > 20 ||
    typeof fetchImpl !== 'function' ||
    typeof now !== 'function'
  )
    refuse('INVALID_PROBE_CONFIGURATION');
  const documents = new Map();
  for (const bytes of contractDocuments) {
    const item = contract(Buffer.from(bytes));
    if (documents.has(item.sha256)) refuse('DUPLICATE_PROBE_CONTRACT');
    documents.set(item.sha256, item);
  }
  const safe = fixtures(knownFixtures);
  const deviceId = randomUUID();
  const policyReader = readMetadataPolicy ?? gitMetadataPolicyReader(root);
  if (typeof policyReader !== 'function') refuse('INVALID_PROBE_CONFIGURATION');
  const expectationSource =
    readMetadataPolicy === undefined
      ? 'immutable-git-inputs'
      : 'injected-policy';
  return async (input) => {
    const plan = expected(input, documents);
    for (const item of plan.artifacts) {
      item.policy = structuredClone(await policyReader(item.build));
      if (
        !item.policy ||
        item.policy.contractVersion !== item.build.contractVersion
      )
        refuse('PROBE_METADATA_POLICY_REQUIRED');
    }
    const startedAt = now();
    const completed = [];
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(ROUND_TIMEOUT);
    const signal = AbortSignal.any([controller.signal, deadline]);
    const headers = Object.freeze({
      'X-Device-ID': deviceId,
      'X-Device-OS': 'WEB',
      'X-Device-Version': 'unknown',
      'X-App-Version': '0.0.0+rollout-probe',
      'X-App-Language': 'en',
    });
    try {
      const meta = await read(
        plan.origin,
        '/v1/meta',
        headers,
        fetchImpl,
        signal,
        65536,
        plan.environment,
      );
      if (meta.status !== 200) refuse('PROBE_METADATA_MISMATCH');
      const serving = metadata(plan, meta);
      completed.push('metadata');
      const slug = safe.publicSlug ?? 'blogpost-rollout-probe-' + randomUUID();
      const checks = [
        [
          'liveness',
          '/health/live',
          (exchange) => serving.document.verifier.assertHealth(exchange),
        ],
        [
          'readiness',
          '/health/ready',
          (exchange) => serving.document.verifier.assertHealth(exchange),
        ],
        [
          'public-list',
          '/v1/public/posts?pageSize=1',
          (exchange) => {
            if (exchange.status !== 200) refuse('PROBE_PUBLIC_LIST_FAILED');
            const { value } = wire(plan, 'listPublicPosts', exchange);
            if (value.data.length > 1 || value.meta.pagination.pageSize !== 1)
              refuse('PROBE_PUBLIC_LIST_FAILED');
          },
        ],
        [
          'public-search',
          '/v1/public/search?q=blogpost&page=1&pageSize=1',
          (exchange) => {
            if (exchange.status !== 200) refuse('PROBE_PUBLIC_SEARCH_FAILED');
            const { value } = wire(plan, 'searchPublicPosts', exchange);
            if (
              value.data.length > 1 ||
              value.meta.pagination.pageSize !== 1 ||
              value.meta.pagination.page !== 1
            )
              refuse('PROBE_PUBLIC_SEARCH_FAILED');
          },
        ],
        [
          'public-slug',
          '/v1/public/posts/by-slug/' + slug,
          (exchange) => {
            const { value } = wire(plan, 'resolvePublicPostSlug', exchange);
            if (
              exchange.status === 404
                ? value.error.code !== 'RESOURCE_NOT_FOUND' || safe.publicSlug
                : exchange.status !== 200
            )
              refuse('PROBE_PUBLIC_SLUG_FAILED');
            if (
              exchange.status === 200 &&
              (value.data.canonicalPath !==
                '/posts/' + value.data.canonicalSlug ||
                value.data.post.slug !== value.data.canonicalSlug ||
                (value.data.resolution === 'CANONICAL') !==
                  (slug === value.data.canonicalSlug))
            )
              refuse('PROBE_PUBLIC_SLUG_FAILED');
          },
        ],
        [
          'anonymous-profile-denied',
          '/v1/me',
          (exchange) => {
            const { value } = wire(plan, 'getMe', exchange);
            if (
              exchange.status !== 401 ||
              value.error?.code !== 'AUTHENTICATION_REQUIRED'
            )
              refuse('PROBE_ANONYMOUS_DENIAL_FAILED');
          },
        ],
        [
          'anonymous-workspace-denied',
          '/v1/posts',
          (exchange) => {
            const { value } = wire(plan, 'listWorkspacePosts', exchange);
            if (
              exchange.status !== 401 ||
              value.error?.code !== 'AUTHENTICATION_REQUIRED'
            )
              refuse('PROBE_ANONYMOUS_DENIAL_FAILED');
          },
        ],
      ];
      if (safe.publicImage)
        checks.push([
          'public-image',
          safe.publicImage.path,
          (exchange) => {
            wire(plan, 'getPublicPostMedia', exchange);
            if (
              exchange.status !== 200 ||
              exchange.headers['content-type'].split(';')[0].trim() !==
                safe.publicImage.mimeType ||
              exchange.body.length !== safe.publicImage.byteSize ||
              sha(exchange.body) !== safe.publicImage.sha256
            )
              refuse('PROBE_PUBLIC_IMAGE_FAILED');
          },
        ]);
      if (safe.withdrawnImage)
        checks.push([
          'withdrawn-image-denied',
          safe.withdrawnImage.path,
          (exchange) => {
            const { value } = wire(plan, 'getPublicPostMedia', exchange);
            if (
              exchange.status !== 404 ||
              value.error?.code !== 'RESOURCE_NOT_FOUND'
            )
              refuse('PROBE_WITHDRAWN_IMAGE_FAILED');
          },
        ]);
      let next = 0;
      let firstFailure;
      const workers = Array.from({ length: 3 }, async () => {
        try {
          while (next < checks.length && !signal.aborted) {
            const [id, path, check] = checks[next++];
            const exchange = await read(
              plan.origin,
              path,
              headers,
              fetchImpl,
              signal,
              path === safe.publicImage?.path
                ? safe.publicImage.byteSize
                : 1048576,
              plan.environment,
            );
            check(exchange);
            completed.push(id);
          }
        } catch (error) {
          firstFailure ??= error;
          controller.abort();
          throw error;
        }
      });
      const results = await Promise.allSettled(workers);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw firstFailure ?? failed.reason;
      signal.throwIfAborted();
      if (
        completed.length !== checks.length + 1 ||
        now() < startedAt ||
        now() - startedAt > ROUND_TIMEOUT
      )
        refuse('PROBE_ROUND_TIMEOUT');
      return {
        schemaVersion: 1,
        ok: true,
        scope: 'read-only-rollout-http-round',
        evidenceSource:
          fetchImpl === fetch ? 'live-http' : 'injected-transport',
        expectationSource,
        phase: input.phase,
        observedAt: new Date(now()).toISOString(),
        durationMs: now() - startedAt,
        observedSourceSha: serving.build.sourceSha,
        observedRevision: serving.artifact.revision,
        contractSha256: serving.document.sha256,
        checks: completed.sort(),
        skipped: [
          !safe.publicImage && 'public-image-no-reviewed-fixture',
          !safe.withdrawnImage && 'withdrawn-image-no-reviewed-fixture',
        ].filter(Boolean),
      };
    } catch (error) {
      return {
        schemaVersion: 1,
        ok: false,
        scope: 'read-only-rollout-http-round',
        evidenceSource:
          fetchImpl === fetch ? 'live-http' : 'injected-transport',
        expectationSource,
        phase: input.phase,
        observedAt: new Date(now()).toISOString(),
        completedChecks: completed.sort(),
        rule:
          error instanceof ConformanceError
            ? error.rule
            : error instanceof RolloutError
              ? error.code
              : deadline.aborted
                ? 'PROBE_ROUND_TIMEOUT'
                : 'PROBE_TRANSPORT_FAILED',
      };
    } finally {
      controller.abort();
    }
  };
}
