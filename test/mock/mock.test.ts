import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { createMock } from '../../mock/server.js';
import { fixtureIds, MockState, type DTO } from '../../mock/state.js';
import { metadata } from '../helpers.js';
import { operations } from '../../mock/contract.js';
import {
  assertConforms,
  coverage,
  operationFor,
} from '../conformance/verify.js';

const exercisedOperations = new Set<string>();
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => {
    resolve = ready;
  });
  return { promise, resolve };
}

const NOW = Date.parse('2026-10-26T01:00:00.000Z');
const draft = {
  title: 'A new article',
  summary: 'A useful summary',
  markdown: '# A new article\n\nInitial body.',
  categoryId: fixtureIds.category,
  tagIds: [fixtureIds.tag],
  coverMediaId: null,
};
type Post = DTO<'WorkspacePost'>;
interface Body<T> {
  timestamp: string;
  traceId: string;
  statusCode: number;
  data: T;
  error: { code: string; context: Record<string, unknown> } | null;
  meta: {
    idempotency: { replayed: boolean; expiresAt: string } | null;
    pagination: DTO<'CursorPagination'> | null;
  };
}
function parse<T>(response: LightMyRequestResponse, status = 200): Body<T> {
  assert.equal(response.statusCode, status, response.body);
  const body = response.json<Body<T>>();
  assert.equal(body.statusCode, response.statusCode);
  assert.equal(body.traceId, response.headers['x-trace-id']);
  assert.equal(response.headers['cache-control'], 'no-store');
  return body;
}
function setup(t: TestContext, onFaultTaken?: (operationId: string) => void) {
  const violations: Error[] = [];
  const mock = createMock({
    now: NOW,
    onContractViolation: (error) => violations.push(error),
    onFaultTaken,
  });
  mock.app.addHook('onSend', (request, reply, payload, done) => {
    const operation = operationFor(request.method, request.url);
    if (
      operation &&
      (typeof payload === 'string' || Buffer.isBuffer(payload))
    ) {
      try {
        assertConforms(operation.operationId, {
          method: request.method,
          path: request.url,
          status: reply.statusCode,
          headers: reply.getHeaders(),
          body: payload,
        });
        if (reply.statusCode < 300)
          exercisedOperations.add(operation.operationId);
      } catch (error) {
        violations.push(error as Error);
      }
    }
    done(null, payload);
  });
  t.after(async () => {
    await mock.app.close();
    assert.deepEqual(
      violations.map((error) => error.message),
      [],
    );
  });
  const call = (
    method: InjectOptions['method'],
    url: string,
    body?: object,
    version?: number,
    key = randomUUID(),
    user: string | null = 'author',
  ) =>
    mock.app.inject({
      method,
      url,
      headers: {
        ...metadata,
        ...(user ? { authorization: `Bearer mock-${user}` } : {}),
        'idempotency-key': key,
        ...(version === undefined
          ? {}
          : { 'x-expected-version': String(version) }),
      },
      payload: body,
    });
  const create = async (user = 'author') =>
    parse<Post>(
      await call(
        'POST',
        '/v1/posts',
        { clientDraftId: randomUUID(), draft },
        undefined,
        undefined,
        user,
      ),
      201,
    ).data;
  return { ...mock, violations, call, create };
}
function uploadPayload() {
  const boundary = 'blogpost-fixture-boundary';
  const bytes = readFileSync('contracts/fixtures/media/pixel.png');
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    bytes: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pixel.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

test('schema-validated editorial journey preserves public snapshots and reauthorizes media after withdrawal', async (t) => {
  const { call, create, app } = setup(t);
  let post = await create();
  const firstRevision = post.workingRevision!;
  const upload = uploadPayload();
  const media = parse<DTO<'MediaAsset'>>(
    await app.inject({
      method: 'POST',
      url: `/v1/posts/${post.id}/media`,
      headers: {
        ...metadata,
        authorization: 'Bearer mock-author',
        'idempotency-key': randomUUID(),
        'content-type': upload.contentType,
      },
      payload: upload.bytes,
    }),
    201,
  ).data;
  assert.equal(
    parse<Post>(await call('GET', `/v1/posts/${post.id}`)).data.version,
    1,
  );
  const content = {
    ...draft,
    markdown: `Published words.\n\n![A blue pixel](media://${media.id})`,
    coverMediaId: media.id,
    coverAltText: 'A blue pixel',
  };
  post = parse<Post>(
    await call('PUT', `/v1/posts/${post.id}/draft`, content, 1),
  ).data;
  assert.equal(post.version, 2);
  post = parse<Post>(
    await call(
      'POST',
      `/v1/posts/${post.id}/submit`,
      { revisionId: post.workingRevisionId },
      2,
    ),
  ).data;
  assert.equal(post.workflowState, 'IN_REVIEW');
  assert.equal(
    parse<null>(await call('PUT', `/v1/posts/${post.id}/draft`, draft, 3), 409)
      .error?.code,
    'WORKFLOW_CONFLICT',
  );
  assert.equal(
    parse<null>(
      await call(
        'POST',
        `/v1/posts/${post.id}/publish`,
        { revisionId: firstRevision.id },
        3,
        undefined,
        'editor',
      ),
      409,
    ).error?.code,
    'WORKFLOW_CONFLICT',
  );
  post = parse<Post>(
    await call(
      'POST',
      `/v1/posts/${post.id}/publish`,
      { revisionId: post.workingRevisionId },
      3,
      undefined,
      'editor',
    ),
  ).data;
  assert.equal(post.version, 4);
  const article = parse<DTO<'PublicPost'>>(
    await call(
      'GET',
      `/v1/public/posts/${post.id}`,
      undefined,
      undefined,
      undefined,
      null,
    ),
  ).data;
  assert.equal(
    article.media[0]!.variants[0]!.apiPath,
    `/v1/public/posts/${post.id}/media/${media.id}/w480`,
  );
  assert.ok(!JSON.stringify(article).includes('clientDraftId'));
  assert.ok(!JSON.stringify(article).includes('email'));
  const binary = await call(
    'GET',
    article.media[0]!.variants[0]!.apiPath,
    undefined,
    undefined,
    undefined,
    null,
  );
  assert.equal(binary.statusCode, 200);
  assert.equal(binary.headers['content-type'], 'image/png');
  assert.ok(binary.rawPayload.length > 0);
  post = parse<Post>(
    await call(
      'PUT',
      `/v1/posts/${post.id}/draft`,
      {
        ...content,
        title: 'Private future title',
        markdown: 'Private future body.',
      },
      4,
    ),
  ).data;
  assert.equal(post.version, 5);
  assert.deepEqual(
    parse<DTO<'PublicPost'>>(
      await call(
        'GET',
        `/v1/public/posts/${post.id}`,
        undefined,
        undefined,
        undefined,
        null,
      ),
    ).data,
    article,
  );
  assert.deepEqual(
    parse<DTO<'Revision'>>(
      await call('GET', `/v1/posts/${post.id}/revisions/${firstRevision.id}`),
    ).data,
    firstRevision,
  );
  assert.equal(
    parse<unknown[]>(
      await call(
        'GET',
        '/v1/public/search?q=Private%20future',
        undefined,
        undefined,
        undefined,
        null,
      ),
    ).data.length,
    0,
  );
  post = parse<Post>(
    await call(
      'POST',
      `/v1/posts/${post.id}/unpublish`,
      {},
      5,
      undefined,
      'editor',
    ),
  ).data;
  assert.equal(post.publicationState, 'WITHDRAWN');
  parse(
    await call(
      'GET',
      `/v1/public/posts/${post.id}`,
      undefined,
      undefined,
      undefined,
      null,
    ),
    404,
  );
  parse(
    await call(
      'GET',
      article.media[0]!.variants[0]!.apiPath,
      undefined,
      undefined,
      undefined,
      null,
    ),
    404,
  );
  assert.equal(
    (await call('GET', `/v1/posts/${post.id}/media/${media.id}/w480`))
      .statusCode,
    200,
  );
  const other = await create('other-author');
  parse(
    await call(
      'GET',
      `/v1/posts/${other.id}/media/${media.id}/w480`,
      undefined,
      undefined,
      undefined,
      'other-author',
    ),
    404,
  );
  parse(
    await call(
      'PUT',
      `/v1/posts/${other.id}/draft`,
      { ...draft, coverMediaId: media.id, coverAltText: 'Not owned' },
      1,
      undefined,
      'other-author',
    ),
    404,
  );
});

test('replay returns the original version before stale-version checks, while current membership remains authoritative', async (t) => {
  const { call, create } = setup(t);
  const post = await create();
  const path = `/v1/posts/${post.id}/draft`;
  const key = randomUUID();
  const saved = parse<Post>(
    await call('PUT', path, { ...draft, title: 'Saved once' }, 1, key),
  );
  parse(await call('PUT', path, { ...draft, title: 'Saved twice' }, 2));
  const replay = parse<Post>(
    await call(
      'PUT',
      path,
      {
        title: 'Saved once',
        ...Object.fromEntries(
          Object.entries(draft).filter(([key]) => key !== 'title'),
        ),
      },
      1,
      key,
    ),
  );
  assert.equal(replay.data.version, 2);
  assert.deepEqual(replay.data, saved.data);
  assert.equal(replay.meta.idempotency?.replayed, true);
  assert.notEqual(replay.traceId, saved.traceId);
  assert.equal(
    parse(
      await call(
        'PUT',
        path,
        { ...draft, title: 'Changed semantic input' },
        1,
        key,
      ),
      409,
    ).error?.code,
    'IDEMPOTENCY_KEY_REUSED',
  );
  const stale = parse(await call('PUT', path, draft, 1), 412);
  assert.equal(stale.error?.context.currentVersion, 3);
  assert.ok(!JSON.stringify(stale.error?.context).includes('Saved twice'));
  parse(
    await call(
      'PATCH',
      `/v1/admin/members/${fixtureIds.author}`,
      { active: false },
      1,
      undefined,
      'admin',
    ),
  );
  assert.equal(
    parse(
      await call('PUT', path, { ...draft, title: 'Saved once' }, 1, key),
      403,
    ).error?.code,
    'ACCESS_REVOKED',
  );
});

test('private ownership, creator recovery, no-op saves and missing/malformed versions obey the wire rules', async (t) => {
  const { call, create, state, app } = setup(t);
  const post = await create();
  parse(
    await call(
      'GET',
      `/v1/posts/${post.id}`,
      undefined,
      undefined,
      undefined,
      'other-author',
    ),
    404,
  );
  parse(
    await call(
      'GET',
      `/v1/posts/by-client-draft-id/${post.clientDraftId}`,
      undefined,
      undefined,
      undefined,
      'other-author',
    ),
    404,
  );
  assert.equal(
    parse<Post>(
      await call('GET', `/v1/posts/by-client-draft-id/${post.clientDraftId}`),
    ).data.id,
    post.id,
  );
  assert.equal(
    parse<Post>(await call('PUT', `/v1/posts/${post.id}/draft`, draft, 1)).data
      .version,
    1,
  );
  assert.equal(
    parse(await call('PUT', `/v1/posts/${post.id}/draft`, draft), 428).error
      ?.code,
    'EXPECTED_VERSION_REQUIRED',
  );
  const malformed = await app.inject({
    method: 'PUT',
    url: `/v1/posts/${post.id}/draft`,
    headers: {
      ...metadata,
      authorization: 'Bearer mock-author',
      'idempotency-key': randomUUID(),
      'x-expected-version': '2147483648',
    },
    payload: draft,
  });
  assert.equal(parse(malformed, 400).error?.code, 'INVALID_EXPECTED_VERSION');
  const duplicate = parse(
    await call('POST', '/v1/posts', {
      clientDraftId: post.clientDraftId,
      draft,
    }),
    409,
  );
  assert.equal(duplicate.error?.code, 'CLIENT_DRAFT_ALREADY_EXISTS');
  assert.equal(duplicate.error?.context.resourceId, post.id);
  parse(
    await call(
      'PATCH',
      `/v1/admin/posts/${post.id}/author`,
      { authorId: fixtureIds.otherAuthor },
      1,
      undefined,
      'admin',
    ),
  );
  parse(
    await call('GET', `/v1/posts/by-client-draft-id/${post.clientDraftId}`),
    404,
  );
  parse(
    await call(
      'GET',
      `/v1/posts/by-client-draft-id/${post.clientDraftId}`,
      undefined,
      undefined,
      undefined,
      'other-author',
    ),
    404,
  );
  assert.equal(state().posts.get(post.id)!.dto.version, 2);
});

test('in-progress operations have bounded leases and expire under the scenario clock', async (t) => {
  const { call, app } = setup(t);
  await app.inject({
    method: 'POST',
    url: '/__mock/fault',
    payload: { operationId: 'createPost', mode: 'in-progress' },
  });
  const key = randomUUID();
  const input = { clientDraftId: randomUUID(), draft };
  const first = await call('POST', '/v1/posts', input, undefined, key);
  assert.equal(parse(first, 409).error?.code, 'IDEMPOTENCY_IN_PROGRESS');
  assert.equal(first.headers['retry-after'], '1');
  parse(await call('POST', '/v1/posts', input, undefined, key), 409);
  await app.inject({
    method: 'POST',
    url: '/__mock/clock',
    payload: { milliseconds: 31_000 },
  });
  parse(await call('POST', '/v1/posts', input, undefined, key), 201);
});

test('a dropped response occurs after commit and an identical retry recovers that single result', async (t) => {
  const { app, call, state } = setup(t);
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  await app.inject({
    method: 'POST',
    url: '/__mock/fault',
    payload: { operationId: 'createPost', mode: 'drop-after-commit' },
  });
  const key = randomUUID();
  const input = { clientDraftId: randomUUID(), draft };
  await assert.rejects(
    fetch(`${origin}/v1/posts`, {
      method: 'POST',
      headers: {
        ...metadata,
        authorization: 'Bearer mock-author',
        'idempotency-key': key,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(3000),
    }),
    (error: unknown) => {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      assert.ok(
        code === 'UND_ERR_SOCKET' || code === 'ECONNRESET',
        `Expected the committed response socket to close; got ${code}`,
      );
      return true;
    },
  );
  assert.equal(state().posts.size, 2);
  const retry = parse<Post>(
    await call('POST', '/v1/posts', input, undefined, key),
    201,
  );
  assert.equal(retry.meta.idempotency?.replayed, true);
  assert.equal(state().posts.size, 2);
  assert.equal(
    parse<Post>(
      await call('GET', `/v1/posts/by-client-draft-id/${input.clientDraftId}`),
    ).data.id,
    retry.data.id,
  );
});

test('invitation links replay as secret-free receipts; account mismatch and single use are enforced', async (t) => {
  const { call, state } = setup(t);
  const key = randomUUID();
  const input = { email: 'invited@example.test', role: 'AUTHOR' };
  const issued = parse<DTO<'InvitationIssueResult'>>(
    await call('POST', '/v1/admin/invitations', input, undefined, key, 'admin'),
    201,
  ).data;
  const token = new URL(issued.inviteUrl!).searchParams.get('token')!;
  const replay = parse<DTO<'InvitationIssueResult'>>(
    await call('POST', '/v1/admin/invitations', input, undefined, key, 'admin'),
    201,
  ).data;
  assert.equal(replay.inviteUrl, null);
  assert.equal(replay.linkAvailable, false);
  assert.ok(!JSON.stringify([...state().operations.values()]).includes(token));
  assert.equal(
    parse(await call('POST', '/v1/invitations/accept', { token }), 403).error
      ?.code,
    'INVITATION_ACCOUNT_MISMATCH',
  );
  const acceptKey = randomUUID();
  const member = parse<DTO<'Me'>>(
    await call(
      'POST',
      '/v1/invitations/accept',
      { token },
      undefined,
      acceptKey,
      'uninvited',
    ),
  ).data;
  assert.equal(member.id, fixtureIds.uninvited);
  assert.equal(
    parse(
      await call(
        'POST',
        '/v1/invitations/accept',
        { token },
        undefined,
        acceptKey,
        'uninvited',
      ),
    ).meta.idempotency?.replayed,
    true,
  );
  assert.equal(
    parse(
      await call(
        'POST',
        '/v1/invitations/accept',
        { token },
        undefined,
        undefined,
        'uninvited',
      ),
      410,
    ).error?.code,
    'INVITATION_USED',
  );
});

test('invitation reissue revokes the old secret and clock-controlled expiry is relative to reset', async (t) => {
  const { call, app } = setup(t);
  const old = parse<DTO<'InvitationIssueResult'>>(
    await call(
      'POST',
      '/v1/admin/invitations',
      { email: 'invited@example.test', role: 'EDITOR' },
      undefined,
      undefined,
      'admin',
    ),
    201,
  ).data;
  const oldToken = new URL(old.inviteUrl!).searchParams.get('token')!;
  const reissued = parse<DTO<'InvitationIssueResult'>>(
    await call(
      'POST',
      `/v1/admin/invitations/${old.invitation.id}/reissue`,
      {},
      1,
      undefined,
      'admin',
    ),
    201,
  ).data;
  assert.notEqual(reissued.invitation.id, old.invitation.id);
  assert.equal(
    parse(
      await call(
        'POST',
        '/v1/invitations/accept',
        { token: oldToken },
        undefined,
        undefined,
        'uninvited',
      ),
      410,
    ).error?.code,
    'INVITATION_REVOKED',
  );
  await app.inject({
    method: 'POST',
    url: '/__mock/clock',
    payload: { milliseconds: 7 * 86_400_000 },
  });
  const token = new URL(reissued.inviteUrl!).searchParams.get('token')!;
  assert.equal(
    parse(
      await call(
        'POST',
        '/v1/invitations/accept',
        { token },
        undefined,
        undefined,
        'uninvited',
      ),
      410,
    ).error?.code,
    'INVITATION_EXPIRED',
  );
  await app.inject({ method: 'POST', url: '/__mock/reset', payload: {} });
  parse(
    await call('GET', '/v1/me', undefined, undefined, undefined, 'uninvited'),
    403,
  );
});

test('cursor pagination binds filters and page size and expires without offset duplication', async (t) => {
  const { call, app, create } = setup(t);
  await create();
  const own = parse<DTO<'WorkspacePostSummary'>[]>(
    await call('GET', '/v1/posts?pageSize=1'),
  );
  const equivalent = parse<DTO<'WorkspacePostSummary'>[]>(
    await call(
      'GET',
      `/v1/posts?pageSize=1&scope=OWN&trashed=false&cursor=${own.meta.pagination!.nextCursor}`,
    ),
  );
  assert.notEqual(own.data[0]!.id, equivalent.data[0]!.id);
  const first = parse<DTO<'AdminMember'>[]>(
    await call(
      'GET',
      '/v1/admin/members?pageSize=1',
      undefined,
      undefined,
      undefined,
      'admin',
    ),
  );
  assert.equal(first.data.length, 1);
  const cursor = first.meta.pagination!.nextCursor!;
  const second = parse<DTO<'AdminMember'>[]>(
    await call(
      'GET',
      `/v1/admin/members?pageSize=1&cursor=${cursor}`,
      undefined,
      undefined,
      undefined,
      'admin',
    ),
  );
  assert.notEqual(first.data[0]!.id, second.data[0]!.id);
  assert.equal(
    parse(
      await call(
        'GET',
        `/v1/admin/members?pageSize=2&cursor=${cursor}`,
        undefined,
        undefined,
        undefined,
        'admin',
      ),
      400,
    ).error?.code,
    'INVALID_CURSOR',
  );
  parse(
    await call(
      'GET',
      `/v1/admin/members?pageSize=1&role=ADMIN&cursor=${cursor}`,
      undefined,
      undefined,
      undefined,
      'admin',
    ),
    400,
  );
  await app.inject({
    method: 'POST',
    url: '/__mock/clock',
    payload: { milliseconds: 86_400_000 },
  });
  parse(
    await call(
      'GET',
      `/v1/admin/members?pageSize=1&cursor=${cursor}`,
      undefined,
      undefined,
      undefined,
      'admin',
    ),
    400,
  );
});

test('archived taxonomy prevents publication and slug reservations resolve directly to the current canonical slug', async (t) => {
  const { call, create } = setup(t);
  let post = await create();
  parse(
    await call(
      'PATCH',
      `/v1/categories/${fixtureIds.category}`,
      { active: false },
      1,
      undefined,
      'editor',
    ),
  );
  parse(
    await call(
      'POST',
      `/v1/posts/${post.id}/submit`,
      { revisionId: post.workingRevisionId },
      1,
    ),
    409,
  );
  parse(
    await call(
      'PATCH',
      `/v1/categories/${fixtureIds.category}`,
      { active: true },
      2,
      undefined,
      'editor',
    ),
  );
  post = parse<Post>(
    await call(
      'POST',
      `/v1/posts/${post.id}/submit`,
      { revisionId: post.workingRevisionId },
      1,
    ),
  ).data;
  post = parse<Post>(
    await call(
      'POST',
      `/v1/posts/${post.id}/publish`,
      { revisionId: post.workingRevisionId },
      2,
      undefined,
      'editor',
    ),
  ).data;
  const oldSlug = post.slug;
  post = parse<Post>(
    await call(
      'PATCH',
      `/v1/posts/${post.id}/slug`,
      { slug: 'second-slug' },
      3,
      undefined,
      'editor',
    ),
  ).data;
  post = parse<Post>(
    await call(
      'PATCH',
      `/v1/posts/${post.id}/slug`,
      { slug: 'third-slug' },
      4,
      undefined,
      'editor',
    ),
  ).data;
  for (const slug of [oldSlug, 'second-slug']) {
    const resolution = parse<DTO<'SlugResolution'>>(
      await call(
        'GET',
        `/v1/public/posts/by-slug/${slug}`,
        undefined,
        undefined,
        undefined,
        null,
      ),
    ).data;
    assert.equal(resolution.resolution, 'REDIRECT');
    assert.equal(resolution.canonicalSlug, 'third-slug');
    assert.equal(resolution.post, null);
  }
  parse(await call('DELETE', `/v1/posts/${post.id}`, undefined, 5), 403);
  post = parse<Post>(
    await call(
      'DELETE',
      `/v1/posts/${post.id}`,
      undefined,
      5,
      undefined,
      'editor',
    ),
  ).data;
  post = parse<Post>(
    await call(
      'POST',
      `/v1/posts/${post.id}/restore`,
      {},
      6,
      undefined,
      'editor',
    ),
  ).data;
  assert.equal(post.workflowState, 'DRAFT');
  assert.equal(post.publicationState, 'WITHDRAWN');
  parse(
    await call(
      'GET',
      `/v1/public/posts/${post.id}`,
      undefined,
      undefined,
      undefined,
      null,
    ),
    404,
  );
});

test('current permissions are checked after latency and the last active admin is retained', async (t) => {
  const entered = barrier();
  const { call, app, create } = setup(t, () => entered.resolve());
  const post = await create();
  await app.inject({
    method: 'POST',
    url: '/__mock/fault',
    payload: {
      operationId: 'savePostDraft',
      mode: 'latency',
      milliseconds: 100,
    },
  });
  const delayed = Promise.resolve(
    call(
      'PUT',
      `/v1/posts/${post.id}/draft`,
      { ...draft, title: 'Must not commit' },
      1,
    ),
  );
  await entered.promise;
  parse(
    await call(
      'PATCH',
      `/v1/admin/members/${fixtureIds.author}`,
      { active: false },
      1,
      undefined,
      'admin',
    ),
  );
  assert.equal(parse(await delayed, 403).error?.code, 'ACCESS_REVOKED');
  assert.equal(
    parse<Post>(
      await call(
        'GET',
        `/v1/posts/${post.id}`,
        undefined,
        undefined,
        undefined,
        'editor',
      ),
    ).data.version,
    1,
  );
  parse(
    await call(
      'PATCH',
      `/v1/admin/members/${fixtureIds.admin}`,
      { role: 'AUTHOR' },
      1,
      undefined,
      'admin',
    ),
    409,
  );
  parse(
    await call(
      'PATCH',
      `/v1/admin/members/${fixtureIds.editor}`,
      { role: 'ADMIN' },
      1,
      undefined,
      'admin',
    ),
  );
  const changes = await Promise.all([
    call(
      'PATCH',
      `/v1/admin/members/${fixtureIds.admin}`,
      { role: 'AUTHOR' },
      1,
      undefined,
      'admin',
    ),
    call(
      'PATCH',
      `/v1/admin/members/${fixtureIds.editor}`,
      { role: 'AUTHOR' },
      2,
      undefined,
      'editor',
    ),
  ]);
  assert.deepEqual(
    changes.map((response) => response.statusCode).sort(),
    [200, 409],
  );
});

test('metadata, strict inputs, media bounds, sessions and safe failure injection share envelope rules', async (t) => {
  const { call, app } = setup(t);
  parse(await call('GET', '/v1/meta', undefined, undefined, undefined, null));
  const profile = parse<DTO<'Me'>>(
    await call(
      'PATCH',
      '/v1/me',
      { displayName: 'Updated author', bio: null },
      1,
    ),
  ).data;
  assert.equal(profile.displayName, 'Updated author');
  assert.equal(profile.bio, '');
  assert.equal(profile.version, 2);
  assert.equal(
    parse(await app.inject('/v1/meta'), 400).error?.code,
    'INVALID_CLIENT_METADATA',
  );
  parse(
    await call(
      'GET',
      '/v1/public/posts?unexpected=true',
      undefined,
      undefined,
      undefined,
      null,
    ),
    422,
  );
  parse(
    await call('POST', '/v1/posts', {
      clientDraftId: randomUUID(),
      draft,
      unexpected: true,
    }),
    422,
  );
  parse(
    await call('GET', '/v1/me', undefined, undefined, undefined, null),
    401,
  );
  const session = parse<DTO<'WebSession'>>(
    await call(
      'POST',
      '/v1/auth/web-session',
      { idToken: 'mock-author' },
      undefined,
      undefined,
      null,
    ),
  ).data;
  parse(
    await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { ...metadata, 'x-blogpost-web-session': session.sessionCookie },
    }),
  );
  parse(
    await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: {
        ...metadata,
        authorization: 'Bearer mock-author',
        'x-blogpost-web-session': session.sessionCookie,
      },
    }),
    400,
  );
  await app.inject({
    method: 'POST',
    url: '/__mock/fault',
    payload: {
      operationId: 'createPost',
      mode: 'error',
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
    },
  });
  const input = { clientDraftId: randomUUID(), draft };
  const key = randomUUID();
  parse(await call('POST', '/v1/posts', input, undefined, key), 503);
  parse(await call('POST', '/v1/posts', input, undefined, key), 201);
  await app.inject({
    method: 'POST',
    url: '/__mock/clock',
    payload: { milliseconds: 5 * 86_400_000 },
  });
  parse(
    await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { ...metadata, 'x-blogpost-web-session': session.sessionCookie },
    }),
    401,
  );
});

