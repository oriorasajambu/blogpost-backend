import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createReadOnlyRolloutProbe } from '../../scripts/deploy/rollout-probe.mjs';
import {
  createWireVerifier,
  contractSha256,
} from '../../scripts/deploy/wire-contract.mjs';
import {
  probeFixture,
  document,
  contractBytes,
  pixel,
  publicImagePath,
  withdrawnImagePath,
} from './probe-fixtures.mjs';
import { readFileSync } from 'node:fs';
import { metadataPolicyFromSource } from '../../scripts/deploy/metadata-policy.mjs';

for (const environment of ['staging', 'production'])
  test(
    environment +
      ' read-only round verifies all eight mandatory checks without credentials',
    async () => {
      const h = probeFixture(environment);
      const result = await h.probe(h.state.input);
      assert.equal(result.ok, true);
      assert.equal(result.evidenceSource, 'injected-transport');
      assert.equal(result.contractSha256, contractSha256);
      assert.equal(result.checks.length, 8);
      assert.equal(result.skipped.length, 2);
      assert.equal(h.state.calls.length, 8);
      assert.ok(
        h.state.calls.every(
          (call) =>
            call.method === 'GET' &&
            call.credentials === 'omit' &&
            call.redirect === 'error',
        ),
      );
      const names = [
        'X-Device-ID',
        'X-Device-OS',
        'X-Device-Version',
        'X-App-Version',
        'X-App-Language',
      ];
      assert.ok(
        h.state.calls.every((call) =>
          names.every((name) => typeof call.headers[name] === 'string'),
        ),
      );
      assert.ok(
        h.state.calls.every(
          (call) =>
            !Object.keys(call.headers).some((name) =>
              /authorization|cookie|fixture|mock|debug/i.test(name),
            ),
        ),
      );
      assert.equal(
        new Set(h.state.calls.map((call) => call.headers['X-Device-ID'])).size,
        1,
      );
      const again = await h.probe(h.state.input);
      assert.equal(again.ok, true);
      assert.equal(
        new Set(h.state.calls.map((call) => call.headers['X-Device-ID'])).size,
        1,
      );
    },
  );

test('known public slug/image and withdrawn image are checked with exact binary hash', async () => {
  const knownFixtures = {
    publicSlug: 'a-reviewed-article',
    publicImage: {
      path: publicImagePath,
      byteSize: pixel.length,
      mimeType: 'image/png',
      sha256: createHash('sha256').update(pixel).digest('hex'),
    },
    withdrawnImage: { path: withdrawnImagePath },
  };
  const h = probeFixture('staging', knownFixtures);
  const result = await h.probe(h.state.input);
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 10);
  assert.deepEqual(result.skipped, []);
  h.state.mutation = (response) => {
    if (response.path === publicImagePath)
      response.body = Buffer.concat([
        pixel.subarray(0, pixel.length - 1),
        Buffer.from([0]),
      ]);
  };
  const corrupt = await h.probe(h.state.input);
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.rule, 'PROBE_PUBLIC_IMAGE_FAILED');
  assert.ok(!JSON.stringify(corrupt).includes('A reviewed article'));
});

for (const [name, mutation] of [
  [
    'build SHA',
    (data) => {
      data.buildSha = '0'.repeat(40);
    },
  ],
  [
    'revision',
    (data) => {
      data.deployment.revision = 'blogpost-api-other';
    },
  ],
  [
    'runtime inputs',
    (data) => {
      data.deployment.runtimeInputDigest = '0'.repeat(64);
    },
  ],
  [
    'configuration',
    (data) => {
      data.deployment.configurationDigest = '0'.repeat(64);
    },
  ],
  [
    'environment',
    (data) => {
      data.deployment.environment = 'development';
    },
  ],
  [
    'features',
    (data) => {
      data.features = ['unreviewed'];
    },
  ],
  [
    'limits',
    (data) => {
      data.limits.maxJsonBodyBytes = 999999999;
    },
  ],
  [
    'client policy',
    (data) => {
      data.clients.web.minimumSupportedVersion = '99.0.0';
    },
  ],
])
  test(
    'metadata drift in ' + name + ' fails before public resource reads',
    async () => {
      const h = probeFixture();
      h.state.mutation = (response) => {
        if (response.path === '/v1/meta') mutation(response.body.data);
      };
      const result = await h.probe(h.state.input);
      assert.equal(result.ok, false);
      assert.equal(result.rule, 'PROBE_METADATA_MISMATCH');
      assert.equal(h.state.calls.length, 1);
    },
  );

