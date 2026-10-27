import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../../platform/errors/api-error.js';
import { isUnicodeScalarText } from '../../platform/text/unicode.js';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import {
  IDENTITY_GATEWAY,
  type IdentityGateway,
  type IdentityEvidence,
  type IdentityUser,
  type VerifiedIdentity,
} from './identity.js';

const emailFormat =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
export function normalizeIdentityEmail(value: unknown): string {
  if (typeof value !== 'string') throw invalid();
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !emailFormat.test(email)) throw invalid();
  return email;
}
export function invalid(expired = false): ApiError {
  return new ApiError(
    401,
    expired ? 'AUTHENTICATION_EXPIRED' : 'INVALID_CREDENTIAL',
    'Authentication required',
    'Sign in again with the configured Google identity provider.',
  );
}
export function googleUser(user: IdentityUser): { uid: string; email: string } {
  const email = normalizeIdentityEmail(user.email);
  if (
    user.disabled ||
    !user.emailVerified ||
    user.tenantId !== undefined ||
    typeof user.uid !== 'string' ||
    user.uid.length < 1 ||
    [...user.uid].length > 128 ||
    user.uid.includes('\0') ||
    !isUnicodeScalarText(user.uid) ||
    !user.googleProviders.some(
      (provider) =>
        provider.uid &&
        provider.email !== undefined &&
        normalizeIdentityEmail(provider.email) === email,
    )
  )
    throw invalid();
  return { uid: user.uid, email };
}

@Injectable()
export class IdentityService {
  constructor(
    @Inject(IDENTITY_GATEWAY) private readonly gateway: IdentityGateway,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private validate(
    evidence: IdentityEvidence,
    kind: VerifiedIdentity['kind'],
  ): VerifiedIdentity {
    const now = Math.floor(Date.now() / 1000);
    const user = googleUser(evidence.user);
    const issuer =
      kind === 'id-token'
        ? 'https://securetoken.google.com/'
        : 'https://session.firebase.google.com/';
    const email = normalizeIdentityEmail(evidence.email);
    if (
      evidence.uid !== user.uid ||
      evidence.subject !== user.uid ||
      evidence.audience !== this.config.identityProject ||
      evidence.issuer !== issuer + this.config.identityProject ||
      evidence.emailVerified !== true ||
      evidence.provider !== 'google.com' ||
      evidence.tenant !== undefined ||
      !Array.isArray(evidence.googleIdentities) ||
      !evidence.user.googleProviders.some(
        (provider) =>
          provider.email !== undefined &&
          normalizeIdentityEmail(provider.email) === user.email &&
          evidence.googleIdentities instanceof Array &&
          evidence.googleIdentities.includes(provider.uid),
      )
    )
      throw invalid();
    if (email !== user.email) throw invalid(true);
    if (
      !Number.isSafeInteger(evidence.authTime) ||
      (evidence.authTime as number) <= 0 ||
      (evidence.authTime as number) > now + 30 ||
      !Number.isSafeInteger(evidence.expiresAt) ||
      !Number.isSafeInteger(evidence.issuedAt) ||
      (evidence.issuedAt as number) > now + 30 ||
      (evidence.issuedAt as number) <= 0 ||
      (evidence.expiresAt as number) - (evidence.issuedAt as number) >
        (kind === 'session' ? 432000 : 3600) + 30
    )
      throw invalid();
    if ((evidence.expiresAt as number) <= now) throw invalid(true);
    return {
      uid: user.uid,
      email,
      authTime: evidence.authTime as number,
      expiresAt: evidence.expiresAt as number,
      kind,
    };
  }
  async verify(
    token: string,
    kind: VerifiedIdentity['kind'],
  ): Promise<VerifiedIdentity> {
    if (!token || token.length > 65536 || !/^[A-Za-z0-9._~-]+$/.test(token))
      throw invalid();
    return this.validate(await this.gateway.verify(token, kind), kind);
  }
  async recentIdentity(token: string): Promise<VerifiedIdentity> {
    const identity = await this.verify(token, 'id-token');
    if (Date.now() / 1000 - identity.authTime > 300) throw invalid(true);
    return identity;
  }
  async createSession(
    token: string,
    identity: VerifiedIdentity,
  ): Promise<{
    sessionCookie: string;
    expiresAt: string;
    identity: VerifiedIdentity;
  }> {
    const minted = await this.gateway.createSession(token);
    const verified = this.validate(minted.evidence, 'session');
    if (
      verified.uid !== identity.uid ||
      verified.email !== identity.email ||
      verified.authTime !== identity.authTime ||
      Date.now() / 1000 - verified.authTime > 300 ||
      !minted.cookie ||
      minted.cookie.length > 16384
    )
      throw invalid();
    return {
      sessionCookie: minted.cookie,
      expiresAt: new Date(verified.expiresAt * 1000).toISOString(),
      identity: verified,
    };
  }
  async googleAccount(email: string): Promise<{ uid: string; email: string }> {
    return googleUser(
      await this.gateway.userByEmail(normalizeIdentityEmail(email)),
    );
  }
}
