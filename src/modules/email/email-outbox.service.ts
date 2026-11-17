import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import { ApiError } from '../../platform/errors/api-error.js';
import {
  openPayload,
  payloadKey,
  sealPayload,
} from '../../platform/crypto/payload-cipher.js';
import type { Transaction } from '../members/members.repository.js';
import { EMAIL_GATEWAY, type EmailGateway } from './email-gateway.js';
import {
  invitationPayload,
  renderInvitationEmail,
  type InvitationEmailPayload,
} from './invitation-email.js';
import { MAX_ATTEMPTS, nextAttemptDelay } from './retry.js';

export type DeliveryStatus =
  'NOT_REQUESTED' | 'QUEUED' | 'SENT' | 'FAILED' | 'CANCELLED';
export interface Delivery {
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
}
export interface OutboxSummary {
  status: string;
  attempts: number;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
}
/** Prisma selection for the newest outbox row of an invitation. */
export const latestEmail = {
  orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
  take: 1,
  select: { status: true, attempts: true, lastAttemptAt: true, sentAt: true },
};
export function deliveryDto(row: OutboxSummary | undefined): Delivery {
  if (!row)
    return {
      status: 'NOT_REQUESTED',
      attempts: 0,
      lastAttemptAt: null,
      sentAt: null,
    };
  return {
    // An in-flight attempt is still queued from the administrator's point of view.
    status: (row.status === 'SENDING'
      ? 'QUEUED'
      : row.status) as DeliveryStatus,
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
  };
}

const SEND_TIMEOUT_MS = { request: 5_000, sweep: 10_000 } as const;
const LOCK_INTERVAL = Prisma.sql`interval '2 minutes'`;
const FINAL = ['SENT', 'FAILED', 'CANCELLED'] as const;

interface ClaimedRow {
  id: string;
  invitationId: string;
  toEmail: string;
  payloadCiphertext: Uint8Array;
  attempts: number;
}
export interface DispatchSummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  cancelled: number;
}

