import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { Request, Response } from 'express';
import { parseMultipart } from '../../src/modules/media/multipart.js';

function fixture(
  contentType = 'multipart/form-data; boundary=fixture',
  length?: number,
  timeout?: number,
) {
  const stream = new PassThrough();
  const request = Object.assign(stream, {
    headers: {
      'content-type': contentType,
      ...(length !== undefined ? { 'content-length': String(length) } : {}),
    },
  }) as unknown as Request;
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
  } as Response;
  const result = parseMultipart(request, response, timeout);
  return { request, stream, result, headers };
}
function body(bytes: Buffer, name = 'file') {
  return Buffer.concat([
    Buffer.from(
      '--fixture\r\nContent-Disposition: form-data; name="' +
        name +
        '"; filename="../../ignored-private.png"\r\nContent-Type: image/png\r\n\r\n',
    ),
    bytes,
    Buffer.from('\r\n--fixture--\r\n'),
  ]);
}
test('multipart accepts the inclusive five-MiB file boundary and ignores filenames', async () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024, 7);
  const f = fixture();
  f.stream.end(body(bytes));
  const result = await f.result;
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual(Object.keys(result).sort(), ['bytes', 'mimeType']);
});
test('multipart rejects empty, malformed, extra and oversized fields with bounded errors', async () => {
  for (const encoded of [
    Buffer.from('--fixture--\r\n'),
    Buffer.from('malformed'),
    body(Buffer.from('x'), 'other'),
  ]) {
    const f = fixture();
    const rejected = assert.rejects(f.result, {
      status: 422,
      code: 'VALIDATION_FAILED',
    });
    f.stream.end(encoded);
    await rejected;
    assert.equal(f.headers.get('Connection'), 'close');
  }
  const f = fixture();
  const rejected = assert.rejects(f.result, {
    status: 413,
    code: 'UPLOAD_TOO_LARGE',
  });
  f.stream.end(body(Buffer.alloc(5 * 1024 * 1024 + 1)));
  await rejected;
});
test('multipart rejects total-length overflows, including chunked requests', async () => {
  const declared = fixture(undefined, 6 * 1024 * 1024 + 1);
  await assert.rejects(declared.result, {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
  });
  declared.stream.end();
  const streamed = fixture();
  const rejected = assert.rejects(streamed.result, {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
  });
  streamed.stream.end(Buffer.alloc(6 * 1024 * 1024 + 1));
  await rejected;
});
test('multipart has a deadline, handles aborted streams and refuses non-multipart input', async () => {
  await assert.rejects(fixture('application/json').result, {
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
  });
  const slow = fixture(undefined, undefined, 10);
  const timedOut = assert.rejects(slow.result, {
    status: 422,
    code: 'VALIDATION_FAILED',
  });
  await delay(20);
  await timedOut;
  slow.stream.end();
  const aborted = fixture();
  const rejected = assert.rejects(aborted.result, {
    status: 422,
    code: 'VALIDATION_FAILED',
  });
  aborted.stream.emit('aborted');
  await rejected;
  aborted.stream.destroy();
});
