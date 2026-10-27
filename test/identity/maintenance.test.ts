import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { identityFixture, type DTO, type Body } from './fixture.js';
import { metadata } from '../helpers.js';
import { assertConforms, coverage } from '../conformance/verify.js';
import { connection } from '../../src/platform/database/connection.js';
import {
  StorageAdapter,
  hashBytes,
  storageFailure,
} from '../../src/modules/media/storage.js';
import { MaintenanceService } from '../../src/modules/operations/maintenance.service.js';

test(
  'real retention, durable cleanup and permanent slug tombstones',
  { timeout: 180000 },
  async (t) => {
    const f = await identityFixture(t);
    const db = f.database.prisma;
    const actor = await f.member('EDITOR');
    const storage = f.app.get(StorageAdapter);
    const pool = new Pool({
      ...connection('app'),
      max: 1,
      application_name: 'maintenance-fixture',
    });
    t.after(() => pool.end());
    const service = new MaintenanceService(
      pool,
      storage,
      'media-orphans:fixture',
    );
    const category = await db.category.create({
      data: {
        name: 'Maintenance fixture',
        normalizedName: 'maintenance fixture',
        slug: 'maintenance-' + randomUUID(),
      },
    });
    const pixel = await readFile('contracts/fixtures/media/pixel.png');
    const root = process.env.MEDIA_LOCAL_ROOT!;
    const content = (id?: string): DTO['DraftContentInput'] => ({
      title: 'Maintenance publication',
      summary: 'A useful maintenance summary',
      categoryId: category.id,
      tagIds: [],
      markdown: id
        ? '![A retained image](media://' + id + ')'
        : 'A useful article body.',
      coverMediaId: id ?? null,
      coverAltText: id ? 'A retained cover' : null,
      coverDecorative: false,
    });
    async function create() {
      return (
        await f.request<DTO['WorkspacePost']>('createPost', '/v1/posts', 201, {
          account: actor,
          method: 'POST',
          key: randomUUID(),
          body: { clientDraftId: randomUUID(), draft: content() },
        })
      ).body.data;
    }
    async function upload(postId: string, status = 201) {
      const form = new FormData();
      form.set(
        'file',
        new Blob([new Uint8Array(pixel)], { type: 'image/png' }),
        'private.png',
      );
      const path = '/v1/posts/' + postId + '/media';
      const response = await fetch(f.origin + path, {
        method: 'POST',
        headers: {
          ...metadata,
          Authorization: 'Bearer ' + actor.token,
          'Idempotency-Key': randomUUID(),
        },
        body: form,
        signal: AbortSignal.timeout(15000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(response.status, status);
      assertConforms('stagePostMedia', {
        method: 'POST',
        path,
        status,
        headers: Object.fromEntries(response.headers),
        body: bytes,
      });
      if (response.ok) f.executed.add('stagePostMedia');
      return (JSON.parse(bytes.toString()) as Body<DTO['MediaAsset']>).data;
    }
    async function change(
      operation: string,
      suffix: string,
      post: DTO['WorkspacePost'],
      body?: unknown,
      status = 200,
    ) {
      return f.request<DTO['WorkspacePost']>(
        operation,
        '/v1/posts/' + post.id + (suffix ? '/' + suffix : ''),
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
          version: post.version,
          key: randomUUID(),
          body,
        },
      );
    }
    async function publish(
      post: DTO['WorkspacePost'],
      asset: DTO['MediaAsset'],
    ) {
      post = (await change('savePostDraft', 'draft', post, content(asset.id)))
        .body.data;
      post = (
        await change('submitPostForReview', 'submit', post, {
          revisionId: post.workingRevisionId,
        })
      ).body.data;
      return (
        await change('publishPostRevision', 'publish', post, {
          revisionId: post.review.submittedRevisionId,
        })
      ).body.data;
    }
    async function expire(id: string) {
      await db.mediaAsset.update({
        where: { id },
        data: { unattachedExpiresAt: new Date(0) },
      });
      await db.mediaUploadAttempt.updateMany({
        where: { mediaId: id },
        data: { leaseExpiresAt: new Date(0), cleanupAfter: new Date(0) },
      });
    }
    async function oldTrash(post: DTO['WorkspacePost']) {
      post = (await change('trashPost', '', post)).body.data;
      await db.post.update({
        where: { id: post.id },
        data: {
          trashedAt: new Date(Date.now() - 31 * 86400000),
          purgeAfter: new Date(Date.now() - 86400000),
        },
      });
      await db.mediaUploadAttempt.updateMany({
        where: { media: { postId: post.id } },
        data: { leaseExpiresAt: new Date(0), cleanupAfter: new Date(0) },
      });
      return post;
    }
    t.beforeEach(async () => {
      await db.rateLimitBucket.deleteMany();
    });
    await t.test(
      'expired unattached assets are deleted, while every retained historical reference protects its files',
      async () => {
        let post = await create();
        const retained = await upload(post.id);
        post = (
          await change('savePostDraft', 'draft', post, content(retained.id))
        ).body.data;
        post = (await change('savePostDraft', 'draft', post, content())).body
          .data;
        const expired = await upload(post.id);
        await expire(expired.id);
        await expire(retained.id);
        const result = await service.run();
        assert.equal(result.failures, 0);
        assert.ok(result.assetsDeleted >= 1);
        assert.equal(
          await db.mediaAsset.count({ where: { id: expired.id } }),
          0,
        );
        assert.equal(
          (await readdir(root)).some((name) => name.includes(expired.id)),
          false,
        );
        assert.equal(
          (
            await db.mediaAsset.findUniqueOrThrow({
              where: { id: retained.id },
            })
          ).state,
          'READY',
        );
        assert.equal(
          (await readdir(root)).filter((name) => name.includes(retained.id))
            .length,
          3,
        );
        assert.equal(
          await db.revision.count({ where: { postId: post.id } }),
          3,
        );
        const repeat = await service.run();
        assert.equal(repeat.failures, 0);
        assert.equal(repeat.assetsDeleted, 0);
      },
    );
    await t.test(
      'expired uploads keep their pending byte allowance until physical cleanup succeeds',
      async () => {
        const post = await create();
        const asset = await upload(post.id);
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { byteSize: BigInt(100 * 1024 * 1024) },
        });
        await expire(asset.id);
        await upload(post.id, 409);
        assert.equal((await service.run()).failures, 0);
        assert.equal(await db.mediaAsset.count({ where: { id: asset.id } }), 0);
        await upload(post.id);
      },
    );
    await t.test(
      'partial storage failure retains the post tombstone until retry succeeds and keeps both slugs reserved',
      async () => {
        let post = await create();
        const asset = await upload(post.id);
        post = await publish(post, asset);
        const originalSlug = (
          await db.post.findUniqueOrThrow({ where: { id: post.id } })
        ).canonicalSlug!;
        const renamed = 'reserved-' + randomUUID();
        post = (await change('changePostSlug', 'slug', post, { slug: renamed }))
          .body.data;
        post = await oldTrash(post);
        const original = storage.remove.bind(storage);
        let fail = true;
        storage.remove = async (plan) => {
          await original(plan);
          if (fail) {
            fail = false;
            throw storageFailure();
          }
        };
        try {
          const result = await service.run();
          assert.equal(result.failures, 1);
          const pending = await db.post.findUniqueOrThrow({
            where: { id: post.id },
          });
          assert.ok(pending.purgeStartedAt);
          assert.equal(
            (await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } }))
              .objectsDeletedAt,
            null,
          );
          await change('restoreTrashedPost', 'restore', post, {}, 404);
        } finally {
          storage.remove = original;
        }
        const completed = await service.run();
        assert.equal(completed.failures, 0);
        assert.equal(completed.postsPurged, 1);
        assert.equal(await db.post.count({ where: { id: post.id } }), 0);
        assert.equal(
          await db.revision.count({ where: { postId: post.id } }),
          0,
        );
        assert.equal(
          await db.mediaAsset.count({ where: { postId: post.id } }),
          0,
        );
        for (const slug of [originalSlug, renamed]) {
          const tombstone = await db.slugHistory.findUniqueOrThrow({
            where: { slug },
          });
          assert.equal(tombstone.postId, null);
          assert.equal(tombstone.canonical, false);
          await f.request(
            'resolvePublicPostSlug',
            '/v1/public/posts/by-slug/' + slug,
            404,
          );
          await assert.rejects(
            pool.query('DELETE FROM blogpost."SlugHistory" WHERE slug=$1', [
              slug,
            ]),
            { code: '42501' },
          );
          await assert.rejects(
            pool.query(
              'UPDATE blogpost."SlugHistory" SET slug=$2 WHERE slug=$1',
              [slug, 'replacement-' + randomUUID()],
            ),
            { code: '23514' },
          );
        }
        const next = await create();
        const nextAsset = await upload(next.id);
        const newPublication = await publish(next, nextAsset);
        assert.notEqual(
          (
            await db.post.findUniqueOrThrow({
              where: { id: newPublication.id },
            })
          ).canonicalSlug,
          originalSlug,
        );
        await change(
          'changePostSlug',
          'slug',
          newPublication,
          { slug: renamed },
          409,
        );
        await assert.rejects(
          pool.query(
            'UPDATE blogpost."SlugHistory" SET "postId"=$2 WHERE slug=$1',
            [renamed, next.id],
          ),
          { code: '23514' },
        );
      },
    );
    await t.test(
      'one maintenance session owns cleanup; storage I/O holds no SQL transaction',
      async () => {
        const post = await create();
        const asset = await upload(post.id);
        await expire(asset.id);
        const otherPool = new Pool({ ...connection('app'), max: 1 });
        const original = storage.remove.bind(storage);
        let enter!: () => void;
        let release!: () => void;
        const entered = new Promise<void>((resolve) => {
          enter = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let first = true;
        storage.remove = async (plan) => {
          if (first) {
            first = false;
            enter();
            await gate;
          }
          await original(plan);
        };
        try {
          const pending = service.run();
          await entered;
          assert.equal(
            (
              await new MaintenanceService(
                otherPool,
                storage,
                'other-fixture',
              ).run()
            ).acquired,
            false,
          );
          const activity = await poolState();
          assert.equal(activity, 0);
          const rejected = await change(
            'savePostDraft',
            'draft',
            post,
            content(asset.id),
            409,
          );
          assert.equal(rejected.body.error.code, 'WORKFLOW_CONFLICT');
          release();
          assert.equal((await pending).failures, 0);
        } finally {
          release();
          storage.remove = original;
          await otherPool.end();
        }
      },
    );
    async function poolState() {
      const result = await db.$queryRaw<
        { total: bigint }[]
      >`SELECT count(*) AS total FROM pg_stat_activity
      WHERE application_name='maintenance-fixture' AND state='idle in transaction'`;
      return Number(result[0]!.total);
    }
    await t.test(
      'expired pending workers are fenced before cleanup and grace delays object deletion',
      async () => {
        const post = await create();
        const asset = await db.mediaAsset.create({
          data: {
            postId: post.id,
            uploaderId: actor.row.id,
            leaseExpiresAt: new Date(0),
            uploadAttemptId: randomUUID(),
          },
        });
        const record = await db.idempotencyRecord.create({
          data: {
            identityUid: actor.uid,
            method: 'POST',
            route: '/v1/posts/' + post.id + '/media',
            key: randomUUID(),
            requestHash: 'a'.repeat(64),
            leaseExpiresAt: new Date(0),
            expiresAt: new Date(Date.now() + 86400000),
          },
        });
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { uploadOperationId: record.id },
        });
        await db.mediaUploadAttempt.create({
          data: {
            id: asset.uploadAttemptId!,
            mediaId: asset.id,
            leaseExpiresAt: new Date(0),
            cleanupAfter: new Date(Date.now() + 60000),
          },
        });
        await service.run();
        const pending = await db.mediaAsset.findUniqueOrThrow({
          where: { id: asset.id },
        });
        assert.equal(pending.state, 'DELETING');
        assert.equal(pending.uploadOperationId, null);
        assert.equal(pending.objectsDeletedAt, null);
        assert.equal(
          await db.idempotencyRecord.count({ where: { id: record.id } }),
          0,
        );
        await db.mediaUploadAttempt.updateMany({
          where: { mediaId: asset.id },
          data: { cleanupAfter: new Date(0) },
        });
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { deletionAfter: new Date(0) },
        });
        assert.equal((await service.run()).failures, 0);
        assert.equal(await db.mediaAsset.count({ where: { id: asset.id } }), 0);
      },
    );
    await t.test(
      'retention removes expired receipts, invitations, counters and old audit metadata, preserving current records',
      async () => {
        const old = new Date(0);
        const future = new Date(Date.now() + 86400000);
        const receipts = await Promise.all(
          [old, future].map((expiresAt) =>
            db.idempotencyRecord.create({
              data: {
                identityUid: actor.uid,
                method: 'POST',
                route: '/maintenance-fixture',
                key: randomUUID(),
                requestHash: 'b'.repeat(64),
                expiresAt,
              },
            }),
          ),
        );
        const invitations = await Promise.all(
          [old, future].map((expiresAt) =>
            db.invitation.create({
              data: {
                email: randomUUID() + '@example.test',
                role: 'AUTHOR',
                tokenHash: hashBytes(Buffer.from(randomUUID())),
                issuerId: actor.row.id,
                expiresAt,
              },
            }),
          ),
        );
        const audits = await Promise.all(
          [old, new Date()].map((createdAt) =>
            db.auditEvent.create({
              data: {
                actorId: actor.row.id,
                action: 'RETENTION_FIXTURE',
                subjectType: 'MEMBER',
                subjectId: actor.row.id,
                changes: {},
                traceId: 'c'.repeat(32),
                createdAt,
              },
            }),
          ),
        );
        await db.rateLimitBucket.create({
          data: {
            memberId: actor.row.id,
            action: 'EXPIRED_FIXTURE',
            count: 1,
            windowStart: old,
            expiresAt: old,
          },
        });
        await db.rateLimitBucket.create({
          data: {
            memberId: actor.row.id,
            action: 'CURRENT_FIXTURE',
            count: 1,
            windowStart: new Date(),
            expiresAt: future,
          },
        });
        assert.equal((await service.run()).failures, 0);
        for (const [rows, count] of [
          [
            receipts,
            (id: string) => db.idempotencyRecord.count({ where: { id } }),
          ],
          [invitations, (id: string) => db.invitation.count({ where: { id } })],
          [audits, (id: string) => db.auditEvent.count({ where: { id } })],
        ] as const) {
          assert.equal(await count(rows[0]!.id), 0);
          assert.equal(await count(rows[1]!.id), 1);
        }
        assert.equal(
          await db.rateLimitBucket.count({
            where: { action: 'EXPIRED_FIXTURE' },
          }),
          0,
        );
        assert.equal(
          await db.rateLimitBucket.count({
            where: { action: 'CURRENT_FIXTURE' },
          }),
          1,
        );
      },
    );
    await t.test(
      'orphan reconciliation deletes an old late partial write, while current objects and journal plans stay protected',
      async () => {
        const post = await create();
        const retained = await upload(post.id);
        const oldName =
          'blogpost/posts/' +
          randomUUID() +
          '/' +
          randomUUID() +
          '/' +
          randomUUID() +
          '/w480.png';
        const plan = {
          objectName: oldName,
          sha256: hashBytes(pixel),
          byteSize: pixel.length,
          mimeType: 'image/png',
        };
        await storage.put(plan, pixel);
        await writeFile(
          join(
            root,
            oldName.replaceAll('/', '_') + '.' + plan.sha256 + '.blob',
          ),
          Buffer.alloc(0),
        );
        const young = {
          ...plan,
          objectName:
            'blogpost/posts/' +
            randomUUID() +
            '/' +
            randomUUID() +
            '/' +
            randomUUID() +
            '/w480.png',
        };
        const youngObject = await storage.put(young, pixel);
        const attemptId = randomUUID();
        const future = new Date(Date.now() + 180000);
        const pending = await db.mediaAsset.create({
          data: {
            postId: post.id,
            uploaderId: actor.row.id,
            leaseExpiresAt: future,
            uploadAttemptId: attemptId,
          },
        });
        const pendingPlan = {
          ...plan,
          objectName:
            'blogpost/posts/' +
            post.id +
            '/' +
            pending.id +
            '/' +
            attemptId +
            '/w480.png',
        };
        const pendingObject = await storage.put(pendingPlan, pixel);
        await db.mediaUploadAttempt.create({
          data: {
            id: attemptId,
            mediaId: pending.id,
            leaseExpiresAt: future,
            cleanupAfter: new Date(future.getTime() + 60000),
            objects: [
              {
                ...pendingPlan,
                generation: pendingObject.generation,
                name: 'w480',
                width: 1,
                height: 1,
              },
            ],
          },
        });
        const original = storage.list.bind(storage);
        storage.list = async (cursor) => {
          const page = await original(cursor, 1);
          return {
            ...page,
            objects: page.objects.map((object) => ({
              ...object,
              createdAt:
                object.objectName === young.objectName
                  ? object.createdAt
                  : new Date(0),
            })),
          };
        };
        try {
          let removed = 0;
          for (let i = 0; i < 60 && removed === 0; i++)
            removed += (await service.run({ maxOrphanPages: 1 }))
              .orphansDeleted;
          assert.equal(removed, 1);
          assert.equal(
            (await readdir(root)).some((name) =>
              name.includes(oldName.split('/')[3]!),
            ),
            false,
          );
          assert.equal(
            (await readdir(root)).filter((name) => name.includes(retained.id))
              .length,
            3,
          );
          const stream = await storage.open(youngObject);
          stream.destroy();
          const pendingStream = await storage.open(pendingObject);
          pendingStream.destroy();
        } finally {
          storage.list = original;
        }
      },
    );
    await t.test(
      'small job budgets leave resumable tombstones without deleting retained data early',
      async () => {
        let post = await create();
        const asset = await upload(post.id);
        post = await oldTrash(post);
        const first = await service.run({ maxRows: 1 });
        assert.equal(first.budgetReached, true);
        assert.equal(first.rowsChanged, 1);
        assert.ok(
          (await db.post.findUniqueOrThrow({ where: { id: post.id } }))
            .purgeStartedAt,
        );
        assert.equal(
          (await readdir(root)).filter((name) => name.includes(asset.id))
            .length,
          3,
        );
        const next = await service.run();
        assert.equal(next.postsPurged, 1);
        assert.equal(next.failures, 0);
      },
    );
    await t.test(
      'the operator entrypoint runs with application credentials and emits only bounded result metadata',
      async () => {
        assert.equal(process.env.SQL_ROOT_PASSWORD, undefined);
        assert.equal(process.env.SQL_MIGRATOR_PASSWORD, undefined);
        const { stdout } = await promisify(execFile)(
          process.execPath,
          ['node_modules/tsx/dist/cli.mjs', 'src/ops/maintenance.ts'],
          { timeout: 30000, maxBuffer: 1048576 },
        );
        const events = stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        assert.equal(events.at(-1)?.event, 'job_completed');
        assert.ok(
          events.some(
            (event) =>
              event.event === 'maintenance_result' &&
              event.acquired === true &&
              event.failures === 0,
          ),
        );
        for (const event of events)
          for (const [key, value] of Object.entries(event)) {
            assert.ok(
              key === 'event' ||
                typeof value === 'number' ||
                typeof value === 'boolean',
            );
          }
      },
    );
    await t.test(
      'cleanup skips a pending operation that still owns its SQL idempotency lock',
      async () => {
        const post = await create();
        const key = randomUUID();
        const route = '/v1/posts/' + post.id + '/media';
        const record = await db.idempotencyRecord.create({
          data: {
            identityUid: actor.uid,
            method: 'POST',
            route,
            key,
            requestHash: 'd'.repeat(64),
            leaseExpiresAt: new Date(0),
            expiresAt: new Date(0),
          },
        });
        const attemptId = randomUUID();
        const asset = await db.mediaAsset.create({
          data: {
            postId: post.id,
            uploaderId: actor.row.id,
            uploadOperationId: record.id,
            uploadAttemptId: attemptId,
            leaseExpiresAt: new Date(0),
          },
        });
        await db.mediaUploadAttempt.create({
          data: {
            id: attemptId,
            mediaId: asset.id,
            leaseExpiresAt: new Date(0),
            cleanupAfter: new Date(0),
          },
        });
        const writerPool = new Pool({ ...connection('app'), max: 1 });
        const writer = await writerPool.connect();
        try {
          await writer.query('BEGIN');
          await writer.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            [JSON.stringify([actor.uid, 'POST', route, key])],
          );
          const skipped = await service.run();
          assert.equal(skipped.failures, 0);
          assert.equal(
            (await db.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } }))
              .state,
            'PROCESSING',
          );
          assert.equal(
            await db.idempotencyRecord.count({ where: { id: record.id } }),
            1,
          );
        } finally {
          await writer.query('ROLLBACK');
          writer.release();
          await writerPool.end();
        }
        assert.equal((await service.run()).failures, 0);
        assert.equal(
          await db.idempotencyRecord.count({ where: { id: record.id } }),
          0,
        );
        assert.equal(await db.mediaAsset.count({ where: { id: asset.id } }), 0);
      },
    );
    const runId = process.env.BLOGPOST_IDENTITY_RUN_ID!;
    assert.match(runId, /^[a-f0-9]{12}$/);
    await writeFile(
      '/app/.local/conformance/maintenance-' + runId + '.json',
      JSON.stringify(
        {
          ...coverage('backend', f.executed),
          observedOperations: [...f.executed],
          runId,
          testProject: f.config.identityProject,
          observedAt: new Date().toISOString(),
          maintenanceSuitePassed: true,
        },
        null,
        2,
      ) + '\n',
    );
  },
);
