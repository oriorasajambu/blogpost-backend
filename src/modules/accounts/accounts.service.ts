import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import {
  consumeAnonymousRate,
  transactionTime,
} from '../../platform/database/rate-limits.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import { ApiError } from '../../platform/errors/api-error.js';
import { invalidInput, objectInput } from '../../platform/http/input.js';
import {
  BreachCheck,
  checkedPassword,
} from '../../platform/security/password-policy.js';
import { CaptchaVerifier } from '../../platform/security/captcha.js';
import { EmailOutboxService } from '../email/email-outbox.service.js';
import {
  accountActionUrl,
  type AccountEmailKind,
} from '../email/account-email.js';
import {
  IDENTITY_GATEWAY,
  type IdentityGateway,
} from '../identity/identity.js';
import { normalizeIdentityEmail } from '../identity/identity.service.js';
import {
  databaseFailure,
  type Transaction,
} from '../members/members.repository.js';

export interface Accepted {
  status: 'ACCEPTED';
}
const ACCEPTED: Accepted = { status: 'ACCEPTED' };
/** Per address and across the whole service, per hour. */
const REGISTER_LIMITS = { perAddress: 5, overall: 300 } as const;
const RESEND_LIMITS = { perAddress: 3, overall: 300 } as const;
const FORGOT_LIMITS = { perAddress: 3, overall: 300 } as const;
const RESET_OVERALL_PER_HOUR = 600;
const CODE = /^[A-Za-z0-9_-]{16,512}$/;

/**
 * Public account flows. Every outcome that depends on whether an address is already registered
 * returns the same body, and limits are applied silently, so these routes cannot be used to probe
 * for accounts.
 */
