import type { Pool, PoolClient } from 'pg';
import type { Prisma } from '../../generated/prisma/client.js';
import { objects, type VariantObject } from '../media/media.repository.js';
import {
  storageFailure,
  type MediaStorage,
  type ListedObject,
} from '../media/storage.js';

export const MAINTENANCE_LOCK = 78201906;
interface AssetRow {
  id: string;
  postId: string;
  state: string;
  variants: Prisma.JsonValue;
  uploadOperationId: string | null;
  leaseExpiresAt: Date | null;
  deletionAfter: Date | null;
  objectsDeletedAt: Date | null;
}
interface Receipt {
  id: string;
  identityUid: string;
  method: string;
  route: string;
  key: string;
}
interface PostRow {
  id: string;
  purgeStartedAt: Date | null;
  purgeAfter: Date | null;
  trashedAt: Date | null;
}
export interface MaintenanceStats {
  acquired: boolean;
  rowsChanged: number;
  objectDeletes: number;
  postsPurged: number;
  assetsDeleted: number;
  attemptsCleaned: number;
  orphansDeleted: number;
  failures: number;
  budgetReached: boolean;
}
export interface MaintenanceBudget {
  maxRows?: number;
  maxObjectDeletes?: number;
  maxDurationMs?: number;
  maxOrphanPages?: number;
}

