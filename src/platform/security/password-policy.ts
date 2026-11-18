import { createHash } from 'node:crypto';
import { ApiError } from '../errors/api-error.js';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export type Fetch = typeof fetch;

/** Length-only policy (NIST style): no composition rules, whole passphrases and spaces allowed. */
export function passwordIssue(value: unknown): string | null {
  if (typeof value !== 'string') return 'Enter a password.';
  const length = [...value].length;
  if (length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (value.includes('\0')) return 'Remove unsupported characters.';
  return null;
}
export function invalidPassword(issue: string): ApiError {
  return new ApiError(
    422,
    'VALIDATION_FAILED',
    'Password not accepted',
    issue,
    [
      {
        location: 'body',
        field: '/password',
        code: 'INVALID_PASSWORD',
        params: {},
      },
    ],
  );
}
export function checkedPassword(value: unknown): string {
  const issue = passwordIssue(value);
  if (issue) throw invalidPassword(issue);
  return value as string;
}

/**
 * Looks the password up in the Have I Been Pwned range API. Only the first five characters of its
 * SHA-1 leave this process (k-anonymity), and responses are padded so their size reveals nothing.
 * An outage must not block sign-up, so any failure is reported as "not found".
 */
export class BreachCheck {
  constructor(
    private readonly fetcher: Fetch = fetch,
    private readonly timeoutMs = 3000,
  ) {}
  async count(password: string): Promise<number> {
    const hash = createHash('sha1')
      .update(password, 'utf8')
      .digest('hex')
      .toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    try {
      const response = await this.fetcher(
        `https://api.pwnedpasswords.com/range/${prefix}`,
        {
          headers: { 'Add-Padding': 'true', 'User-Agent': 'blogpost-api' },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!response.ok) return 0;
      const body = await response.text();
      if (body.length > 1_000_000) return 0;
      for (const line of body.split('\n')) {
        const [candidate, count] = line.trim().split(':');
        if (candidate === suffix) return Number(count) || 0;
      }
      return 0;
    } catch {
      return 0;
    }
  }
  /** Throws a validation error when the password appears in a known breach. */
  async assertNotBreached(password: string): Promise<void> {
    if ((await this.count(password)) > 0)
      throw invalidPassword(
        'This password appeared in a data breach. Choose a different one.',
      );
  }
}