@Injectable()
export class AccountsService {
  /** Replaceable in tests. */
  breach = new BreachCheck();
  captcha: CaptchaVerifier;
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(IDENTITY_GATEWAY) private readonly gateway: IdentityGateway,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EmailOutboxService) private readonly outbox: EmailOutboxService,
  ) {
    this.captcha = new CaptchaVerifier(config.captchaSecret);
  }
  /** Registration needs email delivery, and in the cloud also a captcha secret. */
  get enabled(): boolean {
    return (
      this.outbox.enabled &&
      (this.config.environment === 'development' ||
        this.config.captchaSecret !== null)
    );
  }
  /** Completing a reset needs the API key as well as email delivery for the notice. */
  get resetEnabled(): boolean {
    return this.outbox.enabled && this.config.identityWebApiKey !== null;
  }
  private assertEnabled(): void {
    if (!this.enabled)
      throw new ApiError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Registration unavailable',
        'Account registration is not available yet.',
      );
  }
  private email(value: unknown): string {
    try {
      return normalizeIdentityEmail(value);
    } catch {
      return invalidInput('/email');
    }
  }
  private async allowed(
    prefix: 'REGISTER' | 'RESEND' | 'FORGOT',
    email: string,
    limits: { perAddress: number; overall: number },
  ): Promise<boolean> {
    try {
      return await this.database.prisma.$transaction(
        async (tx) => {
          const now = await transactionTime(tx);
          const overall = await consumeAnonymousRate(
            tx,
            `${prefix}_ALL`,
            'all',
            now,
            limits.overall,
          );
          const address = await consumeAnonymousRate(
            tx,
            `${prefix}_EMAIL`,
            email,
            now,
            limits.perAddress,
          );
          return overall && address;
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
  async register(value: unknown, traceId: string): Promise<Accepted> {
    this.assertEnabled();
    const body = objectInput(
      value,
      ['email', 'password', 'captchaToken'],
      ['email', 'password'],
    );
    const email = this.email(body.email);
    const password = checkedPassword(body.password);
    await this.captcha.assert(body.captchaToken, null);
    await this.breach.assertNotBreached(password);
    if (!(await this.allowed('REGISTER', email, REGISTER_LIMITS)))
      return ACCEPTED;
    const created = await this.gateway.createPasswordUser(email, password);
    if (created === 'EXISTS') {
      await this.existing(email, traceId);
      return ACCEPTED;
    }
    let outboxId: string | null;
    try {
      const code = await this.gateway.actionCode('VERIFY_EMAIL', email);
      outboxId = await this.database.prisma.$transaction(
        async (tx) => {
          const id = randomUUID();
          // Pending until an administrator approves; the handle never derives from the address.
          await tx.member.create({
            data: {
              id,
              identityUid: created.uid,
              email,
              displayName: 'New member',
              handle: `member-${id}`,
              role: 'AUTHOR',
              active: false,
              status: 'PENDING',
            },
          });
          await tx.auditEvent.create({
            data: {
              actorId: id,
              action: 'ACCOUNT_REGISTERED',
              subjectType: 'MEMBER',
              subjectId: id,
              changes: {},
              traceId,
            },
          });
          return this.queue(tx, id, 'VERIFY_EMAIL', email, code);
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      // Do not leave a password account without a member row behind.
      await this.gateway.deleteUser(created.uid).catch(() => undefined);
      return databaseFailure(error);
    }
    if (outboxId) await this.outbox.sendNow(outboxId, traceId);
    return ACCEPTED;
  }
  async resendVerification(value: unknown, traceId: string): Promise<Accepted> {
    this.assertEnabled();
    const body = objectInput(value, ['email', 'captchaToken'], ['email']);
    const email = this.email(body.email);
    await this.captcha.assert(body.captchaToken, null);
    if (!(await this.allowed('RESEND', email, RESEND_LIMITS))) return ACCEPTED;
    const user = await this.gateway.findByEmail(email);
    if (user && !user.emailVerified) await this.existing(email, traceId);
    return ACCEPTED;
  }
  /** Sends a reset link when the address has an enabled account; the answer never says whether it did. */
  async forgotPassword(value: unknown, traceId: string): Promise<Accepted> {
    this.assertEnabled();
    const body = objectInput(value, ['email', 'captchaToken'], ['email']);
    const email = this.email(body.email);
    await this.captcha.assert(body.captchaToken, null);
    if (!(await this.allowed('FORGOT', email, FORGOT_LIMITS))) return ACCEPTED;
    const user = await this.gateway.findByEmail(email);
    if (!user) return ACCEPTED;
    const member = await this.database.prisma.member.findUnique({
      where: { identityUid: user.uid },
      select: { id: true, status: true },
    });
    if (!member || member.status === 'DISABLED') return ACCEPTED;
    const code = await this.gateway.actionCode('PASSWORD_RESET', email);
    const outboxId = await this.database.prisma.$transaction(
      async (tx) => this.queue(tx, member.id, 'PASSWORD_RESET', email, code),
      { maxWait: 3000, timeout: 5000 },
    );
    if (outboxId) await this.outbox.sendNow(outboxId, traceId);
    return ACCEPTED;
  }
  /**
   * Completes a reset. The new password is checked against known breaches here, which is why the
   * browser never calls the provider's reset endpoint itself. Every session is revoked afterwards.
   */
  async resetPassword(value: unknown, traceId: string): Promise<Accepted> {
    if (!this.resetEnabled)
      throw new ApiError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Password reset unavailable',
        'Password reset is not available yet.',
      );
    const body = objectInput(value, ['code', 'password'], ['code', 'password']);
    if (typeof body.code !== 'string' || !CODE.test(body.code))
      return invalidInput('/code');
    const password = checkedPassword(body.password);
    await this.breach.assertNotBreached(password);
    try {
      const allowed = await this.database.prisma.$transaction(
        async (tx) =>
          consumeAnonymousRate(
            tx,
            'RESET_ALL',
            'all',
            await transactionTime(tx),
            RESET_OVERALL_PER_HOUR,
          ),
        { maxWait: 3000, timeout: 5000 },
      );
      if (!allowed)
        throw new ApiError(
          429,
          'RATE_LIMITED',
          'Too many operations',
          'Wait before starting another operation.',
          [],
          null,
          60,
        );
    } catch (error) {
      return databaseFailure(error);
    }
    const email = await this.gateway.resetPassword(body.code, password);
    const user = await this.gateway.findByEmail(email);
    if (!user) return ACCEPTED;
    await this.gateway.revokeSessions(user.uid);
    const member = await this.database.prisma.member.findUnique({
      where: { identityUid: user.uid },
      select: { id: true },
    });
    if (!member) return ACCEPTED;
    const outboxId = await this.database.prisma.$transaction(
      async (tx) => {
        await tx.auditEvent.create({
          data: {
            actorId: member.id,
            action: 'PASSWORD_RESET',
            subjectType: 'MEMBER',
            subjectId: member.id,
            changes: {},
            traceId,
          },
        });
        return this.queue(
          tx,
          member.id,
          'PASSWORD_CHANGED_NOTICE',
          email,
          null,
        );
      },
      { maxWait: 3000, timeout: 5000 },
    );
    if (outboxId) await this.outbox.sendNow(outboxId, traceId);
    return ACCEPTED;
  }
  /**
   * The address already has an account: a verified owner is told so, an unverified one gets a fresh
   * verification link. The existing account is never modified, so a password chosen by someone
   * else before the owner arrived is neither replaced by nor revealed to a later registration.
   */
  private async existing(email: string, traceId: string): Promise<void> {
    const user = await this.gateway.findByEmail(email);
    if (!user) return;
    const member = await this.database.prisma.member.findUnique({
      where: { identityUid: user.uid },
      select: { id: true },
    });
    if (!member) return;
    const kind: AccountEmailKind = user.emailVerified
      ? 'ACCOUNT_EXISTS_NOTICE'
      : 'VERIFY_EMAIL';
    const code = user.emailVerified
      ? null
      : await this.gateway.actionCode('VERIFY_EMAIL', email);
    const outboxId = await this.database.prisma.$transaction(
      async (tx) => this.queue(tx, member.id, kind, email, code),
      { maxWait: 3000, timeout: 5000 },
    );
    if (outboxId) await this.outbox.sendNow(outboxId, traceId);
  }
  private async queue(
    tx: Transaction,
    memberId: string,
    kind: AccountEmailKind,
    email: string,
    code: string | null,
  ): Promise<string | null> {
    return this.outbox.enqueueAccount(
      tx,
      memberId,
      kind,
      email,
      {
        actionUrl: accountActionUrl(this.config.webOrigin, kind, code),
        detail: null,
      },
      await transactionTime(tx),
    );
  }
}
