import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  identityFixture,
  type Account,
  type Body,
  type DTO,
} from './fixture.js';
import { assertConforms, coverage } from '../conformance/verify.js';
import { metadata } from '../helpers.js';
import { MediaService } from '../../src/modules/media/media.service.js';
import {
  StorageAdapter,
  storageFailure,
} from '../../src/modules/media/storage.js';

test(
  'real staged media, private storage and publication-aware binary delivery',
  { timeout: 180000 },
  async (t) => {
    const f = await identityFixture(t);
    const db = f.database.prisma;
    const storage = f.app.get(StorageAdapter);
    const author = await f.member();
    const other = await f.member();
    const editor = await f.member('EDITOR');
    const category = await db.category.create({
      data: {
        name: 'Media fixture',
        normalizedName: 'media fixture',
        slug: 'media-' + randomUUID(),
      },
    });
    const pixel = await readFile('contracts/fixtures/media/pixel.png');
    const root = process.env.MEDIA_LOCAL_ROOT!;
    const content = (mediaId?: string): DTO['DraftContentInput'] => ({
      title: 'An image publication',
      summary: 'A useful publication summary',
      markdown: mediaId
        ? '![A meaningful image description](media://' + mediaId + ')'
        : 'Some article text.',
      categoryId: category.id,
      tagIds: [],
      coverMediaId: null,
    });
    async function create(actor: Account = author) {
      return (
        await f.request<DTO['WorkspacePost']>('createPost', '/v1/posts', 201, {
          method: 'POST',
          account: actor,
          key: randomUUID(),
          body: { clientDraftId: randomUUID(), draft: content() },
        })
      ).body.data;
    }
    function assetPath(postId: string, mediaId?: string) {
      return '/v1/posts/' + postId + '/media' + (mediaId ? '/' + mediaId : '');
    }
    async function upload(
      postId: string,
      options: {
        account?: Account;
        key?: string;
        bytes?: Buffer;
        mimeType?: string;
        filename?: string;
        status?: number;
        extras?: boolean;
        headers?: Record<string, string>;
        baseOrigin?: string;
      } = {},
    ) {
      const body = new FormData();
      body.set(
        'file',
        new Blob([new Uint8Array(options.bytes ?? pixel)], {
          type: options.mimeType ?? 'image/png',
        }),
        options.filename ?? 'private-original.png',
      );
      if (options.extras) body.set('unrecognized', 'private field');
      const response = await fetch(
        (options.baseOrigin ?? f.origin) + assetPath(postId),
        {
          method: 'POST',
          headers: {
            ...metadata,
            Authorization: 'Bearer ' + (options.account ?? author).token,
            'Idempotency-Key': options.key ?? randomUUID(),
            ...options.headers,
          },
          body,
          signal: AbortSignal.timeout(20000),
        },
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      const decoded = JSON.parse(bytes.toString()) as Body<DTO['MediaAsset']>;
      assert.equal(
        response.status,
        options.status ?? 201,
        'upload status: ' + decoded.error?.code,
      );
      assertConforms('stagePostMedia', {
        method: 'POST',
        path: assetPath(postId),
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: bytes,
      });
      if (response.ok) f.executed.add('stagePostMedia');
      return { response, body: decoded };
    }
    async function binary(
      postId: string,
      mediaId: string,
      options: {
        public?: boolean;
        account?: Account;
        status?: number;
        name?: string;
        headers?: Record<string, string>;
      } = {},
    ) {
      const path =
        (options.public
          ? '/v1/public/posts/' + postId + '/media/' + mediaId
          : assetPath(postId, mediaId)) +
        '/' +
        (options.name ?? 'w480');
      const operation = options.public
        ? 'getPublicPostMedia'
        : 'getPrivatePostMedia';
      const response = await fetch(f.origin + path, {
        headers: {
          ...metadata,
          ...(!options.public
            ? { Authorization: 'Bearer ' + (options.account ?? author).token }
            : {}),
          ...options.headers,
        },
        signal: AbortSignal.timeout(15000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(
        response.status,
        options.status ?? 200,
        'binary status: ' + (response.ok ? '' : bytes.toString()),
      );
      assertConforms(operation, {
        method: 'GET',
        path,
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: bytes,
      });
      if (response.ok) {
        f.executed.add(operation);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(
          Number(response.headers.get('content-length')),
          bytes.length,
        );
        assert.equal(response.headers.get('x-resource-version'), null);
      }
      return { response, bytes };
    }
    const meta = (
      postId: string,
      mediaId: string,
      account: Account = author,
      status = 200,
    ) =>
      f.request<DTO['MediaAsset']>(
        'getPostMediaMetadata',
        assetPath(postId, mediaId),
        status,
        { account },
      );
    async function change(
      operation: string,
      suffix: string,
      post: DTO['WorkspacePost'],
      body?: unknown,
      account: Account = author,
      status = 200,
    ) {
      return f.request<DTO['WorkspacePost']>(
        operation,
        '/v1/posts/' + post.id + (suffix ? '/' + suffix : ''),
        status,
        {
          method: suffix === 'draft' ? 'PUT' : suffix ? 'POST' : 'DELETE',
          account,
          key: randomUUID(),
          version: post.version,
          body,
        },
      );
    }
    async function publish(post: DTO['WorkspacePost'], mediaId?: string) {
      post = (await change('savePostDraft', 'draft', post, content(mediaId)))
        .body.data;
      post = (
        await change('submitPostForReview', 'submit', post, {
          revisionId: post.workingRevisionId,
        })
      ).body.data;
      return (
        await change(
          'publishPostRevision',
          'publish',
          post,
          { revisionId: post.review.submittedRevisionId },
          editor,
        )
      ).body.data;
    }
    async function pausePut() {
      const original = storage.put.bind(storage);
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let first = true;
      storage.put = async (plan, bytes) => {
        const result = await original(plan, bytes);
        if (first) {
          first = false;
          enter();
          await gate;
        }
        return result;
      };
      return {
        entered,
        release,
        restore() {
          release();
          storage.put = original;
        },
      };
    }
    t.beforeEach(async () => {
      await db.rateLimitBucket.deleteMany();
    });

    await t.test(
      'staging does not mutate or attach to a post and returns only canonical metadata',
      async () => {
        const post = await create();
        const before = await db.post.findUniqueOrThrow({
          where: { id: post.id },
        });
        const result = await upload(post.id);
        const asset = result.body.data;
        assert.equal(result.response.headers.get('x-resource-version'), null);
        assert.equal(
          result.response.headers.get('location'),
          assetPath(post.id, asset.id),
        );
        assert.equal(result.body.meta.idempotency?.replayed, false);
        assert.equal(asset.ready, true);
        assert.equal(asset.mimeType, 'image/png');
        assert.equal(
          Date.parse(asset.unattachedExpiresAt!) -
            Date.parse(result.body.meta.idempotency!.expiresAt),
          0,
        );
        assert.deepEqual(
          asset.variants.map((v) => [v.name, v.width, v.height]),
          [
            ['w480', 1, 1],
            ['w960', 1, 1],
            ['w1600', 1, 1],
          ],
        );
        for (const value of asset.variants) {
          assert.ok(
            value.apiPath.startsWith(assetPath(post.id, asset.id) + '/'),
          );
          const result = await binary(post.id, asset.id, { name: value.name });
          const decoded = await sharp(result.bytes).metadata();
          assert.equal(decoded.width, 1);
          assert.equal(decoded.exif, undefined);
        }
        assert.deepEqual((await meta(post.id, asset.id)).body.data, asset);
        assert.equal(JSON.stringify(asset).includes('objectName'), false);
        assert.equal(JSON.stringify(asset).includes('private-original'), false);
        assert.deepEqual(
          await db.post.findUniqueOrThrow({ where: { id: post.id } }),
          before,
        );
        assert.equal(
          await db.revisionMedia.count({ where: { mediaId: asset.id } }),
          0,
        );
        assert.equal(
          await db.revision.count({ where: { postId: post.id } }),
          1,
        );
        await binary(post.id, asset.id, { public: true, status: 404 });
      },
    );
    await t.test(
      'normalization generates true sizes, preserves transparency and strips metadata',
      async () => {
        const post = await create();
        const original = await sharp({
          create: {
            width: 1800,
            height: 900,
            channels: 4,
            background: { r: 10, g: 20, b: 30, alpha: 0.5 },
          },
        })
          .withMetadata()
          .png()
          .toBuffer();
        const asset = (await upload(post.id, { bytes: original })).body.data;
        assert.deepEqual(
          asset.variants.map((v) => [v.width, v.height]),
          [
            [480, 240],
            [960, 480],
            [1600, 800],
          ],
        );
        for (const value of asset.variants) {
          const decoded = await sharp(
            (await binary(post.id, asset.id, { name: value.name })).bytes,
          ).metadata();
          assert.equal(decoded.hasAlpha, true);
          assert.equal(decoded.exif, undefined);
          assert.equal(decoded.icc, undefined);
        }
        for (const format of ['jpeg', 'webp'] as const) {
          const image = await sharp(pixel)[format]().toBuffer();
          const asset = (
            await upload(post.id, { bytes: image, mimeType: 'image/' + format })
          ).body.data;
          assert.equal(
            (await binary(post.id, asset.id)).response.headers.get(
              'content-type',
            ),
            'image/' + format,
          );
        }
      },
    );
    await t.test(
      'retries ignore multipart boundaries, filenames and diagnostics but bind exact content',
      async () => {
        const post = await create();
        const key = randomUUID();
        const first = await upload(post.id, { key });
        const repeat = await upload(post.id, {
          key,
          filename: '../../renamed-private.png',
          headers: { 'X-Device-ID': randomUUID(), 'X-Expected-Version': '999' },
        });
        assert.deepEqual(repeat.body.data, first.body.data);
        assert.equal(repeat.body.meta.idempotency?.replayed, true);
        assert.notEqual(repeat.body.traceId, first.body.traceId);
        const changed = await sharp(pixel).webp().toBuffer();
        assert.equal(
          (
            await upload(post.id, {
              key,
              bytes: changed,
              mimeType: 'image/webp',
              status: 409,
            })
          ).body.error.code,
          'IDEMPOTENCY_KEY_REUSED',
        );
        assert.equal(
          (await upload(post.id, { key, mimeType: 'image/jpeg', status: 409 }))
            .body.error.code,
          'IDEMPOTENCY_KEY_REUSED',
        );
        await change(
          'savePostDraft',
          'draft',
          post,
          content(first.body.data.id),
        );
        assert.equal(
          (await meta(post.id, first.body.data.id)).body.data
            .unattachedExpiresAt,
          null,
        );
        assert.deepEqual(
          (await upload(post.id, { key })).body.data,
          first.body.data,
        );
        assert.equal(
          await db.mediaAsset.count({ where: { postId: post.id } }),
          1,
        );
      },
    );
    await t.test(
      'only the current published revision grants public media; history remains private',
      async () => {
        let post = await create();
        const first = (await upload(post.id)).body.data;
        const second = (await upload(post.id)).body.data;
        post = await publish(post, first.id);
        await binary(post.id, first.id, { public: true });
        await binary(post.id, second.id, { public: true, status: 404 });
        post = (
          await change('savePostDraft', 'draft', post, content(second.id))
        ).body.data;
        await binary(post.id, first.id, { public: true });
        await binary(post.id, second.id, { public: true, status: 404 });
        post = await publish(post, second.id);
        await binary(post.id, first.id, { public: true, status: 404 });
        await binary(post.id, first.id);
        await binary(post.id, second.id, { public: true });
        post = (await change('unpublishPost', 'unpublish', post, {}, editor))
          .body.data;
        await binary(post.id, second.id, { public: true, status: 404 });
        await binary(post.id, first.id);
        post = (await change('trashPost', '', post, undefined, editor)).body
          .data;
        await binary(post.id, second.id, { public: true, status: 404 });
        await binary(post.id, second.id, { account: editor });
        await change('restoreTrashedPost', 'restore', post, {}, editor);
        await binary(post.id, second.id, { public: true, status: 404 });
      },
    );
    await t.test(
      'current membership, ownership, metadata and cross-post checks cover every media route',
      async () => {
        const post = await create();
        const unrelated = await create(other);
        const key = randomUUID();
        const asset = (await upload(post.id, { key })).body.data;
        await meta(post.id, asset.id, other, 404);
        await binary(post.id, asset.id, { account: other, status: 404 });
        await upload(post.id, { account: other, status: 404 });
        await meta(unrelated.id, asset.id, editor, 404);
        await binary(unrelated.id, asset.id, { account: editor, status: 404 });
        await binary(unrelated.id, asset.id, { public: true, status: 404 });
        await binary(post.id, asset.id, {
          headers: { 'X-Device-ID': '' },
          status: 400,
        });
        await binary(post.id, asset.id, {
          public: true,
          headers: { 'X-Device-ID': '' },
          status: 400,
        });
        await binary(post.id, asset.id, { name: 'original', status: 422 });
        await db.post.update({
          where: { id: post.id },
          data: { authorId: other.row.id },
        });
        await upload(post.id, { key, status: 404 });
        await meta(post.id, asset.id, author, 404);
        await binary(post.id, asset.id, { account: other });
        await db.member.update({
          where: { id: other.row.id },
          data: { active: false },
        });
        try {
          await binary(post.id, asset.id, { account: other, status: 403 });
        } finally {
          await db.member.update({
            where: { id: other.row.id },
            data: { active: true },
          });
        }
      },
    );
    await t.test(
      'multipart and encoded-file limits reject malformed or oversized requests before reservation',
      async () => {
        const post = await create();
        await upload(post.id, { extras: true, status: 422 });
        await upload(post.id, {
          mimeType: 'image/svg+xml',
          bytes: Buffer.from('<svg/>'),
          status: 415,
        });
        await upload(post.id, { mimeType: 'image/jpeg', status: 415 });
        await upload(post.id, {
          bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
          status: 413,
        });
        const response = await fetch(f.origin + assetPath(post.id), {
          method: 'POST',
          headers: {
            ...metadata,
            Authorization: 'Bearer ' + author.token,
            'Idempotency-Key': randomUUID(),
            'Content-Type': 'multipart/form-data; boundary=bounded',
          },
          body: Buffer.alloc(6 * 1024 * 1024 + 1),
          signal: AbortSignal.timeout(15000),
        });
        assert.equal(response.status, 413);
        const bytes = Buffer.from(await response.arrayBuffer());
        assertConforms('stagePostMedia', {
          method: 'POST',
          path: assetPath(post.id),
          status: 413,
          headers: Object.fromEntries(response.headers),
          body: bytes,
        });
        assert.equal(
          await db.mediaAsset.count({
            where: { postId: post.id, state: 'READY' },
          }),
          0,
        );
        assert.equal(
          await db.idempotencyRecord.count({
            where: { route: assetPath(post.id) },
          }),
          0,
        );
      },
    );
    await t.test(
      'duplicate concurrent uploads get one ready asset without changing the post',
      async () => {
        const post = await create();
        const key = randomUUID();
        const pause = await pausePut();
        try {
          const first = upload(post.id, { key });
          await pause.entered;
          const pending = await upload(post.id, { key, status: 409 });
          assert.equal(pending.body.error.code, 'IDEMPOTENCY_IN_PROGRESS');
          assert.equal(pending.response.headers.get('retry-after'), '1');
          pause.release();
          await first;
        } finally {
          pause.restore();
        }
        assert.equal(
          await db.mediaAsset.count({
            where: { postId: post.id, state: 'READY' },
          }),
          1,
        );
        assert.equal(
          (await db.post.findUniqueOrThrow({ where: { id: post.id } }))
            .lockVersion,
          post.version,
        );
      },
    );
    await t.test(
      'partial uncertain writes leave no readable asset and retain their cleanup journal',
      async () => {
        const post = await create();
        const key = randomUUID();
        const original = storage.put.bind(storage);
        storage.put = async (plan, bytes) => {
          await original(plan, bytes);
          throw storageFailure();
        };
        try {
          await upload(post.id, { key, status: 503 });
        } finally {
          storage.put = original;
        }
        const failed = await db.mediaAsset.findFirstOrThrow({
          where: { postId: post.id },
        });
        assert.equal(failed.state, 'DELETING');
        assert.equal(failed.uploadOperationId, null);
        const journal = await db.mediaUploadAttempt.findFirstOrThrow({
          where: { mediaId: failed.id },
        });
        assert.ok(journal.abandonedAt);
        assert.equal(journal.cleanedAt, null);
        assert.equal(
          (await readdir(root)).some((name) => name.includes(failed.id)),
          false,
        );
        await meta(post.id, failed.id, author, 404);
        await upload(post.id, { key });
      },
    );
    await t.test(
      'expiry fences suspended workers and old cleanup cannot delete a replacement attempt',
      async () => {
        const post = await create();
        const key = randomUUID();
        const pause = await pausePut();
        try {
          const old = upload(post.id, { key });
          await pause.entered;
          const initial = await db.mediaAsset.findFirstOrThrow({
            where: { postId: post.id },
          });
          await db.idempotencyRecord.update({
            where: { id: initial.uploadOperationId! },
            data: { leaseExpiresAt: new Date(Date.now() - 1000) },
          });
          const replacement = await upload(post.id, { key });
          assert.equal(replacement.body.data.id, initial.id);
          pause.release();
          const resumed = await old;
          assert.equal(resumed.body.meta.idempotency?.replayed, true);
          assert.deepEqual(resumed.body.data, replacement.body.data);
          const current = await db.mediaAsset.findUniqueOrThrow({
            where: { id: initial.id },
          });
          assert.notEqual(current.uploadAttemptId, initial.uploadAttemptId);
          assert.equal(current.state, 'READY');
          assert.equal(
            (await readdir(root)).filter((name) => name.includes(current.id))
              .length,
            3,
          );
          await binary(post.id, current.id);
        } finally {
          pause.restore();
        }
      },
    );
    await t.test(
      'post trash and membership changes during storage are rechecked before finalization',
      async () => {
        for (const reason of ['trash', 'disable', 'reassign'] as const) {
          const post = await create();
          const pause = await pausePut();
          try {
            const pending = upload(post.id, {
              status:
                reason === 'trash' ? 409 : reason === 'disable' ? 403 : 404,
            });
            await pause.entered;
            if (reason === 'trash') await change('trashPost', '', post);
            else if (reason === 'disable')
              await db.member.update({
                where: { id: author.row.id },
                data: { active: false },
              });
            else
              await db.post.update({
                where: { id: post.id },
                data: { authorId: other.row.id },
              });
            pause.release();
            await pending;
          } finally {
            pause.restore();
            await db.member.update({
              where: { id: author.row.id },
              data: { active: true },
            });
          }
          assert.equal(
            await db.mediaAsset.count({
              where: { postId: post.id, state: 'READY' },
            }),
            0,
          );
          const failed = await db.mediaAsset.findFirstOrThrow({
            where: { postId: post.id },
          });
          assert.equal(
            (await readdir(root)).some((name) => name.includes(failed.id)),
            false,
          );
        }
      },
    );
    await t.test(
      'public and private reads recheck access after opening storage before emitting bytes',
      async () => {
        for (const publicRead of [false, true]) {
          let post = await create();
          const asset = (await upload(post.id)).body.data;
          if (publicRead) post = await publish(post, asset.id);
          const original = storage.open.bind(storage);
          let enter!: () => void;
          let release!: () => void;
          const entered = new Promise<void>((resolve) => {
            enter = resolve;
          });
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          storage.open = async (object) => {
            const stream = await original(object);
            enter();
            await gate;
            return stream;
          };
          try {
            const pending = binary(post.id, asset.id, {
              public: publicRead,
              status: 404,
            });
            await entered;
            if (publicRead)
              await change('unpublishPost', 'unpublish', post, {}, editor);
            else
              await db.post.update({
                where: { id: post.id },
                data: { authorId: other.row.id },
              });
            release();
            await pending;
          } finally {
            release();
            storage.open = original;
          }
        }
      },
    );
    await t.test(
      'expired staged media is unavailable and storage failures are safe 503 responses',
      async () => {
        const post = await create();
        const asset = (await upload(post.id)).body.data;
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { unattachedExpiresAt: new Date(Date.now() - 1000) },
        });
        await meta(post.id, asset.id, author, 404);
        await binary(post.id, asset.id, { status: 404 });
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { unattachedExpiresAt: null },
        });
        const row = await db.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
        });
        const variants = row.variants as unknown as {
          objectName: string;
          generation: string;
          sha256: string;
          byteSize: number;
          mimeType: string;
        }[];
        const first = variants[0]!;
        const physical = join(
          root,
          first.objectName.replaceAll('/', '_') +
            '.' +
            first.generation +
            '.blob',
        );
        await writeFile(physical, Buffer.alloc(first.byteSize));
        const response = await binary(post.id, asset.id, { status: 503 });
        assert.equal(response.response.headers.get('retry-after'), '1');
        assert.equal(
          JSON.parse(response.bytes.toString()).error.code,
          'DEPENDENCY_UNAVAILABLE',
        );
        await storage.remove(first);
        await binary(post.id, asset.id, { status: 503 });
        await meta(post.id, asset.id);
      },
    );
    await t.test(
      'pending quota includes ready uploads and abandoned attempts and rolls reservations back',
      async () => {
        const post = await create();
        const staged = (await upload(post.id)).body.data;
        const asset = await db.mediaAsset.update({
          where: { id: staged.id },
          data: { byteSize: BigInt(100 * 1024 * 1024) },
        });
        try {
          assert.equal(
            (await upload(post.id, { status: 409 })).body.error.code,
            'RESOURCE_QUOTA_EXCEEDED',
          );
          assert.equal(
            await db.mediaAsset.count({ where: { postId: post.id } }),
            1,
          );
          assert.equal(
            await db.idempotencyRecord.count({
              where: { route: assetPath(post.id) },
            }),
            1,
          );
          await db.mediaAsset.update({
            where: { id: asset.id },
            data: { state: 'DELETING' },
          });
          const now = new Date();
          await db.mediaUploadAttempt.create({
            data: {
              id: randomUUID(),
              mediaId: asset.id,
              abandonedAt: now,
              leaseExpiresAt: now,
              cleanupAfter: now,
              objects: [
                {
                  ...(
                    asset.variants as unknown as Record<
                      string,
                      string | number
                    >[]
                  )[0]!,
                  byteSize: 100 * 1024 * 1024,
                },
              ],
            },
          });
          assert.equal(
            (await upload(post.id, { status: 409 })).body.error.code,
            'RESOURCE_QUOTA_EXCEEDED',
          );
        } finally {
          await db.mediaAsset.delete({ where: { id: asset.id } });
        }
      },
    );
    await t.test(
      'upload throttling is atomic and completed receipt retries consume no extra allowance',
      async () => {
        const post = await create();
        const key = randomUUID();
        const first = await upload(post.id, { key });
        for (let i = 1; i < 10; i++) await upload(post.id);
        const limited = await upload(post.id, { status: 429 });
        assert.equal(limited.body.error.code, 'RATE_LIMITED');
        assert.ok(Number(limited.response.headers.get('retry-after')) > 0);
        assert.deepEqual(
          (await upload(post.id, { key })).body.data,
          first.body.data,
        );
        assert.equal(
          await db.mediaAsset.count({
            where: { postId: post.id, state: 'READY' },
          }),
          10,
        );
      },
    );
    await t.test(
      'an actual lost upload response replays the single committed media resource',
      async () => {
        const post = await create();
        const key = randomUUID();
        let complete!: (asset: DTO['MediaAsset']) => void;
        let fail!: (error: unknown) => void;
        const committed = new Promise<DTO['MediaAsset']>((resolve, reject) => {
          complete = resolve;
          fail = reject;
        });
        const proxy = createServer((incoming, outgoing) => {
          incoming.resume();
          void upload(post.id, { key })
            .then((result) => complete(result.body.data))
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
            upload(post.id, {
              key,
              baseOrigin: 'http://127.0.0.1:' + address.port,
            }),
          );
          const asset = await committed;
          const replay = await upload(post.id, { key });
          assert.equal(replay.body.meta.idempotency?.replayed, true);
          assert.deepEqual(replay.body.data, asset);
          assert.equal(
            await db.mediaAsset.count({ where: { postId: post.id } }),
            1,
          );
          await binary(post.id, asset.id);
        } finally {
          await new Promise<void>((resolve) => proxy.close(() => resolve()));
        }
      },
    );
    await t.test(
      'an uncertain finalization outcome never deletes an already committed ready asset',
      async () => {
        const post = await create();
        const key = randomUUID();
        const service = f.app.get(MediaService) as unknown as {
          finalize: (...args: unknown[]) => Promise<unknown>;
        };
        const original = service.finalize.bind(service);
        service.finalize = async (...args) => {
          await original(...args);
          throw storageFailure();
        };
        try {
          await upload(post.id, { key, status: 503 });
        } finally {
          service.finalize = original;
        }
        const asset = await db.mediaAsset.findFirstOrThrow({
          where: { postId: post.id },
        });
        assert.equal(asset.state, 'READY');
        assert.equal(
          (await readdir(root)).filter((name) => name.includes(asset.id))
            .length,
          3,
        );
        const replay = await upload(post.id, { key });
        assert.equal(replay.body.meta.idempotency?.replayed, true);
        assert.equal(replay.body.data.id, asset.id);
        await binary(post.id, asset.id);
      },
    );
    await t.test(
      'upload and private reads require identity and reject invalid keys before reservation',
      async () => {
        const post = await create();
        for (const [method, path, operation] of [
          ['POST', assetPath(post.id), 'stagePostMedia'],
          ['GET', assetPath(post.id, randomUUID()), 'getPostMediaMetadata'],
          [
            'GET',
            assetPath(post.id, randomUUID()) + '/w480',
            'getPrivatePostMedia',
          ],
        ]) {
          const response = await fetch(f.origin + path!, {
            method,
            headers: {
              ...metadata,
              'Content-Type': 'multipart/form-data; boundary=fixture',
            },
            signal: AbortSignal.timeout(10000),
          });
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.equal(response.status, 401);
          assertConforms(operation!, {
            method: method!,
            path: path!,
            status: 401,
            headers: Object.fromEntries(response.headers),
            body: bytes,
          });
        }
        assert.equal(
          (await upload(post.id, { key: 'invalid', status: 400 })).body.error
            .code,
          'INVALID_IDEMPOTENCY_KEY',
        );
        assert.equal(
          await db.mediaAsset.count({ where: { postId: post.id } }),
          0,
        );
      },
    );
    const required = [
      'stagePostMedia',
      'getPostMediaMetadata',
      'getPrivatePostMedia',
      'getPublicPostMedia',
    ];
    for (const id of required)
      assert.ok(f.executed.has(id), 'No actual media success for ' + id);
    const runId = process.env.BLOGPOST_IDENTITY_RUN_ID!;
    assert.match(runId, /^[a-f0-9]{12}$/);
    await writeFile(
      '/app/.local/conformance/media-' + runId + '.json',
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
