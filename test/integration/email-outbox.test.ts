import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { EmailOutboxService } from '../../src/modules/email/email-outbox.service.js';
import type {
  EmailGateway,
  OutgoingEmail,
  SendResult,
} from '../../src/modules/email/email-gateway.js';
import type { AppConfig } from '../../src/platform/config/config.js';

const database = new DatabaseService();
const prisma = database.prisma;
const issuerId = randomUUID();
const config = {
  email: {
    driver: 'resend',
    from: 'Blogpost <no-reply@example.test>',
    payloadKey: '9'.repeat(64),
    resendApiKey: null,
    dispatchAudience: null,
    dispatchInvoker: null,
    cooldownSeconds: 0,
  },
} as unknown as AppConfig;

class ScriptedGateway implements EmailGateway {
  sent: OutgoingEmail[] = [];
  constructor(
    private readonly next: () => SendResult,
    private readonly waitMs = 0,
  ) {}
  async send(email: OutgoingEmail): Promise<SendResult> {
    if (this.waitMs) await delay(this.waitMs);
    this.sent.push(email);
    return this.next();
  }
}
const invitations: string[] = [];
async function invitation(): Promise<{ id: string; email: string }> {
  const email = `outbox-${randomUUID()}@example.test`;
  const row = await prisma.invitation.create({
    data: {
      email,
      role: 'AUTHOR',
      tokenHash: randomBytes(32).toString('hex'),
      issuerId,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  invitations.push(row.id);
  return { id: row.id, email };
}
async function queue(
  service: EmailOutboxService,
  target: { id: string; email: string },
) {
  const id = await prisma.$transaction((tx) =>
    service.enqueue(
      tx,
      target.id,
      target.email,
      {
        inviteUrl: `http://localhost:3000/invitations/accept?token=${'B'.repeat(43)}`,
        role: 'AUTHOR',
        inviterName: 'Outbox admin',
        inviterEmail: 'admin@example.test',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      new Date(),
    ),
  );
  assert.ok(id);
  return id;
}
const service = (gateway: EmailGateway) =>
  new EmailOutboxService(config, database, gateway);

before(async () => {
  await prisma.member.create({
    data: {
      id: issuerId,
      identityUid: `outbox-${issuerId}`,
      email: `outbox-admin-${issuerId}@example.test`,
      displayName: 'Outbox admin',
      handle: `outbox-${issuerId}`,
      role: 'ADMIN',
    },
  });
});
after(async () => {
  await prisma.auditEvent.deleteMany({ where: { actorId: issuerId } });
  await prisma.invitation.deleteMany({ where: { id: { in: invitations } } });
  await prisma.member.delete({ where: { id: issuerId } });
  await database.onModuleDestroy();
});

test('a retryable failure is rescheduled; a final failure wipes the link and audits with an actor', async () => {
  let result: SendResult = { ok: false, retryable: true, code: 'PROVIDER_503' };
  const gateway = new ScriptedGateway(() => result);
  const outbox = service(gateway);
  const target = await invitation();
  const id = await queue(outbox, target);
  const before = Date.now();
  await outbox.sendNow(id, 'a'.repeat(32));
  let row = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, 'QUEUED');
  assert.equal(row.attempts, 1);
  assert.equal(row.lastErrorCode, 'PROVIDER_503');
  assert.ok(row.payloadCiphertext);
  assert.ok(row.nextAttemptAt.getTime() >= before + 55_000);
  assert.equal(gateway.sent[0]!.idempotencyKey, id);
  assert.equal(gateway.sent[0]!.to, target.email);
  // Not yet due: the sweep leaves it alone.
  assert.equal((await outbox.dispatchDue()).claimed, 0);
  await prisma.emailOutbox.update({
    where: { id },
    data: { nextAttemptAt: new Date(Date.now() - 1000) },
  });
  result = { ok: false, retryable: false, code: 'PROVIDER_422' };
  const summary = await outbox.dispatchDue();
  assert.equal(summary.failed, 1);
  row = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, 'FAILED');
  assert.equal(row.attempts, 2);
  assert.equal(row.payloadCiphertext, null);
  assert.equal(row.lockedUntil, null);
  const audit = await prisma.auditEvent.findMany({
    where: { subjectId: target.id, action: 'INVITATION_EMAIL_FAILED' },
  });
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.actorId, issuerId);
  assert.deepEqual(audit[0]!.changes, {
    outboxId: id,
    attempts: 2,
    errorCode: 'PROVIDER_422',
  });
  assert.equal(JSON.stringify(audit).includes('B'.repeat(43)), false);
});

test('concurrent sweeps send each due email exactly once', async () => {
  const gateway = new ScriptedGateway(
    () => ({ ok: true, providerMessageId: randomUUID() }),
    40,
  );
  const outbox = service(gateway);
  const ids: string[] = [];
  for (let index = 0; index < 6; index++)
    ids.push(await queue(outbox, await invitation()));
  const [first, second] = await Promise.all([
    outbox.dispatchDue(20),
    outbox.dispatchDue(20),
  ]);
  const mine = gateway.sent.filter((email) =>
    ids.includes(email.idempotencyKey),
  );
  assert.equal(mine.length, ids.length);
  assert.equal(
    new Set(mine.map((email) => email.idempotencyKey)).size,
    ids.length,
  );
  assert.ok(first.sent + second.sent >= ids.length);
  const rows = await prisma.emailOutbox.findMany({
    where: { id: { in: ids } },
  });
  for (const row of rows) {
    assert.equal(row.status, 'SENT');
    assert.equal(row.payloadCiphertext, null);
    assert.ok(row.sentAt);
  }
});

test('revoked invitations are cancelled and abandoned final attempts fail', async () => {
  const gateway = new ScriptedGateway(() => ({
    ok: true,
    providerMessageId: 'x',
  }));
  const outbox = service(gateway);
  const revoked = await invitation();
  const revokedOutbox = await queue(outbox, revoked);
  await prisma.invitation.update({
    where: { id: revoked.id },
    data: { revokedAt: new Date(), version: 2 },
  });
  await outbox.sendNow(revokedOutbox, 'b'.repeat(32));
  const cancelled = await prisma.emailOutbox.findUniqueOrThrow({
    where: { id: revokedOutbox },
  });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.payloadCiphertext, null);
  assert.equal(gateway.sent.length, 0);

  const abandoned = await invitation();
  const abandonedOutbox = await queue(outbox, abandoned);
  await prisma.emailOutbox.update({
    where: { id: abandonedOutbox },
    data: {
      status: 'SENDING',
      attempts: 6,
      lockedUntil: new Date(Date.now() - 1000),
    },
  });
  await outbox.dispatchDue();
  const failed = await prisma.emailOutbox.findUniqueOrThrow({
    where: { id: abandonedOutbox },
  });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.lastErrorCode, 'ATTEMPT_ABANDONED');
  assert.equal(failed.payloadCiphertext, null);
  assert.equal(
    await prisma.auditEvent.count({
      where: { subjectId: abandoned.id, action: 'INVITATION_EMAIL_FAILED' },
    }),
    1,
  );
});

test('an attempt whose lease was taken over cannot overwrite the newer attempt', async () => {
  let outbox!: EmailOutboxService;
  let id = '';
  // While this attempt is sending, its lease "expires" and a newer claim bumps the attempt count.
  const gateway = new ScriptedGateway(() => ({
    ok: true,
    providerMessageId: 'late',
  }));
  const original = gateway.send.bind(gateway);
  gateway.send = async (email) => {
    await prisma.emailOutbox.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lockedUntil: new Date(Date.now() + 60_000),
      },
    });
    return original(email);
  };
  outbox = service(gateway);
  id = await queue(outbox, await invitation());
  await outbox.sendNow(id, 'c'.repeat(32));
  const row = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
  assert.equal(row.status, 'SENDING');
  assert.equal(row.attempts, 2);
  assert.ok(row.payloadCiphertext);
  assert.equal(row.providerMessageId, null);
});