test('taxonomy CRUD normalizes names, enforces uniqueness and exposes the same retained public taxonomy', async (t) => {
  const { call } = setup(t);
  for (const kind of ['categories', 'tags']) {
    const created = parse<DTO<'ManagedTaxon'>>(
      await call(
        'POST',
        `/v1/${kind}`,
        { name: '  Cafe\u0301  ', slug: 'cafe' },
        undefined,
        undefined,
        'editor',
      ),
      201,
    ).data;
    assert.equal(created.name, 'Café');
    assert.equal(
      parse<DTO<'ManagedTaxon'>>(
        await call(
          'GET',
          `/v1/${kind}/${created.id}`,
          undefined,
          undefined,
          undefined,
          'editor',
        ),
      ).data.version,
      1,
    );
    parse(
      await call(
        'POST',
        `/v1/${kind}`,
        { name: 'CAFÉ', slug: 'other' },
        undefined,
        undefined,
        'editor',
      ),
      409,
    );
    const renamed = parse<DTO<'ManagedTaxon'>>(
      await call(
        'PATCH',
        `/v1/${kind}/${created.id}`,
        { name: 'Renamed', active: false },
        1,
        undefined,
        'editor',
      ),
    ).data;
    assert.equal(renamed.version, 2);
    assert.equal(renamed.slug, 'cafe');
    const managed = parse<DTO<'ManagedTaxon'>[]>(
      await call(
        'GET',
        `/v1/${kind}?active=false`,
        undefined,
        undefined,
        undefined,
        'editor',
      ),
    ).data;
    assert.equal(managed.length, 1);
    const publicItems = parse<DTO<'Taxon'>[]>(
      await call(
        'GET',
        `/v1/public/${kind}`,
        undefined,
        undefined,
        undefined,
        null,
      ),
    ).data;
    assert.ok(publicItems.some((item) => item.id === renamed.id));
    assert.ok(
      publicItems.every((item) => !('version' in item) && !('usage' in item)),
    );
  }
  parse(
    await call(
      'GET',
      `/v1/admin/members/${fixtureIds.author}`,
      undefined,
      undefined,
      undefined,
      'admin',
    ),
  );
  parse(
    await call(
      'GET',
      '/v1/admin/audit-events?subjectType=TAXON',
      undefined,
      undefined,
      undefined,
      'admin',
    ),
  );
  const author = parse<DTO<'PublicAuthor'>>(
    await call(
      'GET',
      '/v1/public/authors/synthetic-author',
      undefined,
      undefined,
      undefined,
      null,
    ),
  ).data;
  assert.equal(author.id, fixtureIds.author);
  assert.ok(!('email' in author));
});