for (const [name, path, mutation, rule] of [
  [
    'readiness',
    '/health/ready',
    (r) => {
      r.status = 503;
      r.body = { status: 'unavailable' };
    },
    'PROBE_HTTP_STATUS',
  ],
  [
    'health schema',
    '/health/live',
    (r) => {
      r.body.private = 'private-payload-never-in-receipt';
    },
    'UNDECLARED_PRODUCER_FIELD',
  ],
  [
    'anonymous denial',
    '/v1/me',
    (r) => {
      r.status = 200;
      r.body = structuredClone(
        document.paths['/v1/me'].get.responses['200'].content[
          'application/json'
        ].examples.success.value,
      );
      r.headers['x-resource-version'] = '1';
    },
    'PROBE_ANONYMOUS_DENIAL_FAILED',
  ],
  [
    'wrong authentication error',
    '/v1/posts',
    (r) => {
      r.body.error.code = 'AUTHENTICATION_EXPIRED';
    },
    'PROBE_ANONYMOUS_DENIAL_FAILED',
  ],
  [
    'trace mismatch',
    '/v1/public/posts',
    (r) => {
      r.body.traceId = '1'.repeat(32);
    },
    'TRACE_AGREEMENT',
  ],
  [
    'private public field',
    '/v1/public/posts',
    (r) => {
      r.body.data = [
        {
          ...document.paths['/v1/public/posts'].get.responses['200'].content[
            'application/json'
          ].examples.success.value.data[0],
          email: 'private-payload-never-in-receipt',
        },
      ];
    },
    'PRIVATE_FIELD_IN_PUBLIC_PROJECTION',
  ],
  [
    'pagination request',
    '/v1/public/search',
    (r) => {
      r.body.meta.pagination.page = 2;
    },
    'PROBE_PUBLIC_SEARCH_FAILED',
  ],
  [
    'non-JSON',
    '/v1/public/search',
    (r) => {
      r.headers['content-type'] = 'text/html';
      r.rawBody = 'private-payload-never-in-receipt';
    },
    'CONTENT_TYPE',
  ],
  [
    'duplicate JSON keys',
    '/v1/public/posts',
    (r) => {
      const text = JSON.stringify(r.body);
      r.rawBody = text.replace(
        '"statusCode":200',
        '"statusCode":503,"statusCode":200',
      );
    },
    'DUPLICATE_JSON_KEY',
  ],
  [
    'invalid UTF-8',
    '/v1/public/posts',
    (r) => {
      r.rawBody = Buffer.from([0xc3, 0x28]);
    },
    'INVALID_JSON_OR_UTF8',
  ],
  [
    'declared body size',
    '/v1/public/search',
    (r) => {
      r.headers['content-length'] = '1048577';
    },
    'PROBE_BODY_LIMIT',
  ],
  [
    'streamed body size',
    '/v1/public/search',
    (r) => {
      r.rawBody = ' '.repeat(1048577);
    },
    'PROBE_BODY_LIMIT',
  ],
])
  test(name + ' failure is bounded and omits response data', async () => {
    const h = probeFixture();
    h.state.mutation = (response) => {
      if (response.path === path) mutation(response);
    };
    const result = await h.probe(h.state.input);
    assert.equal(result.ok, false);
    assert.equal(result.rule, rule);
    assert.ok(
      !JSON.stringify(result).includes('private-payload-never-in-receipt'),
    );
  });

for (const [name, mutation] of [
  [
    'cookie',
    (r) => {
      r.headers['set-cookie'] = 'private-payload-never-in-receipt';
    },
  ],
  [
    'cache',
    (r) => {
      r.headers['cache-control'] = 'public, max-age=3600';
    },
  ],
  [
    'sniffing',
    (r) => {
      delete r.headers['x-content-type-options'];
    },
  ],
  [
    'referrer',
    (r) => {
      r.headers['referrer-policy'] = 'unsafe-url';
    },
  ],
  [
    'staging robots',
    (r) => {
      delete r.headers['x-robots-tag'];
    },
  ],
])
  test('unsafe ' + name + ' response header fails', async () => {
    const h = probeFixture();
    h.state.mutation = mutation;
    const result = await h.probe(h.state.input);
    assert.equal(result.ok, false);
    assert.equal(result.rule, 'PROBE_RESPONSE_HEADERS');
    assert.ok(
      !JSON.stringify(result).includes('private-payload-never-in-receipt'),
    );
  });

