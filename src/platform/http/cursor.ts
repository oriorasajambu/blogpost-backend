import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { ApiError } from '../errors/api-error.js';
import { semanticHash } from '../database/operation.js';
import { boundedText, invalidInput, UUID, uuidInput } from './input.js';

export type FilterKind =
  | 'role'
  | 'active'
  | 'status'
  | 'subjectType'
  | 'subjectId'
  | 'action'
  | 'scope'
  | 'publicationState'
  | 'workflowState'
  | 'trashed';
export type CursorOrder =
  | 'CREATED_DESC_ID_ASC'
  | 'UPDATED_DESC_ID_ASC'
  | 'REVISION_DESC_ID_ASC'
  | 'PUBLISHED_DESC_ID_ASC';
export interface CursorQuery {
  pageSize: number;
  cursor?: string;
  filters: Record<string, string | boolean>;
  order?: CursorOrder;
}
export interface CursorPoint {
  createdAt: Date;
  id: string;
  updatedAt?: Date;
  number?: number;
  firstPublishedAt?: Date | null;
}
export interface CursorPagination {
  kind: 'CURSOR';
  pageSize: number;
  hasMore: boolean;
  nextCursor: string | null;
}
const choices = {
  role: ['AUTHOR', 'EDITOR', 'ADMIN'],
  status: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'],
  scope: ['OWN', 'ALL'],
  publicationState: ['NEVER_PUBLISHED', 'PUBLISHED', 'WITHDRAWN'],
  workflowState: ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'CLEAN'],
};
export function cursorQuery(
  request: Request,
  allowed: readonly FilterKind[],
): CursorQuery {
  const query = new URL(request.originalUrl, 'http://internal').searchParams;
  const filters: CursorQuery['filters'] = {};
  const accepted = ['cursor', 'pageSize', ...allowed];
  for (const key of query.keys())
    if (!accepted.includes(key) || query.getAll(key).length !== 1)
      return invalidInput(
        key.length > 256
          ? ''
          : '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'),
        'query',
      );
  const size = query.get('pageSize') ?? '20';
  if (!/^[0-9]+$/.test(size) || Number(size) < 1 || Number(size) > 50)
    return invalidInput('/pageSize', 'query');
  const cursor = query.get('cursor');
  if (cursor !== null && (!cursor.length || cursor.length > 2048))
    return invalidInput('/cursor', 'query');
  for (const key of allowed) {
    const value = query.get(key);
    if (value === null) {
      if (key === 'scope') filters.scope = 'OWN';
      if (key === 'trashed') filters.trashed = false;
      continue;
    }
    if (key === 'active' || key === 'trashed') {
      if (!['true', 'false'].includes(value))
        return invalidInput('/' + key, 'query');
      filters[key] = value === 'true';
    } else if (key in choices) {
      if (
        !(choices[key as keyof typeof choices] as readonly string[]).includes(
          value,
        )
      )
        return invalidInput('/' + key, 'query');
      filters[key] = value;
    } else if (key === 'subjectId')
      filters[key] = uuidInput(value, key, 'query');
    else {
      if (!boundedText(value, key === 'action' ? 80 : 40))
        return invalidInput('/' + key, 'query');
      filters[key] = value;
    }
  }
  return {
    pageSize: Number(size),
    ...(cursor !== null ? { cursor } : {}),
    filters,
  };
}
@Injectable()
export class CursorService {
  private readonly key: Buffer;
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (
      !config.cursorSigningKey ||
      !/^[a-f0-9]{64}$/.test(config.cursorSigningKey)
    )
      throw new Error('Invalid CURSOR_SIGNING_KEY');
    this.key = Buffer.from(config.cursorSigningKey, 'hex');
  }
  private binding(uid: string, route: string, query: CursorQuery): string {
    return semanticHash({
      uid,
      route,
      pageSize: query.pageSize,
      filters: query.filters,
      order: query.order ?? 'CREATED_DESC_ID_ASC',
    });
  }
  decode(
    uid: string,
    route: string,
    query: CursorQuery,
    now = Date.now(),
  ): CursorPoint | null {
    if (!query.cursor) return null;
    try {
      const [body, signature, extra] = query.cursor.split('.');
      if (
        !body ||
        !signature ||
        extra !== undefined ||
        !/^[A-Za-z0-9_-]+$/.test(body) ||
        !/^[a-f0-9]{64}$/.test(signature)
      )
        throw new Error();
      const expected = createHmac('sha256', this.key).update(body).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
        throw new Error();
      const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (
        value.binding !== this.binding(uid, route, query) ||
        !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= now ||
        value.expiresAt > now + 86_400_000 ||
        typeof value.id !== 'string' ||
        !UUID.test(value.id) ||
        typeof value.createdAt !== 'string' ||
        new Date(value.createdAt).toISOString() !== value.createdAt ||
        (query.order === 'UPDATED_DESC_ID_ASC' &&
          (typeof value.updatedAt !== 'string' ||
            new Date(value.updatedAt).toISOString() !== value.updatedAt)) ||
        (query.order === 'REVISION_DESC_ID_ASC' &&
          (!Number.isSafeInteger(value.number) ||
            value.number < 1 ||
            value.number > 2147483647)) ||
        (query.order === 'PUBLISHED_DESC_ID_ASC' &&
          (typeof value.firstPublishedAt !== 'string' ||
            new Date(value.firstPublishedAt).toISOString() !==
              value.firstPublishedAt))
      )
        throw new Error();
      return {
        id: value.id,
        createdAt: new Date(value.createdAt),
        ...(query.order === 'UPDATED_DESC_ID_ASC'
          ? { updatedAt: new Date(value.updatedAt) }
          : {}),
        ...(query.order === 'REVISION_DESC_ID_ASC'
          ? { number: value.number as number }
          : {}),
        ...(query.order === 'PUBLISHED_DESC_ID_ASC'
          ? { firstPublishedAt: new Date(value.firstPublishedAt) }
          : {}),
      };
    } catch {
      throw new ApiError(
        400,
        'INVALID_CURSOR',
        'Invalid cursor',
        'Restart this collection with the intended filters.',
      );
    }
  }
  page<T extends CursorPoint>(
    uid: string,
    route: string,
    query: CursorQuery,
    rows: T[],
    now = Date.now(),
  ): { rows: T[]; pagination: CursorPagination } {
    const hasMore = rows.length > query.pageSize;
    const page = rows.slice(0, query.pageSize);
    let nextCursor: string | null = null;
    if (hasMore) {
      const last = page.at(-1)!;
      const payload = Buffer.from(
        JSON.stringify({
          binding: this.binding(uid, route, query),
          createdAt: last.createdAt.toISOString(),
          id: last.id,
          ...(query.order === 'UPDATED_DESC_ID_ASC'
            ? { updatedAt: last.updatedAt!.toISOString() }
            : {}),
          ...(query.order === 'REVISION_DESC_ID_ASC'
            ? { number: last.number! }
            : {}),
          ...(query.order === 'PUBLISHED_DESC_ID_ASC'
            ? { firstPublishedAt: last.firstPublishedAt!.toISOString() }
            : {}),
          expiresAt: now + 86_400_000,
        }),
      ).toString('base64url');
      nextCursor = `${payload}.${createHmac('sha256', this.key).update(payload).digest('hex')}`;
    }
    return {
      rows: page,
      pagination: {
        kind: 'CURSOR',
        pageSize: query.pageSize,
        hasMore,
        nextCursor,
      },
    };
  }
}
export function afterCursor(
  point: CursorPoint | null,
  order: CursorOrder = 'CREATED_DESC_ID_ASC',
) {
  if (point && order === 'UPDATED_DESC_ID_ASC')
    return {
      OR: [
        { updatedAt: { lt: point.updatedAt! } },
        { updatedAt: point.updatedAt!, id: { gt: point.id } },
      ],
    };
  if (point && order === 'REVISION_DESC_ID_ASC')
    return {
      OR: [
        { number: { lt: point.number! } },
        { number: point.number!, id: { gt: point.id } },
      ],
    };
  return point
    ? {
        OR: [
          { createdAt: { lt: point.createdAt } },
          { createdAt: point.createdAt, id: { gt: point.id } },
        ],
      }
    : {};
}