test('review feedback, history restoration, published attribution and retained uploads remain independent', async (t) => {
  const { call, create, app } = setup(t);
  let post = await create();
  const original = post.workingRevision!;
  post = parse<Post>(
    await call(
      'POST',
      `/v1/posts/${post.id}/submit`,
      { revisionId: original.id },
      1,
    ),
  ).data;
  post = parse<Post>(
    await call(
      'POST',
      `/v1/posts/${post.id}/reject`,
      { revisionId: original.id, feedback: 'Add detail' },
      2,
      undefined,
      'editor',
    ),
  ).data;
  assert.equal(post.review.lastFeedback?.text, 'Add detail');
  assert.equal(post.workflowState, 'CHANGES_REQUESTED');
  post = parse<Post>(
    await call(
      'PUT',
      `/v1/posts/${post.id}/draft`,
      { ...draft, title: 'Second draft' },
      3,
    ),
  ).data;
  post = parse<Post>(
    await call(
      'POST',
      `/v1/posts/${post.id}/restore-revision`,
      { revisionId: original.id },
      4,
    ),
  ).data;
  assert.notEqual(post.workingRevisionId, original.id);
  assert.equal(post.workingRevision?.restoredFromRevisionId, original.id);
  assert.deepEqual(post.workingRevision?.content, original.content);
  post = parse<Post>(
    await call(
      'POST',
      `/v1/posts/${post.id}/submit`,
      { revisionId: post.workingRevisionId },
      5,
    ),
  ).data;
  post = parse<Post>(
    await call('POST', `/v1/posts/${post.id}/withdraw-review`, {}, 6),
  ).data;
  assert.equal(post.workflowState, 'DRAFT');
  const revisions = parse<DTO<'RevisionSummary'>[]>(
    await call('GET', `/v1/posts/${post.id}/revisions?pageSize=2`),
  );
  assert.equal(revisions.data.length, 2);
  assert.equal(revisions.meta.pagination?.hasMore, true);
  assert.equal(
    parse<DTO<'ReviewEvent'>[]>(
      await call('GET', `/v1/posts/${post.id}/review-events`),
    ).data.length,
    4,
  );
  const upload = uploadPayload();
  const media = parse<DTO<'MediaAsset'>>(
    await app.inject({
      method: 'POST',
      url: `/v1/posts/${post.id}/media`,
      headers: {
        ...metadata,
        authorization: 'Bearer mock-author',
        'idempotency-key': randomUUID(),
        'content-type': upload.contentType,
      },
      payload: upload.bytes,
    }),
    201,
  ).data;
  parse(await call('GET', `/v1/posts/${post.id}/media/${media.id}`));
  await app.inject({
    method: 'POST',
    url: '/__mock/clock',
    payload: { milliseconds: 86_400_000 },
  });
  parse(await call('GET', `/v1/posts/${post.id}/media/${media.id}`), 404);
  const items = parse<DTO<'WorkspacePostSummary'>[]>(
    await call('GET', '/v1/posts'),
  ).data;
  assert.ok(items.some((item) => item.id === post.id));
  assert.ok(items.every((item) => !('workingRevision' in item)));
  parse(
    await call(
      'GET',
      '/v1/public/posts',
      undefined,
      undefined,
      undefined,
      null,
    ),
  );
  const available = parse<DTO<'AvailabilityItem'>[]>(
    await call(
      'POST',
      '/v1/public/posts/availability',
      { postIds: [post.id, fixtureIds.post] },
      undefined,
      undefined,
      null,
    ),
  ).data;
  assert.deepEqual(
    available.map((item) => item.available),
    [false, true],
  );
});

