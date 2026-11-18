import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import {
  getAuth,
  type Auth,
  type DecodedIdToken,
  type UserRecord,
} from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { ApiError } from '../../platform/errors/api-error.js';
import { invalid } from './identity.service.js';
import type {
  ActionCodeKind,
  IdentityEvidence,
  IdentityGateway,
  IdentityUser,
} from './identity.js';

export const SESSION_MILLISECONDS = 5 * 24 * 60 * 60 * 1000;
function dependency(): ApiError {
  return new ApiError(
    503,
    'DEPENDENCY_UNAVAILABLE',
    'Identity unavailable',
    'Identity verification is temporarily unavailable.',
    [],
    null,
    1,
  );
}
function failure(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const code = (error as { code?: string })?.code;
  if (
    [
      'auth/id-token-expired',
      'auth/id-token-revoked',
      'auth/session-cookie-expired',
      'auth/session-cookie-revoked',
      'auth/user-disabled',
    ].includes(code ?? '')
  )
    return invalid(true);
  if (
    [
      'auth/argument-error',
      'auth/invalid-id-token',
      'auth/invalid-session-cookie',
      'auth/user-not-found',
      'auth/invalid-argument',
    ].includes(code ?? '')
  )
    return invalid();
  return dependency();
}
function user(record: UserRecord): IdentityUser {
  return {
    uid: record.uid,
    email: record.email,
    emailVerified: record.emailVerified,
    disabled: record.disabled,
    tenantId: record.tenantId ?? undefined,
    googleProviders: record.providerData
      .filter((provider) => provider.providerId === 'google.com')
      .map((provider) => ({ uid: provider.uid, email: provider.email })),
    passwordProviders: record.providerData
      .filter((provider) => provider.providerId === 'password')
      .map((provider) => ({ uid: provider.uid, email: provider.email })),
  };
}

