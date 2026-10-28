import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import { ApiError } from '../../platform/errors/api-error.js';
import type { MemberRow } from './member.js';

export type Transaction = Prisma.TransactionClient;
export const memberSelection = {
  id: true,
  identityUid: true,
  email: true,
  displayName: true,
  handle: true,
  bio: true,
  role: true,
  active: true,
  version: true,
} as const;
export function activeMember(member: MemberRow | null | undefined): MemberRow {
  if (!member)
    throw new ApiError(
      403,
      'INSUFFICIENT_PERMISSION',
      'Staff access required',
      'An invitation is required for staff access.',
    );
  if (!member.active)
    throw new ApiError(
      403,
      'ACCESS_REVOKED',
      'Staff access disabled',
      'Staff access is unavailable.',
    );
  return member;
}
export function databaseFailure(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const code = (error as { code?: string })?.code;
  const meta = (
    error as {
      meta?: {
        code?: string;
        driverAdapterError?: { cause?: { originalCode?: string } };
      };
    }
  )?.meta;
  const postgresCode =
    meta?.code ?? meta?.driverAdapterError?.cause?.originalCode;
  if (
    ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034'].includes(
      code ?? '',
    ) ||
    (['P2010', 'P2039'].includes(code ?? '') &&
      [
        '40001',
        '40P01',
        '55P03',
        '57014',
        '53300',
        '57P01',
        '57P02',
        '57P03',
      ].includes(postgresCode ?? ''))
  )
    throw new ApiError(
      503,
      'DEPENDENCY_UNAVAILABLE',
      'Database unavailable',
      'Retry the same operation after the dependency recovers.',
      [],
      null,
      1,
    );
  throw error;
}

@Injectable()
export class MembersRepository {
  constructor(@Inject(DatabaseService) readonly database: DatabaseService) {}
  async find(uid: string): Promise<MemberRow | null> {
    try {
      return await this.database.prisma.member.findUnique({
        where: { identityUid: uid },
        select: memberSelection,
      });
    } catch (error) {
      return databaseFailure(error);
    }
  }
  async lock(tx: Transaction, uid: string): Promise<MemberRow> {
    const rows = await tx.$queryRaw<
      MemberRow[]
    >`SELECT id, "identityUid", email, "displayName", handle,
      bio, role::text AS role, active, version FROM blogpost."Member" WHERE "identityUid" = ${uid} FOR UPDATE`;
    return activeMember(rows[0]);
  }
}
