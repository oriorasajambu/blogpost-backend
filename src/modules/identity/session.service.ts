import { Inject, Injectable } from '@nestjs/common';
import { IdentityService } from './identity.service.js';
import { MembershipService } from '../members/membership.service.js';
import {
  MembersRepository,
  databaseFailure,
} from '../members/members.repository.js';
import {
  consumeRate,
  transactionTime,
} from '../../platform/database/rate-limits.js';
import { toMe } from '../members/member.js';

@Injectable()
export class SessionService {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(MembershipService) private readonly membership: MembershipService,
    @Inject(MembersRepository) private readonly members: MembersRepository,
  ) {}
  async exchange(token: string, traceId: string) {
    const identity = await this.identity.recentIdentity(token);
    await this.membership.current(identity, traceId);
    try {
      await this.members.database.prisma.$transaction(
        async (tx) => {
          const member = await this.members.lock(tx, identity.uid);
          await consumeRate(
            tx,
            member.id,
            'IDENTITY',
            await transactionTime(tx),
          );
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
    // No provider request runs inside a SQL transaction, and no session value is persisted.
    const session = await this.identity.createSession(token, identity);
    try {
      const member = await this.members.database.prisma.$transaction(
        async (tx) => {
          const member = await this.members.lock(tx, session.identity.uid);
          await tx.auditEvent.create({
            data: {
              actorId: member.id,
              action: 'WEB_SESSION_CREATED',
              subjectType: 'MEMBER',
              subjectId: member.id,
              traceId,
              changes: {},
            },
          });
          return member;
        },
        { maxWait: 3000, timeout: 5000 },
      );
      return {
        sessionCookie: session.sessionCookie,
        expiresAt: session.expiresAt,
        member: toMe(member),
      };
    } catch (error) {
      return databaseFailure(error);
    }
  }
}
