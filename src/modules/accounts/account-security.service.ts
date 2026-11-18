import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import {
  consumeRate,
  transactionTime,
} from '../../platform/database/rate-limits.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import { ApiError } from '../../platform/errors/api-error.js';
import { invalidInput, objectInput } from '../../platform/http/input.js';
import {
  BreachCheck,
  checkedPassword,
} from '../../platform/security/password-policy.js';
import { EmailOutboxService } from '../email/email-outbox.service.js';
import { accountActionUrl } from '../email/account-email.js';
import {
  IDENTITY_GATEWAY,
  type IdentityGateway,
  type VerifiedIdentity,
} from '../identity/identity.js';
import {
  IdentityService,
  normalizeIdentityEmail,
} from '../identity/identity.service.js';
import {
  databaseFailure,
  MembersRepository,
} from '../members/members.repository.js';
import type { Accepted } from './accounts.service.js';

const ACCEPTED: Accepted = { status: 'ACCEPTED' };

/**
 * Changes a signed-in member makes to their own credentials. Each needs proof that the password
 * was just entered (a fresh ID token for the same account), so a stolen session alone is not
 * enough to take over the account.
 */
@Injectable()
export class AccountSecurityService {
  /** Replaceable in tests. */
  breach = new BreachCheck();
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(IDENTITY_GATEWAY) private readonly gateway: IdentityGateway,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(MembersRepository) private readonly members: MembersRepository,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EmailOutboxService) private readonly outbox: EmailOutboxService,
  ) {}
  private async recent(
    session: VerifiedIdentity,
    idToken: unknown,
  ): Promise<VerifiedIdentity> {
    if (typeof idToken !== 'string') return invalidInput('/idToken');
    const proof = await this.identity.recentIdentity(idToken);
    if (proof.uid !== session.uid)
      throw new ApiError(
        403,
        'INSUFFICIENT_PERMISSION',
        'Different account',
        'Confirm with the account you are signed in to.',
      );
    return proof;
  }
  /** Rate-limits the member, then returns their row inside one short transaction. */
  private async begin(uid: string) {
    try {
      return await this.members.database.prisma.$transaction(
        async (tx) => {
          const member = await this.members.lock(tx, uid);
          await consumeRate(
            tx,
            member.id,
            'IDENTITY',
            await transactionTime(tx),
          );
          return member;
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
  async changePassword(
    session: VerifiedIdentity,
    value: unknown,
    traceId: string,
  ): Promise<Accepted> {
    const body = objectInput(
      value,
      ['idToken', 'newPassword'],
      ['idToken', 'newPassword'],
    );
    const proof = await this.recent(session, body.idToken);
    const password = checkedPassword(body.newPassword, '/newPassword');
    await this.breach.assertNotBreached(password, '/newPassword');
    const member = await this.begin(session.uid);
    await this.gateway.setPassword(session.uid, password);
    // Every session ends, this one included: the member signs in again with the new password.
    await this.gateway.revokeSessions(session.uid);
    const outboxId = await this.database.prisma.$transaction(
      async (tx) => {
        await tx.auditEvent.create({
          data: {
            actorId: member.id,
            action: 'PASSWORD_CHANGED',
            subjectType: 'MEMBER',
            subjectId: member.id,
            changes: {},
            traceId,
          },
        });
        return this.outbox.enqueueAccount(
          tx,
          member.id,
          'PASSWORD_CHANGED_NOTICE',
          proof.email,
          { actionUrl: null, detail: null },
          await transactionTime(tx),
        );
      },
      { maxWait: 3000, timeout: 5000 },
    );
    if (outboxId) await this.outbox.sendNow(outboxId, traceId);
    return ACCEPTED;
  }
  /**
   * Starts an email change: a confirmation link goes to the new address and a notice to the old
   * one. Nothing changes until the new address is confirmed; the member row follows on the next
   * sign-in, which the provider forces by invalidating the old credential.
   */
  async requestEmailChange(
    session: VerifiedIdentity,
    value: unknown,
    traceId: string,
  ): Promise<Accepted> {
    const body = objectInput(
      value,
      ['idToken', 'newEmail'],
      ['idToken', 'newEmail'],
    );
    const proof = await this.recent(session, body.idToken);
    let newEmail: string;
    try {
      newEmail = normalizeIdentityEmail(body.newEmail);
    } catch {
      return invalidInput('/newEmail');
    }
    if (newEmail === proof.email) return invalidInput('/newEmail');
    if (!this.outbox.enabled)
      throw new ApiError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Email change unavailable',
        'Changing the email address is not available yet.',
      );
    const member = await this.begin(session.uid);
    // An address that already has an account is answered like any other, without a link.
    if (await this.gateway.findByEmail(newEmail)) return ACCEPTED;
    const code = await this.gateway.actionCode(
      'EMAIL_CHANGE',
      proof.email,
      newEmail,
    );
    const ids = await this.database.prisma.$transaction(
      async (tx) => {
        const now = await transactionTime(tx);
        await tx.auditEvent.create({
          data: {
            actorId: member.id,
            action: 'EMAIL_CHANGE_REQUESTED',
            subjectType: 'MEMBER',
            subjectId: member.id,
            changes: {},
            traceId,
          },
        });
        return [
          await this.outbox.enqueueAccount(
            tx,
            member.id,
            'EMAIL_CHANGE_VERIFY',
            newEmail,
            {
              actionUrl: accountActionUrl(
                this.config.webOrigin,
                'EMAIL_CHANGE_VERIFY',
                code,
              ),
              detail: proof.email,
            },
            now,
          ),
          await this.outbox.enqueueAccount(
            tx,
            member.id,
            'EMAIL_CHANGE_NOTICE',
            proof.email,
            { actionUrl: null, detail: newEmail },
            now,
          ),
        ];
      },
      { maxWait: 3000, timeout: 5000 },
    );
    for (const id of ids) if (id) await this.outbox.sendNow(id, traceId);
    return ACCEPTED;
  }
}
