import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { CONTRACT_VERSION } from './envelope.js';
import { validateCredentialSyntax, validateMetadata } from './metadata.js';

export function traceId(traceparent: unknown): string {
  if (typeof traceparent === 'string') {
    const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(
      traceparent,
    );
    if (match && match[1] !== '0'.repeat(32) && match[2] !== '0'.repeat(16))
      return match[1]!;
  }
  return randomBytes(16).toString('hex');
}

export function transport(environment: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const trace = traceId(request.headers.traceparent);
    response.locals.traceId = trace;
    response.setHeader('X-Trace-ID', trace);
    response.setHeader('X-API-Contract-Version', CONTRACT_VERSION);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (environment !== 'production')
      response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    const started = performance.now();
    response.once('finish', () => {
      // Route templates only: no URLs, query strings, headers, bodies, or connection strings.
      process.stdout.write(
        `${JSON.stringify({
          severity: 'INFO',
          traceId: trace,
          method: request.method,
          route: request.route?.path ?? 'unmatched',
          ...(typeof response.locals.actorId === 'string'
            ? { actorId: response.locals.actorId }
            : {}),
          status: response.statusCode,
          durationMs: Math.round(performance.now() - started),
        })}\n`,
      );
    });
    next();
  };
}

export function validateApplicationHeaders(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  if (
    request.method === 'OPTIONS' ||
    ['/health/live', '/health/ready'].includes(request.path)
  )
    return next();
  try {
    validateMetadata(request);
    validateCredentialSyntax(request);
    next();
  } catch (error) {
    next(error);
  }
}
