import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import type { Transaction } from '../../modules/members/members.repository.js';
import { ApiError } from '../errors/api-error.js';
export function semanticHash(value: unknown): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, part]) => [key, canonical(part)]),
      );
    return value;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export const ADMIN_STATE_LOCK = 78201902;
export async function lockAdministrativeState(tx: Transaction): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_STATE_LOCK}::bigint)`;
}
export interface OperationScope {
  identityUid: string;
  method: string;
  route: string;
  key: string;
}
export interface OperationResult<T> {
  data: T;
  version: number;
  status: number;
  location?: string;
  replayed: boolean;
  expiresAt: string;
}
export async function lockOperation(
  tx: Transaction,
  scope: OperationScope,
): Promise<void> {
  const rows = await tx.$queryRaw<
    { locked: boolean }[]
  >`SELECT pg_try_advisory_xact_lock(
    hashtextextended(${JSON.stringify([scope.identityUid, scope.method, scope.route, scope.key])}, 0)) AS locked`;
  if (!rows[0]?.locked)
    throw new ApiError(
      409,
      'IDEMPOTENCY_IN_PROGRESS',
      'Operation in progress',
      'Retry the identical request later.',
      [],
      null,
      1,
    );
}
export async function replayOperation<T>(
  tx: Transaction,
  scope: OperationScope,
  hash: string,
  now: Date,
): Promise<OperationResult<T> | null> {
  const unique = { identityUid_method_route_key: scope };
  const record = await tx.idempotencyRecord.findUnique({ where: unique });
  if (!record) return null;
  if (record.expiresAt <= now) {
    await tx.idempotencyRecord.delete({ where: unique });
    return null;
  }
  if (record.requestHash !== hash)
    throw new ApiError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'Operation key reused',
      'Use a new key for changed input.',
    );
  if (!record.result || record.statusCode === null)
    throw new ApiError(
      409,
      'IDEMPOTENCY_IN_PROGRESS',
      'Operation in progress',
      'Retry the identical request later.',
      [],
      null,
      1,
    );
  const result = record.result as unknown as {
    data: T;
    version: number;
    location?: string;
  };
  return {
    ...result,
    status: record.statusCode,
    replayed: true,
    expiresAt: record.expiresAt.toISOString(),
  };
}
export async function finishOperation<T>(
  tx: Transaction,
  scope: OperationScope,
  hash: string,
  now: Date,
  result: { data: T; version: number; status: number; location?: string },
  persistedData: T = result.data,
): Promise<OperationResult<T>> {
  const expiresAt = new Date(now.getTime() + 86_400_000);
  const saved = {
    data: persistedData,
    version: result.version,
    ...(result.location ? { location: result.location } : {}),
  };
  await tx.idempotencyRecord.create({
    data: {
      ...scope,
      requestHash: hash,
      result: saved as unknown as Prisma.InputJsonValue,
      statusCode: result.status,
      expiresAt,
    },
  });
  return {
    data: result.data,
    version: result.version,
    status: result.status,
    ...(result.location ? { location: result.location } : {}),
    replayed: false,
    expiresAt: expiresAt.toISOString(),
  };
}
export function nextVersion(version: number): number {
  if (version >= 2147483647)
    throw new ApiError(
      409,
      'RESOURCE_QUOTA_EXCEEDED',
      'Version limit reached',
      'This resource cannot be changed.',
    );
  return version + 1;
}
export function expectVersion(
  type: string,
  id: string,
  current: number,
  expected: number,
): void {
  if (current !== expected)
    throw new ApiError(
      412,
      'VERSION_CONFLICT',
      'Resource changed',
      'Fetch the current resource before resolving this conflict.',
      [],
      {
        resourceType: type,
        resourceId: id,
        expectedVersion: expected,
        currentVersion: current,
        changedFields: [],
      },
    );
}
