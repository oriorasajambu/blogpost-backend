import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import {
  MembersRepository,
  activeMember,
  databaseFailure,
  memberSelection,
  type Transaction,
} from '../members/members.repository.js';
import type { MemberRow } from '../members/member.js';
import type { VerifiedIdentity } from '../identity/identity.js';
import { ADMIN_STATE_LOCK } from '../../platform/database/operation.js';
import {
  PostsRepository,
  visible,
  notFound,
  descriptor,
} from '../posts/posts.repository.js';
import { transactionTime } from '../../platform/database/rate-limits.js';
import { ApiError } from '../../platform/errors/api-error.js';
import {
  storageFailure,
  checkedPlan,
  type ObjectPlan,
  type StoredObject,
} from './storage.js';
import type { VariantName } from './image-normalizer.js';
import type { components } from '../../../contracts/generated/typescript/api-v1.js';

export interface VariantObject extends ObjectPlan {
  name: VariantName;
  width: number;
  height: number;
  generation?: string;
}
export type Asset = Prisma.MediaAssetGetPayload<Record<string, never>>;
export interface MediaContext {
  tx: Transaction;
  actor: MemberRow;
  post: Prisma.PostGetPayload<Record<string, never>>;
  now: Date;
}
export function objects(value: Prisma.JsonValue): VariantObject[] {
  if (!Array.isArray(value) || value.length > 3) throw storageFailure();
  return value.map((value) => {
    const object = value as unknown as VariantObject;
    if (
      !object ||
      typeof object !== 'object' ||
      !['w480', 'w960', 'w1600'].includes(object.name) ||
      !Number.isSafeInteger(object.width) ||
      object.width < 1 ||
      !Number.isSafeInteger(object.height) ||
      object.height < 1
    )
      throw storageFailure();
    checkedPlan(object);
    if (
      !object.objectName.endsWith(`/${object.name}.${object.mimeType.slice(6)}`)
    )
      throw storageFailure();
    return object;
  });
}
export function assetDto(asset: Asset): components['schemas']['MediaAsset'] {
  const value = descriptor(asset);
  return {
    id: asset.id,
    postId: asset.postId,
    ready: true,
    width: value.width,
    height: value.height,
    mimeType: value.mimeType,
    variants: value.variants,
    createdAt: asset.createdAt.toISOString(),
    unattachedExpiresAt: asset.unattachedExpiresAt?.toISOString() ?? null,
  };
}
export function pending(): never {
  throw new ApiError(
    409,
    'IDEMPOTENCY_IN_PROGRESS',
    'Upload in progress',
    'Retry the identical upload shortly.',
    [],
    null,
    1,
  );
}
export function quota(): never {
  throw new ApiError(
    409,
    'RESOURCE_QUOTA_EXCEEDED',
    'Pending media limit reached',
    'Attach retained uploads or retry after abandoned uploads are cleaned up.',
  );
}
@Injectable()
export class MediaRepository {
  constructor(
    @Inject(MembersRepository) readonly members: MembersRepository,
    @Inject(PostsRepository) private readonly posts: PostsRepository,
  ) {}
  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await this.members.database.prisma.$transaction(work, {
        maxWait: 3000,
        timeout: 5000,
      });
    } catch (error) {
      return databaseFailure(error);
    }
  }
  async context(
    tx: Transaction,
    identity: VerifiedIdentity,
    postId: string,
  ): Promise<MediaContext> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${ADMIN_STATE_LOCK}::bigint)`;
    const candidate = activeMember(
      await tx.member.findUnique({
        where: { identityUid: identity.uid },
        select: memberSelection,
      }),
    );
    const preview = await tx.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    });
    if (!preview) return notFound();
    const ids = [...new Set([candidate.id, preview.authorId])].sort();
    const rows = await tx.$queryRaw<
      MemberRow[]
    >(Prisma.sql`SELECT id, "identityUid", email, "displayName", handle, bio, role::text AS role, active, version
      FROM blogpost."Member" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
    const actor = activeMember(rows.find((row) => row.id === candidate.id));
    const locked = await this.posts.lock(tx, postId, true);
    const now = await transactionTime(tx);
    const post = visible(locked, actor, now);
    return { tx, actor, post, now };
  }
  async pendingBytes(tx: Transaction, memberId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ total: bigint }[]>`SELECT
      coalesce((SELECT sum("byteSize") FROM blogpost."MediaAsset" WHERE "uploaderId" = ${memberId}::uuid AND
        (state = 'PROCESSING' OR (state = 'READY' AND "unattachedExpiresAt" IS NOT NULL) OR (state = 'DELETING' AND "objectsDeletedAt" IS NULL))), 0)::bigint +
      coalesce((SELECT sum((v.value->>'byteSize')::bigint) FROM blogpost."MediaUploadAttempt" a JOIN blogpost."MediaAsset" m ON m.id = a."mediaId"
        CROSS JOIN LATERAL jsonb_array_elements(a.objects) v WHERE m."uploaderId" = ${memberId}::uuid AND a."abandonedAt" IS NOT NULL AND a."cleanedAt" IS NULL
        AND a.id IS DISTINCT FROM m."uploadAttemptId"), 0)::bigint AS total`;
    return Number(rows[0]!.total);
  }
  async metadata(identity: VerifiedIdentity, postId: string, mediaId: string) {
    return this.transaction(async (tx) => {
      const context = await this.context(tx, identity, postId);
      const asset = await this.available(tx, postId, mediaId, context.now);
      return assetDto(asset);
    });
  }
  async available(tx: Transaction, postId: string, mediaId: string, now: Date) {
    const asset = await tx.mediaAsset.findFirst({
      where: { id: mediaId, postId, state: 'READY' },
    });
    if (
      !asset ||
      (asset.unattachedExpiresAt && asset.unattachedExpiresAt <= now)
    )
      return notFound();
    return asset;
  }
  async streamPlan(
    identity: VerifiedIdentity | null,
    postId: string,
    mediaId: string,
    name: VariantName,
  ): Promise<{ object: StoredObject; mimeType: string }> {
    return this.transaction(async (tx) => {
      let now: Date;
      if (identity) now = (await this.context(tx, identity, postId)).now;
      else {
        const post = await tx.post.findFirst({
          where: {
            id: postId,
            publicationState: 'PUBLISHED',
            trashedAt: null,
            purgeStartedAt: null,
          },
          select: { publishedRevisionId: true },
        });
        if (
          !post?.publishedRevisionId ||
          !(await tx.revisionMedia.findUnique({
            where: {
              revisionId_mediaId: {
                revisionId: post.publishedRevisionId,
                mediaId,
              },
            },
          }))
        )
          return notFound();
        now = await transactionTime(tx);
      }
      const asset = await this.available(tx, postId, mediaId, now);
      const variant = objects(asset.variants).find(
        (variant) => variant.name === name,
      );
      if (
        !variant?.generation ||
        !variant.objectName.startsWith(`blogpost/posts/${postId}/${mediaId}/`)
      )
        throw storageFailure();
      return {
        object: {
          objectName: variant.objectName,
          generation: variant.generation,
          byteSize: variant.byteSize,
          sha256: variant.sha256,
        },
        mimeType: asset.mimeType!,
      };
    });
  }
}
