// Mounted read-only at /app/.local/build-image-smoke.mjs in an optimized image.
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { readProvenance } from '../dist/platform/config/provenance.js';
import { readConfig } from '../dist/platform/config/config.js';

assert.equal(process.getuid(), 1000);
await assert.rejects(access('/app/.build/provenance.json', constants.W_OK));
await assert.rejects(access('/app/.build', constants.W_OK));
for (const path of [
  '/app/src',
  '/app/test',
  '/app/scripts/build/test-metadata.mjs',
  '/app/node_modules/typescript',
])
  await assert.rejects(access(path));
const operations = process.argv.includes('--operations');
if (!operations) await assert.rejects(access('/app/node_modules/prisma'));
else await access('/app/operations-tooling/node_modules/prisma');
const build = readProvenance();
const expectedIndex = process.argv.indexOf('--expected');
assert.ok(expectedIndex >= 0);
const expected = JSON.parse(process.argv[expectedIndex + 1]);
for (const [key, value] of Object.entries(expected)) {
  if (key !== 'configurationDigest') assert.deepEqual(build[key], value);
}
assert.equal(build.kind, 'ARTIFACT');
assert.equal(build.dirty, false);
assert.match(build.sourceSha, /^[a-f0-9]{40}$/);
assert.equal(
  build.sourceRef,
  'refs/heads/' + (build.environment === 'staging' ? 'rc' : 'main'),
);
const profile = build.configuration;
assert.ok(profile.projectId.startsWith('example-'));
const env = {
  NODE_ENV: 'production',
  APP_ENV: build.environment,
  PORT: '18080',
  GCP_PROJECT_ID: profile.projectId,
  IDENTITY_PROJECT_ID: profile.projectId,
  IDENTITY_TOKEN_AUDIENCE: profile.identity.audience,
  IDENTITY_TOKEN_ISSUER: profile.identity.idTokenIssuer,
  IDENTITY_SESSION_ISSUER: profile.identity.sessionIssuer,
  API_ORIGIN: profile.apiOrigin,
  WEB_ORIGIN: profile.webOrigin,
  INSTANCE_CONNECTION_NAME: profile.sql.instanceConnectionName,
  SQL_HOST: '/cloudsql/' + profile.sql.instanceConnectionName,
  SQL_DATABASE: profile.sql.database,
  SQL_APP_PASSWORD: 'synthetic-do-not-leak',
  CURSOR_SIGNING_KEY: '7'.repeat(64),
  SQL_APP_SECRET_REF: profile.secretVersions.SQL_APP_PASSWORD,
  CURSOR_SECRET_REF: profile.secretVersions.CURSOR_SIGNING_KEY,
  MEDIA_ADAPTER: 'gcs',
  MEDIA_BUCKET: profile.media.bucket,
  MEDIA_BUCKET_PROJECT_ID: profile.media.projectId,
  RUNTIME_SERVICE_ACCOUNT: profile.serviceAccounts.api,
};
const config = readConfig(env);
assert.equal(config.configurationDigest, expected.configurationDigest);
assert.equal(config.buildSha, build.sourceSha);
assert.equal(config.runtimeInputDigest, build.runtimeInputDigest);
for (const patch of [
  {
    APP_ENV: build.environment === 'staging' ? 'production' : 'staging',
    BUILD_ENV: build.environment === 'staging' ? 'production' : 'staging',
  },
  { BUILD_SHA: '0'.repeat(40) },
  { RUNTIME_INPUT_DIGEST: '0'.repeat(64) },
  { API_ORIGIN: 'https://another.example.test' },
  { RUNTIME_SERVICE_ACCOUNT: profile.serviceAccounts.ops },
  {
    SQL_APP_SECRET_REF: profile.secretVersions.SQL_APP_PASSWORD.replace(
      '/1',
      '/latest',
    ),
  },
  { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
])
  assert.throws(() => readConfig({ ...env, ...patch }));
if (operations) {
  for (const file of ['bootstrap-db', 'migrate', 'verify-db']) {
    await assert.rejects(
      promisify(execFile)(process.execPath, ['dist/ops/' + file + '.js'], {
        env: {
          ...process.env,
          ...env,
          APP_ENV: build.environment === 'staging' ? 'production' : 'staging',
        },
        timeout: 10000,
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, '');
        assert.deepEqual(JSON.parse(error.stderr), {
          event: 'job_failed',
          code: null,
        });
        assert.ok(!error.stderr.includes(env.SQL_APP_PASSWORD));
        return true;
      },
    );
  }
}
const child = spawn(process.execPath, ['dist/main.js'], {
  env: { ...process.env, ...env },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const exited = once(child, 'exit');
try {
  let live;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      live = await fetch('http://127.0.0.1:18080/health/live', {
        signal: AbortSignal.timeout(1000),
      });
      break;
    } catch {
      if (child.exitCode !== null)
        throw new Error('Compiled image failed startup');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert.equal(live?.status, 200);
  const response = await fetch('http://127.0.0.1:18080/v1/meta', {
    headers: {
      'X-Device-ID': '8d5ca46a-7f59-4f64-9d91-fedc41b59e7a',
      'X-Device-OS': 'LINUX',
      'X-Device-Version': 'unknown',
      'X-App-Version': '0.0.0+synthetic.1',
      'X-App-Language': 'en',
    },
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(response.status, 200);
  const meta = await response.json();
  assert.equal(meta.data.buildSha, build.sourceSha);
  assert.equal(meta.data.deployment.environment, build.environment);
  assert.equal(
    meta.data.deployment.runtimeInputDigest,
    build.runtimeInputDigest,
  );
  assert.equal(
    meta.data.deployment.configurationDigest,
    config.configurationDigest,
  );
  for (const privateValue of [
    profile.projectId,
    profile.media.bucket,
    profile.serviceAccounts.api,
    env.SQL_APP_PASSWORD,
  ])
    assert.ok(!JSON.stringify(meta).includes(privateValue));
  assert.equal(
    (
      await fetch('http://127.0.0.1:18080/health/ready', {
        signal: AbortSignal.timeout(5000),
      })
    ).status,
    503,
  );
  console.log(
    JSON.stringify({
      event: 'synthetic_build_image_passed',
      environment: build.environment,
      operations,
      sourceSha: build.sourceSha,
    }),
  );
} finally {
  child.kill('SIGTERM');
  await exited;
}