test('redirects, transport diagnostics and candidate origin substitution cannot confer success', async () => {
  const h = probeFixture();
  const broken = createReadOnlyRolloutProbe({
    readMetadataPolicy: h.readMetadataPolicy,
    fetchImpl: async () => {
      throw new Error('private-token-diagnostic');
    },
  });
  const failure = await broken(h.state.input);
  assert.equal(failure.ok, false);
  assert.ok(!JSON.stringify(failure).includes('private-token-diagnostic'));
  const redirect = createReadOnlyRolloutProbe({
    readMetadataPolicy: h.readMetadataPolicy,
    fetchImpl: async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://foreign.example.test' },
      }),
  });
  assert.equal((await redirect(h.state.input)).rule, 'PROBE_HTTP_STATUS');
  await assert.rejects(
    h.probe({ ...h.state.input, origin: 'https://foreign.example.test' }),
    { code: 'INVALID_PROBE_ORIGIN' },
  );
  assert.equal(h.state.calls.length, 0);
});

test('all selected contract bytes must match the expected artifact before any request', async () => {
  const h = probeFixture();
  h.state.input.artifacts[0].provenance.contractSha256 = '0'.repeat(64);
  await assert.rejects(h.probe(h.state.input), {
    code: 'PROBE_CONTRACT_UNAVAILABLE',
  });
  assert.equal(h.state.calls.length, 0);
  assert.throws(
    () =>
      createReadOnlyRolloutProbe({
        knownFixtures: {
          publicSlug: '../escape',
          publicImage: null,
          withdrawnImage: null,
        },
      }),
    { code: 'INVALID_PROBE_FIXTURE' },
  );
  assert.throws(
    () =>
      createReadOnlyRolloutProbe({
        knownFixtures: {
          publicSlug: null,
          publicImage: {
            path: 'https://foreign.example.test',
            byteSize: 1,
            mimeType: 'image/png',
            sha256: 'a'.repeat(64),
          },
          withdrawnImage: null,
        },
      }),
    { code: 'INVALID_PROBE_FIXTURE' },
  );
});

test('rollback can observe any recorded previous revision without accepting the candidate', async () => {
  const h = probeFixture();
  h.state.input.phase = 'rollback';
  h.state.input.origin = h.f.provenance.configuration.apiOrigin;
  h.state.input.artifacts = structuredClone(h.state.input.request.previous);
  const result = await h.probe(h.state.input);
  assert.equal(result.ok, true);
  assert.equal(
    result.observedRevision,
    h.state.input.request.previous[0].revision,
  );
  assert.equal(result.observedSourceSha, 'f'.repeat(40));
  const candidate = {
    ...h.state.input,
    artifacts: [
      {
        revision: h.state.input.record.candidateRevision,
        provenance: h.f.provenance,
        target: h.f.target,
      },
    ],
  };
  await assert.rejects(h.probe(candidate), { code: 'PROBE_ARTIFACT_MISMATCH' });
});

test('a shared verifier snapshots its operation catalog', () => {
  const item = {
    method: 'GET',
    path: '/v1/meta',
    operationId: 'getApiMeta',
    access: 'ANONYMOUS',
    expectedVersion: false,
    idempotent: false,
  };
  const verifier = createWireVerifier(Buffer.from(JSON.stringify(document)), [
    item,
  ]);
  item.path = '/v1/me';
  assert.equal(
    verifier.operationFor('GET', '/v1/meta').operationId,
    'getApiMeta',
  );
});

test('metadata policy interpretation reads static source without executing it', () => {
  const controller = readFileSync(
    'src/modules/meta/meta.controller.ts',
    'utf8',
  );
  const envelope = readFileSync('src/platform/http/envelope.ts');
  const policy = metadataPolicyFromSource(Buffer.from(controller), envelope);
  assert.equal(policy.contractVersion, '1.0.0');
  assert.deepEqual(policy.features, []);
  assert.equal(policy.limits.maxUploadFileBytes, 5242880);
  const unsafe = controller.replace(
    'features: [],',
    "features: [(() => { throw new Error('private-source-diagnostic'); })()],",
  );
  assert.throws(() => metadataPolicyFromSource(Buffer.from(unsafe), envelope), {
    code: 'METADATA_POLICY_EXPRESSION_UNSUPPORTED',
  });
  const dynamic = controller.replace(
    'features: [],',
    'features: [...API_LIMITS],',
  );
  assert.throws(
    () => metadataPolicyFromSource(Buffer.from(dynamic), envelope),
    { code: 'METADATA_POLICY_EXPRESSION_UNSUPPORTED' },
  );
});

