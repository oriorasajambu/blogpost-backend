import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { VerifiedIdentity } from '../identity/identity.js';
import {
  activeMember,
  databaseFailure,
  memberSelection,
  MembersRepository,
  type Transaction,
} from '../members/members.repository.js';
import type { MemberRow } from '../members/member.js';
import { administrator } from '../members/admin.guard.js';
import {
  ADMIN_STATE_LOCK,
  expectVersion,
  finishOperation,
  lockAdministrativeState,
  lockOperation,
  nextVersion,
  replayOperation,
  semanticHash,
  type OperationScope,
} from '../../platform/database/operation.js';
import {
  consumeRate,
  transactionTime,
} from '../../platform/database/rate-limits.js';
import {
  CursorService,
  afterCursor,
  type CursorQuery,
} from '../../platform/http/cursor.js';
import { ApiError } from '../../platform/errors/api-error.js';
import {
  boundedText,
  invalidInput,
  objectInput,
  UUID,
  uuidInput,
} from '../../platform/http/input.js';
import {
  normalizeDraft,
  validatePublicationContent,
  type DraftContent,
} from './draft.js';
import {
  authorSelection,
  draftContent,
  notFound,
  postSummary,
  PostsRepository,
  revisionDto,
  revisionInclude,
  visible,
  workflowConflict,
  workspaceDto,
  type PostRow,
} from './posts.repository.js';

export type PostAction =
  | 'savePostDraft'
  | 'submitPostForReview'
  | 'withdrawPostReview'
  | 'rejectPostRevision'
  | 'publishPostRevision'
  | 'unpublishPost'
  | 'restorePostRevision'
  | 'trashPost'
  | 'restoreTrashedPost'
  | 'changePostSlug'
  | 'reassignPostAuthor';
export const postActions: Record<
  PostAction,
  { method: string; suffix: string }
> = {
  savePostDraft: { method: 'PUT', suffix: 'draft' },
  submitPostForReview: { method: 'POST', suffix: 'submit' },
  withdrawPostReview: { method: 'POST', suffix: 'withdraw-review' },
  rejectPostRevision: { method: 'POST', suffix: 'reject' },
  publishPostRevision: { method: 'POST', suffix: 'publish' },
  unpublishPost: { method: 'POST', suffix: 'unpublish' },
  restorePostRevision: { method: 'POST', suffix: 'restore-revision' },
  trashPost: { method: 'DELETE', suffix: '' },
  restoreTrashedPost: { method: 'POST', suffix: 'restore' },
  changePostSlug: { method: 'PATCH', suffix: 'slug' },
  reassignPostAuthor: { method: 'PATCH', suffix: 'author' },
};
function draftInput(value: unknown): Record<string, unknown> {
  const content = normalizeDraft(value);
  const input = value as Record<string, unknown>;
  // Keep optional-field presence in the operation fingerprint. Resolve old-client defaults only against the locked current snapshot.
  return {
    ...input,
    categoryId: content.categoryId,
    tagIds: content.tagIds,
    coverMediaId: content.coverMediaId,
  };
}
export function createPostInput(value: unknown) {
  const input = objectInput(
    value,
    ['clientDraftId', 'draft'],
    ['clientDraftId', 'draft'],
  );
  if (typeof input.clientDraftId !== 'string')
    return invalidInput('/clientDraftId');
  return {
    clientDraftId: uuidInput(input.clientDraftId, 'clientDraftId', 'body'),
    draft: draftInput(input.draft),
  };
}
export function postActionInput(
  action: PostAction,
  value: unknown,
): Record<string, unknown> {
  if (action === 'savePostDraft') return draftInput(value);
  if (
    [
      'submitPostForReview',
      'publishPostRevision',
      'restorePostRevision',
      'rejectPostRevision',
    ].includes(action)
  ) {
    const fields =
      action === 'rejectPostRevision'
        ? ['revisionId', 'feedback']
        : ['revisionId'];
    const input = objectInput(value, fields, fields);
    if (typeof input.revisionId !== 'string')
      return invalidInput('/revisionId');
    const revisionId = uuidInput(input.revisionId, 'revisionId', 'body');
    if (action === 'rejectPostRevision') {
      if (!boundedText(input.feedback, 2000) || !input.feedback.trim())
        return invalidInput('/feedback');
      return { revisionId, feedback: input.feedback };
    }
    return { revisionId };
  }
  if (action === 'reassignPostAuthor') {
    const input = objectInput(value, ['authorId'], ['authorId']);
    if (typeof input.authorId !== 'string') return invalidInput('/authorId');
    return { authorId: uuidInput(input.authorId, 'authorId', 'body') };
  }
  if (action === 'changePostSlug') {
    const input = objectInput(value, ['slug'], ['slug']);
    if (
      typeof input.slug !== 'string' ||
      input.slug.length > 120 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)
    )
      return invalidInput('/slug');
    return { slug: input.slug };
  }
  return objectInput(
    action === 'trashPost' && value === undefined ? {} : value,
    [],
  );
}
function permission(): never {
  throw new ApiError(
    403,
    'INSUFFICIENT_PERMISSION',
    'Editor access required',
    'This action requires an editor or administrator.',
  );
}

