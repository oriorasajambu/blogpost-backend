import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import { ApiError } from '../../platform/errors/api-error.js';

export const OIDC_VERIFIER = Symbol('OIDC_VERIFIER');
export interface OidcClaims {
  iss: string;
  aud: string;
  email: string;
  email_verified: boolean;
  exp: number;
  iat: number;
}
export interface OidcVerifier {
  /** Returns the verified claims, or null when the token is not a valid Google-signed ID token. */
  verify(token: string): Promise<OidcClaims | null>;
}

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SKEW_SECONDS = 60;

function part(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}
/** Checks claims of an already signature-verified token. Exported for tests. */
export function acceptableClaims(
  value: unknown,
  nowSeconds: number,
): OidcClaims | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (
    typeof c.iss !== 'string' ||
    !ISSUERS.includes(c.iss) ||
    typeof c.aud !== 'string' ||
    typeof c.email !== 'string' ||
    c.email_verified !== true ||
    typeof c.exp !== 'number' ||
    typeof c.iat !== 'number' ||
    c.exp <= nowSeconds - SKEW_SECONDS ||
    c.iat > nowSeconds + SKEW_SECONDS ||
    c.exp - c.iat > 3600 + SKEW_SECONDS
  )
    return null;
  return c as unknown as OidcClaims;
}

/** Verifies Google-signed OIDC ID tokens (RS256) with Google's published keys. */
@Injectable()
export class GoogleOidcVerifier implements OidcVerifier {
  private keys: { expires: number; byKid: Map<string, JsonWebKey> } | null =
    null;
  private async key(kid: string): Promise<JsonWebKey | null> {
    if (
      !this.keys ||
      this.keys.expires <= Date.now() ||
      !this.keys.byKid.has(kid)
    ) {
      const response = await fetch(GOOGLE_CERTS, {
        signal: AbortSignal.timeout(5_000),
        redirect: 'error',
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { keys?: JsonWebKey[] };
      const maxAge = /max-age=(\d{1,6})/.exec(
        response.headers.get('cache-control') ?? '',
      );
      this.keys = {
        expires:
          Date.now() + Math.min(Number(maxAge?.[1] ?? 3600), 86_400) * 1000,
        byKid: new Map(
          (body.keys ?? [])
            .filter((jwk) => typeof jwk.kid === 'string' && jwk.kty === 'RSA')
            .map((jwk) => [jwk.kid as string, jwk]),
        ),
      };
    }
    return this.keys.byKid.get(kid) ?? null;
  }
  async verify(token: string): Promise<OidcClaims | null> {
    const pieces = token.split('.');
    if (pieces.length !== 3 || token.length > 4096) return null;
    try {
      const header = part(pieces[0]!) as { alg?: unknown; kid?: unknown };
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
      const jwk = await this.key(header.kid);
      if (!jwk) return null;
      const valid = verify(
        'RSA-SHA256',
        Buffer.from(`${pieces[0]}.${pieces[1]}`),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(pieces[2]!, 'base64url'),
      );
      if (!valid) return null;
      return acceptableClaims(part(pieces[1]!), Math.floor(Date.now() / 1000));
    } catch {
      return null;
    }
  }
}

/**
 * Admits only Cloud Scheduler's dedicated service account, with the configured audience.
 * Every failure is reported as not found so the internal route is not advertised.
 */
@Injectable()
export class SchedulerGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OIDC_VERIFIER) private readonly verifier: OidcVerifier,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const hidden = new ApiError(
      404,
      'RESOURCE_NOT_FOUND',
      'Not found',
      'The resource is unavailable.',
    );
    const email = this.config.email;
    if (!email?.dispatchAudience || !email.dispatchInvoker) throw hidden;
    const header = context.switchToHttp().getRequest<Request>()
      .headers.authorization;
    const match =
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
        header ?? '',
      );
    if (!match) throw hidden;
    const claims = await this.verifier.verify(match[1]!);
    if (
      !claims ||
      claims.aud !== email.dispatchAudience ||
      claims.email !== email.dispatchInvoker
    )
      throw hidden;
    return true;
  }
}
