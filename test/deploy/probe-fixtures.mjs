import { readFileSync } from 'node:fs';
import { fixture } from './fixtures.mjs';
import { digest } from '../../src/platform/config/build-model.ts';
import { contractSha256 } from '../../scripts/deploy/wire-contract.mjs';
import { createReadOnlyRolloutProbe } from '../../scripts/deploy/rollout-probe.mjs';

export const contractBytes = readFileSync(
  new URL('../../contracts/openapi-v1.json', import.meta.url),
);
export const document = JSON.parse(contractBytes.toString('utf8'));
export const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
  'base64',
);
export const publicImagePath =
  '/v1/public/posts/10000000-0000-4000-8000-000000000001/media/50000000-0000-4000-8000-000000000001/w480';
export const withdrawnImagePath = publicImagePath.replace(
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
);
const clone = structuredClone;
const example = (id, key) => {
  const op = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .find((item) => item.operationId === id);
  const examples = op.responses['200'].content['application/json'].examples;
  return clone(examples[key] ?? Object.values(examples)[0]).value;
};
const error = (status) =>
  clone(
    Object.values(
      document.components.responses['Error' + status].content[
        'application/json'
      ].examples,
    )[0].value,
  );

export function probeFixture(environment = 'staging', knownFixtures) {
  const f = fixture(environment);
  f.provenance.contractSha256 = contractSha256;
  const previous = {
    revision: 'blogpost-api-known-good',
    provenance: clone(f.provenance),
    target: clone(f.target),
  };
  previous.provenance.sourceSha = 'f'.repeat(40);
  const request = {
    schemaVersion: 1,
    attemptId: '12345-1',
    provenance: f.provenance,
    target: f.target,
    previous: [previous],
  };
  const revision =
    'blogpost-api-r12345-1-' + f.provenance.sourceSha.slice(0, 12);
  const record = {
    id: request.attemptId,
    sourceSha: f.provenance.sourceSha,
    image: f.target.image,
    serviceId: 'blogpost-api',
    tag: 'candidate-12345-1',
    candidateRevision: revision,
  };
  const state = {
    input: {
      request,
      record,
      phase: 'candidate',
      origin: 'https://candidate-12345-1---blogpost-api-fixture.a.run.app',
      artifacts: [{ revision, provenance: f.provenance, target: f.target }],
    },
    calls: [],
    mutation: null,
    knownFixtures,
  };
  function response(url, options) {
    const path = new URL(url).pathname;
    state.calls.push({
      url,
      method: options.method,
      headers: clone(options.headers),
      redirect: options.redirect,
      credentials: options.credentials,
      signal: options.signal,
    });
    const artifact = state.input.artifacts[0];
    const headers = {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-trace-id': '4bf92f3577b34da6a3ce929d0e0e4736',
      'x-api-contract-version': artifact.provenance.contractVersion,
      ...(environment === 'staging'
        ? { 'x-robots-tag': 'noindex, nofollow, noarchive' }
        : {}),
    };
    let status = 200;
    let body;
    if (path === '/v1/meta') {
      body = example('getApiMeta', 'success');
      body.data.buildSha = artifact.provenance.sourceSha;
      body.data.contractVersion = artifact.provenance.contractVersion;
      body.meta.contractVersion = artifact.provenance.contractVersion;
      body.data.deployment = {
        environment: artifact.provenance.environment,
        revision: artifact.revision,
        runtimeInputDigest: artifact.provenance.runtimeInputDigest,
        configurationDigest: digest(artifact.provenance.configuration),
      };
    } else if (path.startsWith('/health/')) body = { status: 'ok' };
    else if (path === '/v1/public/posts') {
      body = example('listPublicPosts', 'empty');
      body.data = [];
      body.meta.pagination.pageSize = 1;
    } else if (path === '/v1/public/search') {
      body = example('searchPublicPosts', 'empty');
      body.data = [];
      body.meta.pagination.pageSize = 1;
    } else if (path.startsWith('/v1/public/posts/by-slug/')) {
      if (knownFixtures?.publicSlug)
        body = example('resolvePublicPostSlug', 'canonical');
      else {
        status = 404;
        body = error(404);
      }
    } else if (path === '/v1/me' || path === '/v1/posts') {
      status = 401;
      body = error(401);
    } else if (path === knownFixtures?.publicImage?.path) {
      body = pixel;
      headers['content-type'] = 'image/png';
    } else if (path === knownFixtures?.withdrawnImage?.path) {
      status = 404;
      body = error(404);
    } else throw new Error('Unexpected test path');
    const result = { path, status, headers, body };
    state.mutation?.(result);
    return result;
  }
  const fetchImpl = async (url, options) => {
    const result = response(url, options);
    return new Response(
      result.rawBody ??
        (Buffer.isBuffer(result.body)
          ? result.body
          : JSON.stringify(result.body)),
      { status: result.status, headers: result.headers },
    );
  };
  const readMetadataPolicy = async (build) => {
    const { buildSha, deployment, ...policy } = example(
      'getApiMeta',
      'success',
    ).data;
    policy.contractVersion = build.contractVersion;
    return policy;
  };
  const probe = createReadOnlyRolloutProbe({
    knownFixtures,
    fetchImpl,
    readMetadataPolicy,
  });
  return { f, state, response, fetchImpl, probe, readMetadataPolicy };
}
