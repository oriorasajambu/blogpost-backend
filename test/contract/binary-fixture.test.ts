import { readFileSync } from 'node:fs';
import { crc32, inflateSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('representative PNG bytes have valid chunk checksums and match declared media dimensions/size', () => {
  const bytes = readFileSync('contracts/fixtures/media/pixel.png');
  assert.deepEqual(
    bytes.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  let offset = 8;
  const imageData: Buffer[] = [];
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const name = bytes.toString('ascii', offset + 4, offset + 8);
    assert.equal(
      crc32(bytes.subarray(offset + 4, offset + 8 + size)),
      bytes.readUInt32BE(offset + 8 + size),
      name,
    );
    if (name === 'IHDR') {
      assert.equal(bytes.readUInt32BE(offset + 8), 1);
      assert.equal(bytes.readUInt32BE(offset + 12), 1);
    }
    if (name === 'IDAT')
      imageData.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  assert.equal(offset, bytes.length);
  assert.equal(inflateSync(Buffer.concat(imageData)).length, 5);
  const receipt = JSON.parse(
    readFileSync(
      'contracts/fixtures/operations/stagePostMedia.response.json',
      'utf8',
    ),
  );
  for (const variant of receipt.data.variants) {
    assert.equal(variant.width, 1);
    assert.equal(variant.height, 1);
    assert.equal(variant.byteSize, bytes.length);
  }
});