test('administrative invitation reads and revocation retain versions without leaking the original link', async (t) => {
  const { call } = setup(t);
  const issued = parse<DTO<'InvitationIssueResult'>>(
    await call(
      'POST',
      '/v1/admin/invitations',
      { email: 'invited@example.test', role: 'AUTHOR' },
      undefined,
      undefined,
      'admin',
    ),
    201,
  ).data;
  const invitation = parse<DTO<'Invitation'>>(
    await call(
      'GET',
      `/v1/admin/invitations/${issued.invitation.id}`,
      undefined,
      undefined,
      undefined,
      'admin',
    ),
  ).data;
  assert.ok(!('inviteUrl' in invitation));
  const pending = parse<DTO<'Invitation'>[]>(
    await call(
      'GET',
      '/v1/admin/invitations?status=PENDING',
      undefined,
      undefined,
      undefined,
      'admin',
    ),
  ).data;
  assert.equal(pending.length, 1);
  const revoked = parse<DTO<'Invitation'>>(
    await call(
      'POST',
      `/v1/admin/invitations/${invitation.id}/revoke`,
      {},
      1,
      undefined,
      'admin',
    ),
  ).data;
  assert.equal(revoked.version, 2);
  assert.equal(revoked.status, 'REVOKED');
});

test(
  'upload retries ignore multipart framing, enforce byte limits, and do not advance the post version',
  { timeout: 5000 },
  async (t) => {
    const { create, app, call } = setup(t);
    const post = await create();
    const key = randomUUID();
    const upload = uploadPayload();
    const first = parse<DTO<'MediaAsset'>>(
      await app.inject({
        method: 'POST',
        url: `/v1/posts/${post.id}/media`,
        headers: {
          ...metadata,
          authorization: 'Bearer mock-author',
          'idempotency-key': key,
          'content-type': upload.contentType,
        },
        payload: upload.bytes,
      }),
      201,
    );
    const renamed = Buffer.from(
      upload.bytes.toString('latin1').replace('pixel.png', 'another-name.png'),
      'latin1',
    );
    const replay = parse<DTO<'MediaAsset'>>(
      await app.inject({
        method: 'POST',
        url: `/v1/posts/${post.id}/media`,
        headers: {
          ...metadata,
          authorization: 'Bearer mock-author',
          'idempotency-key': key,
          'content-type': upload.contentType,
        },
        payload: renamed,
      }),
      201,
    );
    assert.equal(replay.data.id, first.data.id);
    assert.equal(replay.meta.idempotency?.replayed, true);
    assert.equal(
      parse<Post>(await call('GET', `/v1/posts/${post.id}`)).data.version,
      1,
    );
    const excessive = Buffer.concat([
      Buffer.from(
        '--x\r\nContent-Disposition: form-data; name="file"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n',
      ),
      Buffer.alloc(6 * 1024 * 1024 + 1),
      Buffer.from('\r\n--x--\r\n'),
    ]);
    assert.equal(
      parse(
        await app.inject({
          method: 'POST',
          url: `/v1/posts/${post.id}/media`,
          headers: {
            ...metadata,
            authorization: 'Bearer mock-author',
            'idempotency-key': randomUUID(),
            'content-type': 'multipart/form-data; boundary=x',
          },
          payload: excessive,
        }),
        413,
      ).error?.code,
      'UPLOAD_TOO_LARGE',
    );
    parse(
      await call(
        'POST',
        '/v1/auth/web-session',
        { idToken: 'mock-stale-author' },
        undefined,
        undefined,
        null,
      ),
      401,
    );
  },
);

