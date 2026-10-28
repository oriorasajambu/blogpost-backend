import { cloudProvenance } from '../build-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { FirebaseIdentityGateway } from '../../src/modules/identity/firebase-identity.gateway.js';
import type {
  IdentityEvidence,
  IdentityGateway,
} from '../../src/modules/identity/identity.js';
import { readConfig } from '../../src/platform/config/config.js';
import { ApiError } from '../../src/platform/errors/api-error.js';
import { profilePatch } from '../../src/modules/members/profile.service.js';
import { writePreconditions } from '../../src/platform/http/preconditions.js';
import { developmentEnv, cloudEnv } from '../helpers.js';

function evidence(kind: 'id-token' | 'session' = 'id-token'): IdentityEvidence {
  const now = Math.floor(Date.now() / 1000);
  return {
    uid: 'provider-uid',
    subject: 'provider-uid',
    audience: developmentEnv.IDENTITY_PROJECT_ID,
    issuer:
      (kind === 'id-token'
        ? 'https://securetoken.google.com/'
        : 'https://session.firebase.google.com/') +
      developmentEnv.IDENTITY_PROJECT_ID,
    email: 'Author@Example.test',
    emailVerified: true,
    provider: 'google.com',
    googleIdentities: ['google-subject'],
    tenant: undefined,
    authTime: now - 10,
    issuedAt: now,
    expiresAt: now + (kind === 'session' ? 432000 : 3600),
    user: {
      uid: 'provider-uid',
      email: 'author@example.test',
      emailVerified: true,
      disabled: false,
      googleProviders: [
        { uid: 'google-subject', email: 'author@example.test' },
      ],
    },
  };
}
function service(value: IdentityEvidence) {
  const gateway: IdentityGateway = {
    verify: async () => value,
    createSession: async () => ({
      cookie: 'not-a-real-cookie',
      evidence: evidence('session'),
    }),
    userByEmail: async () => value.user,
  };
  return new IdentityService(gateway, readConfig(developmentEnv));
}
const code = (expected: string) => (error: unknown) =>
  error instanceof ApiError && error.code === expected;

test('identity policy returns only verified UID/email/time and never token role claims', async () => {
  const claims = { ...evidence(), role: 'ADMIN', memberId: 'untrusted' };
  const value = await service(claims).verify('synthetic-token', 'id-token');
  assert.deepEqual(Object.keys(value).sort(), [
    'authTime',
    'email',
    'expiresAt',
    'kind',
    'uid',
  ]);
  assert.equal(value.email, 'author@example.test');
});

test('identity policy rejects wrong project/issuer/provider/tenant/email, revoked account shape and expiry', async () => {
  for (const patch of [
    { audience: 'other-project' },
    { issuer: 'https://accounts.google.com' },
    { provider: 'password' },
    { tenant: 'other-tenant' },
    { emailVerified: false },
    { subject: 'someone-else' },
    { googleIdentities: ['other-google-subject'] },
    { authTime: 0 },
    { issuedAt: Number.MAX_SAFE_INTEGER },
    { expiresAt: Number.MAX_VALUE },
  ])
    await assert.rejects(
      service({ ...evidence(), ...patch }).verify(
        'synthetic-token',
        'id-token',
      ),
      code('INVALID_CREDENTIAL'),
    );
  const expired = {
    ...evidence(),
    expiresAt: Math.floor(Date.now() / 1000) - 1,
  };
  await assert.rejects(
    service(expired).verify('synthetic-token', 'id-token'),
    code('AUTHENTICATION_EXPIRED'),
  );
  for (const patch of [
    { emailVerified: false },
    { disabled: true },
    { tenantId: 'tenant' },
    { googleProviders: [] },
    { uid: 'wrong-uid' },
  ]) {
    const value = evidence();
    value.user = { ...value.user, ...patch };
    await assert.rejects(
      service(value).verify('synthetic-token', 'id-token'),
      (error) => error instanceof ApiError && error.status === 401,
    );
  }
});

