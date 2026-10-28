import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { map } from 'rxjs';
import { envelope } from './envelope.js';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    return next
      .handle()
      .pipe(
        map((data: unknown) =>
          request.path.startsWith('/health/') || data instanceof StreamableFile
            ? data
            : envelope(
                response.locals.traceId as string,
                response.statusCode,
                data,
                undefined,
                response.locals.idempotency ?? null,
                response.locals.pagination ?? null,
              ),
        ),
      );
  }
}
