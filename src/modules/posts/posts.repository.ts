import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { Transaction } from '../members/members.repository.js';
import type { MemberRow } from '../members/member.js';
import type { DraftContent } from './draft.js';
import { analyzeMarkdown } from './markdown.js';
import {
  semanticHash,
  nextVersion,
} from '../../platform/database/operation.js';
import { ApiError } from '../../platform/errors/api-error.js';
import { transactionTime } from '../../platform/database/rate-limits.js';
import type { components } from '../../../contracts/generated/typescript/api-v1.js';

type DTO = components['schemas'];
export const authorSelection = {
  id: true,
  handle: true,
  displayName: true,
} as const;
export const revisionInclude = {
  creator: { select: authorSelection },
  creditedAuthor: { select: authorSelection },
  tags: { orderBy: { position: 'asc' } },
  media: { include: { asset: true }, orderBy: { mediaId: 'asc' } },
} satisfies Prisma.RevisionInclude;
export const postInclude = {
  author: { select: authorSelection },
  workingRevision: { include: revisionInclude },
  publishedRevision: { include: revisionInclude },
  reviews: {
    where: { action: 'REJECTED' },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 1,
    include: { actor: { select: authorSelection } },
  },
} satisfies Prisma.PostInclude;
export type PostRow = Prisma.PostGetPayload<Record<string, never>>;
type RevisionGraph = Prisma.RevisionGetPayload<{
  include: typeof revisionInclude;
}>;
type PostGraph = Prisma.PostGetPayload<{ include: typeof postInclude }>;

