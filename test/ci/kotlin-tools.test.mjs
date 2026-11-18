import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  configuredGradleHome,
  downloadPinned,
  downloadWithRetry,
} from '../../scripts/kotlin-tools.mjs';

test('ambient hosted-runner Gradle cannot override the pinned consumer toolchain', () => {
  assert.equal(
    configuredGradleHome({ GRADLE_HOME: '/runner/gradle-9.8.1' }),
    null,
  );
  assert.equal(
    configuredGradleHome({
      BLOGPOST_GRADLE_HOME: '.local/explicit-gradle',
      GRADLE_HOME: '/runner/gradle-9.8.1',
    }),
    resolve('.local/explicit-gradle'),
  );
});

const reply = (status, headers = {}) =>
  new Response(status === 200 ? 'jar' : null, { status, headers });
const scripted = (...replies) => {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
};

test('tool downloads retry rate limits and transient failures with bounded waits', async () => {
  const waits = [];
  const source = scripted(
    reply(429, { 'retry-after': '7' }),
    reply(429, { 'retry-after': '3600' }),
    new TypeError('fetch failed'),
    reply(503),
    reply(200),
  );
  const bytes = await downloadWithRetry('https://example.test/tool.jar', {
    fetchImpl: source.fetchImpl,
    wait: async (ms) => waits.push(ms),
  });
  assert.equal(bytes.toString(), 'jar');
  assert.equal(source.calls.length, 5);
  assert.deepEqual(waits.slice(0, 3), [7_000, 60_000, 8_000]);
  assert.ok(waits[3] >= 16_000 && waits[3] < 17_000);
});

test('tool downloads stop on permanent errors and after the last attempt', async () => {
  const wait = async () => {};
  const missing = scripted(reply(404));
  await assert.rejects(
    downloadWithRetry('https://example.test/a', { ...missing, wait }),
    /HTTP 404/,
  );
  assert.equal(missing.calls.length, 1);
  const limited = scripted(reply(429), reply(429), reply(429));
  await assert.rejects(
    downloadWithRetry('https://example.test/b', {
      ...limited,
      wait,
      attempts: 3,
    }),
    /HTTP 429/,
  );
  assert.equal(limited.calls.length, 3);
});

test('pinned tools fall back to listed mirrors and reject bytes that do not match', async () => {
  const sha256 = createHash('sha256').update('jar').digest('hex');
  const asset = {
    url: 'https://primary.test/tool.jar',
    mirrors: ['https://bad.test/tool.jar', 'https://mirror.test/tool.jar'],
    sha256,
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith('https://primary')) return reply(429);
    if (url.startsWith('https://bad'))
      return new Response('tampered', { status: 200 });
    return reply(200);
  };
  const bytes = await downloadPinned(asset, {
    fetchImpl,
    wait: async () => {},
    attempts: 2,
  });
  assert.equal(bytes.toString(), 'jar');
  assert.deepEqual(calls, [
    asset.url,
    asset.url,
    asset.mirrors[0],
    asset.mirrors[1],
  ]);
  await assert.rejects(
    downloadPinned(
      { url: 'https://bad.test/only.jar', sha256 },
      { fetchImpl, wait: async () => {} },
    ),
    /checksum mismatch/,
  );
});

test('every pinned generator mirror is HTTPS and serves the same artifact path', async () => {
  const { generator } = JSON.parse(
    await readFile(
      new URL('../../tools/kotlin/toolchain.json', import.meta.url),
      'utf8',
    ),
  );
  const path = new URL(generator.url).pathname.replace(/^\/maven2/, '');
  for (const mirror of generator.mirrors ?? []) {
    assert.equal(new URL(mirror).protocol, 'https:');
    assert.ok(new URL(mirror).pathname.endsWith(path));
  }
});
