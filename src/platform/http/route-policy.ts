import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/api-error.js';

const methods = new Map<string, readonly string[]>([
  ['/v1/meta', ['GET', 'HEAD', 'OPTIONS']],
  ['/v1/me', ['GET', 'HEAD', 'PATCH', 'OPTIONS']],
  ['/v1/auth/web-session', ['POST', 'OPTIONS']],
  ['/v1/invitations/accept', ['POST', 'OPTIONS']],
  ['/v1/admin/members', ['GET', 'HEAD', 'OPTIONS']],
  ['/v1/admin/invitations', ['GET', 'HEAD', 'POST', 'OPTIONS']],
  ['/v1/admin/audit-events', ['GET', 'HEAD', 'OPTIONS']],
  ['/v1/posts', ['GET', 'HEAD', 'POST', 'OPTIONS']],
  ['/v1/categories', ['GET', 'HEAD', 'POST', 'OPTIONS']],
  ['/v1/tags', ['GET', 'HEAD', 'POST', 'OPTIONS']],
  ['/v1/public/posts', ['GET', 'HEAD', 'OPTIONS']],
  ['/v1/public/search', ['GET', 'HEAD', 'OPTIONS']],
  ['/v1/public/categories', ['GET', 'HEAD', 'OPTIONS']],
  ['/v1/public/tags', ['GET', 'HEAD', 'OPTIONS']],
  ['/v1/public/posts/availability', ['POST', 'OPTIONS']],
]);

const resourceMethods: [RegExp, readonly string[]][] = [
  [/^\/v1\/(categories|tags)\/[^/]+$/, ['GET', 'HEAD', 'PATCH', 'OPTIONS']],
  [
    /^\/v1\/public\/(posts\/[^/]+|posts\/by-slug\/[^/]+|authors\/[^/]+)$/,
    ['GET', 'HEAD', 'OPTIONS'],
  ],
  [/^\/v1\/posts\/by-client-draft-id\/[^/]+$/, ['GET', 'HEAD', 'OPTIONS']],
  [/^\/v1\/posts\/[^/]+$/, ['GET', 'HEAD', 'DELETE', 'OPTIONS']],
  [/^\/v1\/posts\/[^/]+\/draft$/, ['PUT', 'OPTIONS']],
  [
    /^\/v1\/posts\/[^/]+\/(submit|withdraw-review|reject|publish|unpublish|restore-revision|restore)$/,
    ['POST', 'OPTIONS'],
  ],
  [
    /^\/v1\/posts\/[^/]+\/slug$|^\/v1\/admin\/posts\/[^/]+\/author$/,
    ['PATCH', 'OPTIONS'],
  ],
  [
    /^\/v1\/posts\/[^/]+\/(revisions(?:\/[^/]+)?|review-events)$/,
    ['GET', 'HEAD', 'OPTIONS'],
  ],
  [/^\/v1\/admin\/members\/[^/]+$/, ['GET', 'HEAD', 'PATCH', 'OPTIONS']],
  [/^\/v1\/admin\/invitations\/[^/]+$/, ['GET', 'HEAD', 'OPTIONS']],
  [/^\/v1\/admin\/invitations\/[^/]+\/(revoke|reissue)$/, ['POST', 'OPTIONS']],
  [/^\/v1\/posts\/[^/]+\/media$/, ['POST', 'OPTIONS']],
  [/^\/v1\/posts\/[^/]+\/media\/[^/]+$/, ['GET', 'HEAD', 'OPTIONS']],
  [
    /^\/v1\/(?:public\/)?posts\/[^/]+\/media\/[^/]+\/[^/]+$/,
    ['GET', 'HEAD', 'OPTIONS'],
  ],
];

/** Applies transport rules to the executable JSON and media route surface. */
export function routePolicy(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const path = request.path.toLowerCase().replace(/\/$/, '');
  const allowed =
    methods.get(path) ??
    resourceMethods.find(([pattern]) => pattern.test(path))?.[1];
  if (!allowed) return next();
  if (!allowed.includes(request.method)) {
    response.setHeader('Allow', allowed.join(', '));
    return next(
      new ApiError(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'Use a supported method.',
      ),
    );
  }
  const upload =
    request.method === 'POST' && /^\/v1\/posts\/[^/]+\/media$/.test(path);
  if (
    upload &&
    !/^multipart\/form-data(?:\s*;|\s*$)/i.test(
      request.headers['content-type'] ?? '',
    )
  )
    return next(
      new ApiError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Multipart required',
        'Send a multipart/form-data image upload.',
      ),
    );
  if (
    ['PATCH', 'POST', 'PUT'].includes(request.method) &&
    !upload &&
    !/^application\/json(?:\s*;|\s*$)/i.test(
      request.headers['content-type'] ?? '',
    )
  )
    return next(
      new ApiError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'JSON required',
        'Send an application/json request body.',
      ),
    );
  next();
}
