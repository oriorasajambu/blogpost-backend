import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertConforms,
  catalog,
  ConformanceError,
  coverage,
  operationFor,
  wireOperation,
  type Exchange,
} from '../conformance/verify.js';

function fixture(id: string): Exchange {
  const planned = catalog.find((operation) => operation.operationId === id)!;
  const request = JSON.parse(
    readFileSync(`contracts/fixtures/operations/${id}.request.json`, 'utf8'),
  );
  const body = JSON.parse(
    readFileSync(`contracts/fixtures/operations/${id}.response.json`, 'utf8'),
  );
  const headers: Exchange['headers'] = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-trace-id': body.traceId,
    'x-api-contract-version': body.meta.contractVersion,
  };
  const response = wireOperation(id).responses[String(body.statusCode)]!;
  if (response.headers?.['X-Resource-Version'])
    headers['x-resource-version'] = String(
      body.data.version ?? body.data.invitation.version,
    );
  if (response.headers?.Location) headers.location = request.path;
  return {
    method: planned.method,
    path: request.path,
    status: body.statusCode,
    headers,
    body: JSON.stringify(body),
  };
}

test('independent conformance verifies all 50 JSON success fixtures, headers and versions', () => {
  let count = 0;
  for (const operation of catalog) {
    const status = Object.keys(
      wireOperation(operation.operationId).responses,
    ).find((status) => /^2/.test(status))!;
    if (
      !wireOperation(operation.operationId).responses[status]!.content?.[
        'application/json'
      ]
    )
      continue;
    assertConforms(operation.operationId, fixture(operation.operationId));
    count++;
  }
  assert.equal(count, 50);
});

test('documented 405 responses require a known path and an actually unsupported method', () => {
  const original = fixture('getMe');
  const body = JSON.parse(
    readFileSync('contracts/fixtures/errors/method-not-allowed.json', 'utf8'),
  );
  const exchange: Exchange = {
    ...original,
    method: 'POST',
    status: 405,
    headers: {
      ...original.headers,
      'x-trace-id': body.traceId,
      allow: 'GET, HEAD, PATCH, OPTIONS',
    },
    body: JSON.stringify(body),
  };
  delete exchange.headers['x-resource-version'];
  assertConforms('getMe', exchange);
  assert.throws(
    () => assertConforms('getMe', { ...exchange, path: '/v1/unknown' }),
    /METHOD_OR_PATH/,
  );
  assert.throws(
    () => assertConforms('getMe', { ...exchange, method: 'PATCH' }),
    /METHOD_OR_PATH/,
  );
  assert.throws(
    () => assertConforms('getMe', { ...exchange, status: 200 }),
    /METHOD_OR_PATH/,
  );
});

test('conformance rejects header/status/schema mismatches without exposing a private body', () => {
  const original = fixture('createPost');
  for (const corrupt of [
    (exchange: Exchange) => {
      exchange.status = 200;
    },
    (exchange: Exchange) => {
      delete exchange.headers['cache-control'];
    },
    (exchange: Exchange) => {
      exchange.headers['x-resource-version'] = '9';
    },
    (exchange: Exchange) => {
      exchange.headers['x-trace-id'] = ['a'.repeat(32), 'b'.repeat(32)];
    },
    (exchange: Exchange) => {
      exchange.headers['x-trace-id'] = 'a'.repeat(32);
    },
    (exchange: Exchange) => {
      exchange.body = '{"private":"must-not-be-reported"}';
    },
  ]) {
    const exchange = structuredClone(original);
    corrupt(exchange);
    assert.throws(
      () => assertConforms('createPost', exchange),
      (error: unknown) => {
        assert.ok(error instanceof ConformanceError);
        assert.equal(error.message.includes('must-not-be-reported'), false);
        return true;
      },
    );
  }
});

test('conformance rejects duplicate keys, malformed UTF-8, HTML and private public projections', () => {
  const original = fixture('getPublicPost');
  const duplicate = {
    ...original,
    body: String(original.body).replace('{', '{"data":null,'),
  };
  assert.throws(
    () => assertConforms('getPublicPost', duplicate),
    /DUPLICATE_JSON_KEY/,
  );
  assert.throws(
    () =>
      assertConforms('getPublicPost', {
        ...original,
        body: Buffer.from([0xc3, 0x28]),
      }),
    /INVALID_JSON_OR_UTF8/,
  );
  assert.throws(
    () =>
      assertConforms('getPublicPost', {
        ...original,
        headers: { ...original.headers, 'content-type': 'text/html' },
        body: '<html>private</html>',
      }),
    /CONTENT_TYPE/,
  );
  const body = JSON.parse(String(original.body));
  body.data.author.email = 'private@example.test';
  assert.throws(
    () =>
      assertConforms('getPublicPost', {
        ...original,
        body: JSON.stringify(body),
      }),
    /PRIVATE_FIELD_IN_PUBLIC_PROJECTION/,
  );
});

