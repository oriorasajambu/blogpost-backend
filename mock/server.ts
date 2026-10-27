import Fastify, { type FastifyRequest } from 'fastify';
import { Busboy } from '@fastify/busboy';
import { createHash } from 'node:crypto';
import { ApiError } from '../src/platform/errors/api-error.js';
import { envelope } from '../src/platform/http/envelope.js';
import { traceId } from '../src/platform/http/transport.js';
import {
  UUID_V4,
  validateCredentialSyntax,
  validateMetadata,
} from '../src/platform/http/metadata.js';
import {
  operations,
  validateRequest,
  validateResponse,
  type Operation,
} from './contract.js';
import { MockState, digest, fail, type Result, type Upload } from './state.js';

const DAY = 86_400_000;
type Fault = {
  operationId: string;
  mode: 'latency' | 'network' | 'drop-after-commit' | 'in-progress' | 'error';
  milliseconds?: number;
  status?: number;
  code?: string;
};
function parseUpload(bytes: Buffer, contentType: string): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const invalid = () =>
      new ApiError(
        422,
        'VALIDATION_FAILED',
        'Invalid upload',
        'Provide exactly one file field.',
      );
    let parser: InstanceType<typeof Busboy>;
    try {
      parser = new Busboy({
        headers: { 'content-type': contentType },
        limits: {
          fileSize: 5 * 1024 * 1024 + 1,
          files: 1,
          fields: 0,
          parts: 1,
          headerPairs: 64,
          fieldNameSize: 100,
        },
      });
    } catch {
      reject(invalid());
      return;
    }
    let upload: Upload | undefined;
    let error: ApiError | undefined;
    parser.on('file', (name, file, _filename, _encoding, mimeType) => {
      if (name !== 'file') {
        error = invalid();
        file.resume();
        return;
      }
      const chunks: Buffer[] = [];
      file.on('data', (chunk: Buffer) => chunks.push(chunk));
      file.on('limit', () => {
        error = new ApiError(
          413,
          'UPLOAD_TOO_LARGE',
          'Image too large',
          'The encoded image must not exceed 5 MiB.',
        );
      });
      file.on('error', () => {
        error = invalid();
      });
      file.on('end', () => {
        upload = { bytes: Buffer.concat(chunks), mimeType };
      });
    });
    for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'] as const)
      parser.on(event, () => {
        error = invalid();
      });
    parser.on('error', () => reject(invalid()));
    parser.on('finish', () => {
      if (error || !upload) reject(error ?? invalid());
      else resolve(upload);
    });
    parser.end(bytes);
  });
}
function header(request: FastifyRequest, name: string): string | undefined {
  const matches: string[] = [];
  for (let i = 0; i < request.raw.rawHeaders.length; i += 2)
    if (request.raw.rawHeaders[i]!.toLowerCase() === name)
      matches.push(request.raw.rawHeaders[i + 1]!);
  if (matches.length > 1)
    fail(
      400,
      name === 'idempotency-key'
        ? 'INVALID_IDEMPOTENCY_KEY'
        : 'INVALID_EXPECTED_VERSION',
    );
  return matches[0];
}
function expectedVersion(
  request: FastifyRequest,
  operation: Operation,
): number | undefined {
  if (!operation.expectedVersion) return;
  const value = header(request, 'x-expected-version');
  if (value === undefined) fail(428, 'EXPECTED_VERSION_REQUIRED');
  if (!/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > 2147483647)
    fail(400, 'INVALID_EXPECTED_VERSION');
  return Number(value);
}
function safeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const code = (error as { code?: string })?.code;
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE')
    return new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      'Request too large',
      'Reduce the request size.',
    );
  if (code === 'FST_REQ_FILE_TOO_LARGE')
    return new ApiError(
      413,
      'UPLOAD_TOO_LARGE',
      'Image too large',
      'The encoded image must not exceed 5 MiB.',
    );
  if (
    code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    error instanceof SyntaxError ||
    code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
  )
    return new ApiError(
      400,
      'MALFORMED_JSON',
      'Malformed JSON',
      'Provide one valid JSON object.',
    );
  if (code?.startsWith('FST_') && /LIMIT|MULTIPART/.test(code))
    return new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid upload',
      'Provide exactly one file field.',
    );
  if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE')
    return new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Unsupported content type',
      'Use the documented content type.',
    );
  return new ApiError(
    500,
    'INTERNAL_ERROR',
    'Request failed',
    'The request could not be completed.',
  );
}

