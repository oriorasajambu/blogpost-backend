import { cloudProfile, cloudProvenance } from '../build-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloudRuntimeBinding,
  normalizeCloudProfile,
} from '../../src/platform/config/build-model.js';
import { readConfig } from '../../src/platform/config/config.js';
import {
  openPayload,
  payloadKey,
  sealPayload,
} from '../../src/platform/crypto/payload-cipher.js';
import {
  escapeHtml,
  invitationPayload,
  renderInvitationEmail,
} from '../../src/modules/email/invitation-email.js';
import { classifyStatus } from '../../src/modules/email/email-gateway.js';
import {
  MAX_ATTEMPTS,
  nextAttemptDelay,
} from '../../src/modules/email/retry.js';
import { acceptableClaims } from '../../src/modules/email/scheduler-oidc.js';
import { deliveryDto } from '../../src/modules/email/email-outbox.service.js';
import { cloudEnv, developmentEnv } from '../helpers.js';

const key = payloadKey('7'.repeat(64));
const token = 'A'.repeat(43);
const payload = {
  inviteUrl: `https://staging.example.com/invitations/accept?token=${token}`,
  role: 'AUTHOR' as const,
  inviterName: 'Rio <script>alert(1)</script>',
  inviterEmail: 'rio@example.com',
  expiresAt: '2026-11-23T05:00:00.000Z',
};
const emailBlock = {
  from: 'Blogpost <no-reply@example.com>',
  dispatchAudience: 'https://api.staging.example.com',
  dispatchInvoker:
    'blogpost-scheduler@blogpost-staging.iam.gserviceaccount.com',
  secretVersions: {
    RESEND_API_KEY: 'projects/blogpost-staging/secrets/resend/versions/1',
    EMAIL_PAYLOAD_KEY:
      'projects/blogpost-staging/secrets/email-payload/versions/1',
  },
};

test('payload cipher round-trips and is bound to its outbox row', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const sealed = sealPayload(key, id, payload);
  assert.deepEqual(openPayload(key, id, sealed), payload);
  assert.ok(!sealed.toString('utf8').includes(token));
  assert.throws(() =>
    openPayload(key, '22222222-2222-4222-8222-222222222222', sealed),
  );
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 1]! ^= 1;
  assert.throws(() => openPayload(key, id, tampered));
  assert.throws(() => openPayload(payloadKey('8'.repeat(64)), id, sealed));
  assert.throws(() => payloadKey('7'.repeat(63)));
  assert.throws(() => payloadKey('Z'.repeat(64)));
});

test('invitation email escapes untrusted text and states the account rule', () => {
  const email = renderInvitationEmail(
    invitationPayload(payload),
    'new.author@example.com',
  );
  assert.equal(email.subject, "You're invited to join Blogpost as an author");
  assert.ok(!email.html.includes('<script>'));
  assert.ok(email.html.includes(escapeHtml(payload.inviterName)));
  assert.ok(email.html.includes(`href="${payload.inviteUrl}"`));
  assert.ok(email.text.includes(payload.inviteUrl));
  assert.ok(email.text.includes('Google account for new.author@example.com'));
  assert.ok(email.text.includes('(Asia/Jakarta)'));
  assert.throws(() => invitationPayload({ ...payload, extra: true }));
  assert.throws(() =>
    invitationPayload({
      ...payload,
      inviteUrl: 'https://evil.example.com/x?token=' + token,
    }),
  );
  assert.throws(() => invitationPayload({ ...payload, role: 'OWNER' }));
});

test('retry policy: 429 and 5xx retry with backoff, other statuses are final', () => {
  assert.deepEqual(classifyStatus(429), {
    ok: false,
    retryable: true,
    code: 'PROVIDER_429',
  });
  assert.equal((classifyStatus(503) as { retryable: boolean }).retryable, true);
  assert.equal(
    (classifyStatus(422) as { retryable: boolean }).retryable,
    false,
  );
  assert.equal(
    (classifyStatus(401) as { retryable: boolean }).retryable,
    false,
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => nextAttemptDelay(n)),
    [60_000, 300_000, 900_000, 3_600_000, 21_600_000],
  );
  assert.equal(nextAttemptDelay(MAX_ATTEMPTS), null);
  assert.equal(nextAttemptDelay(0), null);
});

test('delivery status hides in-flight attempts and defaults to not requested', () => {
  assert.equal(deliveryDto(undefined).status, 'NOT_REQUESTED');
  assert.deepEqual(
    deliveryDto({
      status: 'SENDING',
      attempts: 1,
      lastAttemptAt: new Date('2026-11-16T00:00:00.000Z'),
      sentAt: null,
    }),
    {
      status: 'QUEUED',
      attempts: 1,
      lastAttemptAt: '2026-11-16T00:00:00.000Z',
      sentAt: null,
    },
  );
});

