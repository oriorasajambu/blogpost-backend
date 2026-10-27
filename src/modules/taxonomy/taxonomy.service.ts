import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { EditorOperations } from '../members/editor-operations.js';
import type { VerifiedIdentity } from '../identity/identity.js';
import type { Transaction } from '../members/members.repository.js';
import {
  invalidInput,
  objectInput,
  boundedText,
} from '../../platform/http/input.js';
import {
  pageMetadata,
  type PageQuery,
} from '../../platform/http/collections.js';
import { ApiError } from '../../platform/errors/api-error.js';
import {
  expectVersion,
  nextVersion,
} from '../../platform/database/operation.js';
import type { components } from '../../../contracts/generated/typescript/api-v1.js';

export type TaxonKind = 'categories' | 'tags';
type TaxonRow = Prisma.CategoryGetPayload<Record<string, never>>;
export const taxonSelection = {
  id: true,
  name: true,
  slug: true,
  active: true,
} as const;
export function taxonInput(value: unknown, create: boolean) {
  const input = objectInput(
    value,
    create ? ['name', 'slug'] : ['name', 'active'],
    create ? ['name', 'slug'] : [],
  );
  if (!Object.keys(input).length) return invalidInput('');
  const result: { name?: string; slug?: string; active?: boolean } = {};
  if (Object.hasOwn(input, 'name')) {
    if (!boundedText(input.name, 80)) return invalidInput('/name');
    const name = input.name.trim().normalize('NFC');
    if (!boundedText(name, 80)) return invalidInput('/name');
    result.name = name;
  }
  if (Object.hasOwn(input, 'slug')) {
    if (
      typeof input.slug !== 'string' ||
      input.slug.length > 120 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)
    )
      return invalidInput('/slug');
    result.slug = input.slug;
  }
  if (Object.hasOwn(input, 'active')) {
    if (typeof input.active !== 'boolean') return invalidInput('/active');
    result.active = input.active;
  }
  return result;
}
export const taxonTable = (kind: TaxonKind) =>
  kind === 'categories'
    ? Prisma.sql`blogpost."Category"`
    : Prisma.sql`blogpost."Tag"`;