export function notFound(): never {
  throw new ApiError(
    404,
    'RESOURCE_NOT_FOUND',
    'Post unavailable',
    'This resource is unavailable.',
  );
}
export function workflowConflict(): never {
  throw new ApiError(
    409,
    'WORKFLOW_CONFLICT',
    'Workflow conflict',
    'Fetch the current post before continuing.',
  );
}
export function visible(
  post: PostRow | null,
  actor: MemberRow,
  now: Date,
): PostRow {
  if (
    !post ||
    post.purgeStartedAt ||
    (post.purgeAfter && post.purgeAfter <= now) ||
    (actor.role === 'AUTHOR' && post.authorId !== actor.id)
  )
    return notFound();
  return post;
}
export function draftContent(revision: RevisionGraph): DraftContent {
  return {
    title: revision.title,
    summary: revision.summary,
    markdown: revision.markdown,
    markdownContractVersion: 1,
    categoryId: revision.categoryId,
    tagIds: revision.tags.map((tag) => tag.tagId),
    coverMediaId: revision.coverMediaId,
    coverAltText: revision.coverAltText,
    coverDecorative: revision.coverDecorative,
  };
}
export function descriptor(
  asset: Pick<
    Prisma.MediaAssetGetPayload<Record<string, never>>,
    'id' | 'postId' | 'state' | 'width' | 'height' | 'mimeType' | 'variants'
  >,
  visibility: 'private' | 'public' = 'private',
): DTO['MediaDescriptor'] {
  if (
    asset.state !== 'READY' ||
    !asset.width ||
    !asset.height ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType ?? '') ||
    !Array.isArray(asset.variants)
  )
    return workflowConflict();
  const variants = asset.variants as unknown as Record<string, unknown>[];
  if (
    variants.length !== 3 ||
    !['w480', 'w960', 'w1600'].every(
      (name) => variants.filter((v) => v.name === name).length === 1,
    )
  )
    return workflowConflict();
  return {
    mediaId: asset.id,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType as DTO['MediaDescriptor']['mimeType'],
    variants: variants.map((v) => {
      if (
        !Number.isSafeInteger(v.width) ||
        Number(v.width) < 1 ||
        !Number.isSafeInteger(v.height) ||
        Number(v.height) < 1 ||
        !Number.isSafeInteger(v.byteSize) ||
        Number(v.byteSize) < 1
      )
        return workflowConflict();
      return {
        name: v.name as DTO['VariantName'],
        width: Number(v.width),
        height: Number(v.height),
        byteSize: Number(v.byteSize),
        mimeType: asset.mimeType as DTO['MediaDescriptor']['mimeType'],
        apiPath: `/v1/${visibility === 'public' ? 'public/' : ''}posts/${asset.postId}/media/${asset.id}/${v.name}`,
      };
    }),
  };
}
export function revisionDto(revision: RevisionGraph): DTO['Revision'] {
  return {
    id: revision.id,
    postId: revision.postId,
    number: revision.number,
    createdBy: revision.creator,
    createdAt: revision.createdAt.toISOString(),
    creditedAuthor: revision.creditedAuthor,
    content: draftContent(revision),
    media: revision.media.map((reference) => descriptor(reference.asset)),
    restoredFromRevisionId: revision.restoredFromRevisionId,
  };
}
export function postSummary(
  post: PostRow & { author: DTO['AuthorSummary'] },
  actor: MemberRow,
): DTO['WorkspacePostSummary'] {
  const allowedActions: string[] = [];
  const editor = actor.role !== 'AUTHOR';
  if (post.trashedAt) {
    if (editor || !post.firstPublishedAt) allowedActions.push('RESTORE');
  } else {
    if (post.workflowState === 'IN_REVIEW') {
      allowedActions.push('WITHDRAW_REVIEW');
      if (editor) allowedActions.push('PUBLISH', 'REJECT');
    } else allowedActions.push('EDIT_DRAFT', 'SUBMIT', 'RESTORE_REVISION');
    if (editor || !post.firstPublishedAt) allowedActions.push('TRASH');
    if (editor) {
      allowedActions.push('CHANGE_SLUG');
      if (post.publicationState === 'PUBLISHED')
        allowedActions.push('UNPUBLISH');
    }
    if (actor.role === 'ADMIN') allowedActions.push('REASSIGN_AUTHOR');
  }
  return {
    id: post.id,
    clientDraftId: post.clientDraftId,
    author: post.author,
    slug: post.canonicalSlug,
    publicationState: post.publicationState,
    workflowState: post.workflowState,
    version: post.lockVersion,
    workingRevisionId: post.workingRevisionId,
    publishedRevisionId: post.publishedRevisionId,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    trashedAt: post.trashedAt?.toISOString() ?? null,
    purgeAfter: post.purgeAfter?.toISOString() ?? null,
    allowedActions,
  };
}
export function workspaceDto(
  post: PostGraph,
  actor: MemberRow,
): DTO['WorkspacePost'] {
  const last = post.reviews[0];
  return {
    ...postSummary(post, actor),
    workingRevision: post.workingRevision
      ? revisionDto(post.workingRevision)
      : null,
    publishedRevision: post.publishedRevision
      ? revisionDto(post.publishedRevision)
      : null,
    review: {
      submittedRevisionId: post.submittedRevisionId,
      submittedAt: post.submittedAt?.toISOString() ?? null,
      lastFeedback: last
        ? {
            revisionId: last.revisionId,
            actor: last.actor,
            text: last.feedback!,
            createdAt: last.createdAt.toISOString(),
          }
        : null,
    },
  };
}