test('a supplied historical contract is selected by hash for an expected rollback artifact', async () => {
  const h = probeFixture();
  const currentBytes = contractBytes;
  const oldBytes = Buffer.from(
    currentBytes.toString('utf8').replaceAll('"1.0.0"', '"0.9.0"'),
  );
  const previous = h.state.input.request.previous[0];
  previous.provenance.contractVersion = '0.9.0';
  previous.provenance.contractSha256 = createHash('sha256')
    .update(oldBytes)
    .digest('hex');
  h.state.input.phase = 'rollback';
  h.state.input.origin = h.f.provenance.configuration.apiOrigin;
  h.state.input.artifacts = structuredClone([previous]);
  h.state.mutation = (response) => {
    if (response.body?.meta) response.body.meta.contractVersion = '0.9.0';
  };
  const probe = createReadOnlyRolloutProbe({
    contractDocuments: [currentBytes, oldBytes],
    readMetadataPolicy: h.readMetadataPolicy,
    fetchImpl: h.fetchImpl,
  });
  const result = await probe(h.state.input);
  assert.equal(result.ok, true);
  assert.equal(result.contractSha256, previous.provenance.contractSha256);
  assert.equal(result.observedSourceSha, previous.provenance.sourceSha);
});

test('a stalled response body and cancellation respect the request deadline', async () => {
  const h = probeFixture();
  let canceled = false;
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const probe = createReadOnlyRolloutProbe({
      readMetadataPolicy: h.readMetadataPolicy,
      fetchImpl: async (url, options) => {
        const fixture = h.response(url, options);
        return new Response(
          new ReadableStream({
            cancel() {
              canceled = true;
              return new Promise(() => {});
            },
          }),
          { headers: fixture.headers },
        );
      },
    });
    const started = Date.now();
    const result = await probe(h.state.input);
    assert.equal(result.ok, false);
    assert.equal(result.rule, 'PROBE_REQUEST_TIMEOUT');
    assert.ok(Date.now() - started < 8000);
    assert.equal(canceled, true);
  } finally {
    clearInterval(keepAlive);
  }
});

test('an uncooperative transport cannot bypass the probe deadline', async () => {
  const h = probeFixture();
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const probe = createReadOnlyRolloutProbe({
      readMetadataPolicy: h.readMetadataPolicy,
      fetchImpl: () => new Promise(() => {}),
    });
    const start = Date.now();
    const result = await probe(h.state.input);
    assert.equal(result.ok, false);
    assert.equal(result.rule, 'PROBE_REQUEST_TIMEOUT');
    assert.ok(Date.now() - start < 8000);
  } finally {
    clearInterval(keepAlive);
  }
});

test('HTTP adapter is exercised across real loopback TCP with all five metadata headers', async () => {
  const h = probeFixture();
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({
      method: request.method,
      headers: request.headers,
      path: request.url,
    });
    const fixture = h.response(
      new URL(request.url, h.state.input.origin).href,
      { method: request.method, headers: request.headers },
    );
    response.writeHead(fixture.status, fixture.headers);
    response.end(
      Buffer.isBuffer(fixture.body)
        ? fixture.body
        : JSON.stringify(fixture.body),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const port = server.address().port;
    const probe = createReadOnlyRolloutProbe({
      readMetadataPolicy: h.readMetadataPolicy,
      fetchImpl: async (url, options) => {
        const result = await fetch(
          'http://127.0.0.1:' +
            port +
            new URL(url).pathname +
            new URL(url).search,
          options,
        );
        return new Response(await result.arrayBuffer(), {
          status: result.status,
          headers: result.headers,
        });
      },
    });
    const result = await probe(h.state.input);
    assert.equal(result.ok, true);
    assert.equal(result.evidenceSource, 'injected-transport');
    assert.equal(seen.length, 8);
    assert.ok(
      seen.every(
        (call) =>
          call.method === 'GET' &&
          call.headers['x-device-id'] &&
          call.headers['x-device-os'] &&
          call.headers['x-device-version'] &&
          call.headers['x-app-version'] &&
          call.headers['x-app-language'] &&
          !call.headers.authorization &&
          !call.headers.cookie,
      ),
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