test('the separate mock refuses cloud/production configuration', () => {
  const previous = process.env.BUILD_ENV;
  process.env.BUILD_ENV = 'staging';
  try {
    assert.throws(() => createMock(), /cannot run/);
  } finally {
    if (previous === undefined) delete process.env.BUILD_ENV;
    else process.env.BUILD_ENV = previous;
  }
});

test('the inclusive 5 MiB file bound accepts a valid image at the exact limit', async (t) => {
  const { create, app } = setup(t);
  const post = await create();
  const jpeg = await sharp(readFileSync('contracts/fixtures/media/pixel.png'))
    .jpeg()
    .toBuffer();
  const comments: Buffer[] = [];
  let remaining = 5 * 1024 * 1024 - jpeg.length;
  while (remaining > 0) {
    let length = Math.min(remaining, 65537);
    if (remaining - length > 0 && remaining - length < 4) length -= 4;
    const comment = Buffer.alloc(length);
    comment[0] = 0xff;
    comment[1] = 0xfe;
    comment.writeUInt16BE(length - 2, 2);
    comments.push(comment);
    remaining -= length;
  }
  const file = Buffer.concat([
    jpeg.subarray(0, 2),
    ...comments,
    jpeg.subarray(2),
  ]);
  assert.equal(file.length, 5 * 1024 * 1024);
  const payload = Buffer.concat([
    Buffer.from(
      '--x\r\nContent-Disposition: form-data; name="file"; filename="max.jpg"\r\nContent-Type: image/jpeg\r\n\r\n',
    ),
    file,
    Buffer.from('\r\n--x--\r\n'),
  ]);
  parse<DTO<'MediaAsset'>>(
    await app.inject({
      method: 'POST',
      url: `/v1/posts/${post.id}/media`,
      headers: {
        ...metadata,
        authorization: 'Bearer mock-author',
        'idempotency-key': randomUUID(),
        'content-type': 'multipart/form-data; boundary=x',
      },
      payload,
    }),
    201,
  );
});

