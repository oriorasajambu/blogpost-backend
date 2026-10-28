import type { Request } from 'express';
import { ApiError } from '../errors/api-error.js';

export function noQuery(request: Request): void {
  const keys = Object.keys(request.query);
  if (keys.length)
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid query',
      'This operation accepts no query parameters.',
      keys
        .sort()
        .slice(0, 50)
        .map((key) => ({
          location: 'query',
          field:
            key.length > 256
              ? ''
              : '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'),
          code: 'UNKNOWN_FIELD',
          params: {},
        })),
      keys.length > 50 ? { truncated: true } : null,
    );
}