export function createMock(
  options: {
    now?: number;
    webOrigin?: string;
    onContractViolation?: (error: Error) => void;
    onFaultTaken?: (operationId: string) => void;
  } = {},
) {
  for (const name of ['NODE_ENV', 'APP_ENV', 'BUILD_ENV'])
    if (['production', 'staging'].includes(process.env[name] ?? ''))
      throw new Error(
        'The separate fixture mock cannot run in Staging or Production.',
      );
  const webOrigin =
    options.webOrigin ?? process.env.MOCK_WEB_ORIGIN ?? 'http://localhost:3000';
  if (!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/.test(webOrigin))
    throw new Error('Mock invitation links require a local web origin.');
  let state = new MockState(options.now, webOrigin);
  const faults = new Map<string, Fault>();
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024,
    genReqId: (request) => traceId(request.headers.traceparent),
    requestTimeout: 30_000,
  });
  // Fastify bounds the complete encoded body before Busboy parses file parts.
  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer' },
    (_request, bytes, done) => done(null, bytes),
  );
  app.addHook('onRequest', async (request, reply) => {
    reply.headers({
      'X-Trace-ID': request.id,
      'X-API-Contract-Version': '1.0.0',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
    const origin = request.headers.origin;
    if (
      origin &&
      /^http:\/\/(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/.test(origin)
    ) {
      reply
        .header('Access-Control-Allow-Origin', origin)
        .header('Vary', 'Origin');
      reply.header(
        'Access-Control-Expose-Headers',
        'X-Trace-ID,X-Resource-Version,X-API-Contract-Version,Retry-After,Location',
      );
    }
    if (request.method === 'OPTIONS') {
      reply.header(
        'Access-Control-Allow-Methods',
        'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
      );
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization,X-Blogpost-Web-Session,X-Device-ID,X-Device-OS,X-Device-Version,X-App-Version,X-App-Language,X-Expected-Version,Idempotency-Key,traceparent',
      );
      return reply.status(204).send();
    }
    if (
      request.url.startsWith('/__mock/') ||
      request.routeOptions.url?.startsWith('/__mock/')
    ) {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip))
        fail(404, 'RESOURCE_NOT_FOUND');
      return;
    }
    if (['/health/live', '/health/ready'].includes(request.url)) return;
    validateMetadata(request.raw);
    validateCredentialSyntax(request.raw);
  });
  app.setErrorHandler((error, request, reply) => {
    let safe = safeError(error);
    if (
      safe.status === 413 &&
      request.headers['content-type']?.startsWith('multipart/form-data')
    )
      safe = new ApiError(
        413,
        'UPLOAD_TOO_LARGE',
        'Upload too large',
        'Respect the 5 MiB file and 6 MiB multipart limits.',
      );
    if (safe.status === 429 || safe.code === 'IDEMPOTENCY_IN_PROGRESS')
      reply.header('Retry-After', '1');
    const value = {
      ...envelope(request.id, safe.status, null, safe),
      timestamp: state.iso(),
    };
    return reply.status(safe.status).send(value);
  });
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async () => ({ status: 'ok' }));
  app.options('/*', async (_request, reply) => reply.status(204).send());
  app.post('/__mock/reset', async (request) => {
    if (
      request.body !== undefined &&
      (typeof request.body !== 'object' ||
        request.body === null ||
        Object.keys(request.body).length)
    )
      fail(422, 'VALIDATION_FAILED');
    state = new MockState(options.now, webOrigin);
    faults.clear();
    return { reset: true, now: state.iso() };
  });
  app.post('/__mock/clock', async (request) => {
    const body = request.body as Record<string, unknown> | null;
    if (
      !body ||
      Object.keys(body).join(',') !== 'milliseconds' ||
      typeof body.milliseconds !== 'number'
    )
      fail(422, 'VALIDATION_FAILED');
    state.advance(body.milliseconds);
    return { now: state.iso() };
  });
  app.post('/__mock/fault', async (request) => {
    const body = request.body as Fault | null;
    if (
      !body ||
      !operations.some((op) => op.operationId === body.operationId) ||
      ![
        'latency',
        'network',
        'drop-after-commit',
        'in-progress',
        'error',
      ].includes(body.mode) ||
      Object.keys(body).some(
        (key) =>
          !['operationId', 'mode', 'milliseconds', 'status', 'code'].includes(
            key,
          ),
      ) ||
      (body.mode === 'latency' &&
        (!Number.isInteger(body.milliseconds) ||
          body.milliseconds! < 1 ||
          body.milliseconds! > 2000)) ||
      (body.mode === 'error' &&
        (!Number.isInteger(body.status) ||
          body.status! < 400 ||
          body.status! > 599 ||
          typeof body.code !== 'string' ||
          !/^[A-Z][A-Z0-9_]{0,79}$/.test(body.code)))
    )
      fail(422, 'VALIDATION_FAILED');
    const operation = operations.find(
      (op) => op.operationId === body.operationId,
    )!;
    if (
      ['drop-after-commit', 'in-progress'].includes(body.mode) &&
      !operation.idempotent
    )
      fail(422, 'VALIDATION_FAILED');
    faults.set(body.operationId, body);
    return { armed: true };
  });
  for (const operation of operations) {
    const url = operation.path.replace(/\{([^}]+)\}/g, ':$1');
    const successStatus = Number(
      Object.keys(operation.wire.responses).find((status) =>
        /^2[0-9][0-9]$/.test(status),
      )!,
    );
    app.route({
      method: operation.method as 'GET',
      url,
      bodyLimit:
        operation.operationId === 'stagePostMedia'
          ? 6 * 1024 * 1024
          : 1024 * 1024,
      handler: async (request, reply) => {
        const current = state;
        const credential = request.headers.authorization;
        const session = request.headers['x-blogpost-web-session'];
        const actorId = current.identify(
          typeof credential === 'string'
            ? credential.slice(7)
            : typeof session === 'string'
              ? session
              : undefined,
          session !== undefined,
        );
        if (
          !['ANONYMOUS', 'RECENT_IDENTITY', 'VERIFIED_IDENTITY'].includes(
            operation.access,
          )
        )
          current.member(actorId);
        const params = request.params as Record<string, string>;
        const query = validateRequest(
          operation,
          params,
          request.query as Record<string, unknown>,
          request.body,
        );
        current.authorize(operation, actorId, params);
        const expected = expectedVersion(request, operation);
        let key: string | undefined;
        if (operation.idempotent) {
          key = header(request, 'idempotency-key');
          if (!key || !UUID_V4.test(key)) fail(400, 'INVALID_IDEMPOTENCY_KEY');
        }
        let upload: Upload | undefined;
        if (operation.operationId === 'stagePostMedia') {
          if (
            !request.headers['content-type']?.startsWith(
              'multipart/form-data',
            ) ||
            !Buffer.isBuffer(request.body)
          )
            fail(415, 'UNSUPPORTED_MEDIA_TYPE');
          upload = await parseUpload(
            request.body,
            request.headers['content-type'],
          );
        }
        const scope = key
          ? `${actorId}:${operation.method}:${request.url.split('?')[0]}:${key}`
          : undefined;
        const hash = digest({
          body: upload ? null : (request.body ?? null),
          expected: expected ?? null,
          upload: upload
            ? {
                mimeType: upload.mimeType,
                hash: createHash('sha256').update(upload.bytes).digest('hex'),
              }
            : null,
        });
        const fault = faults.get(operation.operationId);
        faults.delete(operation.operationId);
        if (fault) options.onFaultTaken?.(operation.operationId);
        if (fault?.mode === 'latency')
          await new Promise((resolve) =>
            setTimeout(resolve, fault.milliseconds),
          );
        if (fault?.mode === 'error') fail(fault.status!, fault.code!);
        if (fault?.mode === 'network') {
          reply.hijack();
          reply.raw.destroy();
          return;
        }
        // Latency may overlap a role/ownership change; authorization precedes replay again.
        current.authorize(operation, actorId, params);
        let record = scope ? current.operations.get(scope) : undefined;
        if (record && record.expiresAt <= current.now) {
          current.operations.delete(scope!);
          record = undefined;
        }
        if (operation.operationId === 'createPost' && record?.result) {
          const created = record.result.data as { id: string };
          current.authorize(operation, actorId, { postId: created.id });
        }
        let result: Result;
        let status = successStatus;
        let replayed = false;
        if (record) {
          if (record.hash !== hash) fail(409, 'IDEMPOTENCY_KEY_REUSED');
          if (!record.result) fail(409, 'IDEMPOTENCY_IN_PROGRESS');
          result = structuredClone(record.result);
          status = record.status!;
          replayed = true;
        } else {
          const actual = current.resourceVersion(operation, actorId, params);
          if (actual !== undefined && actual !== expected)
            fail(412, 'VERSION_CONFLICT', {
              resourceType: params.postId ? 'POST' : 'RESOURCE',
              resourceId:
                params.postId ??
                params.memberId ??
                params.categoryId ??
                params.tagId ??
                params.invitationId ??
                actorId,
              currentVersion: actual,
              expectedVersion: expected!,
              changedFields: [],
            });
          if (operation.idempotent)
            current.throttle(actorId!, operation.operationId);
          if (scope) {
            record = {
              hash,
              expiresAt:
                current.now + (fault?.mode === 'in-progress' ? 30_000 : DAY),
            };
            current.operations.set(scope, record);
          }
          if (fault?.mode === 'in-progress')
            fail(409, 'IDEMPOTENCY_IN_PROGRESS');
          try {
            result = await current.run(
              operation,
              actorId,
              params,
              query,
              (request.body ?? {}) as Record<string, unknown>,
              upload,
            );
            if (state !== current) fail(503, 'DEPENDENCY_UNAVAILABLE');
            const data = result.data as {
              version?: number;
              invitation?: { version: number };
            } | null;
            const version = data?.version ?? data?.invitation?.version;
            if (record) {
              const receipt = structuredClone(result);
              if (
                operation.operationId === 'createInvitation' ||
                operation.operationId === 'reissueInvitation'
              )
                receipt.data = {
                  ...(receipt.data as object),
                  inviteUrl: null,
                  linkAvailable: false,
                };
              Object.assign(record, {
                result: receipt,
                status,
                version,
                location: result.location,
              });
            }
            current.recordAudit(actorId, operation, params, result);
          } catch (error) {
            if (scope) current.operations.delete(scope);
            throw error;
          }
        }
        const data = result.data as {
          version?: number;
          invitation?: { version: number };
        } | null;
        const version =
          record?.version ?? data?.version ?? data?.invitation?.version;
        if (
          version !== undefined &&
          (operation.expectedVersion ||
            /^(getMe|getWorkspacePost|getPostByClientDraftId|getManagedCategory|getManagedTag|getMember|getInvitation|createPost|createCategory|createTag|createInvitation|acceptInvitation|reissueInvitation)$/.test(
              operation.operationId,
            ))
        )
          reply.header('X-Resource-Version', String(version));
        if (result.location) reply.header('Location', result.location);
        if (result.bytes)
          return reply.type(result.mimeType!).status(status).send(result.bytes);
        const value = {
          ...envelope(request.id, status, result.data),
          timestamp: current.iso(),
          meta: {
            contractVersion: '1.0.0',
            pagination: result.pagination ?? null,
            idempotency: record
              ? {
                  replayed,
                  expiresAt: new Date(record.expiresAt).toISOString(),
                }
              : null,
          },
        };
        try {
          validateResponse(operation, status, value);
        } catch (error) {
          options.onContractViolation?.(error as Error);
          throw error;
        }
        if (fault?.mode === 'drop-after-commit') {
          reply.hijack();
          reply.raw.destroy();
          return;
        }
        return reply.status(status).send(value);
      },
    });
  }
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0]!;
    const matches = operations.filter((operation) =>
      new RegExp(`^${operation.path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(
        path,
      ),
    );
    if (matches.length) {
      reply.header(
        'Allow',
        [
          ...new Set(
            matches.flatMap((operation) =>
              operation.method === 'GET' ? ['GET', 'HEAD'] : [operation.method],
            ),
          ),
        ].join(', '),
      );
      fail(405, 'METHOD_NOT_ALLOWED');
    }
    fail(404, 'RESOURCE_NOT_FOUND');
  });
  return { app, state: () => state };
}
