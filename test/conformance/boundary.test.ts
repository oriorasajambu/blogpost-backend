import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { identityFixture } from '../identity/fixture.js';
import { randomUUID } from 'node:crypto';
import { FirebaseIdentityGateway } from '../../src/modules/identity/firebase-identity.gateway.js';
import { IDENTITY_GATEWAY } from '../../src/modules/identity/identity.js';
import { ApiError } from '../../src/platform/errors/api-error.js';
import { metadata } from '../helpers.js';
import { assertConforms, catalog, coverage } from './verify.js';
import { createWireVerifier } from '../../scripts/deploy/wire-contract.mjs';

assert.equal(
  process.env.BLOGPOST_DISPOSABLE_IDENTITY,
  '1',
  'Use the isolated conformance runner',
);
assert.equal(process.env.SQL_HOST, 'db');
assert.match(
  process.env.IDENTITY_PROJECT_ID ?? '',
  /^demo-blogpost-identity-[a-f0-9]{12}$/,
);

test(
  'every operation has real HTTP metadata rejection and every protected operation denies anonymous access',
  { timeout: 120000 },
  async (t) => {
    const fixture = await identityFixture(t);
    const { config, app, origin } = fixture;
    let temporaryMemberId: string | undefined;
    const executed = new Set<string>();
    const metadataRejected: string[] = [];
    const anonymousRejected: string[] = [];
    async function observe(
      operationId: string,
      path: string,
      method: string,
      headers: Record<string, string>,
      rawBody?: string | FormData,
    ) {
      const response = await fetch(origin + path, {
        method,
        headers,
        ...(rawBody !== undefined ? { body: rawBody } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      const body = assertConforms(operationId, {
        method,
        path,
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
      if (response.ok) executed.add(operationId);
      return { response, body };
    }
    try {
      const verifier = createWireVerifier(
        await readFile(
          new URL('../../contracts/openapi-v1.json', import.meta.url),
        ),
        catalog,
      );
      const healthVerified = [];
      for (const path of ['/health/live', '/health/ready']) {
        const response = await fetch(origin + path, {
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });
        verifier.assertHealth({
          method: 'GET',
          path,
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
        healthVerified.push(path);
      }
      for (const operation of catalog) {
        const fixture = JSON.parse(
          await readFile(
            new URL(
              `../../contracts/fixtures/operations/${operation.operationId}.request.json`,
              import.meta.url,
            ),
            'utf8',
          ),
        );
        let rawBody: string | FormData | undefined =
          operation.method === 'GET'
            ? undefined
            : JSON.stringify(fixture.body ?? {});
        if (operation.operationId === 'stagePostMedia') {
          rawBody = new FormData();
          rawBody.append(
            'file',
            new Blob(
              [
                Uint8Array.from(
                  await readFile(
                    new URL(
                      '../../contracts/fixtures/media/pixel.png',
                      import.meta.url,
                    ),
                  ),
                ),
              ],
              { type: 'image/png' },
            ),
            'pixel.png',
          );
        }
        const bodyHeaders: Record<string, string> =
          typeof rawBody === 'string'
            ? { 'Content-Type': 'application/json' }
            : {};
        const missing = await observe(
          operation.operationId,
          fixture.path,
          operation.method,
          bodyHeaders,
          rawBody,
        );
        assert.equal(missing.response.status, 400, operation.operationId);
        assert.equal(
          missing.body.error.code,
          'INVALID_CLIENT_METADATA',
          operation.operationId,
        );
        metadataRejected.push(operation.operationId);
        if (operation.access !== 'ANONYMOUS') {
          const anonymous = await observe(
            operation.operationId,
            fixture.path,
            operation.method,
            {
              ...metadata,
              ...bodyHeaders,
            },
            rawBody,
          );
          assert.equal(anonymous.response.status, 401, operation.operationId);
          assert.ok(
            ['AUTHENTICATION_REQUIRED', 'INVALID_CREDENTIAL'].includes(
              anonymous.body.error.code,
            ),
            operation.operationId,
          );
          anonymousRejected.push(operation.operationId);
        }
      }
      await observe('getApiMeta', '/v1/meta', 'GET', metadata);
      const samples = [
        [
          'getApiMeta',
          '/v1/meta?unsupported=true',
          'GET',
          metadata,
          undefined,
          422,
          'VALIDATION_FAILED',
        ],
        [
          'getApiMeta',
          '/v1/meta',
          'POST',
          { ...metadata, 'Content-Type': 'application/json' },
          '{}',
          405,
          'METHOD_NOT_ALLOWED',
        ],
        [
          'createPost',
          '/v1/posts',
          'POST',
          { ...metadata, 'Content-Type': 'application/json' },
          '{',
          400,
          'MALFORMED_JSON',
        ],
        [
          'createPost',
          '/v1/posts',
          'POST',
          { ...metadata, 'Content-Type': 'application/json' },
          JSON.stringify({ value: 'x'.repeat(1024 * 1024) }),
          413,
          'PAYLOAD_TOO_LARGE',
        ],
        [
          'getApiMeta',
          '/v1/meta',
          'GET',
          { ...metadata, Authorization: 'Basic fixture-invalid' },
          undefined,
          401,
          'INVALID_CREDENTIAL',
        ],
        [
          'getApiMeta',
          '/v1/meta',
          'GET',
          {
            ...metadata,
            Authorization: 'Bearer fixture-invalid',
            'X-Blogpost-Web-Session': 'fixture-invalid',
          },
          undefined,
          400,
          'AMBIGUOUS_CREDENTIALS',
        ],
      ] as const;
      for (const [id, path, method, headers, raw, status, code] of samples) {
        const result = await observe(id, path, method, headers, raw);
        assert.equal(result.response.status, status);
        assert.equal(result.body.error.code, code);
      }
      const author = await fixture.member();
      temporaryMemberId = author.row.id;
      const invalidVersion = await observe(
        'updateMe',
        '/v1/me',
        'PATCH',
        {
          ...metadata,
          Authorization: 'Bearer ' + author.token,
          'Content-Type': 'application/json',
          'X-Expected-Version': 'invalid',
          'Idempotency-Key': randomUUID(),
        },
        JSON.stringify({ displayName: 'Conformance author' }),
      );
      assert.equal(invalidVersion.response.status, 400);
      assert.equal(invalidVersion.body.error.code, 'INVALID_EXPECTED_VERSION');
      const uninvited = await fixture.google('uninvited-boundary');
      const invalidInvitation = await observe(
        'acceptInvitation',
        '/v1/invitations/accept',
        'POST',
        {
          ...metadata,
          Authorization: 'Bearer ' + uninvited.token,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        JSON.stringify({ token: 'A'.repeat(43) }),
      );
      assert.equal(invalidInvitation.response.status, 404);
      assert.equal(invalidInvitation.body.error.code, 'INVITATION_INVALID');
      // Exercise the actual HTTP error boundary with an explicitly injected failing dependency.
      // This proves safe wire behavior, not a real provider timeout or provider availability.
      const gateway = app.get<FirebaseIdentityGateway>(IDENTITY_GATEWAY);
      const original = gateway.verify;
      try {
        for (const [status, code, failure] of [
          [
            500,
            'INTERNAL_ERROR',
            new Error('private conformance dependency detail'),
          ],
          [
            504,
            'UPSTREAM_TIMEOUT',
            new ApiError(
              504,
              'UPSTREAM_TIMEOUT',
              'Upstream unavailable',
              'The upstream request timed out.',
            ),
          ],
        ] as const) {
          gateway.verify = async () => {
            throw failure;
          };
          const result = await observe('getMe', '/v1/me', 'GET', {
            ...metadata,
            Authorization: 'Bearer conformance-dependency-failure',
          });
          assert.equal(result.response.status, status);
          assert.equal(result.body.error.code, code);
          assert.ok(
            !JSON.stringify(result.body).includes(
              'private conformance dependency detail',
            ),
          );
        }
      } finally {
        gateway.verify = original;
      }
      const runId = process.env.BLOGPOST_IDENTITY_RUN_ID!;
      assert.match(runId, /^[a-f0-9]{12}$/);
      await writeFile(
        `/app/.local/conformance/boundary-${runId}.json`,
        JSON.stringify(
          {
            ...coverage('backend', executed),
            runId,
            testProject: config.identityProject,
            observedOperations: [...executed],
            servedBuildSha: config.buildSha,
            metadataRejected,
            anonymousRejected,
            wireBoundarySuitePassed: true,
            healthVerified,
            observedAt: new Date().toISOString(),
            injectedDependencyErrors: ['INTERNAL_ERROR', 'UPSTREAM_TIMEOUT'],
          },
          null,
          2,
        ) + '\n',
      );
    } finally {
      if (temporaryMemberId)
        await fixture.database.prisma.member.delete({
          where: { id: temporaryMemberId },
        });
    }
  },
);
