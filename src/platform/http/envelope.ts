import type { ApiError } from '../errors/api-error.js';

export const CONTRACT_VERSION = '1.0.0';
export const CONTRACT_STATUS = 'DRAFT';
export function envelope(
  traceId: string,
  statusCode: number,
  data: unknown,
  error?: ApiError,
  idempotency: { replayed: boolean; expiresAt: string } | null = null,
  pagination: unknown = null,
) {
  return {
    timestamp: new Date().toISOString(),
    responseKey: error ? 'ERROR' : 'SUCCESS',
    statusCode,
    traceId,
    message: {
      title: error?.title ?? 'Request completed',
      descriptions: error?.description ?? 'The request completed successfully.',
    },
    data: error ? null : data,
    error: error
      ? {
          code: error.code,
          fieldErrors: error.fieldErrors.slice(0, 50),
          context: error.context,
        }
      : null,
    meta: {
      contractVersion: CONTRACT_VERSION,
      pagination: error ? null : pagination,
      idempotency: error ? null : idempotency,
    },
  };
}
