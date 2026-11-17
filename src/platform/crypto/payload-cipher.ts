import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT = 4096;

/** Validates a 32-byte key written as 64 lowercase hex characters, like CURSOR_SIGNING_KEY. */
export function payloadKey(value: string): Buffer {
  if (value.length !== 64 || !/^[a-f0-9]{64}$/.test(value))
    throw new Error('Invalid EMAIL_PAYLOAD_KEY');
  return Buffer.from(value, 'hex');
}

/**
 * Seals a small JSON payload with AES-256-GCM. The associated data (the outbox row id) binds
 * the ciphertext to its row, so a ciphertext copied onto another row cannot be opened.
 * Layout: IV (12) || tag (16) || ciphertext.
 */
export function sealPayload(
  key: Buffer,
  associated: string,
  value: unknown,
): Buffer {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  if (plaintext.length < 1 || plaintext.length > MAX_PLAINTEXT)
    throw new Error('Email payload size is out of bounds');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(associated, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openPayload(
  key: Buffer,
  associated: string,
  sealed: Uint8Array,
): unknown {
  const bytes = Buffer.from(sealed);
  if (
    bytes.length <= IV_BYTES + TAG_BYTES ||
    bytes.length > IV_BYTES + TAG_BYTES + MAX_PLAINTEXT
  )
    throw new Error('Invalid email payload');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    bytes.subarray(0, IV_BYTES),
    {
      authTagLength: TAG_BYTES,
    },
  );
  decipher.setAAD(Buffer.from(associated, 'utf8'));
  decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  const plaintext = Buffer.concat([
    decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}