test('binary conformance validates image magic and denies leaked workspace versions', () => {
  const planned = catalog.find(
    (operation) => operation.operationId === 'getPublicPostMedia',
  )!;
  const request = JSON.parse(
    readFileSync(
      'contracts/fixtures/operations/getPublicPostMedia.request.json',
      'utf8',
    ),
  );
  const exchange: Exchange = {
    method: planned.method,
    path: request.path,
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-trace-id': 'a'.repeat(32),
      'x-api-contract-version': '1.0.0',
    },
    body: readFileSync('contracts/fixtures/media/pixel.png'),
  };
  assert.equal(assertConforms(planned.operationId, exchange).binary, true);
  assert.throws(
    () =>
      assertConforms(planned.operationId, {
        ...exchange,
        body: Buffer.from('not an image'),
      }),
    /IMAGE_MAGIC/,
  );
  assert.throws(
    () =>
      assertConforms(planned.operationId, {
        ...exchange,
        headers: { ...exchange.headers, 'x-resource-version': '1' },
      }),
    /WORKSPACE_VERSION/,
  );
});

test('producer conformance rejects undeclared ORM fields even when response consumers allow additions', () => {
  const exchange = fixture('getPublicPost');
  const body = JSON.parse(String(exchange.body));
  body.data.unexpectedDatabaseColumn = 'must never leave the serializer';
  assert.throws(
    () =>
      assertConforms('getPublicPost', {
        ...exchange,
        body: JSON.stringify(body),
      }),
    /UNDECLARED_PRODUCER_FIELD/,
  );
});

test('coverage reports absent backend implementation as incomplete and resolves literal routes first', () => {
  const report = coverage('backend', new Set(['getApiMeta']));
  assert.equal(report.executed, 1);
  assert.equal(report.pending.length, 51);
  assert.equal(report.complete, false);
  assert.deepEqual(report.configuredBackendOperations, [
    'getApiMeta',
    'createWebSession',
    'getMe',
    'updateMe',
    'acceptInvitation',
    'listMembers',
    'getMember',
    'updateMember',
    'listInvitations',
    'getInvitation',
    'createInvitation',
    'revokeInvitation',
    'reissueInvitation',
    'listAuditEvents',
    'listWorkspacePosts',
    'createPost',
    'getPostByClientDraftId',
    'getWorkspacePost',
    'savePostDraft',
    'submitPostForReview',
    'withdrawPostReview',
    'rejectPostRevision',
    'publishPostRevision',
    'unpublishPost',
    'listPostRevisions',
    'getPostRevision',
    'listPostReviewEvents',
    'restorePostRevision',
    'trashPost',
    'restoreTrashedPost',
    'changePostSlug',
    'reassignPostAuthor',
    'listPublicPosts',
    'searchPublicPosts',
    'listPublicCategories',
    'listPublicTags',
    'getPublicPost',
    'resolvePublicPostSlug',
    'getPublicAuthor',
    'checkPublicPostAvailability',
    'listManagedCategories',
    'getManagedCategory',
    'createCategory',
    'updateCategory',
    'listManagedTags',
    'getManagedTag',
    'createTag',
    'updateTag',
    'getPublicPostMedia',
    'stagePostMedia',
    'getPostMediaMetadata',
    'getPrivatePostMedia',
  ]);
  assert.equal(
    operationFor('GET', '/v1/posts/by-client-draft-id/a')?.operationId,
    'getPostByClientDraftId',
  );
  assert.equal(
    operationFor('GET', '/v1/public/posts/by-slug/a')?.operationId,
    'resolvePublicPostSlug',
  );
  assert.equal(
    operationFor('GET', '/v1/posts/a')?.operationId,
    'getWorkspacePost',
  );
  assert.throws(() => coverage('backend', new Set(['notAnOperation'])));
});
