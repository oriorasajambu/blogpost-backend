import { cloudProvenance } from '../build-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/platform/config/config.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import { FirebaseIdentityGateway } from '../../src/modules/identity/firebase-identity.gateway.js';
import { IdentityService } from '../../src/modules/identity/identity.service.js';
import { MembersRepository } from '../../src/modules/members/members.repository.js';
import { bootstrapAdmin } from '../../src/modules/members/bootstrap-admin.js';
import type { Me } from '../../src/modules/members/member.js';
import { ApiError } from '../../src/platform/errors/api-error.js';
import { metadata, cloudEnv } from '../helpers.js';
import { assertConforms, coverage } from '../conformance/verify.js';

// This file is deliberately outside the ordinary integration glob. Its runner creates fresh,
// internal-only PostgreSQL/Auth containers on tmpfs, with no connection to any saved stack.
assert.equal(
  process.env.BLOGPOST_DISPOSABLE_IDENTITY,
  '1',
  'Use npm run test:identity',
);
assert.match(
  process.env.IDENTITY_PROJECT_ID ?? '',
  /^demo-blogpost-identity-[a-f0-9]{12}$/,
);
assert.equal(process.env.SQL_HOST, 'db');
assert.equal(process.env.SQL_APP_PASSWORD, 'disposable-identity-app');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'auth:9099');

