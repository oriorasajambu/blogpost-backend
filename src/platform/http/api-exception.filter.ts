import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { ApiError } from '../errors/api-error.js';
import { envelope } from './envelope.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status =
      exception instanceof ApiError
        ? exception.status
        : exception instanceof HttpException
          ? exception.getStatus()
          : ((exception as { status?: number })?.status ?? 500);
    const safeStatus = status >= 400 && status <= 599 ? status : 500;
    if (['/health/live', '/health/ready'].includes(request.path)) {
      response.status(safeStatus).json({ status: 'unavailable' });
      return;
    }
    const code =
      safeStatus === 404
        ? 'RESOURCE_NOT_FOUND'
        : safeStatus === 413
          ? 'PAYLOAD_TOO_LARGE'
          : safeStatus === 415
            ? 'UNSUPPORTED_MEDIA_TYPE'
            : safeStatus === 400
              ? 'MALFORMED_JSON'
              : safeStatus === 503
                ? 'DEPENDENCY_UNAVAILABLE'
                : 'INTERNAL_ERROR';
    const error =
      exception instanceof ApiError
        ? exception
        : new ApiError(
            safeStatus,
            code,
            safeStatus >= 500 ? 'Service unavailable' : 'Request rejected',
            safeStatus >= 500
              ? 'The request could not be completed.'
              : 'The request is invalid or the resource is unavailable.',
          );
    if (error.retryAfterSeconds !== undefined)
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    response
      .status(error.status)
      .json(
        envelope(response.locals.traceId as string, error.status, null, error),
      );
  }
}
