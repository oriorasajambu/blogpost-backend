import type { Request } from 'express';
import { boundedText, invalidInput, uuidInput } from './input.js';
import type { CursorQuery } from './cursor.js';

export interface PageQuery {
  page: number;
  pageSize: number;
  active?: boolean;
}
export function queryValues(
  request: Request,
  allowed: readonly string[],
  repeated: readonly string[] = [],
): URLSearchParams {
  const query = new URL(request.originalUrl, 'http://internal').searchParams;
  for (const key of query.keys())
    if (
      !allowed.includes(key) ||
      (!repeated.includes(key) && query.getAll(key).length !== 1)
    )
      return invalidInput(
        key.length > 256
          ? ''
          : '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'),
        'query',
      );
  return query;
}
function positive(value: string, field: string, maximum: number): number {
  const number = Number(value);
  if (
    !/^[0-9]+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > maximum
  )
    return invalidInput('/' + field, 'query');
  return number;
}
export function pageQuery(request: Request, managed = false): PageQuery {
  const query = queryValues(request, [
    'page',
    'pageSize',
    ...(managed ? ['active'] : []),
  ]);
  const active = query.get('active');
  if (active !== null && !['true', 'false'].includes(active))
    return invalidInput('/active', 'query');
  return {
    page: positive(query.get('page') ?? '1', 'page', Number.MAX_SAFE_INTEGER),
    pageSize: positive(query.get('pageSize') ?? '50', 'pageSize', 50),
    ...(active !== null ? { active: active === 'true' } : {}),
  };
}
export function pageMetadata(
  totalItems: number,
  query: PageQuery,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  const accessible = Math.min(totalItems, maximum);
  return {
    kind: 'PAGE' as const,
    page: query.page,
    pageSize: query.pageSize,
    totalItems,
    totalPages: Math.ceil(accessible / query.pageSize),
    hasMore: query.page * query.pageSize < accessible,
    truncated: totalItems > maximum,
  };
}
export interface PublicQuery extends CursorQuery {
  page: number;
  q?: string;
}
export function publicQuery(request: Request, search = false): PublicQuery {
  const query = queryValues(
    request,
    [
      'pageSize',
      'categoryId',
      'authorId',
      'tagIds',
      ...(search ? ['q', 'page'] : ['cursor']),
    ],
    ['tagIds'],
  );
  const filters: CursorQuery['filters'] = {};
  for (const key of ['categoryId', 'authorId']) {
    const value = query.get(key);
    if (value !== null) filters[key] = uuidInput(value, key, 'query');
  }
  const tags = query
    .getAll('tagIds')
    .map((id) => uuidInput(id, 'tagIds', 'query'));
  if (tags.length > 5 || new Set(tags).size !== tags.length)
    return invalidInput('/tagIds', 'query');
  if (tags.length) filters.tagIds = tags.sort().join(',');
  const cursor = query.get('cursor');
  if (cursor !== null && (!cursor.length || cursor.length > 2048))
    return invalidInput('/cursor', 'query');
  const q = query.get('q');
  if (search && (!boundedText(q, 200) || !q.trim()))
    return invalidInput('/q', 'query');
  return {
    pageSize: positive(query.get('pageSize') ?? '20', 'pageSize', 50),
    page: positive(query.get('page') ?? '1', 'page', Number.MAX_SAFE_INTEGER),
    filters,
    ...(cursor !== null ? { cursor } : {}),
    ...(q !== null ? { q: q.trim() } : {}),
    order: 'PUBLISHED_DESC_ID_ASC',
  };
}
export function slugInput(value: string, field: 'slug' | 'handle'): string {
  if (value.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    return invalidInput('/' + field, 'path');
  return value;
}