@Injectable()
export class TaxonomyService {
  constructor(
    @Inject(EditorOperations) private readonly operations: EditorOperations,
  ) {}
  private model(tx: Transaction, kind: TaxonKind) {
    // Only their identical scalar schema is used through this adapter; relation queries stay separate.
    return kind === 'categories'
      ? tx.category
      : (tx.tag as unknown as typeof tx.category);
  }
  async managed(
    tx: Transaction,
    kind: TaxonKind,
    row: TaxonRow,
  ): Promise<components['schemas']['ManagedTaxon']> {
    return (await this.managedMany(tx, kind, [row]))[0]!;
  }
  private async managedMany(
    tx: Transaction,
    kind: TaxonKind,
    rows: TaxonRow[],
  ): Promise<components['schemas']['ManagedTaxon'][]> {
    if (!rows.length) return [];
    const id =
      kind === 'categories'
        ? Prisma.sql`r."categoryId"`
        : Prisma.sql`rt."tagId"`;
    const join =
      kind === 'tags'
        ? Prisma.sql`JOIN blogpost."RevisionTag" rt ON rt."revisionId" = r.id`
        : Prisma.empty;
    const counts = await tx.$queryRaw<
      { id: string; publishedCount: number; draftCount: number }[]
    >(Prisma.sql`
      WITH pointers AS (
        SELECT id AS "postId", "publishedRevisionId" AS "revisionId", true AS published FROM blogpost."Post"
          WHERE "publicationState" = 'PUBLISHED' AND "trashedAt" IS NULL AND "purgeStartedAt" IS NULL
        UNION ALL SELECT id, "workingRevisionId", false FROM blogpost."Post" WHERE "trashedAt" IS NULL AND "purgeStartedAt" IS NULL
      ) SELECT ${id} AS id, (count(*) FILTER (WHERE p.published))::integer AS "publishedCount",
        (count(*) FILTER (WHERE NOT p.published))::integer AS "draftCount"
      FROM pointers p JOIN blogpost."Revision" r ON r.id = p."revisionId" AND r."postId" = p."postId" ${join}
      WHERE ${id} IN (${Prisma.join(rows.map((row) => Prisma.sql`${row.id}::uuid`))}) GROUP BY ${id}`);
    const usage = new Map(counts.map(({ id, ...count }) => [id, count]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      active: row.active,
      version: row.version,
      usage: usage.get(row.id) ?? { publishedCount: 0, draftCount: 0 },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
  list(identity: VerifiedIdentity, kind: TaxonKind, query: PageQuery) {
    return this.operations.read(identity, async (tx) => {
      const model = this.model(tx, kind);
      const where = query.active === undefined ? {} : { active: query.active };
      const count = await model.count({ where });
      const offset = (query.page - 1) * query.pageSize;
      const rows =
        offset >= count
          ? []
          : await model.findMany({
              where,
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
              skip: offset,
              take: query.pageSize,
            });
      return {
        data: await this.managedMany(tx, kind, rows),
        pagination: pageMetadata(count, query),
      };
    });
  }
  get(identity: VerifiedIdentity, kind: TaxonKind, id: string) {
    return this.operations.read(identity, async (tx) => {
      const row = await this.model(tx, kind).findUnique({ where: { id } });
      if (!row)
        throw new ApiError(
          404,
          'RESOURCE_NOT_FOUND',
          'Taxonomy unavailable',
          'This resource is unavailable.',
        );
      return this.managed(tx, kind, row);
    });
  }
  write(
    identity: VerifiedIdentity,
    kind: TaxonKind,
    id: string | null,
    input: ReturnType<typeof taxonInput>,
    key: string,
    traceId: string,
    expectedVersion?: number,
  ) {
    return this.operations.write(
      identity,
      {
        method: id ? 'PATCH' : 'POST',
        route: `/v1/${kind}${id ? '/' + id : ''}`,
        key,
        body: input,
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      },
      async (tx, actor, now) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`taxonomy:${kind}`}, 0))`;
        const model = this.model(tx, kind);
        let previous: TaxonRow | null = null;
        if (id) {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM ${taxonTable(kind)} WHERE id = ${id}::uuid FOR UPDATE`,
          );
          previous = await model.findUnique({ where: { id } });
          if (!previous)
            throw new ApiError(
              404,
              'RESOURCE_NOT_FOUND',
              'Taxonomy unavailable',
              'This resource is unavailable.',
            );
          expectVersion('TAXON', id, previous.version, expectedVersion!);
        }
        const normalizedName = input.name?.toLocaleLowerCase('en');
        if (
          normalizedName !== undefined &&
          (await model.findFirst({
            where: { normalizedName, ...(id ? { id: { not: id } } : {}) },
          }))
        )
          throw new ApiError(
            409,
            'WORKFLOW_CONFLICT',
            'Name unavailable',
            'Choose another taxonomy name.',
          );
        if (!id && (await model.findUnique({ where: { slug: input.slug! } })))
          throw new ApiError(
            409,
            'SLUG_CONFLICT',
            'Slug unavailable',
            'Choose another taxonomy slug.',
          );
        const fields = Object.keys(input).filter(
          (field) =>
            !previous ||
            previous[field as 'name' | 'active'] !==
              input[field as 'name' | 'active'],
        );
        const row = previous
          ? fields.length
            ? await model.update({
                where: { id: previous.id },
                data: {
                  ...input,
                  ...(normalizedName !== undefined ? { normalizedName } : {}),
                  version: nextVersion(previous.version),
                  updatedAt: now,
                },
              })
            : previous
          : await model.create({
              data: {
                name: input.name!,
                normalizedName: normalizedName!,
                slug: input.slug!,
                createdAt: now,
                updatedAt: now,
              },
            });
        if (fields.length)
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              subjectType: 'TAXON',
              subjectId: row.id,
              action: id ? 'TAXON_UPDATED' : 'TAXON_CREATED',
              traceId,
              changes: { kind, fields },
            },
          });
        return {
          data: await this.managed(tx, kind, row),
          version: row.version,
          status: id ? 200 : 201,
          ...(!id ? { location: `/v1/${kind}/${row.id}` } : {}),
        };
      },
    );
  }
}
