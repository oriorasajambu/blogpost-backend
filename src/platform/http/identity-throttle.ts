import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/api-error.js';
/** Approximate per-instance protection; only socket addresses are trusted. No IP is persisted/logged. */
export function identityThrottle(clock: () => number = Date.now) {
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  return (request: Request, _response: Response, next: NextFunction): void => {
    const route = request.path.toLowerCase().replace(/\/$/, '');
    if (
      request.method !== 'POST' ||
      !['/v1/auth/web-session', '/v1/invitations/accept'].includes(route)
    )
      return next();
    const now = clock();
    for (const [key, bucket] of buckets)
      if (bucket.expiresAt <= now) buckets.delete(key);
    const globalKey = `all:${route}`;
    const key = `${route}:${request.socket.remoteAddress ?? 'unknown'}`;
    for (const [scope, limit] of [
      [globalKey, 200],
      [key, 30],
    ] as const) {
      const bucket = buckets.get(scope);
      if (bucket && bucket.count >= limit)
        return next(
          new ApiError(
            429,
            'RATE_LIMITED',
            'Too many sign-in attempts',
            'Wait before retrying this operation.',
            [],
            null,
            Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000)),
          ),
        );
    }
    for (const scope of [globalKey, key]) {
      const bucket = buckets.get(scope);
      if (bucket) bucket.count++;
      else buckets.set(scope, { count: 1, expiresAt: now + 60_000 });
    }
    next();
  };
}
