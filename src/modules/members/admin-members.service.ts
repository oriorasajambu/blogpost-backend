import { Inject, Injectable } from '@nestjs/common';
import { AdminOperations } from './admin-operations.js';
import { toAdminMember, type MemberRole } from './member.js';
import type { VerifiedIdentity } from '../identity/identity.js';
import {
  CursorService,
  afterCursor,
  type CursorQuery,
} from '../../platform/http/cursor.js';
import { invalidInput, objectInput } from '../../platform/http/input.js';
import { ApiError } from '../../platform/errors/api-error.js';
import {
  expectVersion,
  nextVersion,
} from '../../platform/database/operation.js';
export interface MemberPatch {
  role?: MemberRole;
  active?: boolean;
}
export function memberPatch(value: unknown): MemberPatch {
  const body = objectInput(value, ['role', 'active']);
  if (!Object.keys(body).length) return invalidInput('');
  if (
    Object.hasOwn(body, 'role') &&
    (typeof body.role !== 'string' ||
      !['AUTHOR', 'EDITOR', 'ADMIN'].includes(body.role))
  )
    return invalidInput('/role');
  if (Object.hasOwn(body, 'active') && typeof body.active !== 'boolean')
    return invalidInput('/active');
  return body as MemberPatch;
}
@Injectable()
export class AdminMembersService {
  constructor(
    @Inject(AdminOperations) private readonly operations: AdminOperations,
    @Inject(CursorService) private readonly cursors: CursorService,
  ) {}
  list(identity: VerifiedIdentity, query: CursorQuery) {
    return this.operations.read(identity, async (tx) => {
      const point = this.cursors.decode(
        identity.uid,
        '/v1/admin/members',
        query,
      );
      const rows = await tx.member.findMany({
        where: { ...query.filters, ...afterCursor(point) },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.pageSize + 1,
      });
      const page = this.cursors.page(
        identity.uid,
        '/v1/admin/members',
        query,
        rows,
      );
      return {
        data: page.rows.map(toAdminMember),
        pagination: page.pagination,
      };
    });
  }
  get(identity: VerifiedIdentity, id: string) {
    return this.operations.read(identity, async (tx) => {
      const member = await tx.member.findUnique({ where: { id } });
      if (!member)
        throw new ApiError(
          404,
          'RESOURCE_NOT_FOUND',
          'Member unavailable',
          'The member is unavailable.',
        );
      return toAdminMember(member);
    });
  }
  update(
    identity: VerifiedIdentity,
    id: string,
    input: MemberPatch,
    expectedVersion: number,
    key: string,
    traceId: string,
  ) {
    return this.operations.write(
      identity,
      {
        method: 'PATCH',
        route: `/v1/admin/members/${id}`,
        body: input,
        expectedVersion,
        key,
      },
      async (tx, actor) => {
        await tx.$queryRaw`SELECT id FROM blogpost."Member" WHERE id = ${id}::uuid FOR UPDATE`;
        const member = await tx.member.findUnique({ where: { id } });
        if (!member)
          throw new ApiError(
            404,
            'RESOURCE_NOT_FOUND',
            'Member unavailable',
            'The member is unavailable.',
          );
        expectVersion('MEMBER', id, member.version, expectedVersion);
        const role = input.role ?? member.role;
        const active = input.active ?? member.active;
        if (
          member.role === 'ADMIN' &&
          member.active &&
          (role !== 'ADMIN' || !active) &&
          (await tx.member.count({ where: { role: 'ADMIN', active: true } })) <=
            1
        )
          throw new ApiError(
            409,
            'LAST_ADMIN_REQUIRED',
            'Administrator required',
            'Keep at least one active administrator.',
          );
        const fields = Object.keys(input)
          .filter(
            (field) =>
              member[field as keyof MemberPatch] !==
              input[field as keyof MemberPatch],
          )
          .sort();
        let result = member;
        if (fields.length) {
          result = await tx.member.update({
            where: { id },
            data: { role, active, version: nextVersion(member.version) },
          });
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: 'MEMBER_UPDATED',
              subjectType: 'MEMBER',
              subjectId: id,
              traceId,
              changes: {
                fields,
                ...(role !== member.role
                  ? { role: { from: member.role, to: role } }
                  : {}),
                ...(active !== member.active
                  ? { active: { from: member.active, to: active } }
                  : {}),
              },
            },
          });
        }
        return {
          data: toAdminMember(result),
          version: result.version,
          status: 200,
        };
      },
    );
  }
}