/** A session advisory lock spans bounded I/O; every SQL transaction ends before storage is called. */
export class MaintenanceService {
  constructor(
    private readonly pool: Pool,
    private readonly storage: MediaStorage,
    private readonly checkpointKey: string,
  ) {
    if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(checkpointKey))
      throw new Error('Invalid maintenance checkpoint');
  }
  async run(budget: MaintenanceBudget = {}): Promise<MaintenanceStats> {
    const maxRows = budget.maxRows ?? 500;
    const maxObjects = budget.maxObjectDeletes ?? 500;
    const maxDuration = budget.maxDurationMs ?? 240000;
    const maxPages = budget.maxOrphanPages ?? 10;
    if (
      ![maxRows, maxObjects, maxDuration, maxPages].every(
        Number.isSafeInteger,
      ) ||
      maxRows < 1 ||
      maxRows > 5000 ||
      maxObjects < 1 ||
      maxObjects > 5000 ||
      maxDuration < 1 ||
      maxDuration > 240000 ||
      maxPages < 1 ||
      maxPages > 100
    )
      throw new Error('Invalid maintenance budget');
    const result: MaintenanceStats = {
      acquired: false,
      rowsChanged: 0,
      objectDeletes: 0,
      postsPurged: 0,
      assetsDeleted: 0,
      attemptsCleaned: 0,
      orphansDeleted: 0,
      failures: 0,
      budgetReached: false,
    };
    const deadline = performance.now() + maxDuration;
    const remaining = () => Math.max(0, maxRows - result.rowsChanged);
    const canWork = () => {
      const allowed =
        remaining() > 0 &&
        result.objectDeletes < maxObjects &&
        performance.now() < deadline;
      if (!allowed) result.budgetReached = true;
      return allowed;
    };
    const client = await this.pool.connect();
    const tx = async <T>(work: () => Promise<T>) => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '1s'");
        const value = await work();
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    };
    const clock = async () =>
      (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now'))
        .rows[0]!.now;
    const lockPost = async (id: string) =>
      (
        await client.query<PostRow>(
          'SELECT id, "purgeStartedAt", "purgeAfter", "trashedAt" FROM blogpost."Post" WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
    const referenced = async (id: string) =>
      (
        await client.query<{ used: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM blogpost."RevisionMedia" WHERE "mediaId"=$1)
      OR EXISTS(SELECT 1 FROM blogpost."Revision" WHERE "coverMediaId"=$1) AS used`,
          [id],
        )
      ).rows[0]!.used;
    const receiptLock = async (receipt: Receipt) =>
      (
        await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
          [
            JSON.stringify([
              receipt.identityUid,
              receipt.method,
              receipt.route,
              receipt.key,
            ]),
          ],
        )
      ).rows[0]!.locked;
    const safePlans = (
      value: Prisma.JsonValue,
      postId: string,
      mediaId: string,
    ) => {
      const plans = objects(value);
      if (
        plans.some(
          (plan) =>
            !plan.objectName.startsWith(
              'blogpost/posts/' + postId + '/' + mediaId + '/',
            ),
        )
      )
        throw storageFailure();
      return plans;
    };
    const remove = async (plans: VariantObject[]) => {
      const unique = new Map<string, VariantObject>();
      for (const plan of plans) {
        const previous = unique.get(plan.objectName);
        if (previous && previous.sha256 !== plan.sha256) throw storageFailure();
        if (!previous || plan.generation) unique.set(plan.objectName, plan);
      }
      if (
        result.objectDeletes + unique.size > maxObjects ||
        performance.now() >= deadline
      ) {
        result.budgetReached = true;
        return false;
      }
      try {
        for (const plan of unique.values()) {
          result.objectDeletes++;
          await this.storage.remove(plan);
        }
        return true;
      } catch {
        result.failures++;
        return false;
      }
    };
    try {
      result.acquired = (
        await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
          [MAINTENANCE_LOCK],
        )
      ).rows[0]!.acquired;
      if (!result.acquired) return result;
      // Claim expired trash before touching its files. Restore and all reads already reject purgeStartedAt.
      const purgeCandidates = await client.query<{ id: string }>(
        `SELECT id FROM blogpost."Post" WHERE "trashedAt" IS NOT NULL
        AND "purgeAfter" <= clock_timestamp() AND "purgeStartedAt" IS NULL ORDER BY "purgeAfter", id LIMIT $1`,
        [Math.min(100, remaining())],
      );
      for (const candidate of purgeCandidates.rows) {
        if (!canWork()) break;
        await tx(async () => {
          const post = await lockPost(candidate.id);
          const now = await clock();
          if (
            !post?.trashedAt ||
            !post.purgeAfter ||
            post.purgeAfter > now ||
            post.purgeStartedAt
          )
            return;
          result.rowsChanged +=
            (
              await client.query(
                'UPDATE blogpost."Post" SET "purgeStartedAt"=$2 WHERE id=$1',
                [post.id, now],
              )
            ).rowCount ?? 0;
          await client.query(
            'DELETE FROM blogpost."PublishedSearch" WHERE "postId"=$1',
            [post.id],
          );
        });
      }
      const assets = await client.query<AssetRow>(
        `SELECT m.* FROM blogpost."MediaAsset" m JOIN blogpost."Post" p ON p.id=m."postId" WHERE
        (m.state='DELETING' AND m."objectsDeletedAt" IS NULL AND (m."deletionAfter" IS NULL OR m."deletionAfter" <= clock_timestamp())) OR
        (m.state<>'DELETING' AND (p."purgeStartedAt" IS NOT NULL OR (m.state='PROCESSING' AND (m."leaseExpiresAt" <= clock_timestamp() OR (m."leaseExpiresAt" IS NULL AND m."createdAt" <= clock_timestamp()-interval '24 hours'))) OR
          (m.state='READY' AND ((m."unattachedExpiresAt" <= clock_timestamp()) OR (m."unattachedExpiresAt" IS NULL AND m."createdAt" <= clock_timestamp()-interval '24 hours')))
          AND NOT EXISTS(SELECT 1 FROM blogpost."RevisionMedia" r WHERE r."mediaId"=m.id)
          AND NOT EXISTS(SELECT 1 FROM blogpost."Revision" r WHERE r."coverMediaId"=m.id)))
        ORDER BY m."createdAt", m.id LIMIT $1`,
        [Math.min(100, remaining())],
      );
      for (const preview of assets.rows) {
        if (!canWork()) break;
        const prepared = await tx(async () => {
          const receipt = preview.uploadOperationId
            ? (
                await client.query<Receipt>(
                  'SELECT * FROM blogpost."IdempotencyRecord" WHERE id=$1',
                  [preview.uploadOperationId],
                )
              ).rows[0]
            : undefined;
          if (receipt && !(await receiptLock(receipt))) return null;
          const post = await lockPost(preview.postId);
          const asset = (
            await client.query<AssetRow>(
              'SELECT * FROM blogpost."MediaAsset" WHERE id=$1 FOR UPDATE',
              [preview.id],
            )
          ).rows[0];
          const now = await clock();
          if (
            !post ||
            !asset ||
            asset.objectsDeletedAt ||
            asset.uploadOperationId !== preview.uploadOperationId
          )
            return null;
          if (!post.purgeStartedAt && (await referenced(asset.id))) return null;
          if (
            asset.state === 'PROCESSING' &&
            asset.leaseExpiresAt &&
            asset.leaseExpiresAt > now &&
            !post.purgeStartedAt
          )
            return null;
          if (asset.state !== 'DELETING') {
            // Re-evaluate ready expiry under the post lock; a draft attachment may have won the race.
            if (!post.purgeStartedAt && asset.state === 'READY') {
              const eligible = (
                await client.query<{ eligible: boolean }>(
                  `SELECT ("unattachedExpiresAt" <= $2 OR ("unattachedExpiresAt" IS NULL AND "createdAt" <= $2-interval '24 hours')) AS eligible
                FROM blogpost."MediaAsset" WHERE id=$1`,
                  [asset.id, now],
                )
              ).rows[0]?.eligible;
              if (!eligible) return null;
            }
            const attempts = await client.query<{ cleanupAfter: Date }>(
              'SELECT "cleanupAfter" FROM blogpost."MediaUploadAttempt" WHERE "mediaId"=$1',
              [asset.id],
            );
            const after = new Date(
              Math.max(
                now.getTime(),
                ...attempts.rows.map((row) => row.cleanupAfter.getTime()),
              ),
            );
            await client.query(
              `UPDATE blogpost."MediaAsset" SET state='DELETING', "deletionAfter"=$2, "leaseExpiresAt"=NULL WHERE id=$1`,
              [asset.id, after],
            );
            await client.query(
              'UPDATE blogpost."MediaUploadAttempt" SET "abandonedAt"=coalesce("abandonedAt", $2) WHERE "mediaId"=$1',
              [asset.id, now],
            );
            if (receipt)
              await client.query(
                'DELETE FROM blogpost."IdempotencyRecord" WHERE id=$1 AND result IS NULL',
                [receipt.id],
              );
            asset.deletionAfter = after;
            result.rowsChanged++;
          }
          if (asset.deletionAfter && asset.deletionAfter > now) return null;
          const attempts = await client.query<{
            objects: Prisma.JsonValue;
            cleanupAfter: Date;
          }>(
            'SELECT objects, "cleanupAfter" FROM blogpost."MediaUploadAttempt" WHERE "mediaId"=$1',
            [asset.id],
          );
          if (attempts.rows.some((row) => row.cleanupAfter > now)) return null;
          return {
            asset,
            plans: [
              ...safePlans(asset.variants, asset.postId, asset.id),
              ...attempts.rows.flatMap((row) =>
                safePlans(row.objects, asset.postId, asset.id),
              ),
            ],
          };
        });
        if (!prepared || !canWork() || !(await remove(prepared.plans)))
          continue;
        await tx(async () => {
          const post = await lockPost(prepared.asset.postId);
          if (!post) return;
          const now = await clock();
          const changed = await client.query(
            'UPDATE blogpost."MediaAsset" SET "objectsDeletedAt"=$2 WHERE id=$1 AND state=\'DELETING\' AND "objectsDeletedAt" IS NULL',
            [prepared.asset.id, now],
          );
          if (!changed.rowCount) return;
          result.rowsChanged++;
          await client.query(
            'UPDATE blogpost."MediaUploadAttempt" SET "cleanedAt"=$2 WHERE "mediaId"=$1',
            [prepared.asset.id, now],
          );
          if (!post.purgeStartedAt && !(await referenced(prepared.asset.id))) {
            await client.query(
              'DELETE FROM blogpost."MediaAsset" WHERE id=$1',
              [prepared.asset.id],
            );
            result.assetsDeleted++;
          }
        });
      }
      // Superseded attempts have their own object namespace and can be cleaned while a replacement stays ready.
      const attempts = await client.query<{
        id: string;
        mediaId: string;
        postId: string;
        objects: Prisma.JsonValue;
      }>(
        `SELECT a.id, a."mediaId", m."postId", a.objects FROM blogpost."MediaUploadAttempt" a
        JOIN blogpost."MediaAsset" m ON m.id=a."mediaId" WHERE a."abandonedAt" IS NOT NULL AND a."cleanedAt" IS NULL
        AND a."cleanupAfter" <= clock_timestamp() AND (m."uploadAttemptId" IS DISTINCT FROM a.id OR m.state='DELETING') ORDER BY a."cleanupAfter", a.id LIMIT $1`,
        [Math.min(100, remaining())],
      );
      for (const attempt of attempts.rows) {
        if (!canWork()) break;
        const plans = await tx(async () => {
          if (!(await lockPost(attempt.postId))) return null;
          const rows = await client.query<{ objects: Prisma.JsonValue }>(
            `SELECT a.objects FROM blogpost."MediaUploadAttempt" a JOIN blogpost."MediaAsset" m ON m.id=a."mediaId"
            WHERE a.id=$1 AND a."abandonedAt" IS NOT NULL AND a."cleanedAt" IS NULL AND a."cleanupAfter" <= clock_timestamp()
            AND (m."uploadAttemptId" IS DISTINCT FROM a.id OR m.state='DELETING') FOR UPDATE OF m, a`,
            [attempt.id],
          );
          return rows.rows[0]
            ? safePlans(rows.rows[0].objects, attempt.postId, attempt.mediaId)
            : null;
        });
        if (!plans || !(await remove(plans))) continue;
        const changed = await client.query(
          'UPDATE blogpost."MediaUploadAttempt" SET "cleanedAt"=clock_timestamp() WHERE id=$1 AND "cleanedAt" IS NULL',
          [attempt.id],
        );
        result.rowsChanged += changed.rowCount ?? 0;
        result.attemptsCleaned += changed.rowCount ?? 0;
      }
      // The post and its immutable graph disappear only after all object tombstones have completed.
      const purges = await client.query<{ id: string }>(
        `SELECT p.id FROM blogpost."Post" p WHERE p."purgeStartedAt" IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM blogpost."MediaAsset" m WHERE m."postId"=p.id AND m."objectsDeletedAt" IS NULL) ORDER BY p."purgeStartedAt", p.id LIMIT $1`,
        [Math.min(100, remaining())],
      );
      for (const candidate of purges.rows) {
        if (!canWork()) break;
        await tx(async () => {
          const post = await lockPost(candidate.id);
          if (!post?.purgeStartedAt) return;
          const deleted = await client.query(
            `DELETE FROM blogpost."Post" p WHERE p.id=$1 AND NOT EXISTS(SELECT 1 FROM blogpost."MediaAsset" m
            WHERE m."postId"=p.id AND m."objectsDeletedAt" IS NULL)`,
            [post.id],
          );
          result.rowsChanged += deleted.rowCount ?? 0;
          result.postsPurged += deleted.rowCount ?? 0;
        });
      }
      const receipts = await client.query<Receipt>(
        'SELECT id, "identityUid", method, route, key FROM blogpost."IdempotencyRecord" WHERE "expiresAt" <= clock_timestamp() ORDER BY "expiresAt", id LIMIT $1',
        [Math.min(100, remaining())],
      );
      for (const receipt of receipts.rows) {
        if (!canWork()) break;
        await tx(async () => {
          if (!(await receiptLock(receipt))) return;
          result.rowsChanged +=
            (
              await client.query(
                'DELETE FROM blogpost."IdempotencyRecord" WHERE id=$1 AND "expiresAt" <= clock_timestamp()',
                [receipt.id],
              )
            ).rowCount ?? 0;
        });
      }
      for (const sql of [
        'DELETE FROM blogpost."Invitation" WHERE id IN (SELECT id FROM blogpost."Invitation" WHERE "expiresAt" <= clock_timestamp() ORDER BY "expiresAt", id LIMIT $1)',
        'DELETE FROM blogpost."RateLimitBucket" WHERE ctid IN (SELECT ctid FROM blogpost."RateLimitBucket" WHERE "expiresAt" <= clock_timestamp() ORDER BY "expiresAt" LIMIT $1)',
        'DELETE FROM blogpost."AuditEvent" WHERE id IN (SELECT id FROM blogpost."AuditEvent" WHERE "createdAt" < clock_timestamp()-interval \'90 days\' ORDER BY "createdAt", id LIMIT $1)',
        'DELETE FROM blogpost."MediaUploadAttempt" WHERE id IN (SELECT id FROM blogpost."MediaUploadAttempt" WHERE "cleanedAt" < clock_timestamp()-interval \'24 hours\' OR ("abandonedAt" IS NULL AND "completedAt" < clock_timestamp()-interval \'24 hours\') ORDER BY "createdAt", id LIMIT $1)',
      ]) {
        if (!canWork()) break;
        result.rowsChanged +=
          (await client.query(sql, [Math.min(100, remaining())])).rowCount ?? 0;
      }
      const cutoff = new Date((await clock()).getTime() - 86400000);
      let cursor =
        (
          await client.query<{ cursor: string | null }>(
            'SELECT cursor FROM blogpost."MaintenanceCheckpoint" WHERE key=$1',
            [this.checkpointKey],
          )
        ).rows[0]?.cursor ?? null;
      for (let page = 0; page < maxPages && canWork(); page++) {
        const listed = await this.storage.list(
          cursor,
          Math.min(100, maxObjects - result.objectDeletes),
        );
        let complete = true;
        for (const object of listed.objects) {
          if (
            performance.now() >= deadline ||
            result.objectDeletes >= maxObjects
          ) {
            result.budgetReached = true;
            complete = false;
            break;
          }
          if (
            object.createdAt > cutoff ||
            (await this.protected(client, object))
          )
            continue;
          result.objectDeletes++;
          try {
            await this.storage.remove(object);
            result.orphansDeleted++;
          } catch {
            result.failures++;
            complete = false;
            break;
          }
        }
        if (!complete) break;
        cursor = listed.nextCursor;
        await client.query(
          `INSERT INTO blogpost."MaintenanceCheckpoint" (key, cursor, "updatedAt") VALUES ($1,$2,clock_timestamp())
          ON CONFLICT (key) DO UPDATE SET cursor=excluded.cursor, "updatedAt"=excluded."updatedAt"`,
          [this.checkpointKey, cursor],
        );
        if (!cursor) break;
        if (page === maxPages - 1) result.budgetReached = true;
      }
      return result;
    } finally {
      if (result.acquired)
        await client
          .query('SELECT pg_advisory_unlock($1::bigint)', [MAINTENANCE_LOCK])
          .catch(() => {});
      client.release(true);
    }
  }
  private async protected(client: PoolClient, object: ListedObject) {
    const result = await client.query<{ protected: boolean }>(
      `SELECT
      EXISTS(SELECT 1 FROM blogpost."MediaAsset" m CROSS JOIN LATERAL jsonb_array_elements(m.variants) v
        WHERE m."objectsDeletedAt" IS NULL AND v->>'objectName'=$1 AND (v->>'generation' IS NULL OR v->>'generation'=$2)) OR
      EXISTS(SELECT 1 FROM blogpost."MediaUploadAttempt" a JOIN blogpost."MediaAsset" m ON m.id=a."mediaId"
        CROSS JOIN LATERAL jsonb_array_elements(a.objects) v WHERE a."cleanedAt" IS NULL AND m."objectsDeletedAt" IS NULL
        AND v->>'objectName'=$1 AND (v->>'generation' IS NULL OR v->>'generation'=$2)) AS protected`,
      [object.objectName, object.generation],
    );
    return result.rows[0]!.protected;
  }
}
