import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  configuredGradleHome,
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
