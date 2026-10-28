import type { IncomingMessage } from 'node:http';
import { ApiError } from '../errors/api-error.js';
import { UUID_V4 } from './metadata.js';

function values(
  request: Pick<IncomingMessage, 'rawHeaders'>,
  name: string,
): string[] {
  const result: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index]!.toLowerCase() === name)
      result.push(request.rawHeaders[index + 1] ?? '');
  return result;
}
export function writePreconditions(
  request: Pick<IncomingMessage, 'rawHeaders'>,
): { key: string; expectedVersion: number } {
  const versions = values(request, 'x-expected-version');
  if (versions.length === 0)
    throw new ApiError(
      428,
      'EXPECTED_VERSION_REQUIRED',
      'Version required',
      'Supply the last confirmed resource version.',
    );
  if (
    versions.length !== 1 ||
    !/^[1-9][0-9]{0,9}$/.test(versions[0]!) ||
    Number(versions[0]) > 2147483647
  )
    throw new ApiError(
      400,
      'INVALID_EXPECTED_VERSION',
      'Invalid version',
      'Supply one positive integer resource version.',
    );
  return { key: idempotencyKey(request), expectedVersion: Number(versions[0]) };
}
export function idempotencyKey(
  request: Pick<IncomingMessage, 'rawHeaders'>,
): string {
  const keys = values(request, 'idempotency-key');
  if (keys.length !== 1 || !UUID_V4.test(keys[0]!))
    throw new ApiError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Invalid operation key',
      'Supply one UUID v4 idempotency key.',
    );
  return keys[0]!;
}
