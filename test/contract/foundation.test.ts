import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { envelope } from '../../src/platform/http/envelope.js';
import { MetaController } from '../../src/modules/meta/meta.controller.js';
import { readConfig } from '../../src/platform/config/config.js';
import { developmentEnv } from '../helpers.js';

const contract = JSON.parse(readFileSync('contracts/openapi-v1.json', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;
addFormats(ajv);
test('authored OpenAPI is a valid 3.1 document and remains explicitly unreleased', async () => {
  await SwaggerParser.validate(structuredClone(contract));
  assert.equal(contract.openapi, '3.1.2');
  assert.equal(contract['x-contract-status'], 'DRAFT');
});
test('actual meta DTO and conflict fixture satisfy authored schemas', () => {
  for (const [name, data] of [
    [
      'MetaEnvelope',
      envelope(
        'a'.repeat(32),
        200,
        new MetaController(readConfig(developmentEnv)).get(),
      ),
    ],
    [
      'ErrorEnvelope',
      JSON.parse(
        readFileSync('contracts/fixtures/errors/version-conflict.json', 'utf8'),
      ),
    ],
  ] as const) {
    const validate = ajv.compile({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      components: contract.components,
      ...contract.components.schemas[name],
    });
    assert.equal(validate(data), true, JSON.stringify(validate.errors));
    const missing = structuredClone(data);
    delete (missing as Record<string, unknown>).traceId;
    assert.equal(
      validate(missing),
      false,
      'Required transport fields must not disappear',
    );
  }
});
