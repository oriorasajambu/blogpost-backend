import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import {
  normalizeImage,
  MAX_UPLOAD_BYTES,
} from '../../src/modules/media/image-normalizer.js';
import { ApiError } from '../../src/platform/errors/api-error.js';

const pixel = readFileSync('contracts/fixtures/media/pixel.png');
function isError(status: number, code: string) {
  return (error: unknown) =>
    error instanceof ApiError && error.status === status && error.code === code;
}

test('all named variants exist for a small original without upscaling or losing alpha', async () => {
  const normalized = await normalizeImage(pixel, 'image/png');
  assert.equal(normalized.width, 1);
  assert.deepEqual(
    normalized.variants.map((v) => v.name),
    ['w480', 'w960', 'w1600'],
  );
  for (const variant of normalized.variants) {
    assert.equal(variant.width, 1);
    assert.equal(variant.height, 1);
    const metadata = await sharp(variant.bytes).metadata();
    assert.equal(metadata.hasAlpha, true);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
  }
});

test('normalizes EXIF orientation, strips metadata and preserves aspect ratio', async () => {
  const encoded = await sharp({
    create: { width: 600, height: 1800, channels: 3, background: '#123456' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const normalized = await normalizeImage(encoded, 'image/jpeg');
  assert.equal(normalized.width, 1800);
  assert.equal(normalized.height, 600);
  assert.deepEqual(
    normalized.variants.map((v) => [v.width, v.height]),
    [
      [480, 160],
      [960, 320],
      [1600, 533],
    ],
  );
  for (const variant of normalized.variants) {
    const metadata = await sharp(variant.bytes).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.equal(metadata.xmp, undefined);
  }
});

test('WebP transparency remains in the actually encoded MIME format', async () => {
  const encoded = await sharp({
    create: {
      width: 20,
      height: 10,
      channels: 4,
      background: { r: 2, g: 4, b: 6, alpha: 0.5 },
    },
  })
    .webp()
    .toBuffer();
  const normalized = await normalizeImage(encoded, 'image/webp');
  assert.equal(normalized.mimeType, 'image/webp');
  const output = normalized.variants[0]!;
  assert.equal((await sharp(output.bytes).metadata()).hasAlpha, true);
  const { data } = await sharp(output.bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.ok(data[3]! >= 126 && data[3]! <= 129);
});

test('encoded size and MIME/magic checks fail before decoding', async () => {
  await assert.rejects(
    normalizeImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'image/png'),
    isError(413, 'UPLOAD_TOO_LARGE'),
  );
  await assert.rejects(
    normalizeImage(pixel, 'image/jpeg'),
    isError(415, 'UNSUPPORTED_MEDIA_TYPE'),
  );
  await assert.rejects(
    normalizeImage(Buffer.from('<svg>private</svg>'), 'image/svg+xml'),
    isError(415, 'UNSUPPORTED_MEDIA_TYPE'),
  );
});

test('malformed containers and decoder failures never echo attacker bytes', async () => {
  for (const bytes of [
    pixel.subarray(0, 40),
    Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.from('secret payload'),
    ]),
  ]) {
    await assert.rejects(
      normalizeImage(bytes, bytes[0] === 0xff ? 'image/jpeg' : 'image/png'),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 422);
        assert.ok(!JSON.stringify(error).includes('secret payload'));
        return true;
      },
    );
  }
});

test('a compressed image above the decoded pixel bound is rejected', async () => {
  const bomb = await sharp({
    create: { width: 4000, height: 3001, channels: 3, background: '#000000' },
  })
    .png()
    .toBuffer();
  assert.ok(bomb.length < MAX_UPLOAD_BYTES);
  await assert.rejects(
    normalizeImage(bomb, 'image/png'),
    isError(422, 'VALIDATION_FAILED'),
  );
});

test('animated WebP is rejected even though a first-frame decode would succeed', async () => {
  const animation = await sharp(
    Buffer.from([0, 0, 0, 255, 255, 255, 255, 255]),
    {
      raw: { width: 1, height: 2, pageHeight: 1, channels: 4 },
    },
  )
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
  assert.equal((await sharp(animation).metadata()).pages, 2);
  await assert.rejects(
    normalizeImage(animation, 'image/webp'),
    isError(422, 'VALIDATION_FAILED'),
  );
});

test('APNG markers cannot bypass single-frame validation', async () => {
  // A decoder might ignore this ancillary control chunk; container validation must not.
  const control = Buffer.alloc(20);
  control.writeUInt32BE(8, 0);
  control.write('acTL', 4);
  control.writeUInt32BE(2, 8);
  const apng = Buffer.concat([
    pixel.subarray(0, 33),
    control,
    pixel.subarray(33),
  ]);
  await assert.rejects(
    normalizeImage(apng, 'image/png'),
    isError(422, 'VALIDATION_FAILED'),
  );
});

test('JPEG containers reject concatenated images and multipicture markers', async () => {
  const jpeg = await sharp(pixel).jpeg({ progressive: true }).toBuffer();
  assert.equal((await normalizeImage(jpeg, 'image/jpeg')).width, 1);
  for (const bytes of [
    Buffer.concat([jpeg, jpeg]),
    Buffer.concat([
      jpeg.subarray(0, 2),
      Buffer.from([0xff, 0xe2, 0, 6, 77, 80, 70, 0]),
      jpeg.subarray(2),
    ]),
  ])
    await assert.rejects(
      normalizeImage(bytes, 'image/jpeg'),
      (error: unknown) =>
        error instanceof ApiError &&
        error.fieldErrors[0]?.code === 'MULTIPLE_IMAGES_NOT_SUPPORTED',
    );
});

test('bounded backpressure rejects surplus uploads and the processor recovers after failures', async () => {
  const outcomes = await Promise.allSettled(
    Array.from({ length: 8 }, () => normalizeImage(pixel, 'image/png')),
  );
  assert.equal(
    outcomes.filter((result) => result.status === 'fulfilled').length,
    3,
  );
  assert.equal(
    outcomes.filter(
      (result) =>
        result.status === 'rejected' &&
        isError(429, 'RATE_LIMITED')(result.reason),
    ).length,
    5,
  );
  await assert.rejects(
    normalizeImage(Buffer.from([0xff, 0xd8, 0xff, 0]), 'image/jpeg'),
  );
  assert.equal((await normalizeImage(pixel, 'image/png')).width, 1);
});