test('human clocks follow elapsed wall time while automated clocks remain fixed and resettable', (t) => {
  const wall = t.mock.method(Date, 'now', () => NOW);
  const human = new MockState();
  const automated = new MockState(NOW);
  wall.mock.mockImplementation(() => NOW + 60_000);
  assert.equal(human.now, NOW + 60_000);
  assert.equal(automated.now, NOW);
  human.advance(1000);
  automated.advance(1000);
  assert.equal(human.now, NOW + 61_000);
  assert.equal(automated.now, NOW + 1000);
});

test('a delayed duplicate observes a completed operation instead of overwriting its receipt', async (t) => {
  const entered = barrier();
  const { call, app, state } = setup(t, () => entered.resolve());
  await app.inject({
    method: 'POST',
    url: '/__mock/fault',
    payload: { operationId: 'createPost', mode: 'latency', milliseconds: 100 },
  });
  const input = { clientDraftId: randomUUID(), draft };
  const key = randomUUID();
  const delayed = Promise.resolve(
    call('POST', '/v1/posts', input, undefined, key),
  );
  await entered.promise;
  const first = parse<Post>(
    await call('POST', '/v1/posts', input, undefined, key),
    201,
  );
  const duplicate = parse<Post>(await delayed, 201);
  assert.equal(duplicate.data.id, first.data.id);
  assert.equal(duplicate.meta.idempotency?.replayed, true);
  assert.equal(state().posts.size, 2);
});

