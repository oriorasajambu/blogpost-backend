import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import SwaggerParser from '@apidevtools/swagger-parser';
import { isUnicodeScalarText } from '../../src/modules/posts/markdown.js';

const document = JSON.parse(readFileSync('contracts/openapi-v1.json', 'utf8'));
const inventory = JSON.parse(
  readFileSync('contracts/operation-inventory.json', 'utf8'),
) as {
  method: string;
  path: string;
  operationId: string;
  expectedVersion: boolean;
  idempotent: boolean;
}[];
const wirePlan = readFileSync('contracts/CONTRACT.md', 'utf8').replaceAll(
  '\r\n',
  '\n',
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
(addFormatsModule as unknown as (ajv: Ajv2020) => void)(ajv);
ajv.addKeyword({
  keyword: 'x-maxUtf8Bytes',
  type: 'string',
  schemaType: 'number',
  validate: (maximum: number, value: string) =>
    Buffer.byteLength(value, 'utf8') <= maximum,
});
const validators = new Map<string, ReturnType<Ajv2020['compile']>>();
ajv.addKeyword({
  keyword: 'x-unicodeScalarText',
  type: 'string',
  schemaType: 'boolean',
  validate: (enabled: boolean, value: string) =>
    !enabled || isUnicodeScalarText(value),
});
const validateSchema = (schema: Record<string, unknown>, value: unknown) => {
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile({ components: document.components, ...schema });
    validators.set(key, validate);
  }
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
};

test('all 52 planned application operation IDs have authored method/path entries', () => {
  const expected = [
    ...wirePlan.matchAll(
      /^\|\s+`((?:GET|POST|PUT|PATCH|DELETE) \/v1\/[^`]+)`[^\n]*\|\s+`([A-Za-z][A-Za-z0-9]+)`\s+\|$/gm,
    ),
  ].map((match) => ({ route: match[1]!, id: match[2]! }));
  assert.equal(expected.length, 52);
  assert.equal(inventory.length, expected.length);
  assert.equal(
    new Set(inventory.map((operation) => operation.operationId)).size,
    52,
  );
  for (const operation of expected) {
    const planned = inventory.find(
      (candidate) => candidate.operationId === operation.id,
    );
    assert.ok(planned, operation.id);
    assert.equal(`${planned.method} ${planned.path}`, operation.route);
    assert.equal(
      document.paths[planned.path][planned.method.toLowerCase()].operationId,
      operation.id,
    );
  }
});

test('every application operation declares mandatory metadata, access, preconditions and success examples', () => {
  for (const planned of inventory) {
    const operation =
      document.paths[planned.path][planned.method.toLowerCase()];
    const parameters = operation.parameters.map(
      (parameter: { $ref?: string }) =>
        parameter.$ref
          ? document.components.parameters[parameter.$ref.split('/').at(-1)!]
          : parameter,
    );
    for (const name of [
      'X-Device-ID',
      'X-Device-OS',
      'X-Device-Version',
      'X-App-Version',
      'X-App-Language',
    ])
      assert.ok(
        parameters.some(
          (parameter: { name: string; required: boolean }) =>
            parameter.name === name && parameter.required,
        ),
        `${planned.operationId}: ${name}`,
      );
    assert.equal(
      parameters.some(
        (parameter: { name: string }) =>
          parameter.name === 'X-Expected-Version',
      ),
      planned.expectedVersion,
    );
    assert.equal(
      parameters.some(
        (parameter: { name: string }) => parameter.name === 'Idempotency-Key',
      ),
      planned.idempotent,
    );
    assert.ok(operation['x-access']);
    const request = JSON.parse(
      readFileSync(
        `contracts/fixtures/operations/${planned.operationId}.request.json`,
        'utf8',
      ),
    );
    if (operation.requestBody) {
      const media =
        operation.requestBody.content['application/json'] ??
        operation.requestBody.content['multipart/form-data'];
      validateSchema(media.schema, request.body);
      const requestSchema =
        document.components.schemas[media.schema.$ref.split('/').at(-1)];
      assert.equal(requestSchema.additionalProperties, false);
    }
    const status = Object.keys(operation.responses).find((status) =>
      /^2\d\d$/.test(status),
    )!;
    const success = operation.responses[status];
    if (success.content['application/json']) {
      const response = JSON.parse(
        readFileSync(
          `contracts/fixtures/operations/${planned.operationId}.response.json`,
          'utf8',
        ),
      );
      validateSchema(success.content['application/json'].schema, response);
      assert.equal(response.statusCode, Number(status));
      for (const { value } of Object.values(
        success.content['application/json'].examples,
      ) as { value: Record<string, unknown> }[])
        validateSchema(success.content['application/json'].schema, value);
    } else assert.ok(success.content['image/png']);
  }
});

test('shared HTTP error examples match their actual status and error envelope', async () => {
  const resolved = (await SwaggerParser.dereference(
    structuredClone(document),
  )) as unknown as typeof document;
  for (const planned of inventory) {
    const operation =
      resolved.paths[planned.path][planned.method.toLowerCase()];
    for (const [status, response] of Object.entries(operation.responses) as [
      string,
      {
        content: {
          'application/json'?: {
            examples: Record<
              string,
              { value: { statusCode: number; error: { code: string } } }
            >;
          };
        };
      },
    ][]) {
      if (Number(status) < 400) continue;
      for (const [name, example] of Object.entries(
        response.content['application/json']!.examples,
      )) {
        assert.equal(example.value.statusCode, Number(status));
        assert.equal(example.value.error.code, name);
        validateSchema(
          { $ref: '#/components/schemas/ErrorEnvelope' },
          example.value,
        );
      }
    }
  }
});

test('critical enums are fixed; response additions are accepted and unknown request fields are rejected', () => {
  assert.deepEqual(document.components.schemas.Role.enum, [
    'AUTHOR',
    'EDITOR',
    'ADMIN',
  ]);
  assert.deepEqual(document.components.schemas.PublicationState.enum, [
    'NEVER_PUBLISHED',
    'PUBLISHED',
    'WITHDRAWN',
  ]);
  assert.deepEqual(document.components.schemas.WorkflowState.enum, [
    'DRAFT',
    'IN_REVIEW',
    'CHANGES_REQUESTED',
    'CLEAN',
  ]);
  const data = JSON.parse(
    readFileSync(
      'contracts/fixtures/operations/getPublicPost.response.json',
      'utf8',
    ),
  );
  data.data.futureOptionalField = true;
  validateSchema({ $ref: '#/components/schemas/GetPublicPostEnvelope' }, data);
  const validate = ajv.compile({
    components: document.components,
    $ref: '#/components/schemas/UpdateMemberInput',
  });
  assert.equal(validate({ role: 'ADMIN', unexpected: true }), false);
});

test('UTF-8 annotation rejects drafts that fit a code-point bound but exceed the byte limit', () => {
  const validate = ajv.compile({
    components: document.components,
    $ref: '#/components/schemas/DraftContentInput',
  });
  const input = {
    title: '',
    summary: '',
    markdown: '😀'.repeat(32769),
    categoryId: null,
    tagIds: [],
    coverMediaId: null,
  };
  assert.equal(validate(input), false);
  input.markdown = '😀'.repeat(32768);
  assert.equal(validate(input), true);
  input.title = '\ud800';
  assert.equal(validate(input), false);
});