test('scheduler OIDC claims require Google issuer, verified email and a fresh token', () => {
  const now = 1_800_000_000;
  const claims = {
    iss: 'https://accounts.google.com',
    aud: emailBlock.dispatchAudience,
    email: emailBlock.dispatchInvoker,
    email_verified: true,
    iat: now - 10,
    exp: now + 3500,
  };
  assert.ok(acceptableClaims(claims, now));
  for (const patch of [
    { iss: 'https://evil.example.com' },
    { email_verified: false },
    { exp: now - 120 },
    { iat: now + 300 },
    { exp: now + 7200 },
    { aud: 5 },
  ])
    assert.equal(acceptableClaims({ ...claims, ...patch }, now), null);
});

test('cloud email is enabled only by a complete profile block', () => {
  const { email: _none, ...base } = cloudProfile;
  assert.equal(cloudProfile.email, undefined);
  const withEmail = normalizeCloudProfile({ ...base, email: emailBlock });
  assert.equal(withEmail.email?.from, emailBlock.from);
  for (const broken of [
    { ...emailBlock, from: 'Evil\r\nBcc: x@example.com <a@example.com>' },
    { ...emailBlock, dispatchAudience: 'http://api.staging.example.com' },
    { ...emailBlock, dispatchInvoker: base.serviceAccounts.api },
    {
      ...emailBlock,
      secretVersions: {
        ...emailBlock.secretVersions,
        EMAIL_PAYLOAD_KEY: base.secretVersions.CURSOR_SIGNING_KEY,
      },
    },
    { ...emailBlock, secretVersions: { RESEND_API_KEY: 'x' } },
    { from: emailBlock.from },
  ])
    assert.throws(() => normalizeCloudProfile({ ...base, email: broken }));

  const provenance = { ...cloudProvenance, configuration: withEmail };
  const binding = cloudRuntimeBinding(provenance, 'api');
  assert.equal(binding.literals.EMAIL_FROM, emailBlock.from);
  assert.equal(
    binding.secrets.RESEND_API_KEY,
    emailBlock.secretVersions.RESEND_API_KEY,
  );
  assert.equal(
    cloudRuntimeBinding(provenance, 'maintenance').literals.EMAIL_FROM,
    undefined,
  );
  const env = {
    ...cloudEnv,
    EMAIL_FROM: emailBlock.from,
    EMAIL_DISPATCH_AUDIENCE: emailBlock.dispatchAudience,
    EMAIL_DISPATCH_INVOKER: emailBlock.dispatchInvoker,
    RESEND_SECRET_REF: emailBlock.secretVersions.RESEND_API_KEY,
    EMAIL_PAYLOAD_SECRET_REF: emailBlock.secretVersions.EMAIL_PAYLOAD_KEY,
    RESEND_API_KEY: ['re', 'synthetic', 'value'].join('_'),
    EMAIL_PAYLOAD_KEY: '4'.repeat(64),
  };
  assert.equal(readConfig(env, 'api', provenance).email?.driver, 'resend');
  assert.throws(() =>
    readConfig({ ...env, EMAIL_DRIVER: 'log' }, 'api', provenance),
  );
  assert.throws(() =>
    readConfig({ ...env, RESEND_API_KEY: '' }, 'api', provenance),
  );
  assert.throws(() =>
    readConfig({ ...env, EMAIL_FROM: 'other@example.com' }, 'api', provenance),
  );
  // Without the profile block, stray email settings fail closed and email stays off.
  assert.equal(readConfig(cloudEnv, 'api', cloudProvenance).email, null);
  assert.throws(() =>
    readConfig(
      { ...cloudEnv, EMAIL_FROM: emailBlock.from },
      'api',
      cloudProvenance,
    ),
  );
});

test('development email is optional and may log instead of sending', () => {
  assert.equal(readConfig(developmentEnv).email, null);
  const local = readConfig({
    ...developmentEnv,
    EMAIL_DRIVER: 'log',
    EMAIL_FROM: 'Blogpost <no-reply@example.com>',
    EMAIL_PAYLOAD_KEY: '5'.repeat(64),
  });
  assert.equal(local.email?.driver, 'log');
  assert.equal(local.email?.resendApiKey, null);
  assert.throws(() =>
    readConfig({
      ...developmentEnv,
      EMAIL_DRIVER: 'log',
      EMAIL_FROM: 'x@example.com',
    }),
  );
  assert.throws(() =>
    readConfig({
      ...developmentEnv,
      EMAIL_DRIVER: 'smtp',
      EMAIL_FROM: 'x@example.com',
      EMAIL_PAYLOAD_KEY: '5'.repeat(64),
    }),
  );
});

