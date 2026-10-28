import { readFileSync } from 'node:fs';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { ApiError, type FieldIssue } from '../src/platform/errors/api-error.js';
import { isUnicodeScalarText } from '../src/modules/posts/markdown.js';

type Schema = Record<string, unknown>;
interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema: Schema;
  $ref?: string;
}
interface WireOperation {
  parameters: Parameter[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<
    string,
    { content?: Record<string, { schema: Schema }>; $ref?: string }
  >;
}
interface Document {
  components: {
    schemas: Record<string, Schema>;
    parameters: Record<string, Parameter>;
  };
  paths: Record<string, Record<string, WireOperation>>;
}
export interface Operation {
  method: string;
  path: string;
  operationId: string;
  access: string;
  expectedVersion: boolean;
  idempotent: boolean;
  wire: WireOperation;
}
const document = JSON.parse(
  readFileSync(
    new URL('../contracts/openapi-v1.json', import.meta.url),
    'utf8',
  ),
) as Document;
export const operations = (
  JSON.parse(
    readFileSync(
      new URL('../contracts/operation-inventory.json', import.meta.url),
      'utf8',
    ),
  ) as Omit<Operation, 'wire'>[]
).map((operation) => ({
  ...operation,
  wire: document.paths[operation.path]![operation.method.toLowerCase()]!,
}));
const ajv = new Ajv2020({ strict: false, allErrors: true });
(addFormatsModule as unknown as (instance: Ajv2020) => void)(ajv);
ajv.addKeyword({
  keyword: 'x-maxUtf8Bytes',
  type: 'string',
  schemaType: 'number',
  validate: (max: number, value: string) =>
    Buffer.byteLength(value, 'utf8') <= max,
});
ajv.addKeyword({
  keyword: 'x-unicodeScalarText',
  type: 'string',
  schemaType: 'boolean',
  validate: (enabled: boolean, value: string) =>
    !enabled || isUnicodeScalarText(value),
});
const validators = new Map<string, ValidateFunction>();
function validator(schema: Schema): ValidateFunction {
  const key = JSON.stringify(schema);
  let result = validators.get(key);
  if (!result) {
    result = ajv.compile({ components: document.components, ...schema });
    validators.set(key, result);
  }
  return result;
}
function validate(
  schema: Schema,
  value: unknown,
  location: FieldIssue['location'],
): void {
  const check = validator(schema);
  if (check(value)) return;
  const issues = (check.errors ?? [])
    .map((error) => ({
      location,
      field: `${error.instancePath}${error.keyword === 'required' ? `/${error.params.missingProperty}` : error.keyword === 'additionalProperties' ? `/${error.params.additionalProperty}` : ''}`,
      code:
        error.keyword === 'additionalProperties'
          ? 'UNKNOWN_FIELD'
          : 'INVALID_VALUE',
      params: {},
    }))
    .sort((a, b) => a.field.localeCompare(b.field));
  throw new ApiError(
    422,
    'VALIDATION_FAILED',
    'Invalid request',
    'Correct the indicated request fields.',
    issues.slice(0, 50),
    issues.length > 50 ? { truncated: true } : null,
  );
}
export function validateRequest(
  operation: Operation,
  params: Record<string, unknown>,
  query: Record<string, unknown>,
  body: unknown,
): Record<string, unknown> {
  const queryProperties: Record<string, Schema> = {};
  const required: string[] = [];
  const normalized = { ...query };
  for (const source of operation.wire.parameters) {
    const parameter = source.$ref
      ? document.components.parameters[source.$ref.split('/').at(-1)!]!
      : source;
    if (parameter.in === 'path')
      validate(parameter.schema, params[parameter.name], 'path');
    if (parameter.in !== 'query') continue;
    queryProperties[parameter.name] = parameter.schema;
    if (parameter.required) required.push(parameter.name);
    const value = normalized[parameter.name];
    if (value === undefined && 'default' in parameter.schema)
      normalized[parameter.name] = parameter.schema.default;
    if (
      parameter.schema.type === 'integer' &&
      typeof value === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(value)
    )
      normalized[parameter.name] = Number(value);
    if (
      parameter.schema.type === 'boolean' &&
      (value === 'true' || value === 'false')
    )
      normalized[parameter.name] = value === 'true';
    if (parameter.schema.type === 'array' && typeof value === 'string')
      normalized[parameter.name] = [value];
  }
  validate(
    {
      type: 'object',
      properties: queryProperties,
      required,
      additionalProperties: false,
    },
    normalized,
    'query',
  );
  if (Array.isArray(normalized.tagIds))
    normalized.tagIds = [...normalized.tagIds].sort();
  const schema =
    operation.wire.requestBody?.content['application/json']?.schema;
  if (schema) validate(schema, body, 'body');
  else if (!operation.wire.requestBody && body !== undefined)
    validate({ type: 'null' }, body, 'body');
  return normalized;
}
export function validateResponse(
  operation: Operation,
  status: number,
  value: unknown,
): void {
  const schema =
    status >= 400
      ? { $ref: '#/components/schemas/ErrorEnvelope' }
      : operation.wire.responses[String(status)]?.content?.['application/json']
          ?.schema;
  if (!schema)
    throw new Error(
      `No JSON response schema for ${operation.operationId} ${status}`,
    );
  const check = validator(schema);
  if (!check(value))
    throw new Error(
      `Mock response violates ${operation.operationId}: ${JSON.stringify(check.errors)}`,
    );
}
