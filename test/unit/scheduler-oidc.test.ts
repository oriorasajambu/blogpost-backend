import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, type JsonWebKey } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import {
  GoogleOidcVerifier,
  SchedulerGuard,
  type OidcVerifier,
} from '../../src/modules/email/scheduler-oidc.js';
import type { AppConfig } from '../../src/platform/config/config.js';

const audience = 'https://api.staging.example.com';
const invoker = 'blogpost-scheduler@blogpost-staging.iam.gserviceaccount.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...(publicKey.export({ format: 'jwk' }) as JsonWebKey),
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};
const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = { alg: 'RS256', kid: 'test-key' },
) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64(header)}.${b64({
    iss: 'https://accounts.google.com',
    aud: audience,
    email: invoker,
    email_verified: true,
    iat: now,
    exp: now + 3600,
    ...claims,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(body);
  return `${body}.${signer.sign(privateKey).toString('base64url')}`;
}
function withCerts<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { 'cache-control': 'public, max-age=3600' },
    })) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test('Google OIDC verifier accepts only correctly signed RS256 tokens with known keys', () =>
  withCerts(async () => {
    const verifier = new GoogleOidcVerifier();
    const good = token();
    assert.equal((await verifier.verify(good))?.email, invoker);
    const [header, body, signature] = good.split('.');
    // A different payload under the original signature.
    const forged = `${header}.${b64({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), email: 'attacker@example.com' })}.${signature}`;
    assert.equal(await verifier.verify(forged), null);
    assert.equal(await verifier.verify(`${header}.${body}.`), null);
    assert.equal(
      await verifier.verify(token({}, { alg: 'none', kid: 'test-key' })),
      null,
    );
    assert.equal(
      await verifier.verify(token({}, { alg: 'HS256', kid: 'test-key' })),
      null,
    );
    assert.equal(
      await verifier.verify(token({}, { alg: 'RS256', kid: 'unknown' })),
      null,
    );
    assert.equal(
      await verifier.verify(
        token({ exp: Math.floor(Date.now() / 1000) - 600 }),
      ),
      null,
    );
    assert.equal(await verifier.verify(token({ email_verified: false })), null);
    assert.equal(await verifier.verify('not-a-token'), null);
  }));

function context(authorization?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}
const config = (email: Partial<NonNullable<AppConfig['email']>> | null) =>
  ({
    email: email && {
      driver: 'resend',
      from: 'x@example.com',
      payloadKey: '1'.repeat(64),
      resendApiKey: 're_x',
      dispatchAudience: audience,
      dispatchInvoker: invoker,
      cooldownSeconds: 60,
      ...email,
    },
  }) as AppConfig;
const notFound = (error: { status: number }) => error.status === 404;

test('scheduler guard admits only the configured audience and service account, hiding the route otherwise', () =>
  withCerts(async () => {
    const verifier = new GoogleOidcVerifier();
    const guard = new SchedulerGuard(config({}), verifier);
    assert.equal(await guard.canActivate(context(`Bearer ${token()}`)), true);
    for (const header of [
      undefined,
      'Basic abc',
      `Bearer ${token({ aud: 'https://other.example.com' })}`,
      `Bearer ${token({ email: 'blogpost-api@blogpost-staging.iam.gserviceaccount.com' })}`,
    ])
      await assert.rejects(guard.canActivate(context(header)), notFound);
    // Without email (or without dispatch settings) the endpoint does not exist.
    const always: OidcVerifier = {
      verify: async () => ({
        iss: '',
        aud: audience,
        email: invoker,
        email_verified: true,
        exp: 0,
        iat: 0,
      }),
    };
    await assert.rejects(
      new SchedulerGuard(config(null), always).canActivate(
        context(`Bearer ${token()}`),
      ),
      notFound,
    );
    await assert.rejects(
      new SchedulerGuard(
        config({ dispatchAudience: null }),
        always,
      ).canActivate(context(`Bearer ${token()}`)),
      notFound,
    );
  }));
