import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { Prisma } from '../../src/generated/prisma/client.js';
import { connection } from '../../src/platform/database/connection.js';
import { identityFixture, type Account, type DTO } from './fixture.js';
import { coverage } from '../conformance/verify.js';

test(
  'real taxonomy administration and published-only public reading/search',
  { timeout: 180000 },
  async (t) => {
    const f = await identityFixture(t);
    const db = f.database.prisma;
    const req = f.request;
    const author = await f.member();
    const other = await f.member();
    const editor = await f.member('EDITOR');
    const admin = await f.member('ADMIN');
    const taxon = (
      kind: 'categories' | 'tags',
      name: string,
      actor: Account = editor,
      status: number | readonly number[] = 201,
      key = randomUUID(),
      slug = `fixture-${randomUUID()}`,
    ) =>
      req<DTO['ManagedTaxon']>(
        kind === 'categories' ? 'createCategory' : 'createTag',
        `/v1/${kind}`,
        status,
        { account: actor, method: 'POST', body: { name, slug }, key },
      );
    const patch = (
      kind: 'categories' | 'tags',
      row: DTO['ManagedTaxon'],
      body: unknown,
      status: number | readonly number[] = 200,
      actor: Account = editor,
      key = randomUUID(),
      version = row.version,
    ) =>
      req<DTO['ManagedTaxon']>(
        kind === 'categories' ? 'updateCategory' : 'updateTag',
        `/v1/${kind}/${row.id}`,
        status,
        { account: actor, method: 'PATCH', body, version, key },
      );
    const category = (await taxon('categories', 'Public fixture category')).body
      .data;
    const tagA = (await taxon('tags', 'Public fixture tag A')).body.data;
    const tagB = (await taxon('tags', 'Public fixture tag B')).body.data;
    const draft = (
      title = 'Public fixture article',
    ): DTO['DraftContentInput'] => ({
      title,
      summary: 'A useful published summary',
      markdown: 'A published article body.',
      categoryId: category.id,
      tagIds: [tagA.id, tagB.id],
      coverMediaId: null,
    });
    const create = (content = draft(), actor: Account = author) =>
      req<DTO['WorkspacePost']>('createPost', '/v1/posts', 201, {
        account: actor,
        method: 'POST',
        body: { clientDraftId: randomUUID(), draft: content },
        key: randomUUID(),
      });
    const change = (
      operation: string,
      suffix: string,
      post: DTO['WorkspacePost'],
      body: unknown,
      actor: Account = editor,
      status: number | readonly number[] = 200,
    ) =>
      req<DTO['WorkspacePost']>(
        operation,
        `/v1/posts/${post.id}${suffix ? '/' + suffix : ''}`,
        status,
        {
          account: actor,
          method:
            suffix === 'draft'
              ? 'PUT'
              : suffix === 'slug'
                ? 'PATCH'
                : suffix
                  ? 'POST'
                  : 'DELETE',
          body,
          key: randomUUID(),
          version: post.version,
        },
      );
    async function review(post: DTO['WorkspacePost'], actor: Account = author) {
      return (
        await change(
          'submitPostForReview',
          'submit',
          post,
          { revisionId: post.workingRevisionId },
          actor,
        )
      ).body.data;
    }
    async function publish(post: DTO['WorkspacePost']) {
      return (
        await change('publishPostRevision', 'publish', post, {
          revisionId: post.review.submittedRevisionId,
        })
      ).body.data;
    }
    async function article(content = draft(), actor: Account = author) {
      return publish(
        await review((await create(content, actor)).body.data, actor),
      );
    }
    const read = (post: DTO['WorkspacePost'], status = 200) =>
      req<DTO['PublicPost']>(
        'getPublicPost',
        `/v1/public/posts/${post.id}`,
        status,
      );
    const search = (q: string, status = 200, more = '') =>
      req<DTO['PublicPostSummary'][]>(
        'searchPublicPosts',
        `/v1/public/search?q=${encodeURIComponent(q)}${more}`,
        status,
      );
    const page = (pagination: unknown) => pagination as DTO['PagePagination'];
    t.beforeEach(async () => {
      await db.rateLimitBucket.deleteMany();
    });

    await t.test(
      'editor/admin taxonomy CRUD normalizes names, enforces immutable slugs and safe projections',
      async () => {
        for (const kind of ['categories', 'tags'] as const) {
          const name =
            kind === 'categories'
              ? '  Cafe\u0301 category  '
              : '  Cafe\u0301 tag  ';
          const original = await taxon(kind, name, admin);
          let row = original.body.data;
          assert.equal(row.name, name.trim().normalize('NFC'));
          assert.equal(row.active, true);
          assert.equal(
            original.response.headers.get('location'),
            `/v1/${kind}/${row.id}`,
          );
          assert.equal(JSON.stringify(row).includes('normalizedName'), false);
          await taxon(kind, row.name.toUpperCase(), editor, 409);
          await taxon(
            kind,
            `Different ${kind}`,
            editor,
            409,
            randomUUID(),
            row.slug,
          );
          const key = randomUUID();
          const edited = await patch(
            kind,
            row,
            { name: `Renamed ${kind}` },
            200,
            editor,
            key,
          );
          const savedOriginal = row;
          row = edited.body.data;
          assert.equal(row.version, 2);
          assert.equal(row.slug, savedOriginal.slug);
          const noop = await patch(kind, row, { name: row.name, active: true });
          assert.equal(noop.body.data.version, 2);
          row = (await patch(kind, row, { active: false })).body.data;
          assert.equal(row.active, false);
          const replay = await patch(
            kind,
            savedOriginal,
            { name: `Renamed ${kind}` },
            200,
            editor,
            key,
          );
          assert.equal(replay.body.meta.idempotency?.replayed, true);
          assert.deepEqual(replay.body.data, edited.body.data);
          await patch(
            kind,
            savedOriginal,
            { name: 'Changed semantic input' },
            409,
            editor,
            key,
          );
          await patch(kind, savedOriginal, { active: false }, 412);
          await patch(kind, row, { slug: 'cannot-change' }, 422);
          const current = await req<DTO['ManagedTaxon']>(
            kind === 'categories' ? 'getManagedCategory' : 'getManagedTag',
            `/v1/${kind}/${row.id}`,
            200,
            { account: editor },
          );
          assert.equal(current.body.data.version, 3);
          const listed = await req<DTO['ManagedTaxon'][]>(
            kind === 'categories' ? 'listManagedCategories' : 'listManagedTags',
            `/v1/${kind}?active=false&pageSize=1`,
            200,
            { account: admin },
          );
          assert.equal(page(listed.body.meta.pagination).kind, 'PAGE');
          assert.equal(page(listed.body.meta.pagination).pageSize, 1);
          assert.ok(listed.body.data.every((item) => item.active === false));
        }
      },
    );

    await t.test(
      'taxonomy author/nonmember access, validation, current permissions and completed replay are enforced',
      async () => {
        const operator = await f.member('EDITOR');
        const key = randomUUID();
        const slug = `operator-${randomUUID()}`;
        const created = (
          await taxon('tags', 'Operator role fixture', operator, 201, key, slug)
        ).body.data;
        for (const kind of ['categories', 'tags'] as const) {
          await req(
            kind === 'categories' ? 'listManagedCategories' : 'listManagedTags',
            `/v1/${kind}`,
            401,
          );
          await req(
            kind === 'categories' ? 'listManagedCategories' : 'listManagedTags',
            `/v1/${kind}`,
            403,
            { account: author },
          );
          await taxon(kind, 'Forbidden', author, 403);
        }
        await db.member.update({
          where: { id: operator.row.id },
          data: { role: 'AUTHOR' },
        });
        await taxon('tags', 'Operator role fixture', operator, 403, key, slug);
        await db.member.update({
          where: { id: operator.row.id },
          data: { role: 'EDITOR', active: false },
        });
        await taxon('tags', 'Operator role fixture', operator, 403, key, slug);
        for (const body of [
          {},
          { name: ' ' },
          { name: 3 },
          { active: 'false' },
          { name: 'Null\0value' },
          { name: 'x'.repeat(81) },
        ])
          await patch('tags', created, body, 422);
        await req('listManagedTags', '/v1/tags?active=yes', 422, {
          account: editor,
        });
        await req('listManagedCategories', '/v1/categories?sort=secret', 422, {
          account: editor,
        });
        assert.equal(
          await db.auditEvent.count({ where: { subjectId: created.id } }),
          1,
        );
      },
    );

    await t.test(
      'concurrent normalized-name and slug collisions commit one taxon and one audit',
      async () => {
        const suffix = randomUUID();
        const results = await Promise.all([
          taxon('categories', `Race ${suffix}`, editor, [201, 409]),
          taxon('categories', `RACE ${suffix}`, admin, [201, 409]),
        ]);
        assert.deepEqual(
          results.map((result) => result.response.status).sort(),
          [201, 409],
        );
        const winner = results.find((result) => result.response.status === 201)!
          .body.data;
        assert.equal(
          await db.category.count({
            where: { normalizedName: winner.name.toLocaleLowerCase('en') },
          }),
          1,
        );
        assert.equal(
          await db.auditEvent.count({ where: { subjectId: winner.id } }),
          1,
        );
        const slug = `race-${randomUUID()}`;
        const slugs = await Promise.all([
          taxon(
            'tags',
            `Slug one ${suffix}`,
            editor,
            [201, 409],
            randomUUID(),
            slug,
          ),
          taxon(
            'tags',
            `Slug two ${suffix}`,
            admin,
            [201, 409],
            randomUUID(),
            slug,
          ),
        ]);
        assert.deepEqual(
          slugs.map((result) => result.response.status).sort(),
          [201, 409],
        );
      },
    );

    await t.test(
      'public details, summaries, media metadata and profiles expose the published snapshot only',
      async () => {
        let post = (await create(draft('Publication privacy fixture'))).body
          .data;
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
        const publishedContent = {
          ...draft('Publication privacy fixture'),
          coverMediaId: asset.id,
          coverAltText: 'A useful description',
          markdown: `Published illustration ![Useful](media://${asset.id})`,
        };
        post = (
          await change('savePostDraft', 'draft', post, publishedContent, author)
        ).body.data;
        post = await publish(await review(post));
        const first = await read(post);
        assert.equal(first.body.data.markdown, publishedContent.markdown);
        assert.equal(first.body.data.cover?.altText, 'A useful description');
        assert.ok(
          first.body.data.media.every((item) =>
            item.variants.every((variant) =>
              variant.apiPath.startsWith(`/v1/public/posts/${post.id}/media/`),
            ),
          ),
        );
        assert.equal(
          JSON.stringify(first.body.data).includes('objectName'),
          false,
        );
        const originalTime = first.body.data.updatedAt;
        post = (
          await change(
            'savePostDraft',
            'draft',
            post,
            draft('zyx private title must stay private'),
            author,
          )
        ).body.data;
        const latest = await read(post);
        assert.deepEqual(latest.body.data, first.body.data);
        assert.equal(latest.body.data.updatedAt, originalTime);
        const feed = await req<DTO['PublicPostSummary'][]>(
          'listPublicPosts',
          `/v1/public/posts?authorId=${author.row.id}`,
          200,
        );
        assert.equal(
          feed.body.data.find((row) => row.id === post.id)?.title,
          'Publication privacy fixture',
        );
        const profile = await req<DTO['PublicAuthor']>(
          'getPublicAuthor',
          `/v1/public/authors/${author.row.handle}`,
          200,
        );
        assert.equal(profile.body.data.id, author.row.id);
        assert.equal(
          JSON.stringify(profile.body.data).includes(author.email),
          false,
        );
        assert.equal(latest.response.headers.get('cache-control'), 'no-store');
        assert.equal(latest.response.headers.get('x-resource-version'), null);
        await req('getPublicAuthor', '/v1/public/authors/does-not-exist', 404);
      },
    );

    await t.test(
      'feed filters use credited publication author and AND tags, independent of private attribution changes',
      async () => {
        let post = await article(draft('Credited author filter fixture'));
        const onlyA = await article({
          ...draft('One tag fixture'),
          tagIds: [tagA.id],
        });
        const filtered = await req<DTO['PublicPostSummary'][]>(
          'listPublicPosts',
          `/v1/public/posts?categoryId=${category.id}&authorId=${author.row.id}&tagIds=${tagA.id}&tagIds=${tagB.id}`,
          200,
        );
        assert.ok(filtered.body.data.some((row) => row.id === post.id));
        assert.ok(filtered.body.data.every((row) => row.id !== onlyA.id));
        post = (
          await req<DTO['WorkspacePost']>(
            'reassignPostAuthor',
            `/v1/admin/posts/${post.id}/author`,
            200,
            {
              account: admin,
              method: 'PATCH',
              body: { authorId: other.row.id },
              key: randomUUID(),
              version: post.version,
            },
          )
        ).body.data;
        assert.equal((await read(post)).body.data.author.id, author.row.id);
        const old = await req<DTO['PublicPostSummary'][]>(
          'listPublicPosts',
          `/v1/public/posts?authorId=${author.row.id}`,
          200,
        );
        assert.ok(old.body.data.some((row) => row.id === post.id));
        const current = await req<DTO['PublicPostSummary'][]>(
          'listPublicPosts',
          `/v1/public/posts?authorId=${other.row.id}`,
          200,
        );
        assert.ok(current.body.data.every((row) => row.id !== post.id));
        post = await publish(await review(post, other));
        assert.equal((await read(post)).body.data.author.id, other.row.id);
        await db.member.update({
          where: { id: other.row.id },
          data: { active: false },
        });
        try {
          assert.equal((await read(post)).body.data.author.id, other.row.id);
        } finally {
          await db.member.update({
            where: { id: other.row.id },
            data: { active: true },
          });
        }
      },
    );

    await t.test(
      'feed pagination orders first publication and UUID ties, binds filters and never exposes private dates in cursors',
      async () => {
        const one = await article(draft('Feed pagination one'));
        const two = await article(draft('Feed pagination two'));
        const three = await article(draft('Feed pagination three'));
        const tied = new Date(Date.now() + 60000);
        await db.post.updateMany({
          where: { id: { in: [one.id, two.id, three.id] } },
          data: { firstPublishedAt: tied },
        });
        const ids = [one.id, two.id, three.id].sort();
        const first = await req<DTO['PublicPostSummary'][]>(
          'listPublicPosts',
          `/v1/public/posts?pageSize=1&tagIds=${tagA.id}&tagIds=${tagB.id}`,
          200,
        );
        assert.equal(first.body.data[0]?.id, ids[0]);
        const cursor = first.body.meta.pagination.nextCursor!;
        const payload = JSON.parse(
          Buffer.from(cursor.split('.')[0]!, 'base64url').toString('utf8'),
        );
        assert.equal(payload.createdAt, tied.toISOString());
        assert.equal(payload.firstPublishedAt, tied.toISOString());
        const second = await req<DTO['PublicPostSummary'][]>(
          'listPublicPosts',
          `/v1/public/posts?pageSize=1&tagIds=${tagB.id}&tagIds=${tagA.id}&cursor=${encodeURIComponent(cursor)}`,
          200,
        );
        assert.equal(second.body.data[0]?.id, ids[1]);
        await req(
          'listPublicPosts',
          `/v1/public/posts?pageSize=2&tagIds=${tagA.id}&tagIds=${tagB.id}&cursor=${encodeURIComponent(cursor)}`,
          400,
        );
        await req(
          'listPublicPosts',
          `/v1/public/posts?pageSize=1&tagIds=${tagA.id}&cursor=${encodeURIComponent(cursor)}`,
          400,
        );
        await req(
          'listPublicPosts',
          `/v1/public/posts?tagIds=${tagA.id}&tagIds=${tagA.id}`,
          422,
        );
        await req('listPublicPosts', '/v1/public/posts?authorId=bad', 422);
        await req('listPublicPosts', '/v1/public/posts?scope=ALL', 422);
      },
    );

    await t.test(
      'canonical/history slug resolution points directly to the current public path and denies withdrawn targets',
      async () => {
        let post = await article(draft('Public redirect fixture'));
        const original = post.slug!;
        post = (
          await change('changePostSlug', 'slug', post, {
            slug: `public-middle-${randomUUID()}`,
          })
        ).body.data;
        const middle = post.slug!;
        post = (
          await change('changePostSlug', 'slug', post, {
            slug: `public-final-${randomUUID()}`,
          })
        ).body.data;
        for (const slug of [original, middle]) {
          const redirect = await req<DTO['SlugResolution']>(
            'resolvePublicPostSlug',
            `/v1/public/posts/by-slug/${slug}`,
            200,
          );
          assert.equal(redirect.body.data.resolution, 'REDIRECT');
          assert.equal(redirect.body.data.canonicalPath, `/posts/${post.slug}`);
          assert.equal(redirect.body.data.post, null);
        }
        const canonical = await req<DTO['SlugResolution']>(
          'resolvePublicPostSlug',
          `/v1/public/posts/by-slug/${post.slug}`,
          200,
        );
        assert.equal(canonical.body.data.post?.id, post.id);
        post = (await change('unpublishPost', 'unpublish', post, {})).body.data;
        await read(post, 404);
        for (const slug of [original, middle, post.slug])
          await req(
            'resolvePublicPostSlug',
            `/v1/public/posts/by-slug/${slug}`,
            404,
          );
      },
    );

    await t.test(
      'availability preserves order and hides unknown, draft, withdrawn and trashed states without operation keys',
      async () => {
        const published = await article();
        const draftPost = (await create()).body.data;
        let withdrawn = await article();
        withdrawn = (await change('unpublishPost', 'unpublish', withdrawn, {}))
          .body.data;
        let trashed = await article();
        trashed = (await change('trashPost', '', trashed, undefined)).body.data;
        const unknown = randomUUID();
        const ids = [
          draftPost.id,
          published.id,
          unknown,
          withdrawn.id,
          trashed.id,
        ];
        const response = await req<DTO['AvailabilityItem'][]>(
          'checkPublicPostAvailability',
          '/v1/public/posts/availability',
          200,
          { method: 'POST', body: { postIds: ids } },
        );
        assert.deepEqual(
          response.body.data.map((row) => row.postId),
          ids,
        );
        assert.deepEqual(
          response.body.data.map((row) => row.available),
          [false, true, false, false, false],
        );
        assert.equal(
          response.body.data[1]?.publishedRevisionId,
          published.publishedRevisionId,
        );
        assert.equal(response.body.meta.idempotency, null);
        for (const post of [draftPost, withdrawn, trashed])
          await read(post, 404);
        for (const postIds of [
          [],
          [published.id, published.id],
          Array.from({ length: 51 }, () => randomUUID()),
          ['invalid'],
        ])
          await req(
            'checkPublicPostAvailability',
            '/v1/public/posts/availability',
            422,
            { method: 'POST', body: { postIds } },
          );
        const fifty = await req<DTO['AvailabilityItem'][]>(
          'checkPublicPostAvailability',
          '/v1/public/posts/availability',
          200,
          {
            method: 'POST',
            body: { postIds: Array.from({ length: 50 }, () => randomUUID()) },
          },
        );
        assert.equal(fifty.body.data.length, 50);
        assert.ok(
          fifty.body.data.every(
            (row) => !row.available && row.publishedRevisionId === null,
          ),
        );
      },
    );

    await t.test(
      'taxonomy usage counts current pointers, while public lists retain only live archived references',
      async () => {
        const oldCategory = (
          await taxon('categories', 'Archived published category')
        ).body.data;
        const oldTag = (await taxon('tags', 'Archived published tag')).body
          .data;
        let post = await article({
          ...draft(),
          categoryId: oldCategory.id,
          tagIds: [oldTag.id],
        });
        post = (
          await change(
            'savePostDraft',
            'draft',
            post,
            draft('Different private taxonomy'),
            author,
          )
        ).body.data;
        const usage = await req<DTO['ManagedTaxon']>(
          'getManagedCategory',
          `/v1/categories/${oldCategory.id}`,
          200,
          { account: editor },
        );
        assert.deepEqual(usage.body.data.usage, {
          publishedCount: 1,
          draftCount: 0,
        });
        await patch('categories', oldCategory, { active: false });
        await patch('tags', oldTag, { active: false });
        const draftOnly = (
          await taxon('categories', 'Archived draft only category')
        ).body.data;
        await create({ ...draft(), categoryId: draftOnly.id });
        await patch('categories', draftOnly, { active: false });
        const publicCategories = await req<DTO['Taxon'][]>(
          'listPublicCategories',
          '/v1/public/categories',
          200,
        );
        assert.ok(
          publicCategories.body.data.some(
            (row) => row.id === oldCategory.id && !row.active,
          ),
        );
        assert.ok(
          publicCategories.body.data.every((row) => row.id !== draftOnly.id),
        );
        const publicTags = await req<DTO['Taxon'][]>(
          'listPublicTags',
          '/v1/public/tags',
          200,
        );
        assert.ok(
          publicTags.body.data.some(
            (row) => row.id === oldTag.id && !row.active,
          ),
        );
        await req(
          'listPublicCategories',
          '/v1/public/categories?active=false',
          422,
        );
        post = (await change('unpublishPost', 'unpublish', post, {})).body.data;
        const after = await req<DTO['Taxon'][]>(
          'listPublicCategories',
          '/v1/public/categories',
          200,
        );
        assert.ok(after.body.data.every((row) => row.id !== oldCategory.id));
        const beyond = await req<DTO['Taxon'][]>(
          'listPublicTags',
          '/v1/public/tags?page=999999&pageSize=1',
          200,
        );
        assert.equal(beyond.body.data.length, 0);
        assert.equal(page(beyond.body.meta.pagination).hasMore, false);
      },
    );

    await t.test(
      'English stemming and web-search phrase/OR/negation semantics reject non-indexable queries',
      async () => {
        const phrase = await article({
          ...draft('Running silver foxes'),
          markdown: 'The quick brown fox jumps over a river.',
        });
        const alternatives = await article({
          ...draft('Alternative cranberry scenery'),
          markdown: 'A leisurely walk.',
        });
        const run = await search('run');
        assert.ok(run.body.data.some((row) => row.id === phrase.id));
        const exact = await search('"quick brown"');
        assert.ok(exact.body.data.some((row) => row.id === phrase.id));
        const reverse = await search('"brown quick"');
        assert.ok(reverse.body.data.every((row) => row.id !== phrase.id));
        const or = await search('cranberry OR silver');
        assert.ok(or.body.data.some((row) => row.id === phrase.id));
        assert.ok(or.body.data.some((row) => row.id === alternatives.id));
        const exclude = await search('silver -fox');
        assert.ok(exclude.body.data.every((row) => row.id !== phrase.id));
        for (const q of [
          'the and of',
          '!!!',
          '-silver',
          'silver OR -cranberry',
        ])
          assert.equal(
            (await search(q, 422)).body.error.code,
            'SEARCH_QUERY_NOT_SEARCHABLE',
          );
        await search(' ', 422);
        await search('x'.repeat(201), 422);
        await search("' OR 1=1; --");
        await req('searchPublicPosts', '/v1/public/search?q=a&q=b', 422);
        await req(
          'searchPublicPosts',
          '/v1/public/search?q=running&cursor=bad',
          422,
        );
      },
    );

    await t.test(
      'weighted search ranking and filters use the current published revision, never working content',
      async () => {
        const title = await article({
          ...draft('Marigold title rank'),
          summary: 'A summary',
          markdown: 'A body.',
        });
        const summary = await article({
          ...draft('Summary rank'),
          summary: 'Marigold summary',
          markdown: 'A body.',
        });
        const body = await article({
          ...draft('Body rank'),
          summary: 'A summary',
          markdown: 'Marigold body.',
        });
        const ranked = await search('marigold');
        assert.deepEqual(
          ranked.body.data.map((row) => row.id),
          [title.id, summary.id, body.id],
        );
        let current = (
          await change(
            'savePostDraft',
            'draft',
            title,
            { ...draft('secretmauve private draft'), tagIds: [tagA.id] },
            author,
          )
        ).body.data;
        assert.ok(
          (await search('secretmauve')).body.data.every(
            (row) => row.id !== title.id,
          ),
        );
        const filtered = await search(
          'marigold',
          200,
          `&authorId=${author.row.id}&categoryId=${category.id}&tagIds=${tagA.id}&tagIds=${tagB.id}`,
        );
        assert.ok(filtered.body.data.some((row) => row.id === title.id));
        current = await publish(await review(current));
        assert.ok(
          (await search('marigold')).body.data.every(
            (row) => row.id !== title.id,
          ),
        );
        assert.ok(
          (await search('secretmauve')).body.data.some(
            (row) => row.id === title.id,
          ),
        );
        current = (await change('trashPost', '', current, undefined)).body.data;
        assert.ok(
          (await search('secretmauve')).body.data.every(
            (row) => row.id !== title.id,
          ),
        );
        await read(current, 404);
      },
    );

    await t.test(
      'search result window caps at 1000 while reporting the full matching count and exact last page',
      async () => {
        const suffix = randomUUID();
        const token = `windoworchid${suffix.replaceAll('-', '')}`;
        const owners = Array.from({ length: 11 }, (_, i) => ({
          id: randomUUID(),
          identityUid: `fixture-window-${suffix}-${i}`,
          email: `window-${i}@example.test`,
          displayName: `Window author ${i}`,
          handle: `window-${suffix}-${i}`,
          role: 'AUTHOR' as const,
        }));
        await db.member.createMany({ data: owners });
        const posts = Array.from({ length: 1001 }, (_, i) => ({
          id: randomUUID(),
          authorId: owners[Math.floor(i / 100)]!.id,
          creatorId: owners[Math.floor(i / 100)]!.id,
          clientDraftId: randomUUID(),
        }));
        const revisions = posts.map((post) => ({
          id: randomUUID(),
          postId: post.id,
          creatorId: post.creatorId,
          creditedAuthorId: post.authorId,
          number: 1,
          title: token,
          summary: 'Window fixture summary',
          markdown: 'Window fixture body',
          plainBody: 'Window fixture body',
          categoryId: category.id,
          checksum: 'c'.repeat(64),
        }));
        await db.post.createMany({ data: posts });
        await db.revision.createMany({ data: revisions });
        const reserved = posts.map((post) => ({
          slug: `window-${post.id}`,
          postId: post.id,
          canonical: true,
        }));
        await db.slugHistory.createMany({ data: reserved });
        const pointers = revisions.map((row) => ({
          id: row.postId,
          revisionId: row.id,
          slug: `window-${row.postId}`,
        }));
        await db.$executeRaw`UPDATE blogpost."Post" p SET "workingRevisionId" = v."revisionId", "publishedRevisionId" = v."revisionId", "canonicalSlug" = v.slug,
      "publicationState" = 'PUBLISHED', "workflowState" = 'CLEAN', "firstPublishedAt" = clock_timestamp(), "lastPublishedAt" = clock_timestamp()
      FROM jsonb_to_recordset(${JSON.stringify(pointers)}::jsonb) AS v(id uuid, "revisionId" uuid, slug text) WHERE p.id = v.id`;
        await db.$executeRaw(Prisma.sql`INSERT INTO blogpost."PublishedSearch" ("postId", "revisionId", document)
      SELECT p.id, r.id, setweight(to_tsvector('english', r.title), 'A') || setweight(to_tsvector('english', r.summary), 'B') || setweight(to_tsvector('english', r."plainBody"), 'C')
      FROM blogpost."Post" p JOIN blogpost."Revision" r ON r.id = p."publishedRevisionId" WHERE p."creatorId" IN (${Prisma.join(owners.map((owner) => Prisma.sql`${owner.id}::uuid`))})`);
        const first = await search(token);
        assert.equal(first.body.data.length, 20);
        assert.equal(page(first.body.meta.pagination).totalItems, 1001);
        assert.equal(page(first.body.meta.pagination).totalPages, 50);
        assert.equal(page(first.body.meta.pagination).truncated, true);
        const last = await search(token, 200, '&page=28&pageSize=37');
        assert.equal(last.body.data.length, 1);
        assert.equal(page(last.body.meta.pagination).hasMore, false);
        assert.equal(page(last.body.meta.pagination).totalPages, 28);
        const beyond = await search(token, 200, '&page=29&pageSize=37');
        assert.equal(beyond.body.data.length, 0);
        assert.equal(page(beyond.body.meta.pagination).truncated, true);
      },
    );

    await t.test(
      'archive winning a row-lock race prevents publication with no index, event or receipt commit',
      async () => {
        const local = (await taxon('categories', 'Archive race category')).body
          .data;
        const post = await review(
          (await create({ ...draft(), categoryId: local.id })).body.data,
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
            await tx.$queryRaw`SELECT id FROM blogpost."Category" WHERE id = ${local.id}::uuid FOR UPDATE`;
            await tx.category.update({
              where: { id: local.id },
              data: { active: false },
            });
            acquired();
            await finish;
          },
          { timeout: 15000 },
        );
        await ready;
        try {
          const pending = change(
            'publishPostRevision',
            'publish',
            post,
            { revisionId: post.review.submittedRevisionId },
            editor,
            409,
          );
          let waiting = false;
          for (let i = 0; i < 150; i++) {
            const rows = await db.$queryRaw<
              { waiting: boolean }[]
            >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename = current_user AND wait_event IS NOT NULL AND query LIKE '%Category%FOR SHARE%') AS waiting`;
            if (rows[0]?.waiting) {
              waiting = true;
              break;
            }
            await delay(10);
          }
          assert.equal(waiting, true);
          release();
          await holder;
          await pending;
          assert.equal(
            await db.publishedSearch.count({ where: { postId: post.id } }),
            0,
          );
          assert.equal(
            await db.reviewEvent.count({
              where: { postId: post.id, action: 'PUBLISHED' },
            }),
            0,
          );
          assert.equal(
            (await db.post.findUniqueOrThrow({ where: { id: post.id } }))
              .lockVersion,
            post.version,
          );
        } finally {
          release();
          await holder;
        }
      },
    );

    await t.test(
      'a genuine SQL dependency timeout fails the whole availability check instead of deleting offline copies',
      async () => {
        const post = await article();
        const body = { postIds: [post.id] };
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
            await tx.$executeRaw`LOCK TABLE blogpost."Post" IN ACCESS EXCLUSIVE MODE`;
            acquired();
            await finish;
          },
          { timeout: 15000 },
        );
        await ready;
        try {
          const failed = await req(
            'checkPublicPostAvailability',
            '/v1/public/posts/availability',
            503,
            { method: 'POST', body },
          );
          assert.equal(failed.body.data, null);
          assert.equal(failed.body.error.code, 'DEPENDENCY_UNAVAILABLE');
          assert.equal(failed.response.headers.get('retry-after'), '1');
        } finally {
          release();
          await holder;
        }
        const recovered = await req<DTO['AvailabilityItem'][]>(
          'checkPublicPostAvailability',
          '/v1/public/posts/availability',
          200,
          { method: 'POST', body },
        );
        assert.equal(recovered.body.data[0]?.available, true);
      },
    );

    await t.test(
      'the migration rebuilds old simple vectors from the public pointer without changing revisions or private content',
      async () => {
        const post = await article({
          ...draft('Running migration fixture'),
          markdown: 'Published migration body.',
        });
        await db.$executeRaw`UPDATE blogpost."PublishedSearch" SET document = to_tsvector('simple', 'Running migration fixture') WHERE "postId" = ${post.id}::uuid`;
        assert.ok(
          (await search('run')).body.data.every((row) => row.id !== post.id),
        );
        const pool = new Pool(connection('app'));
        t.after(() => pool.end());
        const source = await readFile(
          'prisma/migrations/202610260003_english_search/migration.sql',
          'utf8',
        );
        const before = await db.revision.findUniqueOrThrow({
          where: { id: post.publishedRevisionId! },
        });
        await pool.query(source);
        assert.ok(
          (await search('run')).body.data.some((row) => row.id === post.id),
        );
        assert.deepEqual(
          await db.revision.findUniqueOrThrow({
            where: { id: post.publishedRevisionId! },
          }),
          before,
        );
      },
    );

    await t.test(
      'backfill waits for editorial row locks and preserves a concurrently republished search pointer',
      async () => {
        let post = await article(draft('Backfill old publication'));
        post = (
          await change(
            'savePostDraft',
            'draft',
            post,
            draft('backfillamethyst new publication'),
            author,
          )
        ).body.data;
        post = await review(post);
        const pool = new Pool(connection('app'));
        t.after(() => pool.end());
        const source = await readFile(
          'prisma/migrations/202610260003_english_search/migration.sql',
          'utf8',
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
            await tx.$queryRaw`SELECT id FROM blogpost."Post" WHERE id = ${post.id}::uuid FOR UPDATE`;
            acquired();
            await finish;
          },
          { timeout: 15000 },
        );
        await ready;
        let backfill: Promise<unknown> | undefined;
        try {
          backfill = pool.query(source);
          let waiting = false;
          for (let i = 0; i < 100; i++) {
            const rows = await db.$queryRaw<
              { waiting: boolean }[]
            >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename = current_user AND wait_event = 'relation' AND query LIKE '%LOCK TABLE%EXCLUSIVE MODE%') AS waiting`;
            if (rows[0]?.waiting) {
              waiting = true;
              break;
            }
            await delay(10);
          }
          assert.equal(
            waiting,
            true,
            'Backfill did not wait for the editorial row-lock transaction',
          );
          const publishing = publish(post);
          release();
          await holder;
          await backfill;
          post = await publishing;
          const indexed = await db.publishedSearch.findUniqueOrThrow({
            where: { postId: post.id },
          });
          assert.equal(indexed.revisionId, post.publishedRevisionId);
          assert.ok(
            (await search('backfillamethyst')).body.data.some(
              (row) => row.id === post.id,
            ),
          );
        } finally {
          release();
          await holder;
          if (backfill) await backfill;
        }
      },
    );

    const required = [
      'listPublicPosts',
      'getPublicPost',
      'resolvePublicPostSlug',
      'searchPublicPosts',
      'listPublicCategories',
      'listPublicTags',
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
    ];
    for (const id of required)
      assert.ok(f.executed.has(id), `No observed success for ${id}`);
    const runId = process.env.BLOGPOST_IDENTITY_RUN_ID!;
    assert.match(runId, /^[a-f0-9]{12}$/);
    await writeFile(
      `/app/.local/conformance/public-taxonomy-${runId}.json`,
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