test('legacy-shaped saves preserve cover settings and replays cannot overwrite a newer revision', async (t) => {
  const { app, call, create } = setup(t);
  let post = await create();
  const upload = uploadPayload();
  const media = parse<DTO<'MediaAsset'>>(
    await app.inject({
      method: 'POST',
      url: `/v1/posts/${post.id}/media`,
      headers: {
        ...metadata,
        authorization: 'Bearer mock-author',
        'idempotency-key': randomUUID(),
        'content-type': upload.contentType,
      },
      payload: upload.bytes,
    }),
    201,
  ).data;
  post = parse<Post>(
    await call(
      'PUT',
      `/v1/posts/${post.id}/draft`,
      {
        ...draft,
        coverMediaId: media.id,
        coverAltText: null,
        coverDecorative: true,
      },
      post.version,
    ),
  ).data;
  const legacyInput = {
    ...draft,
    title: 'Legacy device edit',
    coverMediaId: media.id,
  };
  const originalVersion = post.version;
  const key = randomUUID();
  const saved = parse<Post>(
    await call(
      'PUT',
      `/v1/posts/${post.id}/draft`,
      legacyInput,
      originalVersion,
      key,
    ),
  );
  assert.equal(saved.data.workingRevision!.content.coverDecorative, true);
  assert.equal(
    saved.data.workingRevision!.content.coverAltText,
    post.workingRevision!.content.coverAltText,
  );
  assert.equal(saved.data.workingRevision!.content.markdownContractVersion, 1);
  const newer = parse<Post>(
    await call(
      'PUT',
      `/v1/posts/${post.id}/draft`,
      {
        ...legacyInput,
        title: 'Newer device edit',
        coverDecorative: false,
        coverAltText: 'A safe cover description',
      },
      saved.data.version,
    ),
  ).data;
  const replay = parse<Post>(
    await call(
      'PUT',
      `/v1/posts/${post.id}/draft`,
      legacyInput,
      originalVersion,
      key,
    ),
  );
  assert.equal(replay.meta.idempotency?.replayed, true);
  assert.equal(replay.data.version, saved.data.version);
  assert.notEqual(replay.traceId, saved.traceId);
  const current = parse<Post>(await call('GET', `/v1/posts/${post.id}`)).data;
  assert.equal(current.version, newer.version);
  assert.equal(current.workingRevision!.content.title, 'Newer device edit');
  assert.equal(
    current.workingRevision!.content.coverAltText,
    'A safe cover description',
  );
  assert.equal(current.workingRevision!.content.coverDecorative, false);
  assert.equal(current.allowedActions.includes('UPLOAD_MEDIA'), false);
  assert.equal(
    parse<Post>(
      await call('GET', `/v1/posts/by-client-draft-id/${post.clientDraftId}`),
    ).data.version,
    newer.version,
  );
  assert.equal(
    parse<null>(
      await call(
        'PUT',
        `/v1/posts/${post.id}/draft`,
        { ...legacyInput, summary: 'Changed semantic input' },
        originalVersion,
        key,
      ),
      409,
    ).error?.code,
    'IDEMPOTENCY_KEY_REUSED',
  );
});

