import { cloudProfile, cloudProvenance } from '../build-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../../src/platform/config/config.js';
import {
  connection,
  migrationUrl,
} from '../../src/platform/database/connection.js';
import { cloudEnv, developmentEnv } from '../helpers.js';

test('explicit local configuration works and secret rotation does not enter safe digests', () => {
  const first = readConfig(developmentEnv);
  assert.equal(first.environment, 'development');
  assert.equal(
    first.configurationDigest,
    readConfig({ ...developmentEnv, SQL_APP_PASSWORD: 'another-secret' })
      .configurationDigest,
  );
});
test('validated cloud configuration accepts the correct project and socket', () => {
  assert.equal(
    readConfig(cloudEnv, 'api', cloudProvenance).environment,
    'staging',
  );
});

test('staging uses two application connections and production/development use three', () => {
  for (const [APP_ENV, expected] of [
    ['staging', 2],
    ['production', 3],
    ['development', 3],
  ] as const) {
    assert.equal(connection('app', { ...cloudEnv, APP_ENV }).max, expected);
    assert.equal(
      connection('migrator', {
        ...cloudEnv,
        APP_ENV,
        SQL_MIGRATOR_PASSWORD: 'synthetic',
      }).max,
      2,
    );
  }
});
for (const patch of [
  { BUILD_ENV: 'production' },
  { FIREBASE_AUTH_EMULATOR_HOST: 'auth:9099' },
  { MEDIA_ADAPTER: 'local' },
  { IDENTITY_PROJECT_ID: 'production' },
  { MEDIA_BUCKET_PROJECT_ID: 'production' },
  { SQL_HOST: '/cloudsql/production:asia-southeast2:db' },
  { WEB_ORIGIN: 'http://localhost:3000' },
  { NODE_ENV: 'development' },
  { SQL_ROOT_PASSWORD: 'secret' },
  { SQL_MIGRATOR_PASSWORD: 'secret' },
  { RUNTIME_INPUT_DIGEST: 'invalid' },
  { BUILD_SHA: 'local' },
  { APP_ENV: 'production', BUILD_ENV: 'production' },
  { API_ORIGIN: 'https://another-api.example.com' },
  { WEB_ORIGIN: 'https://another-web.example.com' },
  { SQL_DATABASE: 'another_database' },
  {
    INSTANCE_CONNECTION_NAME: 'blogpost-staging:asia-southeast2:other',
    SQL_HOST: '/cloudsql/blogpost-staging:asia-southeast2:other',
  },
  {
    SQL_APP_SECRET_REF: 'projects/blogpost-staging/secrets/sql-app/versions/2',
  },
  {
    CURSOR_SECRET_REF:
      'projects/blogpost-staging/secrets/cursor/versions/latest',
  },
  { RUNTIME_SERVICE_ACCOUNT: cloudProfile.serviceAccounts.ops },
  { IDENTITY_TOKEN_AUDIENCE: 'another-project' },
  { IDENTITY_TOKEN_ISSUER: 'https://accounts.google.com' },
  { IDENTITY_SESSION_ISSUER: 'https://another-issuer.example.com' },
  { DATABASE_URL: 'postgresql://another-host/blogpost' },
  { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/local-service-account.json' },
  { SQL_PORT: '5433' },
  { SQL_SCHEMA: 'public' },
  { CURSOR_SIGNING_KEY: '1'.repeat(64) + '\n' },
] as NodeJS.ProcessEnv[])
  test(`cloud rejects unsafe configuration ${Object.keys(patch).join()}`, () => {
    assert.throws(() =>
      readConfig({ ...cloudEnv, ...patch }, 'api', cloudProvenance),
    );
  });
test('development cannot run on Cloud Run or target a cloud web origin', () => {
  assert.throws(() => readConfig({ ...developmentEnv, K_SERVICE: 'api' }));
  assert.throws(() =>
    readConfig({ ...developmentEnv, WEB_ORIGIN: 'https://real.example.com' }),
  );
});
test('maintenance omits the API cursor secret while retaining cloud environment and least-privilege checks', () => {
  const job = { ...cloudEnv };
  delete job.CURSOR_SIGNING_KEY;
  job.RUNTIME_SERVICE_ACCOUNT =
    'blogpost-ops@blogpost-staging.iam.gserviceaccount.com';
  assert.equal(
    readConfig(job, 'maintenance', cloudProvenance).cursorSigningKey,
    null,
  );
  assert.throws(() =>
    readConfig(
      { ...job, SQL_ROOT_PASSWORD: 'privileged' },
      'maintenance',
      cloudProvenance,
    ),
  );
  assert.throws(() =>
    readConfig(
      { ...job, MEDIA_LOCAL_ROOT: '/tmp/untrusted' },
      'maintenance',
      cloudProvenance,
    ),
  );
  assert.throws(() =>
    readConfig(
      { ...job, GCP_PROJECT_ID: 'other-project' },
      'maintenance',
      cloudProvenance,
    ),
  );
});
test('migration URL safely encodes passwords and Cloud SQL socket paths', () => {
  const value = migrationUrl({
    ...cloudEnv,
    SQL_MIGRATOR_PASSWORD: 'p@ss:/?#% word',
  });
  const url = new URL(value);
  assert.equal(decodeURIComponent(url.password), 'p@ss:/?#% word');
  assert.equal(url.searchParams.get('host'), cloudEnv.SQL_HOST);
  assert.equal(url.searchParams.get('schema'), 'blogpost');
});

test('cloud configuration digest hashes resource and numeric secret references, never secret values', () => {
  const first = readConfig(cloudEnv, 'api', cloudProvenance);
  const rotatedValue = readConfig(
    {
      ...cloudEnv,
      SQL_APP_PASSWORD: 'different-private-value',
      CURSOR_SIGNING_KEY: '4'.repeat(64),
    },
    'api',
    cloudProvenance,
  );
  assert.equal(first.configurationDigest, rotatedValue.configurationDigest);
  const build = structuredClone(cloudProvenance);
  build.configuration!.secretVersions.SQL_APP_PASSWORD =
    'projects/blogpost-staging/secrets/sql-app/versions/2';
  const rotatedReference = readConfig(
    {
      ...cloudEnv,
      SQL_APP_SECRET_REF: build.configuration!.secretVersions.SQL_APP_PASSWORD,
    },
    'api',
    build,
  );
  assert.notEqual(
    first.configurationDigest,
    rotatedReference.configurationDigest,
  );
});

test('database jobs validate their baked purpose, account and credential references before connecting', () => {
  for (const purpose of [
    'bootstrap-db',
    'migrate',
    'verify',
    'bootstrap-admin',
    'maintenance',
  ] as const) {
    const env = { ...cloudEnv };
    delete env.CURSOR_SIGNING_KEY;
    delete env.CURSOR_SECRET_REF;
    env.RUNTIME_SERVICE_ACCOUNT =
      cloudProfile.serviceAccounts[
        purpose === 'migrate'
          ? 'migrator'
          : purpose === 'bootstrap-db' || purpose === 'bootstrap-admin'
            ? 'bootstrap'
            : 'ops'
      ];
    if (purpose === 'bootstrap-db' || purpose === 'migrate') {
      env.SQL_MIGRATOR_PASSWORD = 'synthetic-migrator';
      env.SQL_MIGRATOR_SECRET_REF =
        cloudProfile.secretVersions.SQL_MIGRATOR_PASSWORD;
    }
    if (purpose === 'bootstrap-db') {
      env.SQL_ROOT_PASSWORD = 'synthetic-root';
      env.SQL_ROOT_SECRET_REF = cloudProfile.secretVersions.SQL_ROOT_PASSWORD;
    }
    assert.equal(
      readConfig(env, purpose, cloudProvenance).cursorSigningKey,
      null,
    );
    assert.throws(() =>
      readConfig(
        { ...env, RUNTIME_SERVICE_ACCOUNT: cloudProfile.serviceAccounts.api },
        purpose,
        cloudProvenance,
      ),
    );
    assert.throws(() =>
      readConfig(
        { ...env, APP_ENV: 'production', BUILD_ENV: 'production' },
        purpose,
        cloudProvenance,
      ),
    );
    if (purpose === 'bootstrap-db' || purpose === 'migrate')
      assert.throws(() =>
        readConfig(
          {
            ...env,
            SQL_MIGRATOR_SECRET_REF:
              'projects/blogpost-staging/secrets/sql-migrator/versions/2',
          },
          purpose,
          cloudProvenance,
        ),
      );
  }
});
