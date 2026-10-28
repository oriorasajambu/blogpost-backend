import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCatalogConstraint } from '../../src/ops/catalog-normalization.js';
import { digest } from '../../src/platform/config/build-model.js';

// Actual pg_get_constraintdef outputs observed before/after PostgreSQL 17 restore.
const source = `CHECK (state <> 'READY'::blogpost."MediaState" OR width IS NOT NULL AND height IS NOT NULL AND "mimeType" IS NOT NULL AND ("mimeType"::text = ANY (ARRAY['image/jpeg'::character varying, 'image/png'::character varying, 'image/webp'::character varying]::text[])) AND jsonb_array_length(variants) = 3)`;
const restored = `CHECK (state <> 'READY'::blogpost."MediaState" OR width IS NOT NULL AND height IS NOT NULL AND "mimeType" IS NOT NULL AND ("mimeType"::text = ANY (ARRAY['image/jpeg'::character varying::text, 'image/png'::character varying::text, 'image/webp'::character varying::text])) AND jsonb_array_length(variants) = 3)`;
const row = {
  name: 'media_ready',
  relation: 'MediaAsset',
  kind: 'c',
  definition: source,
  deferrable: false,
  deferred: false,
  validated: true,
};
test('fresh and logically restored MIME constraints have one stable catalog fingerprint', () => {
  const actual = canonicalCatalogConstraint(row);
  assert.equal(actual.definition, restored);
  assert.equal(
    digest(actual),
    digest(canonicalCatalogConstraint({ ...row, definition: restored })),
  );
  assert.equal(row.definition, source);
  assert.deepEqual(canonicalCatalogConstraint(actual), actual);
});
test('catalog normalization cannot erase changed values, columns, casts or constraint state', () => {
  for (const patch of [
    { name: 'other_constraint' },
    { relation: 'OtherTable' },
    { kind: 'f' },
    { definition: source.replace('image/webp', 'image/gif') },
    { definition: source.replace(' = 3)', ' >= 3)') },
    {
      definition: source.replace('"mimeType"::text', '"mimeType"::varchar(3)'),
    },
    {
      definition: source.replace(
        'width IS NOT NULL AND',
        'width IS NOT NULL OR',
      ),
    },
    { definition: 'CHECK (true)' },
  ]) {
    const changed = { ...row, ...patch };
    assert.equal(canonicalCatalogConstraint(changed), changed);
    assert.notEqual(
      digest(canonicalCatalogConstraint(changed)),
      digest(canonicalCatalogConstraint(row)),
    );
  }
  const invalid = canonicalCatalogConstraint({ ...row, validated: false });
  assert.equal(invalid.validated, false);
  assert.notEqual(digest(invalid), digest(canonicalCatalogConstraint(row)));
});