function unsigned(claims: Record<string, unknown>): string {
  // Emulator-only upstream OAuth fixture, never a runtime authentication bypass.
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    '',
  ].join('.');
}
function mutate(token: string, patch: Record<string, unknown>): string {
  return unsigned({
    ...JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()),
    ...patch,
  });
}
type Account = {
  uid: string;
  email: string;
  subject: string;
  token: string;
  rawGoogleToken: string;
};
interface Body {
  data: Me & { sessionCookie: string; expiresAt: string; member: Me };
  error: {
    code: string;
    context: { expectedVersion: number; currentVersion: number };
  };
  meta: { idempotency: { replayed: boolean; expiresAt: string } | null };
  traceId: string;
}
const trace = () => randomBytes(16).toString('hex');
const apiError = (code: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code;

test(
  'real Admin SDK, current SQL membership, first-admin job and profile transactions',
  { timeout: 120_000 },
  async (t) => {
    const config = readConfig();
    const database = new DatabaseService();
    const gateway = new FirebaseIdentityGateway(config);
    const identity = new IdentityService(gateway, config);
    const members = new MembersRepository(database);
    const fixtureApp = initializeApp(
      { projectId: config.identityProject },
      `identity-fixture-${randomUUID()}`,
    );
    const admin = getAuth(fixtureApp);
    const app = await createApp(config);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const executed = new Set<string>();
    t.after(async () => {
      await app.close();
      await gateway.onModuleDestroy();
      await database.onModuleDestroy();
      await deleteApp(fixtureApp);
    });
    async function rest(
      operation: string,
      input: unknown,
    ): Promise<Record<string, string>> {
      const response = await fetch(
        `http://auth:9099/identitytoolkit.googleapis.com/v1/accounts:${operation}?key=disposable`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(10_000),
        },
      );
      assert.equal(
        response.status,
        200,
        `Emulator fixture operation failed: ${operation}`,
      );
      return response.json() as Promise<Record<string, string>>;
    }
    async function google(
      label: string,
      subject: string = randomUUID(),
      email = `${label}-${randomUUID()}@example.test`,
    ): Promise<Account> {
      const rawGoogleToken = unsigned({
        iss: 'https://accounts.google.com',
        sub: subject,
        aud: 'disposable-google-client',
        email,
        email_verified: true,
        name: `Fixture ${label}`,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      const signedIn = await rest('signInWithIdp', {
        requestUri: 'http://localhost',
        returnSecureToken: true,
        postBody: new URLSearchParams({
          providerId: 'google.com',
          id_token: rawGoogleToken,
        }).toString(),
      });
      assert.equal(typeof signedIn.idToken, 'string');
      assert.equal(typeof signedIn.localId, 'string');
      return {
        uid: signedIn.localId!,
        email,
        subject,
        token: signedIn.idToken!,
        rawGoogleToken,
      };
    }
    async function member(
      account: Account,
      role: 'AUTHOR' | 'EDITOR' | 'ADMIN' = 'AUTHOR',
    ) {
      return database.prisma.member.create({
        data: {
          identityUid: account.uid,
          email: account.email,
          displayName: 'Fixture staff',
          handle: `fixture-${randomUUID()}`,
          role,
        },
      });
    }
    async function request(
      operation: string,
      path: string,
      status: number,
      options: {
        method?: string;
        token?: string;
        session?: string;
        body?: unknown;
        headers?: Record<string, string>;
      } = {},
    ) {
      const method = options.method ?? 'GET';
      const response = await fetch(origin + path, {
        method,
        headers: {
          ...metadata,
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
          ...(options.session
            ? { 'X-Blogpost-Web-Session': options.session }
            : {}),
          ...(options.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...options.headers,
        },
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
        signal: AbortSignal.timeout(15_000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const body = JSON.parse(bytes.toString()) as Body;
      assert.equal(
        response.status,
        status,
        `${operation}: ${body.error?.code ?? 'unexpected status'}`,
      );
      assertConforms(operation, {
        method,
        path,
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: bytes,
      });
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (response.ok) executed.add(operation);
      return { response, body };
    }
    const me = (account: Account, status = 200) =>
      request('getMe', '/v1/me', status, { token: account.token });
    const exchange = (
      account: Account,
      status = 200,
      headers?: Record<string, string>,
    ) =>
      request('createWebSession', '/v1/auth/web-session', status, {
        method: 'POST',
        body: { idToken: account.token },
        headers,
      });
    const patch = (
      account: Account,
      body: unknown,
      version: number,
      key: string = randomUUID(),
      status = 200,
      headers?: Record<string, string>,
    ) =>
      request('updateMe', '/v1/me', status, {
        method: 'PATCH',
        token: account.token,
        body,
        headers: {
          'X-Expected-Version': String(version),
          'Idempotency-Key': key,
          ...headers,
        },
      });

    const administrator = await google('administrator');
    const administratorInput = {
      uid: administrator.uid,
      email: administrator.email,
      displayName: 'Initial administrator',
      handle: 'initial-administrator',
    };
    await t.test(
      'bootstrap independently matches UID/email, serializes initial creation and is idempotent',
      async () => {
        await assert.rejects(
          bootstrapAdmin(
            identity,
            members,
            { ...administratorInput, uid: 'wrong-uid' },
            trace(),
          ),
          apiError('INVALID_CREDENTIAL'),
        );
        const other = await google('other-administrator');
        const outcomes = await Promise.allSettled([
          bootstrapAdmin(identity, members, administratorInput, trace()),
          bootstrapAdmin(
            identity,
            members,
            {
              uid: other.uid,
              email: other.email,
              displayName: 'Other administrator',
              handle: 'other-administrator',
            },
            trace(),
          ),
        ]);
        assert.equal(
          outcomes.filter((result) => result.status === 'fulfilled').length,
          1,
        );
        assert.equal(
          outcomes.filter(
            (result) =>
              result.status === 'rejected' &&
              apiError('ADMIN_ALREADY_INITIALIZED')(result.reason),
          ).length,
          1,
        );
        const created = await database.prisma.member.findFirstOrThrow({
          where: { role: 'ADMIN' },
        });
        const input =
          created.identityUid === administrator.uid
            ? administratorInput
            : {
                uid: other.uid,
                email: other.email,
                displayName: 'Other administrator',
                handle: 'other-administrator',
              };
        const replay = await bootstrapAdmin(identity, members, input, trace());
        assert.equal(replay.id, created.id);
        const job = await promisify(execFile)(
          process.execPath,
          ['node_modules/tsx/dist/cli.mjs', 'src/ops/bootstrap-admin.ts'],
          {
            env: {
              ...process.env,
              CURSOR_SIGNING_KEY: undefined,
              INITIAL_ADMIN_UID: input.uid,
              INITIAL_ADMIN_EMAIL: input.email,
              INITIAL_ADMIN_DISPLAY_NAME: input.displayName,
              INITIAL_ADMIN_HANDLE: input.handle,
            },
            timeout: 15_000,
          },
        );
        const events = job.stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        assert.deepEqual(
          events.map((event) => event.event),
          ['administrator_initialized', 'job_completed'],
        );
        assert.equal(events[0].memberId, created.id);
        for (const value of [input.uid, input.email])
          assert.equal(job.stdout.includes(value), false);
        assert.equal(
          await database.prisma.auditEvent.count({
            where: { action: 'INITIAL_ADMIN_BOOTSTRAPPED' },
          }),
          1,
        );
        assert.equal(
          await database.prisma.member.count({
            where: { active: true, role: 'ADMIN' },
          }),
          1,
        );
      },
    );
    const author = await google('author');
    const authorRow = await member(author);
    await t.test(
      'real SDK accepts Identity Platform Google tokens and exposes only the private Me projection',
      async () => {
        const result = await me(author);
        assert.equal(result.body.data.role, 'AUTHOR');
        assert.equal(result.body.data.id, authorRow.id);
        assert.equal(result.response.headers.get('x-resource-version'), '1');
        assert.deepEqual(Object.keys(result.body.data).sort(), [
          'active',
          'bio',
          'displayName',
          'email',
          'handle',
          'id',
          'role',
          'version',
        ]);
      },
    );
    await t.test(
      'custom token role claims never replace current SQL role or active status',
      async () => {
        await admin.setCustomUserClaims(author.uid, {
          role: 'ADMIN',
          active: true,
        });
        const renewed = await google('author', author.subject, author.email);
        author.token = renewed.token;
        assert.equal((await me(author)).body.data.role, 'AUTHOR');
        await database.prisma.member.update({
          where: { id: authorRow.id },
          data: { role: 'EDITOR' },
        });
        assert.equal((await me(author)).body.data.role, 'EDITOR');
        await database.prisma.member.update({
          where: { id: authorRow.id },
          data: { role: 'AUTHOR' },
        });
      },
    );
    await t.test(
      'nonmembers are denied without automatic membership or web-session creation',
      async () => {
        const outsider = await google('outsider');
        const before = await database.prisma.member.count();
        assert.equal(
          (await me(outsider, 403)).body.error.code,
          'INSUFFICIENT_PERMISSION',
        );
        await exchange(outsider, 403);
        assert.equal(await database.prisma.member.count(), before);
        assert.equal(await database.prisma.idempotencyRecord.count(), 0);
      },
    );
    await t.test(
      'raw Google, wrong-project, expired, non-Google and unverified credentials are rejected',
      async () => {
        await me({ ...author, token: author.rawGoogleToken }, 401);
        await me(
          { ...author, token: mutate(author.token, { aud: 'wrong-project' }) },
          401,
        );
        const expired = await me(
          {
            ...author,
            token: mutate(author.token, {
              exp: Math.floor(Date.now() / 1000) - 1,
            }),
          },
          401,
        );
        assert.equal(expired.body.error.code, 'AUTHENTICATION_EXPIRED');
        const passwordEmail = `password-${randomUUID()}@example.test`;
        await admin.createUser({
          email: passwordEmail,
          emailVerified: true,
          password: 'disposable-password-123',
        });
        const password = await rest('signInWithPassword', {
          email: passwordEmail,
          password: 'disposable-password-123',
          returnSecureToken: true,
        });
        await me({ ...author, token: password.idToken! }, 401);
        await me(
          { ...author, token: mutate(author.token, { email_verified: false }) },
          401,
        );
        await me({ ...author, token: 'mock-fixture-credential' }, 401);
      },
    );
    let session = '';
    await t.test(
      'recent-token exchange mints a five-day session verified by the SDK, with live SQL membership',
      async () => {
        const result = await exchange(author);
        session = result.body.data.sessionCookie;
        const verified = await admin.verifySessionCookie(session, true);
        assert.equal(verified.uid, author.uid);
        assert.ok(
          verified.exp - verified.iat >= 431_999 &&
            verified.exp - verified.iat <= 432_001,
        );
        assert.equal(result.body.data.member.id, authorRow.id);
        assert.equal(result.body.meta.idempotency, null);
        const profile = await request('getMe', '/v1/me', 200, { session });
        assert.equal(profile.body.data.id, authorRow.id);
        await database.prisma.member.update({
          where: { id: authorRow.id },
          data: { active: false },
        });
        assert.equal((await me(author, 403)).body.error.code, 'ACCESS_REVOKED');
        await request('getMe', '/v1/me', 403, { session });
        await exchange(author, 403);
        await database.prisma.member.update({
          where: { id: authorRow.id },
          data: { active: true },
        });
      },
    );
    await t.test(
      'session/ID-token mixups, ambiguous credentials, stale auth_time and direct browser exchange fail',
      async () => {
        await request('getMe', '/v1/me', 401, { session: author.token });
        await request('getMe', '/v1/me', 401, { token: session });
        await request('getMe', '/v1/me', 400, { token: author.token, session });
        await exchange(
          {
            ...author,
            token: mutate(author.token, {
              auth_time: Math.floor(Date.now() / 1000) - 301,
            }),
          },
          401,
        );
        await exchange(author, 403, { Origin: config.webOrigin });
      },
    );
    await t.test(
      'profile mutation persists through real Prisma SQL with optional-null, versions and audit',
      async () => {
        const changed = await patch(
          author,
          { displayName: 'Updated author', bio: 'Plain text biography' },
          1,
        );
        assert.equal(changed.body.data.version, 2);
        assert.equal(changed.body.meta.idempotency?.replayed, false);
        assert.equal(changed.response.headers.get('x-resource-version'), '2');
        assert.equal((await me(author)).body.data.bio, 'Plain text biography');
        assert.equal((await patch(author, { bio: null }, 2)).body.data.bio, '');
        const unchanged = await patch(author, { bio: '' }, 3);
        assert.equal(unchanged.body.data.version, 3);
        assert.equal(
          await database.prisma.auditEvent.count({
            where: { subjectId: authorRow.id, action: 'PROFILE_UPDATED' },
          }),
          2,
        );
      },
    );
    await t.test(
      'completed replay returns the original result/version and current trace after a newer edit',
      async () => {
        const key = randomUUID();
        const original = await patch(
          author,
          { bio: 'Original save', displayName: 'Original name' },
          3,
          key,
        );
        await patch(author, { bio: 'Newer save' }, 4);
        const replay = await patch(
          author,
          { displayName: 'Original name', bio: 'Original save' },
          3,
          key,
          200,
          { 'X-Device-ID': randomUUID(), 'X-App-Version': '1.1.0' },
        );
        assert.deepEqual(replay.body.data, original.body.data);
        assert.equal(replay.body.meta.idempotency?.replayed, true);
        assert.notEqual(replay.body.traceId, original.body.traceId);
        assert.equal(
          replay.body.meta.idempotency?.expiresAt,
          original.body.meta.idempotency?.expiresAt,
        );
        assert.equal((await me(author)).body.data.bio, 'Newer save');
        assert.equal(
          (await patch(author, { bio: 'Different input' }, 3, key, 409)).body
            .error.code,
          'IDEMPOTENCY_KEY_REUSED',
        );
        await database.prisma.member.update({
          where: { id: authorRow.id },
          data: { active: false },
        });
        assert.equal(
          (
            await patch(
              author,
              { displayName: 'Original name', bio: 'Original save' },
              3,
              key,
              403,
            )
          ).body.error.code,
          'ACCESS_REVOKED',
        );
        await database.prisma.member.update({
          where: { id: authorRow.id },
          data: { active: true },
        });
      },
    );
    await t.test(
      'stale versions and invalid fields/preconditions never mutate profile or store an operation result',
      async () => {
        const count = await database.prisma.idempotencyRecord.count();
        const conflict = await patch(
          author,
          { bio: 'Stale' },
          1,
          randomUUID(),
          412,
        );
        assert.equal(conflict.body.error.code, 'VERSION_CONFLICT');
        assert.equal(conflict.body.error.context.currentVersion, 5);
        for (const input of [
          { role: 'ADMIN' },
          { active: false },
          { handle: 'new-handle' },
          { email: 'other@example.test' },
          { displayName: null },
          { displayName: ' ' },
          { bio: '\ud800' },
          { bio: '\0' },
          { bio: 'x'.repeat(501) },
        ])
          await patch(author, input, 5, randomUUID(), 422);
        await request('updateMe', '/v1/me', 428, {
          method: 'PATCH',
          token: author.token,
          body: { bio: 'Missing version' },
        });
        await patch(author, { bio: 'Missing key' }, 5, randomUUID(), 400, {
          'Idempotency-Key': 'invalid',
        });
        assert.equal(await database.prisma.idempotencyRecord.count(), count);
        assert.equal((await me(author)).body.data.version, 5);
      },
    );
    await t.test(
      'method, query and content-type rejection applies to the actual identity/profile paths',
      async () => {
        const wrongVerb = await request('getMe', '/v1/me', 405, {
          method: 'POST',
          token: author.token,
          body: {},
        });
        assert.equal(
          wrongVerb.response.headers.get('allow'),
          'GET, HEAD, PATCH, OPTIONS',
        );
        await request('createWebSession', '/v1/auth/web-session', 405);
        await request('getMe', '/v1/me?role=ADMIN', 422, {
          token: author.token,
        });
        for (const [path, operation, method] of [
          ['/v1/me', 'updateMe', 'PATCH'],
          ['/v1/auth/web-session', 'createWebSession', 'POST'],
        ])
          await request(operation!, path!, 415, {
            method,
            token: author.token,
            body: {},
            headers: { 'Content-Type': 'text/plain' },
          });
        await request('createWebSession', '/v1/auth/web-session', 422, {
          method: 'POST',
          body: { idToken: author.token, role: 'ADMIN' },
        });
        await request('createWebSession', '/v1/auth/web-session', 422, {
          method: 'POST',
          body: {},
        });
        await request('getMe', '/v1/me', 401);
      },
    );
    await t.test(
      'a dropped HTTP response after commit recovers through the original idempotent result',
      async () => {
        const recovering = await google('response-loss');
        const row = await member(recovering);
        const key = randomUUID();
        const input = { bio: 'Committed before the connection was lost' };
        let complete!: () => void;
        let fail!: (error: unknown) => void;
        const committed = new Promise<void>((resolve, reject) => {
          complete = resolve;
          fail = reject;
        });
        const proxy = createServer((incoming, outgoing) => {
          incoming.resume();
          void (async () => {
            const response = await fetch(origin + '/v1/me', {
              method: 'PATCH',
              headers: {
                ...metadata,
                Authorization: `Bearer ${recovering.token}`,
                'Content-Type': 'application/json',
                'X-Expected-Version': '1',
                'Idempotency-Key': key,
              },
              body: JSON.stringify(input),
              signal: AbortSignal.timeout(10_000),
            });
            const bytes = Buffer.from(await response.arrayBuffer());
            assert.equal(response.status, 200);
            assertConforms('updateMe', {
              method: 'PATCH',
              path: '/v1/me',
              status: response.status,
              headers: Object.fromEntries(response.headers),
              body: bytes,
            });
            complete();
          })()
            .catch(fail)
            .finally(() => outgoing.destroy());
        });
        await new Promise<void>((resolve) =>
          proxy.listen(0, '127.0.0.1', resolve),
        );
        try {
          const endpoint = proxy.address();
          assert.ok(endpoint && typeof endpoint !== 'string');
          await assert.rejects(
            fetch(`http://127.0.0.1:${endpoint.port}/v1/me`, {
              method: 'PATCH',
              body: JSON.stringify(input),
              signal: AbortSignal.timeout(10_000),
            }),
          );
          await committed;
          const recovered = await patch(recovering, input, 1, key);
          assert.equal(recovered.body.meta.idempotency?.replayed, true);
          assert.equal(recovered.body.data.version, 2);
          assert.equal(
            await database.prisma.auditEvent.count({
              where: { subjectId: row.id, action: 'PROFILE_UPDATED' },
            }),
            1,
          );
        } finally {
          await new Promise<void>((resolve) => proxy.close(() => resolve()));
        }
      },
    );
    await t.test(
      'expired idempotency records stop replaying and cannot bypass current version checks',
      async () => {
        const expiring = await google('expired-replay');
        await member(expiring);
        const key = randomUUID();
        await patch(expiring, { bio: 'First' }, 1, key);
        await database.prisma.idempotencyRecord.updateMany({
          where: { identityUid: expiring.uid, key },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await patch(expiring, { bio: 'First' }, 1, key, 412);
        const replacement = await patch(expiring, { bio: 'Second' }, 2, key);
        assert.equal(replacement.body.meta.idempotency?.replayed, false);
        assert.equal(replacement.body.data.version, 3);
      },
    );
    await t.test(
      'real concurrent saves of one version have one commit and one conflict',
      async () => {
        const racing = await google('racing');
        const row = await member(racing);
        const results = await Promise.all(
          ['Left', 'Right'].map(async (bio) => {
            const response = await fetch(origin + '/v1/me', {
              method: 'PATCH',
              headers: {
                ...metadata,
                Authorization: `Bearer ${racing.token}`,
                'Content-Type': 'application/json',
                'X-Expected-Version': '1',
                'Idempotency-Key': randomUUID(),
              },
              body: JSON.stringify({ bio }),
            });
            const bytes = Buffer.from(await response.arrayBuffer());
            assertConforms('updateMe', {
              method: 'PATCH',
              path: '/v1/me',
              status: response.status,
              headers: Object.fromEntries(response.headers),
              body: bytes,
            });
            return response.status;
          }),
        );
        assert.deepEqual(results.sort(), [200, 412]);
        assert.equal(
          (
            await database.prisma.member.findUniqueOrThrow({
              where: { id: row.id },
            })
          ).version,
          2,
        );
        assert.equal(
          await database.prisma.auditEvent.count({
            where: { subjectId: row.id, action: 'PROFILE_UPDATED' },
          }),
          1,
        );
      },
    );
    await t.test(
      'an in-progress SQL operation returns bounded retry metadata without waiting on its row',
      async () => {
        const key = randomUUID();
        let acquired!: () => void;
        let release!: () => void;
        const ready = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const finish = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holder = database.prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([author.uid, 'PATCH', '/v1/me', key])}, 0))`;
            acquired();
            await finish;
          },
          { timeout: 10_000 },
        );
        try {
          await ready;
          const result = await patch(
            author,
            { bio: 'In progress' },
            5,
            key,
            409,
          );
          assert.equal(result.body.error.code, 'IDEMPOTENCY_IN_PROGRESS');
          assert.equal(result.response.headers.get('retry-after'), '1');
        } finally {
          release();
          await holder;
        }
      },
    );
    await t.test(
      'write and identity quotas are SQL-backed, replay-safe and expire with database time',
      async () => {
        const limited = await google('limited');
        const row = await member(limited);
        const firstKey = randomUUID();
        await patch(limited, { bio: '' }, 1, firstKey);
        for (let i = 1; i < 30; i++) await patch(limited, { bio: '' }, 1);
        assert.equal(
          (await patch(limited, { bio: '' }, 1, firstKey)).body.meta.idempotency
            ?.replayed,
          true,
        );
        const throttled = await patch(
          limited,
          { bio: '' },
          1,
          randomUUID(),
          429,
        );
        assert.equal(throttled.body.error.code, 'RATE_LIMITED');
        assert.ok(Number(throttled.response.headers.get('retry-after')) >= 1);
        assert.equal(
          (
            await database.prisma.rateLimitBucket.aggregate({
              where: { memberId: row.id, action: 'WRITE' },
              _sum: { count: true },
            })
          )._sum.count,
          30,
        );
        await database.prisma.rateLimitBucket.updateMany({
          where: { memberId: row.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await patch(limited, { bio: 'After expiry' }, 1);
        for (let i = 0; i < 5; i++) await exchange(limited);
        const identityLimit = await exchange(limited, 429);
        assert.equal(identityLimit.body.error.code, 'RATE_LIMITED');
        assert.ok(
          Number(identityLimit.response.headers.get('retry-after')) >= 1,
        );
      },
    );
    await t.test(
      'revocation and provider disablement invalidate both credential schemes on the next request',
      async () => {
        const revoked = await google('revoked');
        await member(revoked);
        const before = await exchange(revoked);
        await delay(1100); // Firebase revocation timestamps have whole-second precision.
        await admin.revokeRefreshTokens(revoked.uid);
        assert.equal(
          (await me(revoked, 401)).body.error.code,
          'AUTHENTICATION_EXPIRED',
        );
        await request('getMe', '/v1/me', 401, {
          session: before.body.data.sessionCookie,
        });
        const disabled = await google('provider-disabled');
        await member(disabled);
        await admin.updateUser(disabled.uid, { disabled: true });
        assert.equal(
          (await me(disabled, 401)).body.error.code,
          'AUTHENTICATION_EXPIRED',
        );
      },
    );
    await t.test(
      'refreshed verified email updates only the existing UID membership and audit, while old claims require refresh',
      async () => {
        const changed = await google('email-change');
        const row = await member(changed);
        const newEmail = `changed-${randomUUID()}@example.test`;
        // Complete the provider account's verified-email change, then obtain refreshed ID claims.
        await admin.updateUser(changed.uid, {
          email: newEmail,
          emailVerified: true,
        });
        const next = await google('email-change', changed.subject, newEmail);
        assert.equal(next.uid, changed.uid);
        assert.equal(
          (await me(changed, 401)).body.error.code,
          'AUTHENTICATION_EXPIRED',
        );
        const updated = await me(next);
        assert.equal(updated.body.data.id, row.id);
        assert.equal(updated.body.data.version, 2);
        assert.equal(updated.body.data.email, next.email);
        await me(next);
        assert.equal(
          await database.prisma.auditEvent.count({
            where: { subjectId: row.id, action: 'IDENTITY_EMAIL_UPDATED' },
          }),
          1,
        );
      },
    );
    await t.test(
      'no credential/session or profile content enters operation replay or audit storage',
      async () => {
        const operations = JSON.stringify(
          await database.prisma.idempotencyRecord.findMany(),
        );
        const audits = JSON.stringify(
          await database.prisma.auditEvent.findMany(),
        );
        for (const secret of [author.token, session, author.rawGoogleToken]) {
          assert.ok(secret.length > 20);
          assert.equal(operations.includes(secret), false);
          assert.equal(audits.includes(secret), false);
        }
        assert.equal(audits.includes('Original save'), false);
        assert.equal(audits.includes(author.email), false);
        assert.equal(operations.includes('sessionCookie'), false);
        assert.equal(
          await database.prisma.idempotencyRecord.count({
            where: { route: '/v1/auth/web-session' },
          }),
          0,
        );
      },
    );
    await t.test(
      'real SDK and SQL connection failures return safe dependency errors',
      async () => {
        const previousAuth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
        process.env.FIREBASE_AUTH_EMULATOR_HOST = 'auth:1';
        const disconnectedIdentity = new FirebaseIdentityGateway({
          ...config,
          identityEmulatorHost: 'auth:1',
        });
        try {
          await assert.rejects(
            disconnectedIdentity.verify(author.token, 'id-token'),
            apiError('DEPENDENCY_UNAVAILABLE'),
          );
        } finally {
          process.env.FIREBASE_AUTH_EMULATOR_HOST = previousAuth;
          await disconnectedIdentity.onModuleDestroy();
        }
        const previousPort = process.env.SQL_PORT;
        let disconnectedApp;
        try {
          process.env.SQL_PORT = '1';
          disconnectedApp = await createApp(config);
        } finally {
          if (previousPort === undefined) delete process.env.SQL_PORT;
          else process.env.SQL_PORT = previousPort;
        }
        try {
          await disconnectedApp.listen(0, '127.0.0.1');
          const endpoint = disconnectedApp.getHttpServer().address();
          assert.ok(endpoint && typeof endpoint !== 'string');
          const response = await fetch(
            `http://127.0.0.1:${endpoint.port}/v1/me`,
            {
              headers: { ...metadata, Authorization: `Bearer ${author.token}` },
              signal: AbortSignal.timeout(15_000),
            },
          );
          const bytes = Buffer.from(await response.arrayBuffer());
          assert.equal(response.status, 503);
          assert.equal(response.headers.get('retry-after'), '1');
          assertConforms('getMe', {
            method: 'GET',
            path: '/v1/me',
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: bytes,
          });
          for (const privateValue of [
            author.token,
            process.env.SQL_APP_PASSWORD!,
            author.email,
          ])
            assert.equal(bytes.toString().includes(privateValue), false);
        } finally {
          await disconnectedApp.close();
        }
      },
    );
    await t.test(
      'cloud SDK mode rejects an unsigned emulator-shaped token with no emulator configuration',
      async () => {
        const old = process.env.FIREBASE_AUTH_EMULATOR_HOST;
        delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
        const cloud = new FirebaseIdentityGateway(
          readConfig(cloudEnv, 'api', cloudProvenance),
        );
        try {
          const token = mutate(author.token, {
            aud: cloudEnv.IDENTITY_PROJECT_ID,
            iss: `https://securetoken.google.com/${cloudEnv.IDENTITY_PROJECT_ID}`,
          });
          await assert.rejects(
            cloud.verify(token, 'id-token'),
            apiError('INVALID_CREDENTIAL'),
          );
        } finally {
          process.env.FIREBASE_AUTH_EMULATOR_HOST = old;
          await cloud.onModuleDestroy();
        }
      },
    );
    await t.test(
      'member version bounds reject mutation and email reconciliation without integer overflow',
      async () => {
        const bounded = await google('bounded-version');
        const row = await member(bounded);
        await database.prisma.member.update({
          where: { id: row.id },
          data: { version: 2147483647 },
        });
        assert.equal((await me(bounded)).body.data.version, 2147483647);
        assert.equal(
          (
            await patch(
              bounded,
              { bio: 'Overflow' },
              2147483647,
              randomUUID(),
              409,
            )
          ).body.error.code,
          'RESOURCE_QUOTA_EXCEEDED',
        );
        assert.equal(
          (await patch(bounded, { bio: '' }, 2147483647)).body.data.version,
          2147483647,
        );
        const email = `bounded-${randomUUID()}@example.test`;
        await admin.updateUser(bounded.uid, { email, emailVerified: true });
        const refreshed = await google(
          'bounded-version',
          bounded.subject,
          email,
        );
        assert.equal(
          (await me(refreshed, 409)).body.error.code,
          'RESOURCE_QUOTA_EXCEEDED',
        );
        assert.equal(
          (await exchange(refreshed, 409)).body.error.code,
          'RESOURCE_QUOTA_EXCEEDED',
        );
        const current = await database.prisma.member.findUniqueOrThrow({
          where: { id: row.id },
        });
        assert.equal(current.version, 2147483647);
        assert.equal(current.email, bounded.email);
      },
    );
    await request('getApiMeta', '/v1/meta', 200);
    const report = coverage('backend', executed);
    assert.equal(report.executed, 4);
    assert.equal(report.pending.length, 48);
    assert.equal(report.complete, false);
    const runId = process.env.BLOGPOST_IDENTITY_RUN_ID;
    assert.match(runId ?? '', /^[a-f0-9]{12}$/);
    await writeFile(
      `/app/.local/conformance/identity-${runId}.json`,
      JSON.stringify(
        {
          ...report,
          observedAt: new Date().toISOString(),
          runId,
          testProject: config.identityProject,
          servedBuildSha: config.buildSha,
          observedOperations: [...executed],
          evidenceKind: 'wire-successes-with-isolated-sdk-sql-scenarios',
          limitations: [
            'Emulator tokens are unsigned; real Google staging verification remains required.',
            'Does not establish the remaining 48 operations, client journeys or release readiness.',
          ],
        },
        null,
        2,
      ) + '\n',
    );
  },
);
