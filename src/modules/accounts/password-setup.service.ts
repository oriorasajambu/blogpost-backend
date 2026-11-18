import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { consumeRate } from '../../platform/database/rate-limits.js';
import { ApiError } from '../../platform/errors/api-error.js';
import { accountActionUrl } from '../email/account-email.js';
import { EmailOutboxService } from '../email/email-outbox.service.js';
import {
  IDENTITY_GATEWAY,
  type IdentityGateway,
  type VerifiedIdentity,
} from '../identity/identity.js';
import { AdminOperations } from '../members/admin-operations.js';

export interface PasswordSetupResult {
  /** Links queued for members who have no password yet. */
  queued: number;
  /** Members left alone: they already have a password, or their account is unavailable. */
  skipped: number;
}
/** One call covers a staff-sized membership; a larger one must be handled in batches by an operator. */
const MAX_MEMBERS = 200;

/**
 * Migration from Google sign-in: emails every active member who still has no password a one-time
 * link to choose one. The account (and so every post) is kept: the password is added to the same
 * identity. Members may equally use "Forgot your password?" themselves.
 */
@Injectable()
export class PasswordSetupService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(IDENTITY_GATEWAY) private readonly gateway: IdentityGateway,
    @Inject(AdminOperations) private readonly operations: AdminOperations,
    @Inject(EmailOutboxService) private readonly outbox: EmailOutboxService,
  ) {}
  async sendAll(
    identity: VerifiedIdentity,
    traceId: string,
  ): Promise<PasswordSetupResult> {
    if (!this.outbox.enabled)
      throw new ApiError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Email unavailable',
        'Password setup links need email delivery to be configured.',
      );
    const { actorId, members } = await this.operations.read(
      identity,
      async (tx, actor, now) => {
        await consumeRate(tx, actor.id, 'IDENTITY', now);
        const rows = await tx.member.findMany({
          where: { status: 'ACTIVE' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: MAX_MEMBERS + 1,
          select: { id: true, email: true, identityUid: true },
        });
        return { actorId: actor.id, members: rows };
      },
    );
    if (members.length > MAX_MEMBERS)
      throw new ApiError(
        409,
        'RESOURCE_QUOTA_EXCEEDED',
        'Too many members',
        'Send password setup links in batches.',
      );
    // Provider requests happen outside any SQL transaction.
    const due: { id: string; email: string; code: string }[] = [];
    let skipped = 0;
    for (const member of members) {
      const user = await this.gateway.findByEmail(member.email);
      if (
        !user ||
        user.uid !== member.identityUid ||
        user.disabled ||
        user.passwordProviders.length > 0
      ) {
        skipped++;
        continue;
      }
      due.push({
        id: member.id,
        email: member.email,
        code: await this.gateway.actionCode('PASSWORD_RESET', member.email),
      });
    }
    const queued: string[] = [];
    await this.operations.read(identity, async (tx, actor, now) => {
      for (const item of due) {
        const id = await this.outbox.enqueueAccount(
          tx,
          item.id,
          'PASSWORD_SET',
          item.email,
          {
            actionUrl: accountActionUrl(
              this.config.webOrigin,
              'PASSWORD_SET',
              item.code,
            ),
            detail: null,
          },
          now,
        );
        if (id) queued.push(id);
        else skipped++;
      }
      await tx.auditEvent.create({
        data: {
          actorId,
          action: 'PASSWORD_SETUP_SENT',
          subjectType: 'MEMBER',
          subjectId: actor.id,
          changes: { queued: queued.length, skipped },
          traceId,
        },
      });
    });
    for (const id of queued) await this.outbox.sendNow(id, traceId);
    return { queued: queued.length, skipped };
  }
}
