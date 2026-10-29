import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { schemaPolicyChanges } from '../../scripts/contract-policy.mjs';

const base = JSON.parse(await readFile('contracts/openapi-v1.json', 'utf8'));
const findings = (mutate) => {
  const revision = structuredClone(base);
  mutate(revision);
  return schemaPolicyChanges(base, revision);
};

test('contract semantic policy keeps request defaults and custom encoding/counting bounds stable', () => {
  for (const mutate of [
    (s) => {
      s.components.schemas.DraftContentInput.properties.coverDecorative.default = true;
    },
    (s) => {
      delete s.components.schemas.DraftContentInput.properties
        .markdownContractVersion.default;
    },
    (s) => {
      s.components.schemas.DraftContentInput.properties.coverAltText.default =
        '';
    },
    (s) => {
      s.components.schemas.DraftContentInput.properties.markdown[
        'x-maxUtf8Bytes'
      ] = 65536;
    },
    (s) => {
      delete s.components.schemas.DraftContentInput.properties.title[
        'x-unicodeScalarText'
      ];
    },
    (s) => {
      s.components.parameters.ExpectedVersion.schema['x-maximumInteger'] = 100;
    },
    (s) => {
      s.components.schemas.DateTime.format = 'date';
    },
  ])
    assert.ok(findings(mutate).length > 0);
  assert.deepEqual(
    findings(() => {}),
    [],
  );
});

test('new optional request fields and query inputs require explicit defaults while response additivity stays valid', () => {
  assert.ok(
    findings((s) => {
      s.components.schemas.DraftContentInput.properties.futureInput = {
        type: 'string',
      };
    }).some((f) => f.id === 'OPTIONAL_INPUT_DEFAULT_REQUIRED'),
  );
  assert.deepEqual(
    findings((s) => {
      s.components.schemas.DraftContentInput.properties.futureInput = {
        type: 'string',
        default: '',
      };
    }),
    [],
  );
  assert.deepEqual(
    findings((s) => {
      s.components.schemas.AuthorSummary.properties.futureResponse = {
        type: 'string',
      };
    }),
    [],
  );
  const query = (schema) => (s) => {
    s.paths['/v1/public/posts'].get.parameters.push({
      name: 'future',
      in: 'query',
      required: false,
      schema,
    });
  };
  assert.ok(
    findings(query({ type: 'boolean' })).some(
      (f) => f.id === 'OPTIONAL_INPUT_DEFAULT_REQUIRED',
    ),
  );
  assert.deepEqual(findings(query({ type: 'boolean', default: false })), []);
});

test('same default object with reordered keys is stable, and defaults are not read from examples', () => {
  const before = structuredClone(base);
  before.components.schemas.DraftContentInput.properties.title.default = {
    a: 1,
    b: 2,
  };
  const after = structuredClone(before);
  after.components.schemas.DraftContentInput.properties.title.default = {
    b: 2,
    a: 1,
  };
  assert.deepEqual(schemaPolicyChanges(before, after), []);
  assert.deepEqual(
    findings((s) => {
      s.components.schemas.AuthorSummary.example = {
        default: 'unrelated example',
      };
    }),
    [],
  );
});
