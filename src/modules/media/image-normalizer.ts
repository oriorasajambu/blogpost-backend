import sharp from 'sharp';
import { ApiError } from '../../platform/errors/api-error.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 12_000_000;
export const IMAGE_VARIANTS = { w480: 480, w960: 960, w1600: 1600 } as const;
export type VariantName = keyof typeof IMAGE_VARIANTS;
type Format = 'jpeg' | 'png' | 'webp';
export interface NormalizedImage {
  mimeType: `image/${Format}`;
  width: number;
  height: number;
  variants: {
    name: VariantName;
    width: number;
    height: number;
    bytes: Buffer;
  }[];
}

// Shared by every caller in this Node process, including separate service instances.
// This bounds encoded inputs waiting in memory as well as native transformations.
let busy = false;
const queue: (() => void)[] = [];
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 32 });

function invalid(code = 'INVALID_IMAGE'): never {
  throw new ApiError(
    422,
    'VALIDATION_FAILED',
    'Invalid image',
    'Provide one valid JPEG, PNG or WebP image within the documented limits.',
    [{ location: 'body', field: '/file', code, params: {} }],
  );
}
function unsupported(): never {
  throw new ApiError(
    415,
    'UNSUPPORTED_MEDIA_TYPE',
    'Unsupported image',
    'The image MIME type and encoded format must match JPEG, PNG or WebP.',
  );
}
function formatOf(bytes: Buffer, mimeType: string): Format {
  let format: Format;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    format = 'jpeg';
  else if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    format = 'png';
  else if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    format = 'webp';
  else unsupported();
  if (mimeType !== `image/${format}`) unsupported();
  return format;
}

// libvips may decode only the first APNG frame. Inspect container animation markers
// rather than relying on metadata.pages, which is not available for every format.
function validateContainer(bytes: Buffer, format: Format): void {
  if (format === 'jpeg') {
    let position = 2;
    while (position < bytes.length) {
      if (bytes[position++] !== 0xff) invalid();
      while (bytes[position] === 0xff) position++;
      const marker = bytes[position++];
      if (marker === 0xd9) {
        if (position !== bytes.length) invalid('MULTIPLE_IMAGES_NOT_SUPPORTED');
        return;
      }
      if (marker === undefined || marker === 0xd8 || marker === 0x00) invalid();
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (position + 2 > bytes.length) invalid();
      const size = bytes.readUInt16BE(position);
      if (size < 2 || position + size > bytes.length) invalid();
      if (
        marker === 0xe2 &&
        bytes.toString('ascii', position + 2, position + 6) === 'MPF\0'
      )
        invalid('MULTIPLE_IMAGES_NOT_SUPPORTED');
      position += size;
      if (marker !== 0xda) continue;
      // Entropy-coded bytes escape FF as FF00; restart markers are in-band.
      while (position < bytes.length) {
        if (bytes[position] !== 0xff) {
          position++;
          continue;
        }
        let next = position + 1;
        while (bytes[next] === 0xff) next++;
        const value = bytes[next];
        if (
          value === 0x00 ||
          (value !== undefined && value >= 0xd0 && value <= 0xd7)
        )
          position = next + 1;
        else break;
      }
    }
    invalid();
  } else if (format === 'png') {
    let position = 8;
    let ended = false;
    while (position + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(position);
      const type = bytes.toString('ascii', position + 4, position + 8);
      if (position + 12 + size > bytes.length) invalid();
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT')
        invalid('ANIMATION_NOT_SUPPORTED');
      position += 12 + size;
      if (type === 'IEND') {
        ended = size === 0;
        break;
      }
    }
    if (!ended || position !== bytes.length) invalid();
  } else if (format === 'webp') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
    let position = 12;
    while (position + 8 <= bytes.length) {
      const type = bytes.toString('ascii', position, position + 4);
      const size = bytes.readUInt32LE(position + 4);
      if (position + 8 + size > bytes.length) invalid();
      if (
        type === 'ANIM' ||
        type === 'ANMF' ||
        (type === 'VP8X' && size >= 1 && (bytes[position + 8]! & 2) !== 0)
      )
        invalid('ANIMATION_NOT_SUPPORTED');
      position += 8 + size + (size % 2);
    }
    if (position !== bytes.length) invalid();
  }
}

async function acquire(): Promise<void> {
  if (!busy) {
    busy = true;
    return;
  }
  if (queue.length >= 2)
    throw new ApiError(
      429,
      'RATE_LIMITED',
      'Image processor busy',
      'Retry the upload after the current image processing finishes.',
    );
  await new Promise<void>((resolve) => queue.push(resolve));
}
function release(): void {
  const next = queue.shift();
  if (next) next();
  else busy = false;
}

export async function normalizeImage(
  bytes: Buffer,
  mimeType: string,
): Promise<NormalizedImage> {
  if (bytes.length > MAX_UPLOAD_BYTES)
    throw new ApiError(
      413,
      'UPLOAD_TOO_LARGE',
      'Image too large',
      'The encoded image must not exceed 5 MiB.',
    );
  const format = formatOf(bytes, mimeType);
  validateContainer(bytes, format);
  await acquire();
  try {
    const input = {
      failOn: 'warning' as const,
      limitInputPixels: MAX_IMAGE_PIXELS,
      limitInputChannels: 4,
    };
    const metadata = await sharp(bytes, input).metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1)
      invalid('ANIMATION_NOT_SUPPORTED');
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS
    )
      invalid('TOO_MANY_PIXELS');
    // Decode once. The bounded RGBA buffer avoids decoding the original for each
    // variant, applies orientation, and carries no EXIF/ICC/XMP/GPS metadata.
    const decoded = await sharp(bytes, input)
      .autoOrient()
      .toColourspace('srgb')
      .ensureAlpha()
      .timeout({ seconds: 5 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = decoded.info;
    const variants: NormalizedImage['variants'] = [];
    for (const [name, targetWidth] of Object.entries(IMAGE_VARIANTS)) {
      const output = await sharp(decoded.data, {
        raw: { width, height, channels },
      })
        .resize({ width: targetWidth, withoutEnlargement: true })
        .toFormat(format)
        .timeout({ seconds: 5 })
        .toBuffer({ resolveWithObject: true });
      variants.push({
        name: name as VariantName,
        width: output.info.width,
        height: output.info.height,
        bytes: output.data,
      });
    }
    return { mimeType: `image/${format}`, width, height, variants };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Native decoder errors can include untrusted metadata; never return them.
    invalid();
  } finally {
    release();
  }
}
