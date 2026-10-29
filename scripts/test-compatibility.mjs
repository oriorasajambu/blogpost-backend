import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { compareContracts } from './contract-compatibility.mjs';

const base = JSON.parse(await readFile('contracts/openapi-v1.json', 'utf8'));
const directory = '.local/compatibility-regressions';
await mkdir(directory, { recursive: true });
const baseline = `${directory}/base.json`;
await writeFile(baseline, JSON.stringify(base));
const cases = [
  { name: 'unchanged', compatible: true, mutate() {} },
  {
    name: 'optional-response-property',
    compatible: true,
    mutate(spec) {
      spec.components.schemas.AuthorSummary.properties.futureOptional = {
        type: 'string',
      };
    },
  },
  {
    name: 'removed-operation',
    compatible: false,
    mutate(spec) {
      delete spec.paths['/v1/posts'].post;
    },
  },
  {
    name: 'new-required-header',
    compatible: false,
    mutate(spec) {
      spec.paths['/v1/meta'].get.parameters.push({
        name: 'X-Breaking-Header',
        in: 'header',
        required: true,
        schema: { type: 'string' },
      });
    },
  },
  {
    name: 'tightened-title-bound',
    compatible: false,
    mutate(spec) {
      spec.components.schemas.DraftContentInput.properties.title.maxLength = 159;
    },
  },
  {
    name: 'removed-response-field',
    compatible: false,
    mutate(spec) {
      delete spec.components.schemas.AuthorSummary.properties.displayName;
      spec.components.schemas.AuthorSummary.required = ['id', 'handle'];
    },
  },
  {
    name: 'removed-enum-value',
    compatible: false,
    mutate(spec) {
      spec.components.schemas.Role.enum = ['AUTHOR', 'EDITOR'];
    },
  },
  {
    name: 'added-critical-enum-value',
    compatible: false,
    mutate(spec) {
      spec.components.schemas.Role.enum.push('OWNER');
    },
  },
  {
    name: 'renamed-operation-id',
    compatible: false,
    mutate(spec) {
      spec.paths['/v1/posts'].post.operationId = 'createAnArticle';
    },
  },
  {
    name: 'removed-idempotency-header',
    compatible: false,
    mutate(spec) {
      spec.paths['/v1/posts'].post.parameters = spec.paths[
        '/v1/posts'
      ].post.parameters.filter(
        (value) => value.$ref !== '#/components/parameters/IdempotencyKey',
      );
    },
  },
  {
    name: 'changed-idempotency-policy',
    compatible: false,
    mutate(spec) {
      spec.paths['/v1/posts'].post['x-idempotency-required'] = false;
    },
  },
  {
    name: 'removed-authentication',
    compatible: false,
    mutate(spec) {
      spec.paths['/v1/posts'].post.security = [];
    },
  },
  {
    name: 'changed-omitted-input-default',
    compatible: false,
    mutate(spec) {
      spec.components.schemas.DraftContentInput.properties.coverDecorative.default = true;
    },
  },
  {
    name: 'removed-omitted-input-default',
    compatible: false,
    mutate(spec) {
      delete spec.components.schemas.DraftContentInput.properties
        .markdownContractVersion.default;
    },
  },
  {
    name: 'changed-utf8-input-bound',
    compatible: false,
    mutate(spec) {
      spec.components.schemas.DraftContentInput.properties.markdown[
        'x-maxUtf8Bytes'
      ] = 65536;
    },
  },
  {
    name: 'removed-unicode-counting-semantics',
    compatible: false,
    mutate(spec) {
      delete spec.components.schemas.DraftContentInput.properties.title[
        'x-unicodeScalarText'
      ];
    },
  },
  {
    name: 'changed-version-header-integer-bound',
    compatible: false,
    mutate(spec) {
      spec.components.parameters.ExpectedVersion.schema['x-maximumInteger'] =
        100;
    },
  },
  {
    name: 'optional-input-without-default',
    compatible: false,
    mutate(spec) {
      spec.components.schemas.DraftContentInput.properties.futureInput = {
        type: 'string',
      };
    },
  },
  {
    name: 'optional-input-with-explicit-default',
    compatible: true,
    mutate(spec) {
      spec.components.schemas.DraftContentInput.properties.futureInput = {
        type: 'string',
        default: '',
      };
    },
  },
  {
    name: 'optional-query-without-default',
    compatible: false,
    mutate(spec) {
      spec.paths['/v1/public/posts'].get.parameters.push({
        name: 'future',
        in: 'query',
        required: false,
        schema: { type: 'boolean' },
      });
    },
  },
  {
    name: 'optional-query-with-explicit-default',
    compatible: true,
    mutate(spec) {
      spec.paths['/v1/public/posts'].get.parameters.push({
        name: 'future',
        in: 'query',
        required: false,
        schema: { type: 'boolean', default: false },
      });
    },
  },
];
for (const fixture of cases) {
  const revision = structuredClone(base);
  fixture.mutate(revision);
  const path = `${directory}/${fixture.name}.json`;
  await writeFile(path, JSON.stringify(revision));
  const result = await compareContracts(baseline, path);
  assert.equal(
    result.compatible,
    fixture.compatible,
    `${fixture.name}: ${JSON.stringify(result.findings)}`,
  );
  console.log(`Compatibility regression passed: ${fixture.name}`);
}
console.log(
  `${cases.length} compatibility regressions passed; no published-baseline comparison is claimed.`,
);
