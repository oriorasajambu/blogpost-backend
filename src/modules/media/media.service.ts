import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import type { VerifiedIdentity } from '../identity/identity.js';
import {
  MediaRepository,
  assetDto,
  objects,
  pending,
  quota,
  type VariantObject,
} from './media.repository.js';
import {
  MEDIA_STORAGE,
  hashBytes,
  storageFailure,
  type MediaStorage,
} from './storage.js';
import {
  normalizeImage,
  type NormalizedImage,
  type VariantName,
} from './image-normalizer.js';
import type { UploadInput } from './multipart.js';
import { ApiError } from '../../platform/errors/api-error.js';
import {
  lockOperation,
  replayOperation,
  semanticHash,
  type OperationScope,
  type OperationResult,
} from '../../platform/database/operation.js';
import {
  consumeRate,
  transactionTime,
} from '../../platform/database/rate-limits.js';
import { workflowConflict } from '../posts/posts.repository.js';
import type { Transaction } from '../members/members.repository.js';
import type { components } from '../../../contracts/generated/typescript/api-v1.js';

type MediaDto = components['schemas']['MediaAsset'];
interface Lease {
  scope: OperationScope;
  hash: string;
  recordId: string;
  mediaId: string;
  attemptId: string;
  actorId: string;
}
const LEASE_MS = 180000;
const PENDING_BYTES = 100 * 1024 * 1024;
const json = (value: unknown) => value as Prisma.InputJsonValue;

