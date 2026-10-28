import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import {
  databaseFailure,
  type Transaction,
} from '../members/members.repository.js';
import { CursorService } from '../../platform/http/cursor.js';
import {
  pageMetadata,
  type PublicQuery,
  type PageQuery,
} from '../../platform/http/collections.js';
import {
  objectInput,
  invalidInput,
  uuidInput,
} from '../../platform/http/input.js';
import { ApiError } from '../../platform/errors/api-error.js';
import { authorSelection, descriptor, notFound } from './posts.repository.js';
import {
  taxonSelection,
  type TaxonKind,
} from '../taxonomy/taxonomy.service.js';
import type { components } from '../../../contracts/generated/typescript/api-v1.js';

type DTO = components['schemas'];
const assetSelection = {
  id: true,
  postId: true,
  state: true,
  width: true,
  height: true,
  mimeType: true,
  variants: true,
} as const;
const publicRevision = {
  id: true,
  title: true,
  summary: true,
  creditedAuthor: { select: authorSelection },
  category: { select: taxonSelection },
  tags: {
    select: { tag: { select: taxonSelection } },
    orderBy: { position: 'asc' },
  },
  cover: { select: assetSelection },
  coverAltText: true,
  coverDecorative: true,
} satisfies Prisma.RevisionSelect;
const summarySelection = {
  id: true,
  canonicalSlug: true,
  firstPublishedAt: true,
  lastPublishedAt: true,
  publishedRevision: { select: publicRevision },
} satisfies Prisma.PostSelect;
const articleSelection = {
  ...summarySelection,
  publishedRevision: {
    select: {
      ...publicRevision,
      markdown: true,
      markdownContractVersion: true,
      media: {
        select: { asset: { select: assetSelection } },
        orderBy: { mediaId: 'asc' },
      },
    },
  },
} satisfies Prisma.PostSelect;
type SummaryRow = Prisma.PostGetPayload<{ select: typeof summarySelection }>;
type ArticleRow = Prisma.PostGetPayload<{ select: typeof articleSelection }>;
export const publicWhere = {
  publicationState: 'PUBLISHED',
  trashedAt: null,
  purgeStartedAt: null,
  publishedRevisionId: { not: null },
} satisfies Prisma.PostWhereInput;
function projectionFailure(): never {
  throw new ApiError(
    503,
    'DEPENDENCY_UNAVAILABLE',
    'Publication unavailable',
    'Retry after the dependency recovers.',
    [],
    null,
    1,
  );
}
function summaryDto(post: SummaryRow): DTO['PublicPostSummary'] {
  const revision = post.publishedRevision;
  if (
    !revision ||
    !revision.category ||
    !post.canonicalSlug ||
    !post.firstPublishedAt ||
    !post.lastPublishedAt
  )
    return projectionFailure();
  let cover: DTO['ImageReference'] | null = null;
  if (revision.cover) {
    try {
      cover = {
        ...descriptor(revision.cover, 'public'),
        altText: revision.coverAltText ?? '',
        decorative: revision.coverDecorative,
      };
    } catch {
      return projectionFailure();
    }
  }
  return {
    id: post.id,
    slug: post.canonicalSlug,
    title: revision.title,
    summary: revision.summary,
    author: revision.creditedAuthor,
    category: revision.category,
    tags: revision.tags.map((row) => row.tag),
    cover,
    publishedRevisionId: revision.id,
    firstPublishedAt: post.firstPublishedAt.toISOString(),
    updatedAt: post.lastPublishedAt.toISOString(),
  };
}
function articleDto(post: ArticleRow): DTO['PublicPost'] {
  const summary = summaryDto(post);
  const revision = post.publishedRevision!;
  try {
    return {
      ...summary,
      markdown: revision.markdown,
      markdownContractVersion: 1,
      media: revision.media.map((row) => descriptor(row.asset, 'public')),
    };
  } catch {
    return projectionFailure();
  }
}
export function availabilityInput(value: unknown): string[] {
  const input = objectInput(value, ['postIds'], ['postIds']);
  if (
    !Array.isArray(input.postIds) ||
    input.postIds.length < 1 ||
    input.postIds.length > 50 ||
    input.postIds.some((id) => typeof id !== 'string')
  )
    return invalidInput('/postIds');
  const ids = input.postIds.map((id) =>
    uuidInput(id as string, 'postIds', 'body'),
  );
  if (new Set(ids).size !== ids.length) return invalidInput('/postIds');
  return ids;
}
@Injectable()
export class PublicPostsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CursorService) private readonly cursors: CursorService,
  ) {}
  private async read<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await this.database.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return work(tx);
        },
        { isolationLevel: 'RepeatableRead', maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
  get(id: string) {
    return this.read(async (tx) => {
      const post = await tx.post.findFirst({
        where: { ...publicWhere, id },
        select: articleSelection,
      });
      return post ? articleDto(post) : notFound();
    });
  }
  slug(slug: string) {
    return this.read(async (tx) => {
      const reserved = await tx.slugHistory.findFirst({
        where: { slug, post: publicWhere },
        select: { post: { select: articleSelection } },
      });
      if (!reserved?.post) return notFound();
      const post = reserved.post;
      if (!post.canonicalSlug) return projectionFailure();
      const canonical = post.canonicalSlug === slug;
      return {
        resolution: canonical ? ('CANONICAL' as const) : ('REDIRECT' as const),
        canonicalSlug: post.canonicalSlug,
        canonicalPath: `/posts/${post.canonicalSlug}`,
        post: canonical ? articleDto(post) : null,
      };
    });
  }
  author(handle: string) {
    return this.read(async (tx) => {
      const author = await tx.member.findUnique({
        where: { handle },
        select: { ...authorSelection, bio: true },
      });
      return author ?? notFound();
    });
  }
  availability(ids: string[]) {
    return this.read(async (tx) => {
      const posts = await tx.post.findMany({
        where: { ...publicWhere, id: { in: ids } },
        select: { id: true, publishedRevisionId: true },
      });
      const available = new Map(
        posts.map((row) => [row.id, row.publishedRevisionId]),
      );
      return ids.map((postId) => ({
        postId,
        available: available.has(postId),
        publishedRevisionId: available.get(postId) ?? null,
      }));
    });
  }
  feed(query: PublicQuery) {
    return this.read(async (tx) => {
      const point = this.cursors.decode('public', '/v1/public/posts', query);
      const categoryId = query.filters.categoryId as string | undefined;
      const authorId = query.filters.authorId as string | undefined;
      const tags =
        typeof query.filters.tagIds === 'string'
          ? query.filters.tagIds.split(',')
          : [];
      const rows = await tx.post.findMany({
        where: {
          ...publicWhere,
          publishedRevision: {
            ...(categoryId ? { categoryId } : {}),
            ...(authorId ? { creditedAuthorId: authorId } : {}),
            AND: tags.map((tagId) => ({ tags: { some: { tagId } } })),
          },
          ...(point
            ? {
                OR: [
                  { firstPublishedAt: { lt: point.firstPublishedAt! } },
                  {
                    firstPublishedAt: point.firstPublishedAt!,
                    id: { gt: point.id },
                  },
                ],
              }
            : {}),
        },
        select: summarySelection,
        orderBy: [{ firstPublishedAt: 'desc' }, { id: 'asc' }],
        take: query.pageSize + 1,
      });
      // Public cursors carry publication times only, never the private creation timestamp.
      const page = this.cursors.page(
        'public',
        '/v1/public/posts',
        query,
        rows.map((row) => ({
          ...row,
          firstPublishedAt: row.firstPublishedAt!,
          createdAt: row.firstPublishedAt!,
        })),
      );
      return { data: page.rows.map(summaryDto), pagination: page.pagination };
    });
  }
  taxonomy(kind: TaxonKind, query: PageQuery) {
    return this.read(async (tx) => {
      const publishedReference =
        kind === 'categories'
          ? { revisions: { some: { publishedFor: { some: publicWhere } } } }
          : {
              revisions: {
                some: { revision: { publishedFor: { some: publicWhere } } },
              },
            };
      const where = { OR: [{ active: true }, publishedReference] };
      const offset = (query.page - 1) * query.pageSize;
      if (kind === 'categories') {
        const total = await tx.category.count({
          where: where as Prisma.CategoryWhereInput,
        });
        const rows =
          offset >= total
            ? []
            : await tx.category.findMany({
                where: where as Prisma.CategoryWhereInput,
                select: taxonSelection,
                orderBy: [{ name: 'asc' }, { id: 'asc' }],
                skip: offset,
                take: query.pageSize,
              });
        return { data: rows, pagination: pageMetadata(total, query) };
      }
      const total = await tx.tag.count({
        where: where as Prisma.TagWhereInput,
      });
      const rows =
        offset >= total
          ? []
          : await tx.tag.findMany({
              where: where as Prisma.TagWhereInput,
              select: taxonSelection,
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
              skip: offset,
              take: query.pageSize,
            });
      return { data: rows, pagination: pageMetadata(total, query) };
    });
  }
  search(query: PublicQuery) {
    return this.read(async (tx) => {
      const validity = await tx.$queryRaw<
        { searchable: boolean }[]
      >`SELECT numnode(q) > 0 AND querytree(q) NOT IN ('', 'T') AS searchable FROM (SELECT websearch_to_tsquery('english', ${query.q!}) AS q) parsed`;
      if (!validity[0]?.searchable)
        throw new ApiError(
          422,
          'SEARCH_QUERY_NOT_SEARCHABLE',
          'Search cannot be indexed',
          'Include a searchable positive term.',
        );
      const filters = [
        Prisma.sql`p."publicationState" = 'PUBLISHED' AND p."trashedAt" IS NULL AND p."purgeStartedAt" IS NULL AND p."publishedRevisionId" = s."revisionId" AND s.document @@ q.value`,
      ];
      if (query.filters.categoryId)
        filters.push(
          Prisma.sql`r."categoryId" = ${query.filters.categoryId}::uuid`,
        );
      if (query.filters.authorId)
        filters.push(
          Prisma.sql`r."creditedAuthorId" = ${query.filters.authorId}::uuid`,
        );
      if (typeof query.filters.tagIds === 'string')
        for (const id of query.filters.tagIds.split(','))
          filters.push(
            Prisma.sql`EXISTS(SELECT 1 FROM blogpost."RevisionTag" rt WHERE rt."revisionId" = r.id AND rt."tagId" = ${id}::uuid)`,
          );
      const from = Prisma.sql`FROM blogpost."PublishedSearch" s JOIN blogpost."Post" p ON p.id = s."postId" JOIN blogpost."Revision" r ON r.id = s."revisionId" AND r."postId" = p.id
        CROSS JOIN (SELECT websearch_to_tsquery('english', ${query.q!}) AS value) q WHERE ${Prisma.join(filters, ' AND ')}`;
      const counts = await tx.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT count(*)::integer AS total ${from}`,
      );
      const total = counts[0]!.total;
      const offset = (query.page - 1) * query.pageSize;
      const limit = Math.min(query.pageSize, Math.min(total, 1000) - offset);
      const matches =
        limit <= 0
          ? []
          : await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT p.id ${from}
        ORDER BY ts_rank_cd(s.document, q.value) DESC, p."firstPublishedAt" DESC, p.id ASC LIMIT ${limit} OFFSET ${offset}`);
      const rows = matches.length
        ? await tx.post.findMany({
            where: { ...publicWhere, id: { in: matches.map((row) => row.id) } },
            select: summarySelection,
          })
        : [];
      const byId = new Map(rows.map((row) => [row.id, row]));
      return {
        data: matches.map((match) =>
          summaryDto(byId.get(match.id) ?? projectionFailure()),
        ),
        pagination: pageMetadata(total, query, 1000),
      };
    });
  }
}
