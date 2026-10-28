import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/platform/config/config.js';
import { developmentEnv, metadata } from '../helpers.js';
import { assertConforms, coverage } from '../conformance/verify.js';

test('metadata-only Nest HTTP conformance records its scoped coverage without claiming identity-fixture evidence', async (t) => {
  // The metadata surface needs no SQL query. Keep even the lazy pool's configuration synthetic.
  const keys = ['SQL_HOST', 'SQL_DATABASE', 'SQL_APP_PASSWORD'] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = developmentEnv[key];
  t.after(() => {
    for (const key of keys) {
      if (previous.get(key) === undefined) delete process.env[key];
      else process.env[key] = previous.get(key)!;
    }
  });
  const app = await createApp(readConfig(developmentEnv));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const executed = new Set<string>();
  try {
    for (const sample of [
      { path: '/v1/meta', headers: metadata, status: 200 },
      { path: '/v1/meta', headers: {}, status: 400 },
      {
        path: '/v1/meta',
        headers: { ...metadata, Authorization: 'Basic synthetic-invalid' },
        status: 401,
      },
      { path: '/v1/meta?unsupported=true', headers: metadata, status: 422 },
    ]) {
      const response = await fetch(origin + sample.path, {
        headers: sample.headers,
      });
      assert.equal(response.status, sample.status);
      assertConforms('getApiMeta', {
        method: 'GET',
        path: sample.path,
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
      if (response.ok) executed.add('getApiMeta');
    }
    const report = coverage('backend', executed);
    assert.equal(report.complete, false);
    assert.equal(report.pending.length, 51);
  } finally {
    await app.close();
  }
});
