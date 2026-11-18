import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_EMAIL_KINDS,
  accountActionUrl,
  accountPayload,
  maskEmail,
  renderAccountEmail,
} from '../../src/modules/email/account-email.js';
import {
  BreachCheck,
  checkedPassword,
  passwordIssue,
} from '../../src/platform/security/password-policy.js';
import { CaptchaVerifier } from '../../src/platform/security/captcha.js';
import { subjectHash } from '../../src/platform/database/rate-limits.js';
import { ApiError } from '../../src/platform/errors/api-error.js';

const origin = 'https://app.example.com';
const code = 'A1b2C3d4E5f6G7h8I9j0_-Kk';

import { PasswordSetupService } from '../../src/modules/accounts/password-setup.service.js';
test('action links carry only a URL-safe code and point at the matching web page', () => {
  assert.equal(
    accountActionUrl(origin, 'PASSWORD_RESET', code),
    `${origin}/reset-password?code=${code}`,
  );
  assert.equal(
    accountActionUrl(origin, 'PASSWORD_SET', code),
    `${origin}/reset-password?code=${code}&set=1`,
  );
  assert.equal(accountActionUrl(origin, 'PASSWORD_CHANGED_NOTICE', null), null);
  assert.equal(
    accountActionUrl(origin, 'ACCOUNT_EXISTS_NOTICE', null),
    `${origin}/sign-in`,
  );
  for (const bad of [null, '', 'short', `${code}&x=1`, `${code}/..`])
    assert.throws(() => accountActionUrl(origin, 'VERIFY_EMAIL', bad));
});

test('payload validation rejects unknown keys, foreign paths and links on notices', () => {
  const url = accountActionUrl(origin, 'VERIFY_EMAIL', code);
  assert.deepEqual(
    accountPayload('VERIFY_EMAIL', { actionUrl: url, detail: null }),
    { actionUrl: url, detail: null },
  );
  for (const [kind, value] of [
    ['VERIFY_EMAIL', { actionUrl: url, detail: null, extra: 1 }],
    ['PASSWORD_RESET', { actionUrl: url, detail: null }],
    ['PASSWORD_CHANGED_NOTICE', { actionUrl: url, detail: null }],
    ['VERIFY_EMAIL', { actionUrl: 'javascript:alert(1)', detail: null }],
    ['VERIFY_EMAIL', { actionUrl: url, detail: 'x'.repeat(321) }],
  ] as const)
    assert.throws(() => accountPayload(kind, value));
});

test('every account email renders text and escaped HTML with the link and no raw markup', () => {
  for (const kind of ACCOUNT_EMAIL_KINDS) {
    const actionUrl = accountActionUrl(
      origin,
      kind,
      kind === 'ACCOUNT_EXISTS_NOTICE' ? null : code,
    );
    const hasLink = actionUrl !== null;
    const mail = renderAccountEmail(
      kind,
      { actionUrl, detail: 'old<b>@example.com' },
      'new"@example.com',
    );
    assert.ok(mail.subject.length > 0 && !/[\r\n]/.test(mail.subject));
    assert.ok(!mail.html.includes('<b>'));
    assert.ok(!mail.html.includes('new"@'));
    if (hasLink) {
      assert.ok(mail.text.includes(actionUrl));
      assert.ok(mail.html.includes(actionUrl.replaceAll('&', '&amp;')));
    }
  }
  assert.equal(maskEmail('someone@example.com'), 's***@example.com');
});

test('password policy is length-only and counts code points', () => {
  assert.equal(passwordIssue('correct horse battery'), null);
  assert.equal(passwordIssue('a'.repeat(12)), null);
  assert.equal(passwordIssue('😀'.repeat(12)), null);
  assert.ok(passwordIssue('a'.repeat(11)));
  assert.ok(passwordIssue('a'.repeat(129)));
  assert.ok(passwordIssue('abc\0defghijkl'));
  assert.ok(passwordIssue(undefined));
  assert.throws(
    () => checkedPassword('short'),
    (error) => error instanceof ApiError && error.status === 422,
  );
  // The pointer names the input that was rejected: /newPassword when changing a password.
  const pointer = (error: unknown) =>
    error instanceof ApiError ? error.fieldErrors[0]?.field : undefined;
  assert.throws(
    () => checkedPassword('short'),
    (error) => pointer(error) === '/password',
  );
  assert.throws(
    () => checkedPassword('short', '/newPassword'),
    (error) => pointer(error) === '/newPassword',
  );
});

test('breach check sends only a five-character hash prefix and fails open', async () => {
  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  let url = '';
  const found = new BreachCheck(async (input) => {
    url = String(input);
    return new Response(
      '0000000000000000000000000000000000A:0\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\n',
    );
  });
  assert.equal(await found.count('password'), 9545824);
  assert.equal(url, 'https://api.pwnedpasswords.com/range/5BAA6');
  await assert.rejects(
    found.assertNotBreached('password'),
    (error) => error instanceof ApiError && error.status === 422,
  );
  await assert.rejects(
    found.assertNotBreached('password', '/newPassword'),
    (error) =>
      error instanceof ApiError &&
      error.fieldErrors[0]?.field === '/newPassword',
  );
  const padded = new BreachCheck(
    async () => new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:0\n'),
  );
  assert.equal(await padded.count('password'), 0);
  for (const fetcher of [
    async () => new Response('nope', { status: 503 }),
    async () => {
      throw new Error('offline');
    },
  ])
    assert.equal(await new BreachCheck(fetcher).count('password'), 0);
});

test('captcha verifier fails closed and is skipped only without a secret', async () => {
  await new CaptchaVerifier(null).assert(undefined, null);
  const ok = new CaptchaVerifier(
    'secret',
    async () => new Response(JSON.stringify({ success: true })),
  );
  await ok.assert('token', '203.0.113.1');
  for (const token of [undefined, '', 'x'.repeat(2049)])
    await assert.rejects(
      ok.assert(token, null),
      (error) => error instanceof ApiError && error.code === 'CAPTCHA_FAILED',
    );
  const denied = new CaptchaVerifier(
    'secret',
    async () => new Response(JSON.stringify({ success: false })),
  );
  await assert.rejects(
    denied.assert('token', null),
    (error) => error instanceof ApiError && error.code === 'CAPTCHA_FAILED',
  );
  for (const fetcher of [
    async () => new Response('', { status: 500 }),
    async () => {
      throw new Error('offline');
    },
  ])
    await assert.rejects(
      new CaptchaVerifier('secret', fetcher).assert('token', null),
      (error) => error instanceof ApiError && error.status === 503,
    );
});

test('anonymous rate subjects are namespaced, case-insensitive hashes', () => {
  const a = subjectHash('REGISTER_EMAIL', 'User@Example.com');
  assert.equal(a, subjectHash('REGISTER_EMAIL', ' user@example.com '));
  assert.notEqual(a, subjectHash('FORGOT_EMAIL', 'user@example.com'));
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('password setup links require password reset, not only email delivery', async () => {
  let read = false;
  const service = (identityWebApiKey: string | null) =>
    new PasswordSetupService(
      { identityWebApiKey } as never,
      {} as never,
      {
        read: async () => {
          read = true;
          return { actorId: 'actor', members: [] };
        },
      } as never,
      { enabled: true } as never,
    );
  await assert.rejects(
    service(null).sendAll({ uid: 'admin' } as never, 'a'.repeat(32)),
    (error) =>
      error instanceof ApiError &&
      error.status === 503 &&
      error.code === 'DEPENDENCY_UNAVAILABLE',
  );
  assert.equal(read, false);
});