test('enqueue seals the link, and a second email to the same address within the cooldown is rate limited', async () => {
  const { EmailOutboxService } =
    await import('../../src/modules/email/email-outbox.service.js');
  const rows: {
    id: string;
    toEmail: string;
    createdAt: Date;
    payloadCiphertext: Uint8Array;
  }[] = [];
  const tx = {
    emailOutbox: {
      findFirst: async ({
        where,
      }: {
        where: { toEmail: string; createdAt: { gt: Date } };
      }) =>
        rows.find(
          (row) =>
            row.toEmail === where.toEmail && row.createdAt > where.createdAt.gt,
        ) ?? null,
      create: async ({ data }: { data: (typeof rows)[number] }) => {
        rows.push(data);
        return data;
      },
    },
  };
  const config = readConfig({
    ...developmentEnv,
    EMAIL_DRIVER: 'log',
    EMAIL_FROM: 'Blogpost <no-reply@example.com>',
    EMAIL_PAYLOAD_KEY: '7'.repeat(64),
  });
  assert.equal(config.email?.cooldownSeconds, 60);
  const service = new EmailOutboxService(config, {} as never, {} as never);
  const now = new Date('2026-11-17T00:00:00.000Z');
  const id = await service.enqueue(
    tx as never,
    'inv-1',
    'a@example.com',
    payload,
    now,
  );
  assert.ok(id);
  assert.ok(
    !Buffer.from(rows[0]!.payloadCiphertext).toString('utf8').includes(token),
  );
  assert.deepEqual(openPayload(key, id!, rows[0]!.payloadCiphertext), payload);
  await assert.rejects(
    service.enqueue(
      tx as never,
      'inv-2',
      'a@example.com',
      payload,
      new Date(now.getTime() + 20_000),
    ),
    (error: { status: number; code: string; retryAfterSeconds: number }) =>
      error.status === 429 &&
      error.code === 'RATE_LIMITED' &&
      error.retryAfterSeconds === 40,
  );
  assert.ok(
    await service.enqueue(tx as never, 'inv-3', 'b@example.com', payload, now),
  );
  assert.ok(
    await service.enqueue(
      tx as never,
      'inv-4',
      'a@example.com',
      payload,
      new Date(now.getTime() + 61_000),
    ),
  );
  // Without email configured nothing is queued, so invitations keep the copy-link flow.
  const disabled = new EmailOutboxService(
    readConfig(developmentEnv),
    {} as never,
    {} as never,
  );
  assert.equal(disabled.enabled, false);
  assert.equal(
    await disabled.enqueue(tx as never, 'inv-5', 'c@example.com', payload, now),
    null,
  );
  // Only development may lower the cooldown.
  assert.equal(
    readConfig({
      ...developmentEnv,
      EMAIL_DRIVER: 'log',
      EMAIL_FROM: 'x@example.com',
      EMAIL_PAYLOAD_KEY: '7'.repeat(64),
      EMAIL_COOLDOWN_SECONDS: '0',
    }).email?.cooldownSeconds,
    0,
  );
  assert.throws(() =>
    readConfig({
      ...developmentEnv,
      EMAIL_DRIVER: 'log',
      EMAIL_FROM: 'x@example.com',
      EMAIL_PAYLOAD_KEY: '7'.repeat(64),
      EMAIL_COOLDOWN_SECONDS: '61',
    }),
  );
});

test('the development log driver writes the email to stdout even with Nest logging disabled', async () => {
  const { ConfiguredEmailGateway } =
    await import('../../src/modules/email/email-gateway.js');
  const config = readConfig({
    ...developmentEnv,
    EMAIL_DRIVER: 'log',
    EMAIL_FROM: 'Blogpost <no-reply@example.com>',
    EMAIL_PAYLOAD_KEY: '7'.repeat(64),
  });
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  let result;
  try {
    result = await new ConfiguredEmailGateway(config).send(
      {
        ...renderInvitationEmail(payload, 'new@example.com'),
        to: 'new@example.com',
        replyTo: null,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      },
      1000,
    );
  } finally {
    process.stdout.write = original;
  }
  assert.equal(result.ok, true);
  const event = JSON.parse(written.join('').trim());
  assert.equal(event.event, 'development_invitation_email');
  assert.equal(event.to, 'new@example.com');
  assert.ok(event.text.includes(payload.inviteUrl));
});
