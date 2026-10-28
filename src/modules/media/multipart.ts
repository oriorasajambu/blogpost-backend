import { Busboy } from '@fastify/busboy';
import type { Request, Response } from 'express';
import { ApiError } from '../../platform/errors/api-error.js';
export interface UploadInput {
  bytes: Buffer;
  mimeType: string;
}
export const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
function invalid(): ApiError {
  return new ApiError(
    422,
    'VALIDATION_FAILED',
    'Invalid upload',
    'Provide exactly one file field.',
  );
}
export function parseMultipart(
  request: Request,
  response: Response,
  timeout = 30000,
): Promise<UploadInput> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let total = 0;
    let input: UploadInput | undefined;
    let parser: InstanceType<typeof Busboy>;
    let timer: ReturnType<typeof setTimeout>;
    const end = () => {
      if (!finished) parser.end();
    };
    const aborted = () => fail(invalid());
    const data = (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_MULTIPART_BYTES)
        return fail(
          new ApiError(
            413,
            'PAYLOAD_TOO_LARGE',
            'Upload too large',
            'The complete multipart body must not exceed 6 MiB.',
          ),
        );
      if (!parser.write(chunk)) request.pause();
    };
    const cleanup = () => {
      clearTimeout(timer);
      request.off('data', data);
      request.off('end', end);
      request.off('aborted', aborted);
      request.off('error', aborted);
    };
    const fail = (error: ApiError) => {
      if (finished) return;
      finished = true;
      cleanup();
      response.setHeader('Connection', 'close');
      request.once('error', () => {});
      request.resume();
      parser?.destroy();
      reject(error);
    };
    if (
      !/^multipart\/form-data(?:\s*;|\s*$)/i.test(
        request.headers['content-type'] ?? '',
      )
    ) {
      reject(
        new ApiError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Multipart required',
          'Send a multipart/form-data image upload.',
        ),
      );
      return;
    }
    const length = request.headers['content-length'];
    if (length && Number(length) > MAX_MULTIPART_BYTES) {
      fail(
        new ApiError(
          413,
          'PAYLOAD_TOO_LARGE',
          'Upload too large',
          'The complete multipart body must not exceed 6 MiB.',
        ),
      );
      return;
    }
    try {
      parser = new Busboy({
        headers: { 'content-type': request.headers['content-type']! },
        limits: {
          fileSize: MAX_FILE_BYTES + 1,
          files: 1,
          fields: 0,
          parts: 1,
          headerPairs: 64,
          fieldNameSize: 100,
        },
      });
    } catch {
      fail(invalid());
      return;
    }
    parser.on('drain', () => {
      if (!finished) request.resume();
    });
    parser.on('file', (name, file, _filename, _encoding, mimeType) => {
      if (name !== 'file') {
        file.resume();
        fail(invalid());
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      file.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_FILE_BYTES) {
          fail(
            new ApiError(
              413,
              'UPLOAD_TOO_LARGE',
              'Image too large',
              'The encoded image must not exceed 5 MiB.',
            ),
          );
          return;
        }
        if (!finished) chunks.push(chunk);
      });
      file.on('limit', () =>
        fail(
          new ApiError(
            413,
            'UPLOAD_TOO_LARGE',
            'Image too large',
            'The encoded image must not exceed 5 MiB.',
          ),
        ),
      );
      file.on('error', () => fail(invalid()));
      file.on('end', () => {
        if (!finished)
          input = {
            bytes: Buffer.concat(chunks),
            mimeType: mimeType.toLowerCase(),
          };
      });
    });
    for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'] as const)
      parser.on(event, () => fail(invalid()));
    parser.on('error', () => fail(invalid()));
    parser.on('finish', () => {
      if (finished) return;
      if (!input) {
        fail(invalid());
        return;
      }
      finished = true;
      cleanup();
      resolve(input);
    });
    timer = setTimeout(() => fail(invalid()), timeout);
    timer.unref();
    request.on('data', data);
    request.once('end', end);
    request.once('aborted', aborted);
    request.once('error', aborted);
    if (request.readableEnded) end();
    else request.resume();
  });
}