@Injectable()
export class EmailOutboxService {
  private readonly key: Buffer | null;
  /** One email per recipient per minute by default, including resends. */
  private readonly cooldownMs: number;
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(EMAIL_GATEWAY) private readonly gateway: EmailGateway,
  ) {
    this.key = config.email ? payloadKey(config.email.payloadKey) : null;
    this.cooldownMs = (config.email?.cooldownSeconds ?? 60) * 1000;
  }
  get enabled(): boolean {
    return this.key !== null;
  }
  /**
   * Queues an invitation email inside the caller's transaction. Returns null when email is not
   * configured, so invitations fall back to the copy-link flow without leaving unsendable rows.
   */
  async enqueue(
    tx: Transaction,
    invitationId: string,
    toEmail: string,
    payload: InvitationEmailPayload,
    now: Date,
  ): Promise<string | null> {
    if (!this.key) return null;
    const recent = !this.cooldownMs
      ? null
      : await tx.emailOutbox.findFirst({
          where: {
            toEmail,
            createdAt: { gt: new Date(now.getTime() - this.cooldownMs) },
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
    if (recent)
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Email sent recently',
        'Wait a minute before sending another invitation email to this address.',
        [],
        null,
        Math.max(
          1,
          Math.ceil(
            (recent.createdAt.getTime() + this.cooldownMs - now.getTime()) /
              1000,
          ),
        ),
      );
    const id = randomUUID();
    await tx.emailOutbox.create({
      data: {
        id,
        invitationId,
        kind: 'INVITATION',
        toEmail,
        payloadCiphertext: new Uint8Array(sealPayload(this.key, id, payload)),
        status: 'QUEUED',
        nextAttemptAt: now,
        createdAt: now,
      },
    });
    return id;
  }
  /** Cancels pending email for an invitation that was reissued, revoked or accepted. */
  async cancelFor(tx: Transaction, invitationId: string): Promise<void> {
    await tx.emailOutbox.updateMany({
      where: { invitationId, status: { in: ['QUEUED', 'SENDING'] } },
      data: { status: 'CANCELLED', payloadCiphertext: null, lockedUntil: null },
    });
  }
  /** Attempts one queued email right after its invitation commits. Never throws. */
  async sendNow(outboxId: string, traceId: string): Promise<void> {
    try {
      await this.run(outboxId, 1, traceId, SEND_TIMEOUT_MS.request);
    } catch (error) {
      // No addresses, links or messages: only the error class, for operators.
      process.stdout.write(
        `${JSON.stringify({
          severity: 'WARNING',
          event: 'invitation_email_deferred',
          traceId,
          error: (error as Error).name,
        })}\n`,
      );
    }
  }
  /** Retries due and stale emails; called by the scheduled internal endpoint. */
  dispatchDue(limit = 20): Promise<DispatchSummary> {
    return this.run(
      null,
      limit,
      randomBytes(16).toString('hex'),
      SEND_TIMEOUT_MS.sweep,
    );
  }
  private async run(
    only: string | null,
    limit: number,
    traceId: string,
    timeoutMs: number,
  ): Promise<DispatchSummary> {
    const summary: DispatchSummary = {
      claimed: 0,
      sent: 0,
      retried: 0,
      failed: 0,
      cancelled: 0,
    };
    if (!this.key) return summary;
    const prisma = this.database.prisma;
    const filter = only ? Prisma.sql`AND id = ${only}::uuid` : Prisma.empty;
    // An attempt whose worker vanished after the last allowed try can no longer be retried.
    const exhausted = await prisma.$queryRaw<
      { id: string; invitationId: string; attempts: number }[]
    >`UPDATE blogpost."EmailOutbox"
      SET status = 'FAILED', "payloadCiphertext" = NULL, "lockedUntil" = NULL,
        "lastErrorCode" = 'ATTEMPT_ABANDONED'
      WHERE status = 'SENDING' AND "lockedUntil" < clock_timestamp()
        AND attempts >= ${MAX_ATTEMPTS} ${filter}
      RETURNING id, "invitationId", attempts`;
    for (const row of exhausted) {
      summary.failed++;
      await this.auditFailure(
        row.invitationId,
        row.id,
        row.attempts,
        'ATTEMPT_ABANDONED',
        traceId,
      );
    }
    // Claim one row right before delivering it, so each lease covers a single send (bounded by
    // the provider timeout) rather than a whole batch processed in sequence.
    for (let index = 0; index < limit; index++) {
      const [row] = await prisma.$queryRaw<ClaimedRow[]>`
        WITH due AS (
          SELECT id FROM blogpost."EmailOutbox"
          WHERE ((status = 'QUEUED' AND "nextAttemptAt" <= clock_timestamp())
              OR (status = 'SENDING' AND "lockedUntil" < clock_timestamp()))
            AND attempts < ${MAX_ATTEMPTS} ${filter}
          ORDER BY "nextAttemptAt", id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE blogpost."EmailOutbox" AS o
        SET status = 'SENDING', attempts = o.attempts + 1,
          "lockedUntil" = clock_timestamp() + ${LOCK_INTERVAL},
          "lastAttemptAt" = clock_timestamp()
        FROM due WHERE o.id = due.id
        RETURNING o.id, o."invitationId", o."toEmail", o."payloadCiphertext", o.attempts`;
      if (!row) break;
      summary.claimed++;
      const outcome = await this.deliver(row, traceId, timeoutMs);
      summary[outcome]++;
    }
    return summary;
  }
  private async deliver(
    row: ClaimedRow,
    traceId: string,
    timeoutMs: number,
  ): Promise<'sent' | 'retried' | 'failed' | 'cancelled'> {
    const prisma = this.database.prisma;
    const invitation = await prisma.invitation.findUnique({
      where: { id: row.invitationId },
      select: { acceptedAt: true, revokedAt: true, expiresAt: true },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date()
    ) {
      await this.finish(row, {
        status: 'CANCELLED',
        lastErrorCode: 'INVITATION_UNAVAILABLE',
      });
      return 'cancelled';
    }
    let payload: InvitationEmailPayload;
    try {
      payload = invitationPayload(
        openPayload(this.key!, row.id, row.payloadCiphertext),
      );
    } catch {
      return this.fail(row, 'PAYLOAD_UNREADABLE', traceId);
    }
    const result = await this.gateway.send(
      {
        ...renderInvitationEmail(payload, row.toEmail),
        to: row.toEmail,
        replyTo: payload.inviterEmail || null,
        idempotencyKey: row.id,
      },
      timeoutMs,
    );
    if (result.ok) {
      await this.finish(row, {
        status: 'SENT',
        sentAt: new Date(),
        providerMessageId: result.providerMessageId.slice(0, 100),
        lastErrorCode: null,
      });
      return 'sent';
    }
    const delay = result.retryable ? nextAttemptDelay(row.attempts) : null;
    if (delay === null) return this.fail(row, result.code, traceId);
    await prisma.emailOutbox.updateMany({
      // Fenced to this attempt: a newer claim of the same row owns its outcome.
      where: { id: row.id, status: 'SENDING', attempts: row.attempts },
      data: {
        status: 'QUEUED',
        lockedUntil: null,
        nextAttemptAt: new Date(Date.now() + delay),
        lastErrorCode: result.code.slice(0, 80),
      },
    });
    return 'retried';
  }
  private async fail(
    row: ClaimedRow,
    code: string,
    traceId: string,
  ): Promise<'failed'> {
    const changed = await this.finish(row, {
      status: 'FAILED',
      lastErrorCode: code.slice(0, 80),
    });
    if (changed)
      await this.auditFailure(
        row.invitationId,
        row.id,
        row.attempts,
        code,
        traceId,
      );
    return 'failed';
  }
  /**
   * Moves this attempt's in-flight row to a final state. A concurrent cancellation, or a newer
   * claim after this attempt's lease expired (a higher attempt count), wins.
   */
  private async finish(
    row: ClaimedRow,
    data: {
      status: (typeof FINAL)[number];
      sentAt?: Date;
      providerMessageId?: string;
      lastErrorCode?: string | null;
    },
  ): Promise<boolean> {
    const result = await this.database.prisma.emailOutbox.updateMany({
      where: { id: row.id, status: 'SENDING', attempts: row.attempts },
      data: { ...data, payloadCiphertext: null, lockedUntil: null },
    });
    return result.count === 1;
  }
  private async auditFailure(
    invitationId: string,
    outboxId: string,
    attempts: number,
    errorCode: string,
    traceId: string,
  ): Promise<void> {
    const invitation = await this.database.prisma.invitation.findUnique({
      where: { id: invitationId },
      select: { issuerId: true },
    });
    if (!invitation) return;
    // The issuing administrator is the actor: the audit list requires one for every event.
    await this.database.prisma.auditEvent.create({
      data: {
        actorId: invitation.issuerId,
        action: 'INVITATION_EMAIL_FAILED',
        subjectType: 'INVITATION',
        subjectId: invitationId,
        changes: { outboxId, attempts, errorCode: errorCode.slice(0, 80) },
        traceId,
      },
    });
  }
}
