import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMetadata,
  validateCredentialSyntax,
  METADATA_HEADERS,
} from '../../src/platform/http/metadata.js';
import { traceId } from '../../src/platform/http/transport.js';
import { ApiError } from '../../src/platform/errors/api-error.js';
import { envelope } from '../../src/platform/http/envelope.js';

export const metadata = {
  'X-Device-ID': '8d5ca46a-7f59-4f64-9d91-fedc41b59e7a',
  'X-Device-OS': 'ANDROID',
  'X-Device-Version': 'unknown',
  'X-App-Version': '1.0.0+android.1',
  'X-App-Language': 'id-ID',
};
const raw = (headers = metadata) => ({
  rawHeaders: Object.entries(headers).flat(),
});
test('metadata accepts build metadata, future OS identifiers and valid unsupported languages', () => {
  validateMetadata(raw());
  validateMetadata(
    raw({
      ...metadata,
      'X-Device-OS': 'FUTURE_OS_9',
      'X-App-Language': 'fr-CA',
    }),
  );
});
test('valid private-use and grandfathered BCP 47 tags remain acceptable', () => {
  for (const tag of ['x-private', 'i-klingon', 'en-GB-oed', 'zh-cmn-Hans-CN'])
    validateMetadata(raw({ ...metadata, 'X-App-Language': tag }));
});
test('BCP 47 accepts reserved language syntax but rejects duplicate variants and extensions', () => {
  for (const tag of [
    'abcd',
    'en-Latn-US',
    'en-abc-def-ghi-US',
    'de-CH-1901-a-extend-x-local',
  ])
    validateMetadata(raw({ ...metadata, 'X-App-Language': tag }));
  for (const tag of [
    'de-1901-1901',
    'en-a-one-a-two',
    'en-u-foo-u-bar',
    'en-',
    '123',
  ])
    assert.throws(
      () => validateMetadata(raw({ ...metadata, 'X-App-Language': tag })),
      ApiError,
    );
});
test('SemVer metadata does not invent a numeric size restriction inside its documented 64-character bound', () => {
  validateMetadata(
    raw({
      ...metadata,
      'X-App-Version':
        '999999999999999999999999999999999999999999999999999999999999.1.0',
    }),
  );
});
test('malformed single credential schemes return a safe 401 without exposing the value', () => {
  for (const pair of [
    ['Authorization', 'Basic secret'],
    ['X-Blogpost-Web-Session', 'invalid cookie'],
  ])
    assert.throws(
      () => validateCredentialSyntax({ rawHeaders: pair }),
      (error: ApiError) =>
        error.status === 401 &&
        error.code === 'INVALID_CREDENTIAL' &&
        !JSON.stringify(error).includes('secret'),
    );
});
for (const header of METADATA_HEADERS) {
  test(`metadata rejects missing ${header} without echoing values`, () => {
    const request = {
      rawHeaders: Object.entries(metadata)
        .filter(([name]) => name.toLowerCase() !== header)
        .flat(),
    };
    assert.throws(
      () => validateMetadata(request),
      (error: ApiError) =>
        error.code === 'INVALID_CLIENT_METADATA' &&
        error.fieldErrors.some((issue) => issue.field === `/${header}`),
    );
  });
  test(`metadata rejects duplicate ${header} case insensitively`, () => {
    const request = raw();
    request.rawHeaders.push(header, 'secret-value');
    assert.throws(
      () => validateMetadata(request),
      (error: ApiError) =>
        error.fieldErrors.some((issue) => issue.code === 'DUPLICATE_HEADER') &&
        !JSON.stringify(error).includes('secret-value'),
    );
  });
}
for (const [name, value] of [
  ['X-Device-ID', '8D5CA46A-7F59-4F64-9D91-FEDC41B59E7A'],
  ['X-Device-OS', 'android'],
  ['X-Device-Version', '16,17'],
  ['X-Device-Version', 'x'.repeat(65)],
  ['X-App-Version', 'v1.0.0'],
  ['X-App-Version', '1.0'],
  ['X-App-Version', '01.0.0'],
  ['X-App-Language', 'en_US'],
  ['X-App-Language', 'en,fr'],
] as const)
  test(`metadata rejects malformed ${name}: ${value.slice(0, 16)}`, () => {
    assert.throws(
      () => validateMetadata(raw({ ...metadata, [name]: value })),
      ApiError,
    );
  });
test('trace context rejects zero or malformed IDs and preserves valid parents', () => {
  const expected = '4bf92f3577b34da6a3ce929d0e0e4736';
  assert.equal(traceId(`00-${expected}-00f067aa0ba902b7-01`), expected);
  for (const input of [
    undefined,
    'invalid',
    `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`,
    `00-${expected}-${'0'.repeat(16)}-01`,
  ])
    assert.match(traceId(input), /^[a-f0-9]{32}$/);
});
test('ambiguous or duplicate credentials fail before any identity verification', () => {
  assert.throws(
    () =>
      validateCredentialSyntax({
        rawHeaders: [
          'Authorization',
          'Bearer secret',
          'X-Blogpost-Web-Session',
          'secret',
        ],
      }),
    ApiError,
  );
  assert.throws(
    () =>
      validateCredentialSyntax({
        rawHeaders: ['Authorization', 'one', 'authorization', 'two'],
      }),
    ApiError,
  );
});
test('error envelopes keep all eight fields and never expose internal exception details', () => {
  const result = envelope(
    'a'.repeat(32),
    412,
    null,
    new ApiError(
      412,
      'VERSION_CONFLICT',
      'Draft changed',
      'Fetch the current draft.',
    ),
  );
  assert.equal(Object.keys(result).length, 8);
  assert.equal(result.statusCode, 412);
  assert.equal(result.data, null);
  assert.equal(result.error?.code, 'VERSION_CONFLICT');
});
