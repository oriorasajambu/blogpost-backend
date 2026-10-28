import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { ApiError } from '../../platform/errors/api-error.js';
import { objectInput, invalidInput } from '../../platform/http/input.js';
import {
  CursorService,
  afterCursor,
  type CursorQuery,
} from '../../platform/http/cursor.js';
import { AdminOperations } from '../members/admin-operations.js';
import {
  MembersRepository,
  activeMember,
  databaseFailure,
  type Transaction,
} from '../members/members.repository.js';
import { toMe, type Me, type MemberRole } from '../members/member.js';
import type { VerifiedIdentity } from '../identity/identity.js';
import { normalizeIdentityEmail } from '../identity/identity.service.js';
import {
  lockAdministrativeState,
  lockOperation,
  replayOperation,
  finishOperation,
  semanticHash,
  expectVersion,
  nextVersion,
  type OperationScope,
} from '../../platform/database/operation.js';
import {
  transactionTime,
  consumeRate,
} from '../../platform/database/rate-limits.js';

export interface InvitationInput {
  email: string;
  role: MemberRole;
}
export function invitationInput(value: unknown): InvitationInput {
  const body = objectInput(value, ['email', 'role'], ['email', 'role']);
  let email: string;
  try {
    email = normalizeIdentityEmail(body.email);
  } catch {
    return invalidInput('/email');
  }
  if (
    typeof body.role !== 'string' ||
    !['AUTHOR', 'EDITOR', 'ADMIN'].includes(body.role)
  )
    return invalidInput('/role');
  return { email, role: body.role as MemberRole };
}
export function invitationToken(value: unknown): string {
  const body = objectInput(value, ['token'], ['token']);
  if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token))
    return invalidInput('/token');
  return body.token;
}
const selection = {
  issuer: { select: { id: true, handle: true, displayName: true } },
} as const;
type InvitationRow = Prisma.InvitationGetPayload<{ include: typeof selection }>;
export function invitationDto(row: InvitationRow, now: Date) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.acceptedAt
      ? 'ACCEPTED'
      : row.revokedAt
        ? 'REVOKED'
        : row.expiresAt <= now
          ? 'EXPIRED'
          : 'PENDING',
    version: row.version,
    issuedBy: row.issuer,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
