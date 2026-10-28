import { ApiError, type FieldIssue } from '../errors/api-error.js';
import { isUnicodeScalarText } from '../text/unicode.js';
export const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function invalidInput(
  field: string,
  location: FieldIssue['location'] = 'body',
): never {
  throw new ApiError(
    422,
    'VALIDATION_FAILED',
    'Invalid input',
    'Correct the indicated field.',
    [{ location, field, code: 'INVALID_VALUE', params: {} }],
  );
}
export function objectInput(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalidInput('');
  const input = value as Record<string, unknown>;
  const fields = Object.keys(input).sort();
  const issues: FieldIssue[] = fields
    .filter((key) => !allowed.includes(key))
    .slice(0, 51)
    .map((key) => ({
      location: 'body',
      field:
        key.length > 256
          ? ''
          : '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'),
      code: 'UNKNOWN_FIELD',
      params: {},
    }));
  for (const key of required)
    if (!Object.hasOwn(input, key))
      issues.push({
        location: 'body',
        field: '/' + key,
        code: 'REQUIRED',
        params: {},
      });
  if (issues.length)
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid input',
      'Correct the indicated fields.',
      issues
        .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
        .slice(0, 50),
      issues.length > 50 ? { truncated: true } : null,
    );
  return input;
}
export function uuidInput(
  value: string,
  field: string,
  location: FieldIssue['location'] = 'path',
): string {
  if (!UUID.test(value)) return invalidInput('/' + field, location);
  return value.toLowerCase();
}
export function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maximum &&
    !value.includes('\0') &&
    isUnicodeScalarText(value)
  );
}
