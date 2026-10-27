import type { IncomingMessage } from 'node:http';
import rules from './metadata-rules.json' with { type: 'json' };
import { ApiError, type FieldIssue } from '../errors/api-error.js';

export const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const METADATA_HEADERS = [
  'x-device-id',
  'x-device-os',
  'x-device-version',
  'x-app-version',
  'x-app-language',
] as const;

const semver = new RegExp(rules.semver);
const languageSyntax = new RegExp(rules.language);
const languageParts = new RegExp(rules.languageParts, 'i');
function language(value: string): boolean {
  if (!languageSyntax.test(value)) return false;
  const parts = languageParts.exec(value);
  if (!parts) return true; // Valid private-use or grandfathered tag.
  const variants = parts[1]!.toLowerCase().split('-').filter(Boolean);
  const extensions = parts[2]!
    .toLowerCase()
    .split('-')
    .filter((part) => part.length === 1);
  return (
    new Set(variants).size === variants.length &&
    new Set(extensions).size === extensions.length
  );
}

export function validateMetadata(
  request: Pick<IncomingMessage, 'rawHeaders'>,
): void {
  const values = new Map<string, string[]>();
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    const name = request.rawHeaders[i]!.toLowerCase();
    values.set(name, [
      ...(values.get(name) ?? []),
      request.rawHeaders[i + 1] ?? '',
    ]);
  }
  const issues: FieldIssue[] = [];
  for (const name of METADATA_HEADERS) {
    const entries = values.get(name) ?? [];
    const value = entries[0] ?? '';
    let code: string | null = null;
    if (!entries.length) code = 'REQUIRED';
    else if (entries.length !== 1) code = 'DUPLICATE_HEADER';
    else if (!value.trim() || /[^\x20-\x7e]|,/.test(value))
      code = 'INVALID_FORMAT';
    else if (name === 'x-device-id' && !UUID_V4.test(value))
      code = 'INVALID_UUID';
    else if (name === 'x-device-os' && !/^[A-Z][A-Z0-9_]{0,31}$/.test(value))
      code = 'INVALID_FORMAT';
    else if (name === 'x-device-version' && value.length > 64)
      code = 'TOO_LONG';
    else if (
      name === 'x-app-version' &&
      (value.length > 64 || !semver.test(value))
    )
      code = 'INVALID_SEMVER';
    else if (
      name === 'x-app-language' &&
      (value.length > 64 || !language(value))
    )
      code = 'INVALID_LANGUAGE_TAG';
    if (code)
      issues.push({ location: 'header', field: `/${name}`, code, params: {} });
  }
  if (issues.length)
    throw new ApiError(
      400,
      'INVALID_CLIENT_METADATA',
      'Invalid client metadata',
      'Provide the five required client metadata headers.',
      issues.sort((a, b) => a.field.localeCompare(b.field)),
    );
}

export function validateCredentialSyntax(
  request: Pick<IncomingMessage, 'rawHeaders'>,
): void {
  const credentials = request.rawHeaders
    .filter((_, index) => index % 2 === 0)
    .map((name) => name.toLowerCase())
    .filter((name) =>
      ['authorization', 'x-blogpost-web-session'].includes(name),
    );
  if (credentials.length > 1)
    throw new ApiError(
      400,
      'AMBIGUOUS_CREDENTIALS',
      'Ambiguous credentials',
      'Send exactly one credential scheme.',
    );
  if (credentials.length === 1) {
    const name = credentials[0]!;
    const index = request.rawHeaders.findIndex(
      (entry, index) => index % 2 === 0 && entry.toLowerCase() === name,
    );
    const value = request.rawHeaders[index + 1] ?? '';
    if (
      name === 'authorization'
        ? !/^Bearer [A-Za-z0-9._~-]+$/i.test(value)
        : !/^[A-Za-z0-9._~-]+$/.test(value)
    )
      throw new ApiError(
        401,
        'INVALID_CREDENTIAL',
        'Invalid credential',
        'Provide a valid credential using a supported scheme.',
      );
  }
}