test('recent authentication and session lifetime/kind checks are independent of SQL roles', async () => {
  const old = { ...evidence(), authTime: Math.floor(Date.now() / 1000) - 301 };
  await assert.rejects(
    service(old).recentIdentity('synthetic-token'),
    code('AUTHENTICATION_EXPIRED'),
  );
  const session = evidence('session');
  await service(session).verify('synthetic-session', 'session');
  await assert.rejects(
    service(session).verify('synthetic-session', 'id-token'),
    code('INVALID_CREDENTIAL'),
  );
  session.expiresAt = (session.issuedAt as number) + 14 * 86400;
  await assert.rejects(
    service(session).verify('synthetic-session', 'session'),
    code('INVALID_CREDENTIAL'),
  );
});

test('Admin gateway refuses emulator/project mode drift before making an SDK request', async () => {
  const gateway = new FirebaseIdentityGateway(
    readConfig(cloudEnv, 'api', cloudProvenance),
  );
  const previous = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  try {
    await assert.rejects(
      gateway.verify('synthetic-token', 'id-token'),
      code('DEPENDENCY_UNAVAILABLE'),
    );
  } finally {
    if (previous === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = previous;
    await gateway.onModuleDestroy();
  }
});

test('profile input preserves optional-null intent and rejects unknown/oversized/invalid scalar input', () => {
  assert.deepEqual(profilePatch({ bio: null }), { bio: null });
  assert.equal(
    profilePatch({ displayName: '😀'.repeat(80) }).displayName!.length,
    160,
  );
  for (const value of [
    {},
    [],
    null,
    { role: 'ADMIN' },
    { displayName: null },
    { displayName: ' ' },
    { displayName: '😀'.repeat(81) },
    { bio: '\ud800' },
    { bio: '\0' },
    { bio: 'a'.repeat(501) },
  ])
    assert.throws(() => profilePatch(value), code('VALIDATION_FAILED'));
});

test('profile validation bounds and sorts issues while explicitly marking truncation', () => {
  const input = Object.fromEntries(
    Array.from({ length: 80 }, (_, index) => [
      `unknown-${String(index).padStart(3, '0')}`,
      'private-value',
    ]),
  );
  assert.throws(
    () => profilePatch({ ...input, bio: 2 }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.fieldErrors.length, 50);
      assert.deepEqual(error.context, { truncated: true });
      const fields = error.fieldErrors.map((issue) => issue.field);
      assert.deepEqual(fields, [...fields].sort());
      assert.equal(fields[0], '/bio');
      assert.equal(
        JSON.stringify(error.fieldErrors).includes('private-value'),
        false,
      );
      return true;
    },
  );
});

test('write preconditions reject missing, duplicate and non-canonical operation headers', () => {
  const key = '83c9a1ca-6d20-48c5-8476-bb6a60677377';
  assert.deepEqual(
    writePreconditions({
      rawHeaders: ['X-Expected-Version', '1', 'Idempotency-Key', key],
    }),
    { expectedVersion: 1, key },
  );
  assert.throws(
    () => writePreconditions({ rawHeaders: [] }),
    code('EXPECTED_VERSION_REQUIRED'),
  );
  for (const version of ['0', '01', '-1', '2147483648', '1,2'])
    assert.throws(
      () =>
        writePreconditions({
          rawHeaders: ['X-Expected-Version', version, 'Idempotency-Key', key],
        }),
      code('INVALID_EXPECTED_VERSION'),
    );
  assert.throws(
    () =>
      writePreconditions({
        rawHeaders: [
          'X-Expected-Version',
          '1',
          'x-expected-version',
          '1',
          'Idempotency-Key',
          key,
        ],
      }),
    code('INVALID_EXPECTED_VERSION'),
  );
  assert.throws(
    () =>
      writePreconditions({
        rawHeaders: [
          'X-Expected-Version',
          '1',
          'Idempotency-Key',
          key,
          'idempotency-key',
          key,
        ],
      }),
    code('INVALID_IDEMPOTENCY_KEY'),
  );
});
