import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture } from './fixtures.mjs';
import {
  compatibilityCatalog,
  verifyRecoveryCompatibility,
} from '../../scripts/cloudbuild/compatibility.mjs';

const initial = { schemaVersion: 1, mode: 'INITIAL_DRAFT', baselines: [] };
test('initial draft has no published-baseline pass and cannot be used for production or a release', () => {
  const context = {
    environment: 'staging',
    version: '0.0.0',
    publish: false,
    contractStatus: 'DRAFT',
  };
  assert.deepEqual(compatibilityCatalog(initial, context), initial);
  for (const patch of [
    { environment: 'production' },
    { version: '0.1.0' },
    { publish: true },
    { contractStatus: 'STABLE' },
  ])
    assert.throws(() =>
      compatibilityCatalog(initial, { ...context, ...patch }),
    );
  for (const catalog of [
    { ...initial, extra: true },
    { ...initial, mode: 'REVIEWED_HASHED_BASELINES' },
    { ...initial, mode: 'SKIP' },
  ])
    assert.throws(() => compatibilityCatalog(catalog, context));
});
test('supported compatibility catalog requires bounded unique exact file/hash/version pins', () => {
  const entry = {
    file: 'config/contract-baselines/v1.0.0.json',
    sha256: 'a'.repeat(64),
    contractVersion: '1.0.0',
  };
  const catalog = {
    schemaVersion: 1,
    mode: 'REVIEWED_HASHED_BASELINES',
    baselines: [entry],
  };
  assert.equal(compatibilityCatalog(catalog, {}), catalog);
  for (const patch of [
    { file: '../private.json' },
    { file: 'config/contract-baselines/../../private.json' },
    { file: 'config/contract-baselines/v1.json\n' },
    { sha256: 'a'.repeat(63) },
    { contractVersion: '2.0.0' },
    { contractVersion: '1.0.0\n' },
    { contractVersion: '1.01.0' },
    { extra: true },
  ])
    assert.throws(() =>
      compatibilityCatalog(
        { ...catalog, baselines: [{ ...entry, ...patch }] },
        {},
      ),
    );
  assert.throws(() =>
    compatibilityCatalog({ ...catalog, baselines: [entry, entry] }, {}),
  );
});
test('compatibility compares all reviewed pinned bytes plus actual Git parent; missing or altered evidence fails', async (t) => {
  const f = await fixture(t);
  const a = Buffer.from(
    JSON.stringify({ info: { version: '1.0.0' }, paths: {} }),
  );
  const b = Buffer.from(
    JSON.stringify({ info: { version: '1.0.1' }, paths: {} }),
  );
  const entry = (version, bytes) => ({
    file: 'config/contract-baselines/v' + version + '.json',
    contractVersion: version,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  const entries = [entry('1.0.0', a), entry('1.0.1', b)];
  await f.write(entries[0].file, a.toString());
  await f.write(entries[1].file, b.toString());
  await f.write('config/contract-baselines.json', {
    schemaVersion: 1,
    mode: 'REVIEWED_HASHED_BASELINES',
    baselines: entries,
  });
  f.commit();
  const calls = [];
  const compare = async (before, after) => {
    calls.push({ before, after });
    return { compatible: true };
  };
  const proof = await verifyRecoveryCompatibility(
    f.root,
    'production',
    f.base,
    compare,
  );
  assert.equal(proof.baselines.length, 2);
  assert.equal(calls.length, 3);
  assert.equal(proof.parent.sourceSha, f.base);
  assert.equal(proof.parent.status, 'STRUCTURALLY_COMPATIBLE');
  assert.equal(proof.semanticAndClientAcceptance, 'REQUIRED');
  await assert.rejects(
    verifyRecoveryCompatibility(f.root, 'production', f.base, async () => ({
      compatible: false,
    })),
    { code: 'SUPPORTED_CONTRACT_BREAKING_CHANGE' },
  );
  await f.write(entries[0].file, b.toString());
  const committed = await verifyRecoveryCompatibility(
    f.root,
    'production',
    f.base,
    compare,
  );
  assert.equal(committed.inputScope, 'COMMITTED_HEAD');
  assert.equal(committed.sourceSha, proof.sourceSha);
  assert.equal(committed.baselines[0].sha256, entries[0].sha256);
  f.commit();
  await assert.rejects(
    verifyRecoveryCompatibility(f.root, 'production', f.base, compare),
    { code: 'COMPATIBILITY_BASELINE_BYTES_DISAGREE' },
  );
});
test('initial draft receipt distinguishes parent comparison from absent supported published baselines', async (t) => {
  const f = await fixture(t);
  await f.write('contracts/openapi-v1.json', {
    info: { version: '1.0.0' },
    'x-contract-status': 'DRAFT',
  });
  await f.write('config/contract-baselines.json', initial);
  f.commit();
  const proof = await verifyRecoveryCompatibility(
    f.root,
    'staging',
    f.base,
    async () => ({ compatible: true }),
  );
  assert.equal(proof.supportedBaselineComparison, 'NOT_RUN_INITIAL_DRAFT');
  assert.equal(proof.baselines.length, 0);
  assert.equal(proof.parent.status, 'STRUCTURALLY_COMPATIBLE');
  const stored = JSON.parse(
    await readFile(
      resolve(f.root, '.local/cloudbuild-compatibility/result.json'),
      'utf8',
    ),
  );
  assert.deepEqual(stored, proof);
  await assert.rejects(
    verifyRecoveryCompatibility(f.root, 'production', f.base, async () => {
      throw new Error('must not compare');
    }),
    { code: 'INITIAL_DRAFT_COMPATIBILITY_NOT_ALLOWED' },
  );
});