@Injectable()
export class FirebaseIdentityGateway
  implements IdentityGateway, OnModuleDestroy
{
  private app?: App;
  private active = 0;
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  private client(): Auth {
    if (this.config.environment === 'development') {
      if (
        !this.config.identityProject.startsWith('demo-') ||
        !this.config.identityEmulatorHost ||
        process.env.FIREBASE_AUTH_EMULATOR_HOST !==
          this.config.identityEmulatorHost
      )
        throw dependency();
    } else if (
      this.config.identityEmulatorHost ||
      Object.keys(process.env).some((key) =>
        /EMULATOR|MOCK|FIXTURE|DEBUG_IDENTITY/.test(key),
      )
    )
      throw dependency();
    this.app ??= initializeApp(
      { projectId: this.config.identityProject },
      `blogpost-${randomUUID()}`,
    );
    return getAuth(this.app);
  }
  private async execute<T>(operation: (auth: Auth) => Promise<T>): Promise<T> {
    if (this.active >= 4) throw dependency();
    let auth: Auth;
    try {
      auth = this.client();
    } catch (error) {
      throw failure(error);
    }
    this.active++;
    // A timed-out SDK request keeps its slot until it actually settles, bounding background work.
    const pending = Promise.resolve()
      .then(() => operation(auth))
      .finally(() => {
        this.active--;
      });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(dependency()), 8000);
        }),
      ]);
    } catch (error) {
      throw failure(error);
    } finally {
      clearTimeout(timeout);
    }
  }
  private async evidence(
    auth: Auth,
    claims: DecodedIdToken,
  ): Promise<IdentityEvidence> {
    const current = await auth.getUser(claims.uid);
    return {
      uid: claims.uid,
      subject: claims.sub,
      audience: claims.aud,
      issuer: claims.iss,
      email: claims.email,
      emailVerified: claims.email_verified,
      provider: claims.firebase?.sign_in_provider,
      googleIdentities: claims.firebase?.identities?.['google.com'],
      passwordIdentities: claims.firebase?.identities?.['email'],
      tenant: claims.firebase?.tenant,
      authTime: claims.auth_time,
      issuedAt: claims.iat,
      expiresAt: claims.exp,
      user: user(current),
    };
  }
  verify(
    token: string,
    kind: 'id-token' | 'session',
  ): Promise<IdentityEvidence> {
    return this.execute(async (auth) =>
      this.evidence(
        auth,
        kind === 'id-token'
          ? await auth.verifyIdToken(token, true)
          : await auth.verifySessionCookie(token, true),
      ),
    );
  }
  createSession(
    token: string,
  ): Promise<{ cookie: string; evidence: IdentityEvidence }> {
    return this.execute(async (auth) => {
      const cookie = await auth.createSessionCookie(token, {
        expiresIn: SESSION_MILLISECONDS,
      });
      return {
        cookie,
        evidence: await this.evidence(
          auth,
          await auth.verifySessionCookie(cookie, true),
        ),
      };
    });
  }
  userByEmail(email: string): Promise<IdentityUser> {
    return this.execute(async (auth) => user(await auth.getUserByEmail(email)));
  }
  findByEmail(email: string): Promise<IdentityUser | null> {
    return this.execute(async (auth) => {
      try {
        return user(await auth.getUserByEmail(email));
      } catch (error) {
        if ((error as { code?: string })?.code === 'auth/user-not-found')
          return null;
        throw error;
      }
    });
  }
  createPasswordUser(
    email: string,
    password: string,
  ): Promise<{ uid: string } | 'EXISTS'> {
    return this.execute(async (auth) => {
      try {
        const created = await auth.createUser({
          email,
          password,
          emailVerified: false,
          disabled: false,
        });
        return { uid: created.uid };
      } catch (error) {
        if ((error as { code?: string })?.code === 'auth/email-already-exists')
          return 'EXISTS' as const;
        throw error;
      }
    });
  }
  actionCode(
    kind: ActionCodeKind,
    email: string,
    newEmail?: string,
  ): Promise<string> {
    return this.execute(async (auth) => {
      const link =
        kind === 'VERIFY_EMAIL'
          ? await auth.generateEmailVerificationLink(email)
          : kind === 'PASSWORD_RESET'
            ? await auth.generatePasswordResetLink(email)
            : await auth.generateVerifyAndChangeEmailLink(email, newEmail!);
      // Only the one-time code is kept; the link itself points at Firebase's hosted handler.
      const code = new URL(link).searchParams.get('oobCode');
      if (!code) throw dependency();
      return code;
    });
  }
  async resetPassword(code: string, password: string): Promise<string> {
    const key = this.config.identityWebApiKey;
    let base: string;
    try {
      this.client(); // enforces the emulator/project rules before any request
      if (!key) throw dependency();
      base = this.config.identityEmulatorHost
        ? `http://${this.config.identityEmulatorHost}/identitytoolkit.googleapis.com`
        : 'https://identitytoolkit.googleapis.com';
    } catch (error) {
      throw failure(error);
    }
    let response: Response;
    try {
      response = await fetch(
        `${base}/v1/accounts:resetPassword?key=${encodeURIComponent(key)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ oobCode: code, newPassword: password }),
          signal: AbortSignal.timeout(8000),
        },
      );
    } catch {
      throw dependency();
    }
    const body = (await response.json().catch(() => ({}))) as {
      email?: unknown;
      error?: { message?: unknown };
    };
    if (!response.ok) {
      const message = String(body.error?.message ?? '');
      const field = /^(INVALID|EXPIRED)_OOB_CODE/.test(message)
        ? '/code'
        : message.startsWith('WEAK_PASSWORD')
          ? '/password'
          : null;
      if (field)
        throw new ApiError(
          422,
          'VALIDATION_FAILED',
          'Invalid input',
          'Correct the indicated field.',
          [{ location: 'body', field, code: 'INVALID_VALUE', params: {} }],
        );
      throw dependency();
    }
    if (typeof body.email !== 'string') throw dependency();
    return body.email.trim().toLowerCase();
  }
  setPassword(uid: string, password: string): Promise<void> {
    return this.execute(async (auth) => {
      await auth.updateUser(uid, { password });
    });
  }
  deleteUser(uid: string): Promise<void> {
    return this.execute((auth) => auth.deleteUser(uid));
  }
  revokeSessions(uid: string): Promise<void> {
    return this.execute((auth) => auth.revokeRefreshTokens(uid));
  }
  async onModuleDestroy(): Promise<void> {
    if (this.app) await deleteApp(this.app);
  }
}
