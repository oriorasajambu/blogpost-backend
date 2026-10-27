import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/platform/config/config.js';
import { DatabaseService } from '../../src/platform/database/database.service.js';
import type { MemberRole } from '../../src/modules/members/member.js';
import { metadata } from '../helpers.js';
import { assertConforms } from '../conformance/verify.js';
import type { components } from '../../contracts/generated/typescript/api-v1.js';
export type DTO = components['schemas'];
export type Account = {
  uid: string;
  email: string;
  subject: string;
  token: string;
};
export interface Body<T> {
  data: T;
  traceId: string;
  error: { code: string; context: Record<string, unknown> };
  meta: {
    pagination: DTO['CursorPagination'];
    idempotency: { replayed: boolean; expiresAt: string } | null;
  };
}
export async function identityFixture(t: TestContext) {
  assert.equal(
    process.env.BLOGPOST_DISPOSABLE_IDENTITY,
    '1',
    'Use npm run test:identity',
  );
  assert.equal(process.env.SQL_HOST, 'db');
  assert.equal(process.env.SQL_APP_PASSWORD, 'disposable-identity-app');
  assert.match(
    process.env.IDENTITY_PROJECT_ID ?? '',
    /^demo-blogpost-identity-[a-f0-9]{12}$/,
  );
  const config = readConfig();
  const database = new DatabaseService();
  const fixtureApp = initializeApp(
    { projectId: config.identityProject },
    `administration-fixture-${randomUUID()}`,
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
    await database.onModuleDestroy();
    await deleteApp(fixtureApp);
  });
  async function google(
    label: string,
    subject: string = randomUUID(),
    email = `${label}-${randomUUID()}@example.test`,
  ): Promise<Account> {
    const raw = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
        'base64url',
      ),
      Buffer.from(
        JSON.stringify({
          iss: 'https://accounts.google.com',
          sub: subject,
          aud: 'disposable-google-client',
          email,
          email_verified: true,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url'),
      '',
    ].join('.');
    const response = await fetch(
      'http://auth:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=disposable',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestUri: 'http://localhost',
          returnSecureToken: true,
          postBody: new URLSearchParams({
            providerId: 'google.com',
            id_token: raw,
          }).toString(),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    assert.equal(response.status, 200, 'Google emulator fixture failed');
    const result = (await response.json()) as {
      localId: string;
      idToken: string;
    };
    return { uid: result.localId, token: result.idToken, email, subject };
  }
  async function member(role: MemberRole = 'AUTHOR') {
    const account = await google(role.toLowerCase());
    const row = await database.prisma.member.create({
      data: {
        identityUid: account.uid,
        email: account.email,
        displayName: `Fixture ${role}`,
        handle: `fixture-${randomUUID()}`,
        role,
      },
    });
    return { ...account, row };
  }
  async function request<T>(
    operation: string,
    path: string,
    status: number | readonly number[],
    options: {
      method?: string;
      account?: Account;
      body?: unknown;
      key?: string;
      version?: number;
      headers?: Record<string, string>;
      baseOrigin?: string;
    } = {},
  ) {
    const method = options.method ?? 'GET';
    const response = await fetch((options.baseOrigin ?? origin) + path, {
      method,
      headers: {
        ...metadata,
        ...(options.account
          ? { Authorization: `Bearer ${options.account.token}` }
          : {}),
        ...(options.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
        ...(options.version !== undefined
          ? { 'X-Expected-Version': String(options.version) }
          : {}),
        ...options.headers,
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const body = JSON.parse(bytes.toString('utf8')) as Body<T>;
    assert.ok(
      (typeof status === 'number' ? [status] : status).includes(
        response.status,
      ),
      `${operation} unexpected status ${response.status}: ${body.error?.code ?? ''}`,
    );
    assertConforms(operation, {
      method,
      path,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: bytes,
    });
    if (response.ok) executed.add(operation);
    return { response, body };
  }
  return {
    config,
    database,
    admin,
    app,
    origin,
    executed,
    google,
    member,
    request,
  };
}