test('legacy retry fingerprints ignore object-key ordering and diagnostic metadata', async (t) => {
  const { app, call, state } = setup(t);
  const input = { clientDraftId: randomUUID(), draft };
  const key = randomUUID();
  const original = parse<Post>(
    await call('POST', '/v1/posts', input, undefined, key),
    201,
  );
  function reorder(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(reorder);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, value]) => [key, reorder(value)]),
      );
    return value;
  }
  state().advance(1000);
  const replay = parse<Post>(
    await app.inject({
      method: 'POST',
      url: '/v1/posts',
      headers: {
        ...metadata,
        authorization: 'Bearer mock-author',
        'idempotency-key': key,
        'x-device-id': randomUUID(),
        'x-app-version': '1.1.0+legacy-retry',
        traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
      },
      payload: reorder(input) as object,
    }),
    201,
  );
  assert.equal(replay.data.id, original.data.id);
  assert.equal(replay.data.version, original.data.version);
  assert.equal(replay.meta.idempotency?.replayed, true);
  assert.equal(replay.traceId, 'a'.repeat(32));
  assert.notEqual(replay.timestamp, original.timestamp);
  assert.equal(state().posts.size, 2);
});

test('create receipts and expired-key reconciliation respect current ownership after attribution transfer', async (t) => {
  const { call, state } = setup(t);
  const key = randomUUID();
  const input = { clientDraftId: randomUUID(), draft };
  const post = parse<Post>(
    await call('POST', '/v1/posts', input, undefined, key),
    201,
  ).data;
  parse<Post>(
    await call(
      'PATCH',
      `/v1/admin/posts/${post.id}/author`,
      { authorId: fixtureIds.otherAuthor },
      post.version,
      randomUUID(),
      'admin',
    ),
  );
  assert.equal(
    parse(await call('POST', '/v1/posts', input, undefined, key), 404).error
      ?.code,
    'RESOURCE_NOT_FOUND',
  );
  assert.equal(
    parse(await call('POST', '/v1/posts', input, undefined, randomUUID()), 404)
      .error?.code,
    'RESOURCE_NOT_FOUND',
  );
  state().advance(86400001);
  assert.equal(
    parse(await call('POST', '/v1/posts', input, undefined, key), 404).error
      ?.code,
    'RESOURCE_NOT_FOUND',
  );
});

test('every one of the 52 authored application operations has executed a schema-valid success', () => {
  assert.equal(coverage('mock', exercisedOperations).complete, true);
  assert.deepEqual(
    operations
      .map((operation) => operation.operationId)
      .filter((id) => !exercisedOperations.has(id)),
    [],
  );
});