@Injectable()
export class PostsService {
  constructor(
    @Inject(MembersRepository) private readonly members: MembersRepository,
    @Inject(PostsRepository) private readonly posts: PostsRepository,
    @Inject(CursorService) private readonly cursors: CursorService,
  ) {}

  private async read<T>(
    identity: VerifiedIdentity,
    work: (tx: Transaction, actor: MemberRow, now: Date) => Promise<T>,
  ) {
    try {
      return await this.members.database.prisma.$transaction(
        async (tx) => {
          const actor = await this.members.lock(tx, identity.uid);
          return work(tx, actor, await transactionTime(tx));
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
  get(identity: VerifiedIdentity, id: string, byClient = false) {
    return this.read(identity, async (tx, actor, now) => {
      const candidate = byClient
        ? await tx.post.findUnique({
            where: {
              creatorId_clientDraftId: {
                creatorId: actor.id,
                clientDraftId: id,
              },
            },
          })
        : null;
      if (byClient && !candidate) return notFound();
      const post = visible(
        await this.posts.lock(tx, candidate?.id ?? id, false),
        actor,
        now,
      );
      return workspaceDto(await this.posts.graph(tx, post.id), actor);
    });
  }
  list(identity: VerifiedIdentity, query: CursorQuery) {
    query = { ...query, order: 'UPDATED_DESC_ID_ASC' };
    return this.read(identity, async (tx, actor, now) => {
      if (query.filters.scope === 'ALL' && actor.role === 'AUTHOR')
        return permission();
      const point = this.cursors.decode(
        identity.uid,
        '/v1/posts',
        query,
        now.getTime(),
      );
      const rows = await tx.post.findMany({
        where: {
          ...(query.filters.scope !== 'ALL' ? { authorId: actor.id } : {}),
          trashedAt: query.filters.trashed === true ? { not: null } : null,
          purgeStartedAt: null,
          AND: [
            { OR: [{ purgeAfter: null }, { purgeAfter: { gt: now } }] },
            afterCursor(point, query.order),
          ],
          ...(query.filters.workflowState
            ? {
                workflowState: query.filters
                  .workflowState as Prisma.EnumWorkflowStateFilter,
              }
            : {}),
          ...(query.filters.publicationState
            ? {
                publicationState: query.filters
                  .publicationState as Prisma.EnumPublicationStateFilter,
              }
            : {}),
        },
        include: { author: { select: authorSelection } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: query.pageSize + 1,
      });
      const page = this.cursors.page(
        identity.uid,
        '/v1/posts',
        query,
        rows,
        now.getTime(),
      );
      return {
        data: page.rows.map((post) => postSummary(post, actor)),
        pagination: page.pagination,
      };
    });
  }
  history(
    identity: VerifiedIdentity,
    id: string,
    query: CursorQuery,
    kind: 'revisions' | 'review-events',
  ) {
    query = {
      ...query,
      order:
        kind === 'revisions' ? 'REVISION_DESC_ID_ASC' : 'CREATED_DESC_ID_ASC',
    };
    return this.read(identity, async (tx, actor, now) => {
      visible(await this.posts.lock(tx, id, false), actor, now);
      const route = `/v1/posts/${id}/${kind}`;
      const point = this.cursors.decode(
        identity.uid,
        route,
        query,
        now.getTime(),
      );
      if (kind === 'revisions') {
        const rows = await tx.revision.findMany({
          where: { postId: id, ...afterCursor(point, query.order) },
          select: {
            id: true,
            postId: true,
            number: true,
            title: true,
            createdAt: true,
            creator: { select: authorSelection },
          },
          orderBy: [{ number: 'desc' }, { id: 'asc' }],
          take: query.pageSize + 1,
        });
        const page = this.cursors.page(
          identity.uid,
          route,
          query,
          rows,
          now.getTime(),
        );
        return {
          data: page.rows.map((row) => ({
            id: row.id,
            postId: row.postId,
            number: row.number,
            title: row.title,
            createdBy: row.creator,
            createdAt: row.createdAt.toISOString(),
          })),
          pagination: page.pagination,
        };
      }
      const rows = await tx.reviewEvent.findMany({
        where: { postId: id, ...afterCursor(point) },
        include: { actor: { select: authorSelection } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.pageSize + 1,
      });
      const page = this.cursors.page(
        identity.uid,
        route,
        query,
        rows,
        now.getTime(),
      );
      return {
        data: page.rows.map((row) => ({
          id: row.id,
          postId: row.postId,
          revisionId: row.revisionId,
          action: row.action,
          actor: row.actor,
          feedback: row.feedback,
          createdAt: row.createdAt.toISOString(),
        })),
        pagination: page.pagination,
      };
    });
  }
  revision(identity: VerifiedIdentity, id: string, revisionId: string) {
    return this.read(identity, async (tx, actor, now) => {
      visible(await this.posts.lock(tx, id, false), actor, now);
      const revision = await tx.revision.findFirst({
        where: { id: revisionId, postId: id },
        include: revisionInclude,
      });
      return revision ? revisionDto(revision) : notFound();
    });
  }

  private async write(
    identity: VerifiedIdentity,
    scope: Omit<OperationScope, 'identityUid'>,
    input: Record<string, unknown>,
    expectedVersion: number | undefined,
    postId: string | null,
    action: PostAction | 'createPost',
    traceId: string,
  ) {
    const operation = { ...scope, identityUid: identity.uid };
    const hash = semanticHash({
      body: input,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    });
    try {
      return await this.members.database.prisma.$transaction(
        async (tx) => {
          await lockOperation(tx, operation);
          // Role/ownership changes take this lock exclusively. Ordinary editorial work shares it.
          if (action === 'reassignPostAuthor')
            await lockAdministrativeState(tx);
          else
            await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${ADMIN_STATE_LOCK}::bigint)`;
          const candidate = activeMember(
            await tx.member.findUnique({
              where: { identityUid: identity.uid },
              select: memberSelection,
            }),
          );
          const receipt = postId
            ? null
            : await tx.idempotencyRecord.findUnique({
                where: { identityUid_method_route_key: operation },
              });
          const originalId = (
            receipt?.result as unknown as { data?: { id?: string } } | null
          )?.data?.id;
          const previewId =
            postId ??
            (typeof originalId === 'string' && UUID.test(originalId)
              ? originalId
              : null);
          const preview = previewId
            ? await tx.post.findUnique({ where: { id: previewId } })
            : await tx.post.findUnique({
                where: {
                  creatorId_clientDraftId: {
                    creatorId: candidate.id,
                    clientDraftId: input.clientDraftId as string,
                  },
                },
              });
          if (previewId && !preview) return notFound();
          const ids = [
            ...new Set([
              candidate.id,
              ...(preview ? [preview.authorId] : []),
              ...(action === 'reassignPostAuthor'
                ? [input.authorId as string]
                : []),
            ]),
          ].sort();
          const locked = await tx.$queryRaw<
            MemberRow[]
          >(Prisma.sql`SELECT id, "identityUid", email, "displayName", handle, bio, role::text AS role, active, version
          FROM blogpost."Member" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
          const actor = activeMember(
            locked.find((member) => member.id === candidate.id),
          );
          const lockedPost =
            postId || preview
              ? await this.posts.lock(tx, postId ?? preview!.id, true)
              : null;
          const now = await transactionTime(tx);
          // A create receipt can outlive an attribution transfer. It must not reveal a former owner's draft.
          if (!postId && preview) visible(lockedPost, actor, now);
          const post = postId ? visible(lockedPost, actor, now) : null;
          if (action === 'reassignPostAuthor') administrator(actor);
          if (
            [
              'rejectPostRevision',
              'publishPostRevision',
              'unpublishPost',
              'changePostSlug',
            ].includes(action) &&
            actor.role === 'AUTHOR'
          )
            return permission();
          if (
            post &&
            ['trashPost', 'restoreTrashedPost'].includes(action) &&
            actor.role === 'AUTHOR' &&
            post.firstPublishedAt
          )
            return permission();
          const replay = await replayOperation<ReturnType<typeof workspaceDto>>(
            tx,
            operation,
            hash,
            now,
          );
          if (replay) return replay;
          await consumeRate(tx, actor.id, 'WRITE', now);
          if (!post) {
            const existing = await tx.post.findUnique({
              where: {
                creatorId_clientDraftId: {
                  creatorId: actor.id,
                  clientDraftId: input.clientDraftId as string,
                },
              },
            });
            if (existing)
              throw new ApiError(
                409,
                'CLIENT_DRAFT_ALREADY_EXISTS',
                'Draft already exists',
                'Recover the existing draft before continuing.',
                [],
                actor.role !== 'AUTHOR' || existing.authorId === actor.id
                  ? {
                      resourceId: existing.id,
                      currentVersion: existing.lockVersion,
                    }
                  : null,
              );
            await this.posts.quota(tx, actor.id);
            const created = await tx.post.create({
              data: {
                authorId: actor.id,
                creatorId: actor.id,
                clientDraftId: input.clientDraftId as string,
                createdAt: now,
                updatedAt: now,
              },
            });
            const revision = await this.posts.appendRevision(
              tx,
              created,
              actor,
              normalizeDraft(input.draft),
              now,
            );
            await tx.post.update({
              where: { id: created.id },
              data: { workingRevisionId: revision.id, updatedAt: now },
            });
            await this.audit(tx, actor, created.id, action, traceId, {
              revisionId: revision.id,
            });
            const data = workspaceDto(
              await this.posts.graph(tx, created.id),
              actor,
            );
            return finishOperation(tx, operation, hash, now, {
              data,
              version: 1,
              status: 201,
              location: `/v1/posts/${created.id}`,
            });
          }
          expectVersion('POST', post.id, post.lockVersion, expectedVersion!);
          const changed = await this.apply(
            tx,
            post,
            actor,
            now,
            action as PostAction,
            input,
            locked,
          );
          if (changed)
            await this.audit(tx, actor, post.id, action, traceId, changed);
          const data = workspaceDto(await this.posts.graph(tx, post.id), actor);
          return finishOperation(tx, operation, hash, now, {
            data,
            version: data.version,
            status: 200,
          });
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
  create(
    identity: VerifiedIdentity,
    input: ReturnType<typeof createPostInput>,
    key: string,
    traceId: string,
  ) {
    return this.write(
      identity,
      { method: 'POST', route: '/v1/posts', key },
      input,
      undefined,
      null,
      'createPost',
      traceId,
    );
  }
  mutate(
    identity: VerifiedIdentity,
    id: string,
    action: PostAction,
    input: Record<string, unknown>,
    version: number,
    key: string,
    traceId: string,
  ) {
    const specification = postActions[action];
    const route =
      action === 'reassignPostAuthor'
        ? `/v1/admin/posts/${id}/author`
        : `/v1/posts/${id}${specification.suffix ? '/' + specification.suffix : ''}`;
    return this.write(
      identity,
      { method: specification.method, route, key },
      input,
      version,
      id,
      action,
      traceId,
    );
  }
  private audit(
    tx: Transaction,
    actor: MemberRow,
    id: string,
    action: string,
    traceId: string,
    changes: Prisma.InputJsonObject,
  ) {
    return tx.auditEvent.create({
      data: {
        actorId: actor.id,
        subjectId: id,
        subjectType: 'POST',
        action,
        traceId,
        changes,
      },
    });
  }
  private async apply(
    tx: Transaction,
    post: PostRow,
    actor: MemberRow,
    now: Date,
    action: PostAction,
    input: Record<string, unknown>,
    members: MemberRow[],
  ): Promise<Prisma.InputJsonObject | null> {
    if (post.trashedAt && !['restoreTrashedPost', 'trashPost'].includes(action))
      return workflowConflict();
    const change: Prisma.PostUncheckedUpdateInput = {};
    let event:
      { action: string; revisionId: string; feedback?: string } | undefined;
    if (
      ['savePostDraft', 'restorePostRevision', 'reassignPostAuthor'].includes(
        action,
      )
    ) {
      if (post.workflowState === 'IN_REVIEW') return workflowConflict();
      const current = await tx.revision.findFirstOrThrow({
        where: { id: post.workingRevisionId!, postId: post.id },
        include: revisionInclude,
      });
      let content: DraftContent;
      let restored: string | null = null;
      if (action === 'savePostDraft') {
        content = normalizeDraft(input, draftContent(current));
        if (semanticHash(content) === semanticHash(draftContent(current)))
          return null;
      } else if (action === 'restorePostRevision') {
        const old = await tx.revision.findFirst({
          where: { id: input.revisionId as string, postId: post.id },
          include: revisionInclude,
        });
        if (!old) return notFound();
        content = draftContent(old);
        restored = old.id;
      } else {
        const target = members.find((member) => member.id === input.authorId);
        if (!target) return notFound();
        if (!target.active) return workflowConflict();
        if (target.id === post.authorId) return null;
        await this.posts.quota(tx, target.id);
        change.authorId = target.id;
        content = draftContent(current);
      }
      const revision = await this.posts.appendRevision(
        tx,
        {
          ...post,
          authorId:
            typeof change.authorId === 'string'
              ? change.authorId
              : post.authorId,
        },
        actor,
        content,
        now,
        restored,
      );
      change.workingRevisionId = revision.id;
      change.workflowState = 'DRAFT';
    } else if (action === 'submitPostForReview') {
      if (
        ['IN_REVIEW', 'CLEAN'].includes(post.workflowState) ||
        input.revisionId !== post.workingRevisionId
      )
        return workflowConflict();
      const revision = await tx.revision.findUniqueOrThrow({
        where: { id: post.workingRevisionId! },
        include: revisionInclude,
      });
      validatePublicationContent(draftContent(revision));
      await this.posts.references(
        tx,
        post.id,
        draftContent(revision),
        now,
        true,
      );
      change.workflowState = 'IN_REVIEW';
      change.submittedRevisionId = revision.id;
      change.submittedAt = now;
      event = { action: 'SUBMITTED', revisionId: revision.id };
    } else if (
      [
        'withdrawPostReview',
        'rejectPostRevision',
        'publishPostRevision',
      ].includes(action)
    ) {
      if (
        post.workflowState !== 'IN_REVIEW' ||
        !post.submittedRevisionId ||
        (action !== 'withdrawPostReview' &&
          input.revisionId !== post.submittedRevisionId)
      )
        return workflowConflict();
      const revisionId = post.submittedRevisionId;
      change.submittedRevisionId = null;
      change.submittedAt = null;
      if (action === 'publishPostRevision') {
        const revision = await tx.revision.findUniqueOrThrow({
          where: { id: revisionId },
          include: revisionInclude,
        });
        const content = draftContent(revision);
        validatePublicationContent(content);
        await this.posts.references(tx, post.id, content, now, true);
        change.canonicalSlug =
          post.canonicalSlug ??
          (await this.posts.slug(tx, post, null, content.title));
        change.publishedRevisionId = revisionId;
        change.publicationState = 'PUBLISHED';
        change.workflowState = 'CLEAN';
        change.firstPublishedAt = post.firstPublishedAt ?? now;
        change.lastPublishedAt = now;
        await tx.$executeRaw`INSERT INTO blogpost."PublishedSearch" ("postId", "revisionId", document)
          VALUES (${post.id}::uuid, ${revisionId}::uuid, setweight(to_tsvector('english', ${content.title}), 'A') || setweight(to_tsvector('english', ${content.summary}), 'B') || setweight(to_tsvector('english', ${revision.plainBody}), 'C'))
          ON CONFLICT ("postId") DO UPDATE SET "revisionId" = EXCLUDED."revisionId", document = EXCLUDED.document`;
        event = { action: 'PUBLISHED', revisionId };
      } else if (action === 'rejectPostRevision') {
        change.workflowState = 'CHANGES_REQUESTED';
        event = {
          action: 'REJECTED',
          revisionId,
          feedback: input.feedback as string,
        };
      } else {
        change.workflowState = 'DRAFT';
        event = { action: 'WITHDRAWN', revisionId };
      }
    } else if (action === 'unpublishPost') {
      if (post.publicationState !== 'PUBLISHED') return workflowConflict();
      change.publicationState = 'WITHDRAWN';
      await tx.publishedSearch.deleteMany({ where: { postId: post.id } });
      event = { action: 'UNPUBLISHED', revisionId: post.publishedRevisionId! };
    } else if (action === 'trashPost') {
      if (post.trashedAt) return null;
      change.trashedAt = now;
      change.purgeAfter = new Date(now.getTime() + 30 * 86400000);
      if (post.publicationState === 'PUBLISHED')
        change.publicationState = 'WITHDRAWN';
      change.workflowState = 'DRAFT';
      change.submittedRevisionId = null;
      change.submittedAt = null;
      await tx.publishedSearch.deleteMany({ where: { postId: post.id } });
    } else if (action === 'restoreTrashedPost') {
      if (!post.trashedAt) return workflowConflict();
      await this.posts.quota(tx, post.authorId);
      change.trashedAt = null;
      change.purgeAfter = null;
      change.workflowState = 'DRAFT';
      change.publicationState = post.firstPublishedAt
        ? 'WITHDRAWN'
        : 'NEVER_PUBLISHED';
    } else if (action === 'changePostSlug') {
      if (post.canonicalSlug === input.slug) return null;
      change.canonicalSlug = await this.posts.slug(
        tx,
        post,
        input.slug as string,
        '',
      );
    }
    change.lockVersion = nextVersion(post.lockVersion);
    change.updatedAt = now;
    await tx.post.update({ where: { id: post.id }, data: change });
    if (event)
      await tx.reviewEvent.create({
        data: { ...event, postId: post.id, actorId: actor.id, createdAt: now },
      });
    return {
      fields: Object.keys(change).filter(
        (field) => !['lockVersion', 'updatedAt'].includes(field),
      ),
      ...(typeof change.workingRevisionId === 'string'
        ? { revisionId: change.workingRevisionId }
        : {}),
      ...(typeof change.authorId === 'string'
        ? { previousAuthorId: post.authorId, authorId: change.authorId }
        : {}),
    };
  }
}
