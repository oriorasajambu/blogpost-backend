import { crc32, inflateRawSync } from 'node:zlib';
import { canonical } from '../../../src/platform/config/build-model.ts';
import { fail } from '../policy.mjs';
import { evidencePolicy, sha256, validateReceipt } from './model.mjs';

export const BUNDLE_FILES = [
  'SHA256SUMS',
  'backend-staging-artifact.json',
  'staging-evidence.json',
];
export const jsonBytes = (value) => Buffer.from(canonical(value) + '\n');
export function bundleFiles(receipt, descriptor) {
  receipt = validateReceipt(receipt);
  const artifact = jsonBytes(descriptor);
  if (
    receipt.artifact.size !== artifact.length ||
    receipt.artifact.sha256 !== sha256(artifact)
  )
    fail('ARTIFACT_FILE_DISAGREES');
  const files = new Map([
    ['staging-evidence.json', jsonBytes(receipt)],
    ['backend-staging-artifact.json', artifact],
  ]);
  files.set(
    'SHA256SUMS',
    Buffer.from(
      [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, bytes]) => sha256(bytes) + '  ' + name + '\n')
        .join(''),
    ),
  );
  return files;
}
export function decodeBundle(files, policy) {
  policy = evidencePolicy(policy);
  if (
    !(files instanceof Map) ||
    canonical([...files.keys()].sort()) !== canonical(BUNDLE_FILES)
  )
    fail('UNEXPECTED_STAGING_BUNDLE_FILES');
  const read = (name) => {
    const bytes = files.get(name);
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > policy.maxReceiptBytes
    )
      fail('EVIDENCE_FILE_LIMIT');
    let value;
    try {
      value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch {
      fail('INVALID_EVIDENCE_JSON');
    }
    // Canonical encoding also rejects duplicate keys, comments, BOM and hidden extra payloads.
    if (!bytes.equals(jsonBytes(value))) fail('NONCANONICAL_EVIDENCE_JSON');
    return value;
  };
  const receipt = validateReceipt(read('staging-evidence.json'));
  const descriptor = read('backend-staging-artifact.json');
  const expected = bundleFiles(receipt, descriptor);
  if (
    !Buffer.isBuffer(files.get('SHA256SUMS')) ||
    !files.get('SHA256SUMS').equals(expected.get('SHA256SUMS'))
  )
    fail('STAGING_CHECKSUMS_DISAGREE');
  return {
    receipt,
    descriptor,
    receiptSha256: sha256(files.get('staging-evidence.json')),
  };
}
function unpack(bytes, policy) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 22 ||
    bytes.length > policy.maxArchiveBytes
  )
    fail('STAGING_ARCHIVE_LIMIT');
  const end = bytes.length - 22;
  if (
    bytes.readUInt32LE(end) !== 0x06054b50 ||
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 8) !== 3 ||
    bytes.readUInt16LE(end + 10) !== 3 ||
    bytes.readUInt16LE(end + 20)
  )
    fail('UNSUPPORTED_STAGING_ARCHIVE');
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryStart = bytes.readUInt32LE(end + 16);
  if (directoryStart + directorySize !== end) fail('INVALID_STAGING_DIRECTORY');
  let at = directoryStart;
  const entries = [];
  for (let n = 0; n < 3; n++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50)
      fail('INVALID_STAGING_DIRECTORY');
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const checksum = bytes.readUInt32LE(at + 16);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameSize = bytes.readUInt16LE(at + 28);
    const extraSize = bytes.readUInt16LE(at + 30);
    const commentSize = bytes.readUInt16LE(at + 32);
    const external = bytes.readUInt32LE(at + 38);
    const offset = bytes.readUInt32LE(at + 42);
    if (
      flags & ~0x0808 ||
      ![0, 8].includes(method) ||
      bytes.readUInt16LE(at + 34) !== 0 ||
      nameSize > 64 ||
      size < 1 ||
      size > policy.maxReceiptBytes ||
      compressedSize > policy.maxArchiveBytes ||
      at + 46 + nameSize + extraSize + commentSize > end ||
      external & 0x10 ||
      ![0, 0x8000].includes((external >>> 16) & 0xf000)
    )
      fail('UNSUPPORTED_STAGING_ENTRY');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameSize);
    const name = nameBytes.toString('utf8');
    if (!BUNDLE_FILES.includes(name) || !nameBytes.equals(Buffer.from(name)))
      fail('UNEXPECTED_STAGING_ENTRY');
    entries.push({
      name,
      nameBytes,
      offset,
      flags,
      method,
      checksum,
      compressedSize,
      size,
    });
    at += 46 + nameSize + extraSize + commentSize;
  }
  if (at !== end || new Set(entries.map((entry) => entry.name)).size !== 3)
    fail('AMBIGUOUS_STAGING_ARCHIVE');
  const files = new Map();
  let cursor = 0;
  for (const entry of entries.sort((a, b) => a.offset - b.offset)) {
    const {
      offset,
      name,
      nameBytes,
      flags,
      method,
      checksum,
      compressedSize,
      size,
    } = entry;
    if (
      offset !== cursor ||
      offset + 30 > directoryStart ||
      bytes.readUInt32LE(offset) !== 0x04034b50 ||
      bytes.readUInt16LE(offset + 6) !== flags ||
      bytes.readUInt16LE(offset + 8) !== method
    )
      fail('STAGING_LOCAL_HEADER_DISAGREES');
    const nameSize = bytes.readUInt16LE(offset + 26);
    const extraSize = bytes.readUInt16LE(offset + 28);
    if (
      nameSize !== nameBytes.length ||
      !bytes.subarray(offset + 30, offset + 30 + nameSize).equals(nameBytes)
    )
      fail('STAGING_LOCAL_HEADER_DISAGREES');
    const dataStart = offset + 30 + nameSize + extraSize;
    cursor = dataStart + compressedSize;
    if (cursor > directoryStart) fail('STAGING_ENTRY_OVERLAP');
    const packed = bytes.subarray(dataStart, cursor);
    const contents =
      method === 0
        ? Buffer.from(packed)
        : inflateRawSync(packed, { maxOutputLength: policy.maxReceiptBytes });
    if (contents.length !== size || crc32(contents) !== checksum)
      fail('STAGING_ENTRY_CHECKSUM_DISAGREES');
    if (flags & 8) {
      if (cursor + 12 > directoryStart) fail('INVALID_STAGING_DATA_DESCRIPTOR');
      if (bytes.readUInt32LE(cursor) === 0x08074b50) cursor += 4;
      if (
        cursor + 12 > directoryStart ||
        bytes.readUInt32LE(cursor) !== checksum ||
        bytes.readUInt32LE(cursor + 4) !== compressedSize ||
        bytes.readUInt32LE(cursor + 8) !== size
      )
        fail('INVALID_STAGING_DATA_DESCRIPTOR');
      cursor += 12;
    } else if (
      bytes.readUInt32LE(offset + 14) !== checksum ||
      bytes.readUInt32LE(offset + 18) !== compressedSize ||
      bytes.readUInt32LE(offset + 22) !== size
    )
      fail('STAGING_LOCAL_HEADER_DISAGREES');
    files.set(name, contents);
  }
  if (cursor !== directoryStart) fail('UNEXPECTED_STAGING_ARCHIVE_PAYLOAD');
  return files;
}
export function decodeArchive(bytes, expectedArchiveSha256, policy) {
  policy = evidencePolicy(policy);
  if (!Buffer.isBuffer(bytes) || sha256(bytes) !== expectedArchiveSha256)
    fail('STAGING_ARCHIVE_DIGEST_DISAGREES');
  try {
    return decodeBundle(unpack(bytes, policy), policy);
  } catch (error) {
    if (error.code) throw error;
    fail('INVALID_STAGING_ARCHIVE');
  }
}
