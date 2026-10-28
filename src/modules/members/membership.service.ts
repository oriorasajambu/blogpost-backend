import { Inject, Injectable } from '@nestjs/common';
import type { VerifiedIdentity } from '../identity/identity.js';
import {
  activeMember,
  databaseFailure,
  MembersRepository,
} from './members.repository.js';
import type { MemberRow } from './member.js';
import { ApiError } from '../../platform/errors/api-error.js';
import { lockAdministrativeState } from '../../platform/database/operation.js';

@Injectable()
export class MembershipService {
  constructor(
    @Inject(MembersRepository) private readonly members: MembersRepository,
  ) {}
  async current(
    identity: VerifiedIdentity,
    traceId: string,
  ): Promise<MemberRow> {
    const member = activeMember(await this.members.find(identity.uid));
    if (member.email === identity.email) return member;
    // A refreshed verified provider email is private member state, not a new membership grant.
    try {
      return await this.members.database.prisma.$transaction(
        async (tx) => {
          await lockAdministrativeState(tx);
          const current = await this.members.lock(tx, identity.uid);
          if (current.email === identity.email) return current;
          if (current.version === 2147483647)
            throw new ApiError(
              409,
              'RESOURCE_QUOTA_EXCEEDED',
              'Version limit reached',
              'The profile cannot be changed.',
            );
          const updated = await tx.member.update({
            where: { id: current.id },
            data: { email: identity.email, version: { increment: 1 } },
          });
          await tx.auditEvent.create({
            data: {
              actorId: current.id,
              action: 'IDENTITY_EMAIL_UPDATED',
              subjectType: 'MEMBER',
              subjectId: current.id,
              changes: { fields: ['email'] },
              traceId,
            },
          });
          return updated;
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
}