@Injectable()
export class PostsRepository {
  async lock(
    tx: Transaction,
    id: string,
    write: boolean,
  ): Promise<PostRow | null> {
    const rows = await tx.$queryRaw<PostRow[]>(
      Prisma.sql`SELECT * FROM blogpost."Post" WHERE id = ${id}::uuid ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`,
    );
    return rows[0] ?? null;
  }
  graph(tx: Transaction, id: string) {
    return tx.post.findUniqueOrThrow({ where: { id }, include: postInclude });
  }
  async quota(tx: Transaction, authorId: string): Promise<void> {
    if ((await tx.post.count({ where: { authorId, trashedAt: null } })) >= 100)
      throw new ApiError(
        409,
        'RESOURCE_QUOTA_EXCEEDED',
        'Post limit reached',
        'Trash an unused post before creating or restoring another.',
      );
  }
  async references(
    tx: Transaction,
    postId: string,
    content: DraftContent,
    now: Date,
    publishing = false,
    previous?: DraftContent,
    historical = false,
  ) {
    if (content.categoryId) {
      const rows = await tx.$queryRaw<
        { id: string; active: boolean }[]
      >`SELECT id, active FROM blogpost."Category" WHERE id = ${content.categoryId}::uuid FOR SHARE`;
      if (
        !rows[0] ||
        (!rows[0].active &&
          (publishing ||
            (!historical && content.categoryId !== previous?.categoryId)))
      )
        return workflowConflict();
    }
    for (const id of [...content.tagIds].sort()) {
      const rows = await tx.$queryRaw<
        { id: string; active: boolean }[]
      >`SELECT id, active FROM blogpost."Tag" WHERE id = ${id}::uuid FOR SHARE`;
      if (
        !rows[0] ||
        (!rows[0].active &&
          (publishing || (!historical && !previous?.tagIds.includes(id))))
      )
        return workflowConflict();
    }
    const analysis = analyzeMarkdown(content.markdown);
    const ids = [
      ...new Set(
        [
          content.coverMediaId,
          ...analysis.mediaReferences.map((ref) => ref.mediaId),
        ].filter((id): id is string => id !== null),
      ),
    ].sort();
    for (const id of ids) {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM blogpost."MediaAsset" WHERE id = ${id}::uuid AND "postId" = ${postId}::uuid FOR UPDATE`;
      if (!rows[0]) return notFound();
      const asset = await tx.mediaAsset.findUniqueOrThrow({ where: { id } });
      if (
        asset.state !== 'READY' ||
        (asset.unattachedExpiresAt &&
          asset.unattachedExpiresAt <= (await transactionTime(tx)))
      )
        return workflowConflict();
      descriptor(asset);
    }
    return { ids, plainText: analysis.plainText };
  }
  async appendRevision(
    tx: Transaction,
    post: PostRow,
    actor: MemberRow,
    content: DraftContent,
    now: Date,
    restoredFromRevisionId: string | null = null,
  ) {
    const current = post.workingRevisionId
      ? await tx.revision.findUniqueOrThrow({
          where: { id: post.workingRevisionId },
          include: revisionInclude,
        })
      : null;
    const references = await this.references(
      tx,
      post.id,
      content,
      now,
      false,
      current ? draftContent(current) : undefined,
      restoredFromRevisionId !== null,
    );
    const maximum = await tx.revision.aggregate({
      where: { postId: post.id },
      _max: { number: true },
    });
    const number = nextVersion(maximum._max.number ?? 0);
    const { tagIds, ...fields } = content;
    const revision = await tx.revision.create({
      data: {
        ...fields,
        postId: post.id,
        creatorId: actor.id,
        creditedAuthorId: post.authorId,
        number,
        plainBody: references.plainText,
        restoredFromRevisionId,
        createdAt: now,
        checksum: semanticHash({ content, creditedAuthorId: post.authorId }),
      },
    });
    // The composite post/revision relation fills postId during nested writes.
    // Explicit inserts preserve every key and avoid Prisma's ambiguous nested unchecked input.
    if (tagIds.length)
      await tx.revisionTag.createMany({
        data: tagIds.map((tagId, position) => ({
          revisionId: revision.id,
          tagId,
          position,
        })),
      });
    if (references.ids.length)
      await tx.revisionMedia.createMany({
        data: references.ids.map((mediaId) => ({
          postId: post.id,
          revisionId: revision.id,
          mediaId,
        })),
      });
    if (references.ids.length)
      await tx.mediaAsset.updateMany({
        where: { id: { in: references.ids } },
        data: { unattachedExpiresAt: null },
      });
    return revision;
  }
  async slug(
    tx: Transaction,
    post: PostRow,
    requested: string | null,
    title: string,
  ): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(78201903::bigint)`;
    const base =
      title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100)
        .replace(/-$/g, '') || 'article';
    let slug = requested ?? base;
    let suffix = 1;
    for (;;) {
      const owner = await tx.slugHistory.findUnique({ where: { slug } });
      if (!owner || owner.postId === post.id) break;
      if (requested)
        throw new ApiError(
          409,
          'SLUG_CONFLICT',
          'Slug unavailable',
          'Choose another slug.',
        );
      slug = `${base}-${++suffix}`;
    }
    await tx.slugHistory.updateMany({
      where: { postId: post.id, canonical: true },
      data: { canonical: false },
    });
    await tx.slugHistory.upsert({
      where: { slug },
      create: { slug, postId: post.id, canonical: true },
      update: { canonical: true },
    });
    return slug;
  }
}
