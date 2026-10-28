import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { identityFixture, type Account, type DTO } from './fixture.js';
import { assertConforms, coverage } from '../conformance/verify.js';
import { metadata } from '../helpers.js';
import { lockAdministrativeState } from '../../src/platform/database/operation.js';
import { setTimeout as delay } from 'node:timers/promises';

test(
  'real SQL editorial workflow, immutable history, current access and retry recovery',
  { timeout: 150_000 },
  async (t) => {
    const f = await identityFixture(t);
    const db = f.database.prisma;
    const req = f.request;
    const author = await f.member();
    const other = await f.member();
    const editor = await f.member('EDITOR');
    const admin = await f.member('ADMIN');
    const category = await db.category.create({
      data: {
        name: 'Editorial fixture',
        normalizedName: `editorial-${randomUUID()}`,
        slug: `editorial-${randomUUID()}`,
      },
    });
    const tag = await db.tag.create({
      data: {
        name: 'Editorial tag',
        normalizedName: `editorial-${randomUUID()}`,
        slug: `editorial-${randomUUID()}`,
      },
    });
    const draft = (
      title = 'Durable editorial article',
    ): DTO['DraftContentInput'] => ({
      title,
      summary: 'A public summary',
      markdown: 'Published body with **formatting**.',
      categoryId: category.id,
      tagIds: [tag.id],
      coverMediaId: null,
    });
    t.beforeEach(async () => {
      await db.rateLimitBucket.deleteMany();
    });
    const create = (
      account: Account = author,
      content: DTO['DraftContentInput'] = draft(),
      clientDraftId = randomUUID(),
      key = randomUUID(),
      status: number | readonly number[] = 201,
    ) =>
      req<DTO['WorkspacePost']>('createPost', '/v1/posts', status, {
        account,
        method: 'POST',
        body: { clientDraftId, draft: content },
        key,
      });
    const get = (
      post: DTO['WorkspacePost'],
      account: Account = author,
      status = 200,
    ) =>
      req<DTO['WorkspacePost']>(
        'getWorkspacePost',
        `/v1/posts/${post.id}`,
        status,
        { account },
      );
    const save = (
      post: DTO['WorkspacePost'],
      content: DTO['DraftContentInput'],
      account: Account = author,
      status: number | readonly number[] = 200,
      key = randomUUID(),
      version = post.version,
    ) =>
      req<DTO['WorkspacePost']>(
        'savePostDraft',
        `/v1/posts/${post.id}/draft`,
        status,
        { account, method: 'PUT', body: content, key, version },
      );
    const action = (
      operation: string,
      suffix: string,
      post: DTO['WorkspacePost'],
      body: unknown,
      account: Account = author,
      status: number | readonly number[] = 200,
      key = randomUUID(),
      version = post.version,
    ) =>
      req<DTO['WorkspacePost']>(
        operation,
        `/v1/posts/${post.id}${suffix ? '/' + suffix : ''}`,
        status,
        {
          account,
          method:
            suffix === '' ? 'DELETE' : suffix === 'slug' ? 'PATCH' : 'POST',
          body,
          key,
          version,
        },
      );
    const submit = (
      post: DTO['WorkspacePost'],
      account: Account = author,
      status = 200,
    ) =>
      action(
        'submitPostForReview',
        'submit',
        post,
        { revisionId: post.workingRevisionId },
        account,
        status,
      );
    const publish = (
      post: DTO['WorkspacePost'],
      account: Account = editor,
      status = 200,
    ) =>
      action(
        'publishPostRevision',
        'publish',
        post,
        {
          revisionId: post.review.submittedRevisionId ?? post.workingRevisionId,
        },
        account,
        status,
      );
    async function published(title?: string) {
      const created = (await create(author, draft(title))).body.data;
      return (await publish((await submit(created)).body.data)).body.data;
    }

    await t.test(
      'creation and creator recovery persist only whitelisted projections; all staff roles can create',
      async () => {
        for (const actor of [author, editor, admin]) {
          const created = await create(actor, {
            ...draft(''),
            summary: '',
            markdown: '',
            categoryId: null,
            tagIds: [],
          });
          const post = created.body.data;
          assert.equal(post.version, 1);
          assert.equal(post.workingRevision?.number, 1);
          assert.equal(post.workingRevision?.content.coverAltText, null);
          assert.equal(
            created.response.headers.get('location'),
            `/v1/posts/${post.id}`,
          );
          const recovered = await req<DTO['WorkspacePost']>(
            'getPostByClientDraftId',
            `/v1/posts/by-client-draft-id/${post.clientDraftId}`,
            200,
            { account: actor },
          );
          assert.deepEqual(recovered.body.data, post);
          assert.equal(JSON.stringify(post).includes(actor.uid), false);
          assert.equal(JSON.stringify(post).includes(actor.email), false);
        }
        await req('createPost', '/v1/posts', 401, {
          method: 'POST',
          body: { clientDraftId: randomUUID(), draft: draft() },
          key: randomUUID(),
        });
        await create(
          await f.google('not-invited'),
          draft(),
          randomUUID(),
          randomUUID(),
          403,
        );
      },
    );

    await t.test(
      'ownership protects detail/history/recovery and scope filters, including bearer and web sessions',
      async () => {
        const post = (await create()).body.data;
        for (const [operation, path] of [
          ['getWorkspacePost', `/v1/posts/${post.id}`],
          [
            'getPostByClientDraftId',
            `/v1/posts/by-client-draft-id/${post.clientDraftId}`,
          ],
          ['listPostRevisions', `/v1/posts/${post.id}/revisions`],
          [
            'getPostRevision',
            `/v1/posts/${post.id}/revisions/${post.workingRevisionId}`,
          ],
          ['listPostReviewEvents', `/v1/posts/${post.id}/review-events`],
        ])
          await req(operation!, path!, 404, { account: other });
        await save(post, draft('Cannot edit'), other, 404);
        await get(post, editor);
        await req('listWorkspacePosts', '/v1/posts?scope=ALL', 403, {
          account: author,
        });
        const own = await req<DTO['WorkspacePostSummary'][]>(
          'listWorkspacePosts',
          '/v1/posts',
          200,
          { account: author },
        );
        assert.ok(
          own.body.data.every((item) => item.author.id === author.row.id),
        );
        const all = await req<DTO['WorkspacePostSummary'][]>(
          'listWorkspacePosts',
          '/v1/posts?scope=ALL',
          200,
          { account: editor },
        );
        assert.ok(
          all.body.data.some((item) => item.author.id === admin.row.id),
        );
        const session = await f.admin.createSessionCookie(author.token, {
          expiresIn: 5 * 86400000,
        });
        await req('getWorkspacePost', `/v1/posts/${post.id}`, 200, {
          headers: { 'X-Blogpost-Web-Session': session },
        });
        const disabled = await f.member();
        const disabledPost = (await create(disabled)).body.data;
        await db.member.update({
          where: { id: disabled.row.id },
          data: { active: false },
        });
        await get(disabledPost, disabled, 403);
      },
    );

    await t.test(
      'draft no-ops retain history/version; snapshots and full original replays survive newer edits',
      async () => {
        const post = (await create()).body.data;
        const count = await db.auditEvent.count({
          where: { subjectId: post.id },
        });
        const noop = await save(post, draft());
        assert.equal(noop.body.data.version, 1);
        assert.equal(
          await db.revision.count({ where: { postId: post.id } }),
          1,
        );
        assert.equal(
          await db.auditEvent.count({ where: { subjectId: post.id } }),
          count,
        );
        const key = randomUUID();
        const old = await save(post, draft('First edit'), author, 200, key);
        const latest = await save(old.body.data, draft('Latest edit'));
        const replay = await save(post, draft('First edit'), author, 200, key);
        assert.equal(replay.body.meta.idempotency?.replayed, true);
        assert.deepEqual(replay.body.data, old.body.data);
        assert.notEqual(replay.body.traceId, old.body.traceId);
        assert.equal(
          (await get(post)).body.data.version,
          latest.body.data.version,
        );
        assert.equal(
          (await save(post, draft('Different input'), author, 409, key)).body
            .error.code,
          'IDEMPOTENCY_KEY_REUSED',
        );
        assert.equal(
          (await save(post, draft('Stale edit'), author, 412)).body.error.code,
          'VERSION_CONFLICT',
        );
        const history = await req<DTO['RevisionSummary'][]>(
          'listPostRevisions',
          `/v1/posts/${post.id}/revisions`,
          200,
          { account: author },
        );
        assert.deepEqual(
          history.body.data.map((item) => item.number),
          [3, 2, 1],
        );
        const first = await req<DTO['Revision']>(
          'getPostRevision',
          `/v1/posts/${post.id}/revisions/${post.workingRevisionId}`,
          200,
          { account: editor },
        );
        assert.equal(first.body.data.content.title, draft().title);
        await assert.rejects(
          db.revision.update({
            where: { id: first.body.data.id },
            data: { title: 'Cannot rewrite history' },
          }),
        );
      },
    );

    await t.test(
      'concurrent saves and duplicate operation keys commit one snapshot and one audit',
      async () => {
        const post = (await create()).body.data;
        const results = await Promise.all([
          save(post, draft('Concurrent A'), author, [200, 412]),
          save(post, draft('Concurrent B'), editor, [200, 412]),
        ]);
        assert.deepEqual(
          results.map((r) => r.response.status).sort(),
          [200, 412],
        );
        const current = (await get(post)).body.data;
        const key = randomUUID();
        const duplicates = await Promise.all([
          save(current, draft('Duplicate save'), author, [200, 409], key),
          save(current, draft('Duplicate save'), author, [200, 409], key),
        ]);
        assert.ok(duplicates.some((r) => r.response.status === 200));
        const retry = await save(
          current,
          draft('Duplicate save'),
          author,
          200,
          key,
        );
        assert.equal(retry.body.meta.idempotency?.replayed, true);
        assert.equal(
          await db.revision.count({ where: { postId: post.id } }),
          3,
        );
        assert.equal(
          await db.auditEvent.count({
            where: { subjectId: post.id, action: 'savePostDraft' },
          }),
          2,
        );
      },
    );

    await t.test(
      'actual lost create response recovers once; expired receipt reconciles via clientDraftId',
      async () => {
        const clientDraftId = randomUUID();
        const key = randomUUID();
        const body = { clientDraftId, draft: draft('Lost create response') };
        let complete!: () => void;
        let fail!: (error: unknown) => void;
        const committed = new Promise<void>((resolve, reject) => {
          complete = resolve;
          fail = reject;
        });
        const proxy = createServer((incoming, outgoing) => {
          incoming.resume();
          void (async () => {
            const response = await fetch(f.origin + '/v1/posts', {
              method: 'POST',
              headers: {
                ...metadata,
                Authorization: `Bearer ${author.token}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': key,
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(10000),
            });
            const bytes = Buffer.from(await response.arrayBuffer());
            assert.equal(response.status, 201);
            assertConforms('createPost', {
              method: 'POST',
              path: '/v1/posts',
              status: response.status,
              headers: Object.fromEntries(response.headers),
              body: bytes,
            });
            complete();
          })()
            .catch(fail)
            .finally(() => outgoing.destroy());
        });
        await new Promise<void>((resolve) =>
          proxy.listen(0, '127.0.0.1', resolve),
        );
        try {
          const address = proxy.address();
          assert.ok(address && typeof address !== 'string');
          await assert.rejects(
            fetch(`http://127.0.0.1:${address.port}`, {
              method: 'POST',
              signal: AbortSignal.timeout(15000),
            }),
          );
          await committed;
          const recovered = await create(
            author,
            body.draft,
            clientDraftId,
            key,
          );
          assert.equal(recovered.body.meta.idempotency?.replayed, true);
          await db.idempotencyRecord.updateMany({
            where: { identityUid: author.uid, key },
            data: { expiresAt: new Date(0) },
          });
          assert.equal(
            (await create(author, body.draft, clientDraftId, key, 409)).body
              .error.code,
            'CLIENT_DRAFT_ALREADY_EXISTS',
          );
          assert.equal(
            await db.post.count({
              where: { creatorId: author.row.id, clientDraftId },
            }),
            1,
          );
          await req(
            'getPostByClientDraftId',
            `/v1/posts/by-client-draft-id/${clientDraftId}`,
            200,
            { account: author },
          );
        } finally {
          await new Promise<void>((resolve) => proxy.close(() => resolve()));
        }
      },
    );

    await t.test(
      'review freezes exact current revision; rejection and withdrawal preserve feedback/history',
      async () => {
        let post = (await create()).body.data;
        const wrong = randomUUID();
        await action(
          'submitPostForReview',
          'submit',
          post,
          { revisionId: wrong },
          author,
          409,
        );
        post = (await submit(post)).body.data;
        await save(post, draft('Edit during review'), author, 409);
        await action(
          'restorePostRevision',
          'restore-revision',
          post,
          { revisionId: post.workingRevisionId },
          author,
          409,
        );
        await action(
          'rejectPostRevision',
          'reject',
          post,
          {
            revisionId: post.workingRevisionId,
            feedback: 'Author cannot reject',
          },
          author,
          403,
        );
        await action(
          'publishPostRevision',
          'publish',
          post,
          { revisionId: wrong },
          editor,
          409,
        );
        post = (
          await action(
            'rejectPostRevision',
            'reject',
            post,
            {
              revisionId: post.workingRevisionId,
              feedback: 'Please clarify the introduction.',
            },
            editor,
          )
        ).body.data;
        assert.equal(post.workflowState, 'CHANGES_REQUESTED');
        assert.equal(
          post.review.lastFeedback?.text,
          'Please clarify the introduction.',
        );
        post = (await save(post, draft('Clarified title'))).body.data;
        post = (await submit(post)).body.data;
        post = (await action('withdrawPostReview', 'withdraw-review', post, {}))
          .body.data;
        assert.equal(post.workflowState, 'DRAFT');
        assert.equal(post.review.submittedRevisionId, null);
        assert.equal(
          post.review.lastFeedback?.text,
          'Please clarify the introduction.',
        );
        const events = await req<DTO['ReviewEvent'][]>(
          'listPostReviewEvents',
          `/v1/posts/${post.id}/review-events`,
          200,
          { account: author },
        );
        assert.equal(events.body.data.length, 4);
        assert.deepEqual(events.body.data.map((e) => e.action).sort(), [
          'REJECTED',
          'SUBMITTED',
          'SUBMITTED',
          'WITHDRAWN',
        ]);
        await action(
          'withdrawPostReview',
          'withdraw-review',
          post,
          {},
          author,
          409,
        );
      },
    );

    await t.test(
      'publication selects immutable submitted content and updates only published search atomically',
      async () => {
        let post = await published();
        const publicId = post.publishedRevisionId;
        assert.equal(post.workflowState, 'CLEAN');
        const before = await db.post.findUniqueOrThrow({
          where: { id: post.id },
        });
        post = (await save(post, draft('Unpublished secret zyxprivate'))).body
          .data;
        assert.equal(post.publicationState, 'PUBLISHED');
        assert.equal(post.publishedRevisionId, publicId);
        assert.notEqual(post.workingRevisionId, publicId);
        assert.equal(post.publishedRevision?.content.title, draft().title);
        const stored = await db.post.findUniqueOrThrow({
          where: { id: post.id },
        });
        assert.equal(
          stored.lastPublishedAt?.getTime(),
          before.lastPublishedAt?.getTime(),
        );
        const search = await db.$queryRaw<
          { revisionId: string; privateMatch: boolean }[]
        >`SELECT "revisionId", document @@ plainto_tsquery('english', 'zyxprivate') AS "privateMatch" FROM blogpost."PublishedSearch" WHERE "postId" = ${post.id}::uuid`;
        assert.equal(search[0]?.revisionId, publicId);
        assert.equal(search[0]?.privateMatch, false);
        post = (await submit(post)).body.data;
        post = (await publish(post)).body.data;
        assert.equal(post.publishedRevisionId, post.workingRevisionId);
        assert.equal(
          post.publishedRevision?.content.title,
          'Unpublished secret zyxprivate',
        );
        const currentSearch = await db.$queryRaw<
          { found: boolean }[]
        >`SELECT document @@ plainto_tsquery('english', 'zyxprivate') AS found FROM blogpost."PublishedSearch" WHERE "postId" = ${post.id}::uuid`;
        assert.equal(currentSearch[0]?.found, true);
        await publish(post, editor, 409);
        const editorOwn = (await create(editor)).body.data;
        const editorReview = (await submit(editorOwn, editor)).body.data;
        assert.equal(
          (await publish(editorReview, editor)).body.data.publicationState,
          'PUBLISHED',
        );
      },
    );

    await t.test(
      'publication revalidates archived taxonomy and unsupported Markdown while incomplete drafts remain durable',
      async () => {
        const empty = (
          await create(author, {
            ...draft(''),
            summary: '',
            markdown: '',
            categoryId: null,
            tagIds: [],
          })
        ).body.data;
        await submit(empty, author, 422);
        const unsafe = (
          await create(author, {
            ...draft(),
            markdown: '[bad](javascript:alert)',
          })
        ).body.data;
        assert.equal(
          (await submit(unsafe, author, 422)).body.error.code,
          'MARKDOWN_UNSUPPORTED',
        );
        const post = (await submit((await create()).body.data)).body.data;
        await db.category.update({
          where: { id: category.id },
          data: { active: false },
        });
        try {
          await publish(post, editor, 409);
          assert.equal(
            await db.publishedSearch.count({ where: { postId: post.id } }),
            0,
          );
          assert.equal((await get(post)).body.data.version, post.version);
          const continued = await save(unsafe, {
            ...draft('Existing archived choice'),
            markdown: 'Updated draft',
          });
          assert.equal(
            continued.body.data.workingRevision?.content.categoryId,
            category.id,
          );
          await create(other, draft(), randomUUID(), randomUUID(), 409);
        } finally {
          await db.category.update({
            where: { id: category.id },
            data: { active: true },
          });
        }
      },
    );

    await t.test(
      'restoring history appends a new revision with current attribution and never republishes',
      async () => {
        let post = await published('Original published title');
        const old = post.workingRevision!;
        post = (await save(post, draft('Current private title'))).body.data;
        const count = await db.revision.count({ where: { postId: post.id } });
        post = (
          await action('restorePostRevision', 'restore-revision', post, {
            revisionId: old.id,
          })
        ).body.data;
        assert.equal(post.workflowState, 'DRAFT');
        assert.notEqual(post.workingRevisionId, old.id);
        assert.equal(post.workingRevision?.restoredFromRevisionId, old.id);
        assert.equal(post.workingRevision?.number, count + 1);
        assert.equal(post.publishedRevisionId, old.id);
        assert.deepEqual(post.workingRevision?.content, old.content);
        assert.equal(
          (
            await req<DTO['Revision']>(
              'getPostRevision',
              `/v1/posts/${post.id}/revisions/${old.id}`,
              200,
              { account: author },
            )
          ).body.data.number,
          1,
        );
      },
    );

    await t.test(
      'slug reservations survive title changes and withdrawal; collisions never form redirect chains',
      async () => {
        let first = await published('Unique slug fixture');
        const second = await published('Unique slug fixture');
        assert.notEqual(first.slug, second.slug);
        const reserved = first.slug!;
        first = (await save(first, draft('Title cannot rename the slug'))).body
          .data;
        assert.equal(first.slug, reserved);
        first = (
          await action(
            'changePostSlug',
            'slug',
            first,
            { slug: 'changed-editorial-slug' },
            editor,
          )
        ).body.data;
        await action(
          'changePostSlug',
          'slug',
          second,
          { slug: reserved },
          editor,
          409,
        );
        const history = await db.slugHistory.findMany({
          where: { postId: first.id },
        });
        assert.equal(history.length, 2);
        assert.equal(history.filter((row) => row.canonical).length, 1);
        assert.ok(history.every((row) => row.postId === first.id));
        first = (await action('unpublishPost', 'unpublish', first, {}, editor))
          .body.data;
        assert.equal(first.publicationState, 'WITHDRAWN');
        assert.equal(
          await db.publishedSearch.count({ where: { postId: first.id } }),
          0,
        );
        assert.equal(
          await db.slugHistory.count({ where: { postId: first.id } }),
          2,
        );
      },
    );

    await t.test(
      'trash is retained 30 days; restore is an unpublished draft with role and retention checks',
      async () => {
        let post = await published('Trash fixture');
        await action('trashPost', '', post, undefined, author, 403);
        post = (await action('trashPost', '', post, undefined, editor)).body
          .data;
        assert.equal(post.publicationState, 'WITHDRAWN');
        assert.equal(
          Date.parse(post.purgeAfter!) - Date.parse(post.trashedAt!),
          30 * 86400000,
        );
        await save(post, draft('Cannot save trash'), editor, 409);
        await action('restoreTrashedPost', 'restore', post, {}, author, 403);
        const list = await req<DTO['WorkspacePostSummary'][]>(
          'listWorkspacePosts',
          '/v1/posts?trashed=true',
          200,
          { account: author },
        );
        assert.ok(list.body.data.some((row) => row.id === post.id));
        post = (await action('restoreTrashedPost', 'restore', post, {}, editor))
          .body.data;
        assert.equal(post.publicationState, 'WITHDRAWN');
        assert.equal(post.workflowState, 'DRAFT');
        assert.equal(post.trashedAt, null);
        assert.equal(
          await db.publishedSearch.count({ where: { postId: post.id } }),
          0,
        );
        let own = (await create()).body.data;
        own = (await action('trashPost', '', own, undefined)).body.data;
        own = (await action('restoreTrashedPost', 'restore', own, {})).body
          .data;
        assert.equal(own.publicationState, 'NEVER_PUBLISHED');
        await db.post.update({
          where: { id: own.id },
          data: {
            trashedAt: new Date(Date.now() - 31 * 86400000),
            purgeAfter: new Date(Date.now() - 86400000),
          },
        });
        await get(own, author, 404);
        await action('restoreTrashedPost', 'restore', own, {}, author, 404);
      },
    );

    await t.test(
      'admin attribution transfer changes current visibility but retains public attribution and creator scope',
      async () => {
        let post = await published('Attribution fixture');
        const key = randomUUID();
        const original = await save(
          post,
          draft('Private text before transfer'),
          author,
          200,
          key,
        );
        post = original.body.data;
        const originalRevision = post.publishedRevisionId;
        const path = `/v1/admin/posts/${post.id}/author`;
        await req('reassignPostAuthor', path, 403, {
          account: editor,
          method: 'PATCH',
          body: { authorId: other.row.id },
          version: post.version,
          key: randomUUID(),
        });
        const changed = await req<DTO['WorkspacePost']>(
          'reassignPostAuthor',
          path,
          200,
          {
            account: admin,
            method: 'PATCH',
            body: { authorId: other.row.id },
            version: post.version,
            key: randomUUID(),
          },
        );
        post = changed.body.data;
        assert.equal(post.author.id, other.row.id);
        assert.equal(post.workingRevision?.creditedAuthor.id, other.row.id);
        assert.equal(post.publishedRevisionId, originalRevision);
        assert.equal(post.publishedRevision?.creditedAuthor.id, author.row.id);
        await get(post, author, 404);
        await get(post, other);
        await save(
          original.body.data,
          draft('Private text before transfer'),
          author,
          404,
          key,
          original.body.data.version - 1,
        );
        await req(
          'getPostByClientDraftId',
          `/v1/posts/by-client-draft-id/${post.clientDraftId}`,
          404,
          { account: author },
        );
        await req(
          'getPostByClientDraftId',
          `/v1/posts/by-client-draft-id/${post.clientDraftId}`,
          404,
          { account: other },
        );
        post = (
          await action(
            'restorePostRevision',
            'restore-revision',
            post,
            { revisionId: originalRevision },
            other,
          )
        ).body.data;
        assert.equal(post.workingRevision?.creditedAuthor.id, other.row.id);
        post = (await submit(post, other)).body.data;
        await req('reassignPostAuthor', path, 409, {
          account: admin,
          method: 'PATCH',
          body: { authorId: author.row.id },
          version: post.version,
          key: randomUUID(),
        });
        post = (await publish(post)).body.data;
        assert.equal(post.publishedRevision?.creditedAuthor.id, other.row.id);
      },
    );

    await t.test(
      'workspace, revisions and event cursors bind actual order, filters, resource, UID and size',
      async () => {
        let post = (await create()).body.data;
        const updated = await save(post, draft('Number two'));
        post = updated.body.data;
        post = (await save(post, draft('Number three'))).body.data;
        const rows = await db.revision.findMany({ where: { postId: post.id } });
        // Revision number, not creation time, is authoritative for history ordering.
        assert.equal(rows.length, 3);
        await db.revision.createMany({
          data: [
            {
              id: randomUUID(),
              postId: post.id,
              number: 4,
              title: 'Fourth',
              summary: '',
              markdown: '',
              plainBody: '',
              creditedAuthorId: author.row.id,
              creatorId: author.row.id,
              checksum: 'a'.repeat(64),
              createdAt: new Date('2010-01-01T00:00:00.000Z'),
            },
            {
              id: randomUUID(),
              postId: post.id,
              number: 5,
              title: 'Fifth',
              summary: '',
              markdown: '',
              plainBody: '',
              creditedAuthorId: author.row.id,
              creatorId: author.row.id,
              checksum: 'b'.repeat(64),
              createdAt: new Date('2000-01-01T00:00:00.000Z'),
            },
          ],
        });
        const first = await req<DTO['RevisionSummary'][]>(
          'listPostRevisions',
          `/v1/posts/${post.id}/revisions?pageSize=1`,
          200,
          { account: author },
        );
        assert.equal(first.body.data[0]?.number, 5);
        const cursor = encodeURIComponent(
          first.body.meta.pagination.nextCursor!,
        );
        const second = await req<DTO['RevisionSummary'][]>(
          'listPostRevisions',
          `/v1/posts/${post.id}/revisions?pageSize=1&cursor=${cursor}`,
          200,
          { account: author },
        );
        assert.equal(second.body.data[0]?.number, 4);
        await req(
          'listPostRevisions',
          `/v1/posts/${post.id}/revisions?pageSize=2&cursor=${cursor}`,
          400,
          { account: author },
        );
        await req(
          'listPostRevisions',
          `/v1/posts/${post.id}/revisions?pageSize=1&cursor=${cursor}`,
          400,
          { account: editor },
        );
        await req(
          'listPostReviewEvents',
          `/v1/posts/${post.id}/review-events?pageSize=1&cursor=${cursor}`,
          400,
          { account: author },
        );
        await create();
        await db.post.update({
          where: { id: post.id },
          data: { updatedAt: new Date(Date.now() + 60000) },
        });
        const workspace = await req<DTO['WorkspacePostSummary'][]>(
          'listWorkspacePosts',
          '/v1/posts?pageSize=1',
          200,
          { account: author },
        );
        const next = encodeURIComponent(
          workspace.body.meta.pagination.nextCursor!,
        );
        assert.equal(workspace.body.data[0]?.id, post.id);
        await req(
          'listWorkspacePosts',
          `/v1/posts?pageSize=1&scope=OWN&trashed=false&cursor=${next}`,
          200,
          { account: author },
        );
        await req(
          'listWorkspacePosts',
          `/v1/posts?pageSize=1&workflowState=DRAFT&cursor=${next}`,
          400,
          { account: author },
        );
      },
    );

    await t.test(
      'media ownership and expiry are enforced atomically, and older clients preserve cover presentation',
      async () => {
        let post = (await create()).body.data;
        const foreign = (await create(other)).body.data;
        const asset = await db.mediaAsset.create({
          data: {
            postId: post.id,
            uploaderId: author.row.id,
            state: 'READY',
            mimeType: 'image/webp',
            width: 2,
            height: 2,
            byteSize: 24,
            variants: ['w480', 'w960', 'w1600'].map((name) => ({
              name,
              width: 2,
              height: 2,
              byteSize: 8,
              objectName: `private/${randomUUID()}`,
              generation: '123',
            })),
            unattachedExpiresAt: new Date(Date.now() + 86400000),
          },
        });
        const content = {
          ...draft(),
          coverMediaId: asset.id,
          coverAltText: 'Original cover description',
          coverDecorative: false,
          markdown: `![Informative](media://${asset.id})`,
        };
        post = (await save(post, content)).body.data;
        assert.equal(
          (await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } }))
            .unattachedExpiresAt,
          null,
        );
        const {
          coverAltText: _alt,
          coverDecorative: _decorative,
          ...olderFields
        } = content;
        const legacy = { ...olderFields, title: 'Older client edit' };
        post = (await save(post, legacy)).body.data;
        assert.equal(
          post.workingRevision?.content.coverAltText,
          'Original cover description',
        );
        assert.equal(JSON.stringify(post).includes('objectName'), false);
        assert.equal(JSON.stringify(post).includes('generation'), false);
        await save(foreign, content, other, 404);
        const before = await db.post.findUniqueOrThrow({
          where: { id: foreign.id },
        });
        assert.equal(before.lockVersion, foreign.version);
        assert.equal(
          await db.revision.count({ where: { postId: foreign.id } }),
          1,
        );
        const expiring = await db.mediaAsset.create({
          data: {
            postId: post.id,
            uploaderId: author.row.id,
            state: 'READY',
            mimeType: 'image/webp',
            width: 2,
            height: 2,
            byteSize: 24,
            variants: asset.variants!,
            unattachedExpiresAt: new Date(0),
          },
        });
        await save(
          post,
          { ...draft(), coverMediaId: expiring.id, coverDecorative: true },
          author,
          409,
        );
        post = (
          await save(post, {
            ...draft(),
            markdown: `\`![Literal only](media://${randomUUID()})\``,
          })
        ).body.data;
        assert.equal(post.workingRevision?.media.length, 0);
        assert.equal(
          await db.revisionMedia.count({ where: { mediaId: asset.id } }),
          2,
        );
      },
    );

    await t.test(
      'post quota includes restores and incoming ownership; concurrent creates cannot exceed 100',
      async () => {
        const limited = await f.member();
        await db.post.createMany({
          data: Array.from({ length: 99 }, () => ({
            authorId: limited.row.id,
            creatorId: limited.row.id,
            clientDraftId: randomUUID(),
          })),
        });
        const candidates = await Promise.all([
          create(limited, draft(), randomUUID(), randomUUID(), [201, 409]),
          create(limited, draft(), randomUUID(), randomUUID(), [201, 409]),
        ]);
        assert.deepEqual(
          candidates.map((result) => result.response.status).sort(),
          [201, 409],
        );
        assert.equal(
          await db.post.count({
            where: { authorId: limited.row.id, trashedAt: null },
          }),
          100,
        );
        const post = (await create()).body.data;
        await req(
          'reassignPostAuthor',
          `/v1/admin/posts/${post.id}/author`,
          409,
          {
            account: admin,
            method: 'PATCH',
            body: { authorId: limited.row.id },
            version: post.version,
            key: randomUUID(),
          },
        );
        const trashed = (await action('trashPost', '', post, undefined)).body
          .data;
        await db.post.update({
          where: { id: post.id },
          data: { authorId: limited.row.id },
        });
        await action('restoreTrashedPost', 'restore', trashed, {}, editor, 409);
      },
    );

    await t.test(
      'strict body/query/precondition errors leave no partial mutation or successful operation receipt',
      async () => {
        const post = (await create()).body.data;
        const key = randomUUID();
        await save(
          post,
          { ...draft(), categoryId: randomUUID() },
          author,
          409,
          key,
        );
        assert.equal(
          await db.idempotencyRecord.count({
            where: { identityUid: author.uid, key },
          }),
          0,
        );
        assert.equal(
          await db.revision.count({ where: { postId: post.id } }),
          1,
        );
        await req('savePostDraft', `/v1/posts/${post.id}/draft`, 428, {
          account: author,
          method: 'PUT',
          body: draft(),
          key: randomUUID(),
        });
        await req('savePostDraft', `/v1/posts/${post.id}/draft`, 400, {
          account: author,
          method: 'PUT',
          body: draft(),
          version: 1,
        });
        await req('savePostDraft', `/v1/posts/${post.id}/draft`, 415, {
          account: author,
          method: 'PUT',
          body: draft(),
          key: randomUUID(),
          version: 1,
          headers: { 'Content-Type': 'text/plain' },
        });
        await req('listWorkspacePosts', '/v1/posts?scope=all', 422, {
          account: author,
        });
        await req('listWorkspacePosts', '/v1/posts?scope=OWN&scope=ALL', 422, {
          account: author,
        });
        await req('listWorkspacePosts', '/v1/posts?unknown=x', 422, {
          account: author,
        });
        await save(post, { ...draft(), title: 'Null\0text' }, author, 422);
        await req('createPost', '/v1/posts', 422, {
          account: author,
          method: 'POST',
          body: {
            clientDraftId: randomUUID(),
            draft: { ...draft(), extra: true },
          },
          key: randomUUID(),
        });
        await req('rejectPostRevision', `/v1/posts/${post.id}/reject`, 422, {
          account: editor,
          method: 'POST',
          body: { revisionId: post.workingRevisionId, feedback: '  ' },
          key: randomUUID(),
          version: 1,
        });
        assert.equal((await get(post)).body.data.version, 1);
      },
    );

    await t.test(
      'completed create receipts respect current ownership and disabled membership',
      async () => {
        const creator = await f.member();
        const client = randomUUID();
        const key = randomUUID();
        const post = (
          await create(creator, draft('Private creation receipt'), client, key)
        ).body.data;
        await req(
          'reassignPostAuthor',
          `/v1/admin/posts/${post.id}/author`,
          200,
          {
            account: admin,
            method: 'PATCH',
            body: { authorId: other.row.id },
            version: post.version,
            key: randomUUID(),
          },
        );
        await create(
          creator,
          draft('Private creation receipt'),
          client,
          key,
          404,
        );
        await create(
          creator,
          draft('Private creation receipt'),
          client,
          randomUUID(),
          404,
        );
        await db.member.update({
          where: { id: creator.row.id },
          data: { role: 'EDITOR' },
        });
        const allowed = await create(
          creator,
          draft('Private creation receipt'),
          client,
          key,
        );
        assert.equal(allowed.body.meta.idempotency?.replayed, true);
        assert.equal(allowed.body.data.author.id, creator.row.id);
        await db.member.update({
          where: { id: creator.row.id },
          data: { active: false },
        });
        await create(
          creator,
          draft('Private creation receipt'),
          client,
          key,
          403,
        );
      },
    );

    await t.test(
      'in-flight demotion and disablement are rechecked after the shared administrative lock',
      async () => {
        for (const mode of ['demotion', 'disablement']) {
          const actor = await f.member(
            mode === 'demotion' ? 'EDITOR' : 'AUTHOR',
          );
          const post = (await create(mode === 'demotion' ? author : actor)).body
            .data;
          const key = randomUUID();
          const first = await save(
            post,
            draft('Before access change'),
            actor,
            200,
            key,
          );
          let acquired!: () => void;
          let release!: () => void;
          const ready = new Promise<void>((resolve) => {
            acquired = resolve;
          });
          const finish = new Promise<void>((resolve) => {
            release = resolve;
          });
          const holder = db.$transaction(
            async (tx) => {
              await lockAdministrativeState(tx);
              acquired();
              await finish;
              await tx.member.update({
                where: { id: actor.row.id },
                data:
                  mode === 'demotion' ? { role: 'AUTHOR' } : { active: false },
              });
            },
            { timeout: 15000 },
          );
          await ready;
          try {
            const denied = save(
              post,
              draft('Before access change'),
              actor,
              mode === 'demotion' ? 404 : 403,
              key,
            );
            let waiting = false;
            for (let i = 0; i < 100; i++) {
              const rows = await db.$queryRaw<
                { waiting: boolean }[]
              >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename = current_user AND wait_event = 'advisory' AND query LIKE '%pg_advisory_xact_lock_shared%') AS waiting`;
              if (rows[0]?.waiting) {
                waiting = true;
                break;
              }
              await delay(10);
            }
            assert.equal(
              waiting,
              true,
              'Editorial request did not reach the SQL lock',
            );
            release();
            await holder;
            await denied;
            assert.equal(
              (await db.post.findUniqueOrThrow({ where: { id: post.id } }))
                .lockVersion,
              first.body.data.version,
            );
            assert.equal(
              await db.revision.count({ where: { postId: post.id } }),
              2,
            );
          } finally {
            release();
            await holder;
          }
        }
      },
    );

    await t.test(
      'version overflow and write quotas roll back snapshots, while completed replay remains usable',
      async () => {
        const bounded = (await create()).body.data;
        await db.post.update({
          where: { id: bounded.id },
          data: { lockVersion: 2147483647 },
        });
        const overflow = { ...bounded, version: 2147483647 };
        await save(overflow, draft('Overflow'), author, 409);
        assert.equal(
          await db.revision.count({ where: { postId: bounded.id } }),
          1,
        );
        assert.equal(
          (await save(overflow, draft())).body.data.version,
          2147483647,
        );
        const limited = await f.member();
        const client = randomUUID();
        const key = randomUUID();
        const created = await create(
          limited,
          draft('Quota replay'),
          client,
          key,
        );
        const now = new Date();
        await db.rateLimitBucket.deleteMany({
          where: { memberId: limited.row.id },
        });
        await db.rateLimitBucket.create({
          data: {
            memberId: limited.row.id,
            action: 'WRITE',
            count: 30,
            windowStart: now,
            expiresAt: new Date(now.getTime() + 60000),
          },
        });
        await save(created.body.data, draft('New blocked edit'), limited, 429);
        assert.equal(
          (await create(limited, draft('Quota replay'), client, key)).body.meta
            .idempotency?.replayed,
          true,
        );
        assert.equal(
          await db.revision.count({ where: { postId: created.body.data.id } }),
          1,
        );
      },
    );

    const required = [
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
    ];
    for (const operation of required)
      assert.ok(
        f.executed.has(operation),
        `No observed success for ${operation}`,
      );
    const runId = process.env.BLOGPOST_IDENTITY_RUN_ID!;
    assert.match(runId, /^[a-f0-9]{12}$/);
    await writeFile(
      `/app/.local/conformance/editorial-${runId}.json`,
      JSON.stringify(
        {
          ...coverage('backend', f.executed),
          observedOperations: [...f.executed],
          runId,
          testProject: f.config.identityProject,
          observedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
  },
);
