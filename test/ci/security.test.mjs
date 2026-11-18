import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  validateArchive,
  downloadArchive,
} from '../../scripts/ci/install-gitleaks.mjs';
import {
  validateEnvironmentExample,
  securityConfiguration,
} from '../../scripts/ci/security.mjs';

test('only complete explicit nonsecret placeholder inputs are allowed in the environment example', async () => {
  const original = await readFile('.env.example', 'utf8');
  validateEnvironmentExample(original);
  for (const text of [
    original + '\nSQL_HOST=127.0.0.1\n',
    original + '\nUNKNOWN=value\n',
    original.replace(
      'replace-with-generated-local-password',
      'a-usable-password',
    ),
    original.replace('SQL_HOST=127.0.0.1\n', ''),
    original.replace('PORT=8080', 'PORT=8080 '),
  ])
    assert.throws(() => validateEnvironmentExample(text));
});
test('pinned scanner archives require exact bytes and size', () => {
  const bytes = Buffer.from('Synthetic pinned archive');
  const asset = {
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  validateArchive(bytes, asset);
  assert.throws(() =>
    validateArchive(Buffer.concat([bytes, Buffer.from('x')]), asset),
  );
  assert.throws(() =>
    validateArchive(bytes, { ...asset, sha256: '0'.repeat(64) }),
  );
});
test('scanner exceptions have exact bounded literals, reasons and an enforced expiry', async () => {
  const policy = JSON.parse(
    await readFile('config/ci/security-exceptions.json', 'utf8'),
  );
  assert.ok(
    securityConfiguration(policy, new Date('2026-10-27T00:00:00Z')).includes(
      'regexTarget = "secret"',
    ),
  );
  assert.throws(
    () => securityConfiguration(policy, new Date('2027-01-26T00:00:00Z')),
    /expired/,
  );
  const unsafe = structuredClone(policy);
  unsafe.exceptions[0].literal = '.*';
  assert.throws(() => securityConfiguration(unsafe));
});
test('a gcp-api-key exception allows only its exact literal and leaves the generic rule alone', () => {
  const now = new Date('2026-10-27T00:00:00Z');
  const literal = 'AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz0123456';
  const entry = {
    rule: 'gcp-api-key',
    literal,
    reason:
      'Public web API key of a project; identifies it and grants no access.',
    expires: '2027-01-25',
  };
  const only = securityConfiguration(
    { schemaVersion: 1, exceptions: [entry] },
    now,
  );
  assert.ok(only.includes('id = "gcp-api-key"'));
  assert.ok(only.includes("'''^" + literal + "$'''"));
  assert.ok(!only.includes('id = "generic-api-key"'));
  const both = securityConfiguration(
    {
      schemaVersion: 1,
      exceptions: [
        entry,
        { ...entry, rule: 'generic-api-key', literal: 'a'.repeat(64) },
      ],
    },
    now,
  );
  assert.equal((both.match(/\[\[rules\]\]/g) ?? []).length, 2);
  for (const unsafe of [
    { ...entry, rule: 'aws-access-token' },
    { ...entry, rule: 'gcp-api-key', literal: 'AIza.*' },
    { ...entry, literal: 'short' },
    { ...entry, reason: 'too short' },
    { ...entry, expires: '2026-10-01' },
    { ...entry, extra: true },
  ])
    assert.throws(
      () =>
        securityConfiguration({ schemaVersion: 1, exceptions: [unsafe] }, now),
      JSON.stringify(unsafe),
    );
});
test('scanner downloads reject unsafe origins and redirects before networking', async () => {
  for (const url of [
    'http://github.com/x',
    'https://example.test/x',
    'https://user:password@github.com/x',
    'https://github.com:444/x',
  ])
    await assert.rejects(downloadArchive(url, 1024));
  await assert.rejects(downloadArchive('https://github.com/x', 1024, 6));
});