function used(row: InvitationRow, now: Date): void {
  const code = row.acceptedAt
    ? 'INVITATION_USED'
    : row.revokedAt
      ? 'INVITATION_REVOKED'
      : row.expiresAt <= now
        ? 'INVITATION_EXPIRED'
        : null;
  if (code)
    throw new ApiError(
      410,
      code,
      'Invitation unavailable',
      'Request a current invitation from an administrator.',
    );
}
@Injectable()
export class InvitationService {
  constructor(
    @Inject(AdminOperations) private readonly operations: AdminOperations,
    @Inject(MembersRepository) private readonly members: MembersRepository,
    @Inject(CursorService) private readonly cursors: CursorService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  list(identity: VerifiedIdentity, query: CursorQuery) {
    return this.operations.read(identity, async (tx, _actor, now) => {
      const status = query.filters.status;
      const where: Prisma.InvitationWhereInput =
        status === 'ACCEPTED'
          ? { acceptedAt: { not: null } }
          : status === 'REVOKED'
            ? { revokedAt: { not: null } }
            : status === 'PENDING' || status === 'EXPIRED'
              ? {
                  acceptedAt: null,
                  revokedAt: null,
                  expiresAt: status === 'PENDING' ? { gt: now } : { lte: now },
                }
              : {};
      const rows = await tx.invitation.findMany({
        where: {
          ...where,
          ...afterCursor(
            this.cursors.decode(identity.uid, '/v1/admin/invitations', query),
          ),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.pageSize + 1,
        include: selection,
      });
      const page = this.cursors.page(
        identity.uid,
        '/v1/admin/invitations',
        query,
        rows,
      );
      return {
        data: page.rows.map((row) => invitationDto(row, now)),
        pagination: page.pagination,
      };
    });
  }
  get(identity: VerifiedIdentity, id: string) {
    return this.operations.read(identity, async (tx, _actor, now) =>
      invitationDto(await this.row(tx, id), now),
    );
  }
  private async row(tx: Transaction, id: string): Promise<InvitationRow> {
    const row = await tx.invitation.findUnique({
      where: { id },
      include: selection,
    });
    if (!row)
      throw new ApiError(
        404,
        'RESOURCE_NOT_FOUND',
        'Invitation unavailable',
        'The invitation is unavailable.',
      );
    return row;
  }
  private async issue(
    tx: Transaction,
    actorId: string,
    input: InvitationInput,
    now: Date,
  ) {
    if (
      await tx.member.findFirst({
        where: { email: { equals: input.email, mode: 'insensitive' } },
        select: { id: true },
      })
    )
      throw new ApiError(
        409,
        'MEMBER_ALREADY_EXISTS',
        'Member exists',
        'Use the existing member controls.',
      );
    if (
      await tx.invitation.findFirst({
        where: { email: input.email, acceptedAt: null, revokedAt: null },
        select: { id: true },
      })
    )
      throw new ApiError(
        409,
        'WORKFLOW_CONFLICT',
        'Invitation exists',
        'Reissue or revoke the existing invitation first.',
      );
    const token = randomBytes(32).toString('base64url');
    const row = await tx.invitation.create({
      data: {
        email: input.email,
        role: input.role,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        issuerId: actorId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      },
      include: selection,
    });
    const invitation = invitationDto(row, now);
    return {
      invitation,
      inviteUrl:
        `${this.config.webOrigin}/invitations/accept?token=${token}` as
          string | null,
      linkAvailable: true,
    };
  }
  create(
    identity: VerifiedIdentity,
    input: InvitationInput,
    key: string,
    traceId: string,
  ) {
    return this.operations.write(
      identity,
      {
        method: 'POST',
        route: '/v1/admin/invitations',
        key,
        body: input,
        identityLimit: true,
      },
      async (tx, actor, now) => {
        const data = await this.issue(tx, actor.id, input, now);
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: 'INVITATION_CREATED',
            subjectType: 'INVITATION',
            subjectId: data.invitation.id,
            changes: { fields: ['email', 'role'] },
            traceId,
          },
        });
        return {
          data,
          persistedData: { ...data, inviteUrl: null, linkAvailable: false },
          version: data.invitation.version,
          status: 201,
          location: `/v1/admin/invitations/${data.invitation.id}`,
        };
      },
    );
  }
  change(
    identity: VerifiedIdentity,
    id: string,
    action: 'revoke' | 'reissue',
    expectedVersion: number,
    key: string,
    traceId: string,
  ) {
    return this.operations.write<
      | ReturnType<typeof invitationDto>
      | Awaited<ReturnType<InvitationService['issue']>>
    >(
      identity,
      {
        method: 'POST',
        route: `/v1/admin/invitations/${id}/${action}`,
        key,
        body: {},
        expectedVersion,
        identityLimit: true,
      },
      async (tx, actor, now) => {
        // All invitation membership mutations share the administrative lock, including acceptance.
        const row = await this.row(tx, id);
        expectVersion('INVITATION', id, row.version, expectedVersion);
        if (row.acceptedAt)
          throw new ApiError(
            410,
            'INVITATION_USED',
            'Invitation used',
            'Use the member controls.',
          );
        if (action === 'reissue') {
          await tx.invitation.update({
            where: { id },
            data: {
              revokedAt: row.revokedAt ?? now,
              version: nextVersion(row.version),
            },
          });
          const data = await this.issue(
            tx,
            actor.id,
            { email: row.email, role: row.role },
            now,
          );
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: 'INVITATION_REISSUED',
              subjectType: 'INVITATION',
              subjectId: id,
              changes: { replacementInvitationId: data.invitation.id },
              traceId,
            },
          });
          return {
            data,
            persistedData: { ...data, inviteUrl: null, linkAvailable: false },
            version: data.invitation.version,
            status: 201,
            location: `/v1/admin/invitations/${data.invitation.id}`,
          };
        }
        const result = row.revokedAt
          ? row
          : await tx.invitation.update({
              where: { id },
              data: { revokedAt: now, version: nextVersion(row.version) },
              include: selection,
            });
        if (!row.revokedAt)
          await tx.auditEvent.create({
            data: {
              actorId: actor.id,
              action: 'INVITATION_REVOKED',
              subjectType: 'INVITATION',
              subjectId: id,
              changes: { fields: ['revokedAt'] },
              traceId,
            },
          });
        return {
          data: invitationDto(result, now),
          version: result.version,
          status: 200,
        };
      },
    );
  }
  async accept(
    identity: VerifiedIdentity,
    token: string,
    key: string,
    traceId: string,
  ) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const scope: OperationScope = {
      identityUid: identity.uid,
      method: 'POST',
      route: '/v1/invitations/accept',
      key,
    };
    // Only a one-way token digest participates in operation identity; no credential is saved.
    const hash = semanticHash({ tokenHash });
    try {
      return await this.members.database.prisma.$transaction(
        async (tx) => {
          await lockOperation(tx, scope);
          await lockAdministrativeState(tx);
          const existing = await tx.member.findUnique({
            where: { identityUid: identity.uid },
          });
          if (existing) activeMember(existing);
          const row = await tx.invitation.findUnique({
            where: { tokenHash },
            include: selection,
          });
          if (!row)
            throw new ApiError(
              404,
              'INVITATION_INVALID',
              'Invitation unavailable',
              'Request a current invitation.',
            );
          if (row.email !== identity.email)
            throw new ApiError(
              403,
              'INVITATION_ACCOUNT_MISMATCH',
              'Different Google account required',
              'Sign in with the invited account.',
            );
          const now = await transactionTime(tx);
          // A successful replay is authorized only for the still-active member bound to this acceptance.
          const replay = await replayOperation<Me>(tx, scope, hash, now);
          if (replay) {
            if (!existing || row.acceptedById !== existing.id)
              throw new ApiError(
                403,
                'INSUFFICIENT_PERMISSION',
                'Invitation unavailable',
                'Staff access is unavailable.',
              );
            return replay;
          }
          used(row, now);
          if (
            existing ||
            (await tx.member.findFirst({
              where: { email: { equals: identity.email, mode: 'insensitive' } },
            }))
          )
            throw new ApiError(
              409,
              'MEMBER_ALREADY_EXISTS',
              'Member exists',
              'Use the existing member controls.',
            );
          const id = randomUUID();
          // Display name is an editable safe initial value; the stable handle is independent of email/UID.
          const member = await tx.member.create({
            data: {
              id,
              identityUid: identity.uid,
              email: identity.email,
              displayName: 'Staff member',
              handle: `member-${id}`,
              role: row.role,
            },
          });
          await consumeRate(tx, member.id, 'IDENTITY', now);
          await tx.invitation.update({
            where: { id: row.id },
            data: {
              acceptedAt: now,
              acceptedById: id,
              version: nextVersion(row.version),
            },
          });
          await tx.auditEvent.create({
            data: {
              actorId: id,
              action: 'INVITATION_ACCEPTED',
              subjectType: 'INVITATION',
              subjectId: row.id,
              changes: { memberId: id },
              traceId,
            },
          });
          return finishOperation(tx, scope, hash, now, {
            data: toMe(member),
            version: member.version,
            status: 200,
          });
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
}
