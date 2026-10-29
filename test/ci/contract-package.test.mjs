import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  buildContractPackage,
  verifyContractPackage,
  verifyContractPackageFile,
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
test('verification accepts another valid deflate representation while rejecting damaged framing', async () => {
  const original = await buildContractPackage();
  const alternative = gzipSync(gunzipSync(original.archive), { level: 1 });
  alternative[9] = 255;
  assert.notDeepEqual(alternative, original.archive);
  assert.equal(
    verifyContractPackage(alternative).fileCount,
    original.fileCount,
  );
  const badCrc = Buffer.from(alternative);
  badCrc[badCrc.length - 8] ^= 1;
  const badSize = Buffer.from(alternative);
  badSize[badSize.length - 4] ^= 1;
  const noncanonicalHeader = Buffer.from(alternative);
  noncanonicalHeader[4] = 1;
  for (const invalid of [
    badCrc,
    badSize,
    noncanonicalHeader,
    Buffer.concat([alternative, gzipSync(Buffer.alloc(0))]),
    Buffer.concat([alternative, Buffer.alloc(8)]),
  ])
    assert.throws(() => verifyContractPackage(invalid));
});
test('file verification checks the external checksum before decoding and accepts a matching alternative stream', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'blogpost-contract-package-'));
  t.after(async () => {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep))
      throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  });
  const package_ = await buildContractPackage();
  const archivePath = join(root, package_.filename);
  await writeFile(archivePath, 'invalid gzip');
  await writeFile(join(root, 'SHA256SUMS'), 'incorrect checksum');
  await assert.rejects(
    verifyContractPackageFile(archivePath),
    /external archive checksum disagrees/,
  );
  const alternative = gzipSync(gunzipSync(package_.archive), { level: 1 });
  alternative[9] = 255;
  await writeFile(archivePath, alternative);
  const checksum = createHash('sha256').update(alternative).digest('hex');
  await writeFile(
    join(root, 'SHA256SUMS'),
    checksum + '  ' + package_.filename + '\n',
  );
  assert.equal(
    (await verifyContractPackageFile(archivePath)).contractVersion,
    '1.0.0',
  );
});