@Injectable()
export class MediaService {
  constructor(
    @Inject(MediaRepository) readonly repository: MediaRepository,
    @Inject(MEDIA_STORAGE) readonly storage: MediaStorage,
  ) {}
  async authorizeUpload(identity: VerifiedIdentity, postId: string) {
    await this.repository.transaction(async (tx) => {
      await this.repository.context(tx, identity, postId);
    });
  }
  metadata(identity: VerifiedIdentity, postId: string, mediaId: string) {
    return this.repository.metadata(identity, postId, mediaId);
  }
  private async reserve(
    identity: VerifiedIdentity,
    postId: string,
    key: string,
    input: UploadInput,
  ): Promise<{ lease: Lease } | { result: OperationResult<MediaDto> }> {
    const scope = {
      identityUid: identity.uid,
      method: 'POST',
      route: `/v1/posts/${postId}/media`,
      key,
    };
    const hash = semanticHash({
      mimeType: input.mimeType,
      bytesSha256: hashBytes(input.bytes),
    });
    return this.repository.transaction(async (tx) => {
      await lockOperation(tx, scope);
      const { actor, post, now } = await this.repository.context(
        tx,
        identity,
        postId,
      );
      const unique = { identityUid_method_route_key: scope };
      let record = await tx.idempotencyRecord.findUnique({ where: unique });
      if (record && record.expiresAt <= now) {
        const old = await tx.mediaAsset.findUnique({
          where: { uploadOperationId: record.id },
        });
        if (old?.state === 'PROCESSING') {
          await tx.mediaAsset.update({
            where: { id: old.id },
            data: { state: 'DELETING', leaseExpiresAt: null },
          });
          await tx.mediaUploadAttempt.updateMany({
            where: { mediaId: old.id, completedAt: null, abandonedAt: null },
            data: { abandonedAt: now },
          });
        }
        await tx.idempotencyRecord.delete({ where: unique });
        record = null;
      }
      if (record?.result) {
        const result = await replayOperation<MediaDto>(tx, scope, hash, now);
        if (result) return { result };
      }
      if (record && record.requestHash !== hash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Operation key reused',
          'Use a new key for changed upload bytes or MIME type.',
        );
      if (record?.leaseExpiresAt && record.leaseExpiresAt > now)
        return pending();
      if (post.trashedAt) return workflowConflict();
      await consumeRate(tx, actor.id, 'WRITE', now);
      await consumeRate(tx, actor.id, 'UPLOAD', now);
      const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
      const attemptId = randomUUID();
      let media = record
        ? await tx.mediaAsset.findUnique({
            where: { uploadOperationId: record.id },
          })
        : null;
      if (record && !media) throw storageFailure();
      if (media?.state === 'READY') throw storageFailure();
      if (media) {
        await tx.mediaUploadAttempt.updateMany({
          where: { mediaId: media.id, completedAt: null, abandonedAt: null },
          data: { abandonedAt: now },
        });
        media = await tx.mediaAsset.update({
          where: { id: media.id },
          data: {
            state: 'PROCESSING',
            byteSize: BigInt(input.bytes.length),
            variants: [],
            uploadAttemptId: attemptId,
            leaseExpiresAt,
          },
        });
      } else {
        record = await tx.idempotencyRecord.create({
          data: {
            ...scope,
            requestHash: hash,
            leaseExpiresAt,
            expiresAt: new Date(now.getTime() + 86400000),
            createdAt: now,
          },
        });
        media = await tx.mediaAsset.create({
          data: {
            postId,
            uploaderId: actor.id,
            uploadOperationId: record.id,
            uploadAttemptId: attemptId,
            leaseExpiresAt,
            byteSize: BigInt(input.bytes.length),
            createdAt: now,
          },
        });
      }
      await tx.idempotencyRecord.update({
        where: { id: record!.id },
        data: { leaseExpiresAt },
      });
      await tx.mediaUploadAttempt.create({
        data: {
          id: attemptId,
          mediaId: media.id,
          leaseExpiresAt,
          cleanupAfter: new Date(leaseExpiresAt.getTime() + 60000),
          createdAt: now,
        },
      });
      if ((await this.repository.pendingBytes(tx, actor.id)) > PENDING_BYTES)
        return quota();
      return {
        lease: {
          scope,
          hash,
          recordId: record!.id,
          mediaId: media.id,
          attemptId,
          actorId: actor.id,
        },
      };
    });
  }
  private async assertLease(tx: Transaction, lease: Lease, now: Date) {
    const record = await tx.idempotencyRecord.findUnique({
      where: { id: lease.recordId },
    });
    const asset = await tx.mediaAsset.findUnique({
      where: { id: lease.mediaId },
    });
    if (
      !record ||
      record.result ||
      record.requestHash !== lease.hash ||
      !record.leaseExpiresAt ||
      record.leaseExpiresAt <= now ||
      !asset ||
      asset.state !== 'PROCESSING' ||
      asset.uploadAttemptId !== lease.attemptId ||
      asset.uploadOperationId !== lease.recordId
    )
      return pending();
    return { record, asset };
  }
  private async plans(
    identity: VerifiedIdentity,
    postId: string,
    lease: Lease,
    image: NormalizedImage,
  ): Promise<VariantObject[]> {
    return this.repository.transaction(async (tx) => {
      await lockOperation(tx, lease.scope);
      const { post, now } = await this.repository.context(tx, identity, postId);
      await this.assertLease(tx, lease, now);
      if (post.trashedAt) return workflowConflict();
      const extension = image.mimeType.slice(6);
      const plans = image.variants.map((variant) => ({
        name: variant.name,
        width: variant.width,
        height: variant.height,
        mimeType: image.mimeType,
        objectName: `blogpost/posts/${postId}/${lease.mediaId}/${lease.attemptId}/${variant.name}.${extension}`,
        sha256: hashBytes(variant.bytes),
        byteSize: variant.bytes.length,
      }));
      const total = plans.reduce((sum, plan) => sum + plan.byteSize, 0);
      await tx.mediaAsset.update({
        where: { id: lease.mediaId },
        data: { byteSize: BigInt(total) },
      });
      if (
        (await this.repository.pendingBytes(tx, lease.actorId)) > PENDING_BYTES
      )
        return quota();
      await tx.mediaUploadAttempt.update({
        where: { id: lease.attemptId },
        data: { objects: json(plans) },
      });
      return plans;
    });
  }
  private async recordObjects(lease: Lease, plans: VariantObject[]) {
    await this.repository.transaction(async (tx) => {
      // Cleanup metadata is internal bookkeeping and remains writable after the uploader loses access.
      const attempt = await tx.mediaUploadAttempt.findUnique({
        where: { id: lease.attemptId },
      });
      if (!attempt || attempt.mediaId !== lease.mediaId) return pending();
      await tx.mediaUploadAttempt.update({
        where: { id: lease.attemptId },
        data: { objects: json(plans) },
      });
    });
  }
  private async finalize(
    identity: VerifiedIdentity,
    postId: string,
    lease: Lease,
    image: NormalizedImage,
    plans: VariantObject[],
    traceId: string,
  ): Promise<OperationResult<MediaDto>> {
    return this.repository.transaction(async (tx) => {
      await lockOperation(tx, lease.scope);
      const { actor, post, now } = await this.repository.context(
        tx,
        identity,
        postId,
      );
      const current = await tx.idempotencyRecord.findUnique({
        where: { identityUid_method_route_key: lease.scope },
      });
      if (current?.result)
        return (await replayOperation<MediaDto>(
          tx,
          lease.scope,
          lease.hash,
          now,
        ))!;
      await this.assertLease(tx, lease, now);
      if (post.trashedAt) return workflowConflict();
      if (plans.length !== 3 || plans.some((plan) => !plan.generation))
        throw storageFailure();
      const asset = await tx.mediaAsset.update({
        where: { id: lease.mediaId },
        data: {
          state: 'READY',
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
          variants: json(plans),
          byteSize: BigInt(plans.reduce((sum, plan) => sum + plan.byteSize, 0)),
          leaseExpiresAt: null,
          unattachedExpiresAt: new Date(now.getTime() + 86400000),
        },
      });
      await tx.mediaUploadAttempt.update({
        where: { id: lease.attemptId },
        data: { completedAt: now, objects: json(plans) },
      });
      const data = assetDto(asset);
      const location = `/v1/posts/${postId}/media/${asset.id}`;
      const expiresAt = new Date(now.getTime() + 86400000);
      await tx.idempotencyRecord.update({
        where: { id: lease.recordId },
        data: {
          result: json({ data, version: 1, location }),
          statusCode: 201,
          leaseExpiresAt: null,
          expiresAt,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          subjectType: 'MEDIA',
          subjectId: asset.id,
          action: 'MEDIA_STAGED',
          traceId,
          changes: {
            postId,
            byteSize: Number(asset.byteSize),
            variants: plans.map((plan) => plan.name),
          },
        },
      });
      return {
        data,
        status: 201,
        version: 1,
        location,
        expiresAt: expiresAt.toISOString(),
        replayed: false,
      };
    });
  }
  async abandon(lease: Lease): Promise<void> {
    let plans: VariantObject[] = [];
    try {
      const allowed = await this.repository.transaction(async (tx) => {
        await lockOperation(tx, lease.scope);
        const asset = await tx.mediaAsset.findUnique({
          where: { id: lease.mediaId },
        });
        const attempt = await tx.mediaUploadAttempt.findUnique({
          where: { id: lease.attemptId },
        });
        const record = await tx.idempotencyRecord.findUnique({
          where: { id: lease.recordId },
        });
        if (!attempt || !asset) return false;
        if (
          asset.state === 'READY' &&
          asset.uploadAttemptId === lease.attemptId
        )
          return false;
        plans = objects(attempt.objects);
        const now = await transactionTime(tx);
        await tx.mediaUploadAttempt.update({
          where: { id: attempt.id },
          data: { abandonedAt: attempt.abandonedAt ?? now },
        });
        if (
          asset.uploadAttemptId === lease.attemptId &&
          asset.state !== 'READY'
        ) {
          await tx.mediaAsset.update({
            where: { id: asset.id },
            data: { state: 'DELETING', leaseExpiresAt: null },
          });
          if (record && !record.result)
            await tx.idempotencyRecord.delete({ where: { id: record.id } });
        }
        return true;
      });
      if (allowed) for (const plan of plans) await this.storage.remove(plan);
      // Retain the journal through its grace period so cleanup can catch late uncertain storage writes.
    } catch {
      /* Unknown SQL outcomes must never trigger blind deletion of a committed ready asset. */
    }
  }
  async upload(
    identity: VerifiedIdentity,
    postId: string,
    key: string,
    input: UploadInput,
    traceId: string,
  ): Promise<OperationResult<MediaDto>> {
    const reservation = await this.reserve(identity, postId, key, input);
    if ('result' in reservation) return reservation.result;
    const lease = reservation.lease;
    try {
      const image = await normalizeImage(input.bytes, input.mimeType);
      const plans = await this.plans(identity, postId, lease, image);
      for (const plan of plans) {
        const bytes = image.variants.find(
          (variant) => variant.name === plan.name,
        )!.bytes;
        const stored = await this.storage.put(plan, bytes);
        plan.generation = stored.generation;
        await this.recordObjects(lease, plans);
      }
      const result = await this.finalize(
        identity,
        postId,
        lease,
        image,
        plans,
        traceId,
      );
      if (result.replayed) await this.abandon(lease);
      return result;
    } catch (error) {
      await this.abandon(lease);
      throw error;
    }
  }
  async stream(
    identity: VerifiedIdentity | null,
    postId: string,
    mediaId: string,
    name: VariantName,
  ) {
    const plan = await this.repository.streamPlan(
      identity,
      postId,
      mediaId,
      name,
    );
    const stream = await this.storage.open(plan.object);
    try {
      const current = await this.repository.streamPlan(
        identity,
        postId,
        mediaId,
        name,
      );
      if (
        current.object.objectName !== plan.object.objectName ||
        current.object.generation !== plan.object.generation
      )
        throw storageFailure();
      return {
        stream,
        mimeType: plan.mimeType,
        byteSize: plan.object.byteSize,
      };
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }
}
