import { ApiError } from '../errors/api-error.js';
import type { Fetch } from './password-policy.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile verification for the public register and forgot-password endpoints. It fails
 * closed: when the provider is unreachable the request is refused rather than skipping the check.
 */
export class CaptchaVerifier {
  constructor(
    private readonly secret: string | null,
    private readonly fetcher: Fetch = fetch,
    private readonly timeoutMs = 4000,
  ) {}
  /** Without a secret (development), every request passes. */
  get enabled(): boolean {
    return this.secret !== null;
  }
  async assert(token: unknown, remoteIp: string | null): Promise<void> {
    if (!this.secret) return;
    if (typeof token !== 'string' || !token || token.length > 2048)
      throw rejected();
    const form = new URLSearchParams({ secret: this.secret, response: token });
    if (remoteIp) form.set('remoteip', remoteIp);
    let verdict: { success?: boolean };
    try {
      const response = await this.fetcher(VERIFY_URL, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw unavailable();
      verdict = (await response.json()) as { success?: boolean };
    } catch (error) {
      throw error instanceof ApiError ? error : unavailable();
    }
    if (verdict.success !== true) throw rejected();
  }
}
function rejected(): ApiError {
  return new ApiError(
    422,
    'CAPTCHA_FAILED',
    'Verification failed',
    'Complete the verification challenge and try again.',
  );
}
function unavailable(): ApiError {
  return new ApiError(
    503,
    'DEPENDENCY_UNAVAILABLE',
    'Verification unavailable',
    'The verification service is temporarily unavailable.',
    [],
    null,
    5,
  );
}
