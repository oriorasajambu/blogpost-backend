import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  buildContractPackage,
  verifyContractPackage,
} from '../../scripts/contract-package.mjs';
test('handoff package is deterministic and contains only bounded source assets with checksums', async () => {
  const a = await buildContractPackage();
  const b = await buildContractPackage();
  assert.deepEqual(a.archive, b.archive);
  const result = verifyContractPackage(a.archive);
  assert.equal(result.contractVersion, '1.0.0');
  assert.equal(result.status, 'DRAFT');
  const paths = result.entries.map((e) => e.path);
  for (const path of [
    'contracts/openapi-v1.json',
    'contracts/openapi-v1.yaml',
    'contracts/manifest.json',
    'mock/server.ts',
    'tools/mock/package-lock.json',
    'scripts/contract-policy.mjs',
    'PACKAGE-MANIFEST.json',
    'SHA256SUMS',
  ])
    assert.ok(paths.includes(path), path);
  assert.ok(
    paths.every(
      (path) =>
        !/(?:^|\/)(?:\.env|\.git|\.local|node_modules)(?:\/|$)/.test(path),
    ),
  );
  for (const mutation of [
    Buffer.from(a.archive.subarray(0, a.archive.length - 8)),
    Buffer.concat([a.archive, Buffer.from('extra')]),
    gzipSync(Buffer.from('../escape')),
  ])
    assert.throws(() => verifyContractPackage(mutation));
  const tar = gunzipSync(a.archive);
  tar[512] ^= 1;
  assert.throws(() => verifyContractPackage(gzipSync(tar)));
});
