import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { json, type Request, type Response, type NextFunction } from 'express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './platform/config/config.js';
import { ApiError, type FieldIssue } from './platform/errors/api-error.js';
import { ApiExceptionFilter } from './platform/http/api-exception.filter.js';
import { EnvelopeInterceptor } from './platform/http/envelope.interceptor.js';
import { METADATA_HEADERS } from './platform/http/metadata.js';
import { routePolicy } from './platform/http/route-policy.js';
import { identityThrottle } from './platform/http/identity-throttle.js';
import {
  transport,
  validateApplicationHeaders,
} from './platform/http/transport.js';

function fieldIssues(errors: ValidationError[], prefix = ''): FieldIssue[] {
  return errors
    .flatMap((error) => {
      const field = `${prefix}/${error.property.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      return [
        ...Object.keys(error.constraints ?? {}).map((code) => ({
          location: 'body' as const,
          field,
          code,
          params: {},
        })),
        ...fieldIssues(error.children ?? [], field),
      ];
    })
    .sort((a, b) => a.field.localeCompare(b.field));
}
export async function createApp(config: AppConfig) {
  const app = await NestFactory.create(AppModule.configure(config), {
    bodyParser: false,
    logger: false,
  });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.getHttpAdapter().getInstance().set('trust proxy', false);
  app.use(transport(config.environment));
  app.enableCors({
    origin: config.webOrigin,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      ...METADATA_HEADERS,
      'Authorization',
      'X-Blogpost-Web-Session',
      'Content-Type',
      'X-Expected-Version',
      'Idempotency-Key',
      'traceparent',
      'tracestate',
    ],
    exposedHeaders: [
      'X-Trace-ID',
      'X-API-Contract-Version',
      'X-Resource-Version',
      'Location',
      'Retry-After',
    ],
  });
  app.use(validateApplicationHeaders);
  app.use(identityThrottle());
  app.use(json({ limit: '1mb', strict: true }));
  app.use(routePolicy);
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path.toLowerCase().replace(/\/$/, '') === '/v1/meta') {
      const keys = Object.keys(request.query);
      if (keys.length)
        return next(
          new ApiError(
            422,
            'VALIDATION_FAILED',
            'Validation failed',
            'This operation does not accept query parameters.',
            keys
              .sort()
              .slice(0, 50)
              .map((key) => ({
                location: 'query',
                field: `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
                code: 'UNKNOWN_FIELD',
                params: {},
              })),
            keys.length > 50 ? { truncated: true } : null,
          ),
        );
    }
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
      exceptionFactory: (errors) => {
        const issues = fieldIssues(errors);
        return new ApiError(
          422,
          'VALIDATION_FAILED',
          'Validation failed',
          'Check the indicated fields.',
          issues.slice(0, 50),
          issues.length > 50 ? { truncated: true } : null,
        );
      },
    }),
  );
  app.enableShutdownHooks();
  return app;
}
