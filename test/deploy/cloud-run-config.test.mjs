import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  verifyCloudRunConfiguration,
  verifyLiveCloudRunConfiguration,
} from '../../scripts/deploy/cloud-run-config.mjs';

const profiles = {};
for (const env of ['staging', 'production'])
  profiles[env] = JSON.parse(
    await readFile(
      new URL(
        '../../config/environments/' + env + '.example.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
function fixture(environment = 'staging', purpose = 'api') {
  const profile = structuredClone(profiles[environment]);
  const provenance = {
    schemaVersion: 1,
    application: 'backend',
    kind: 'ARTIFACT',
    environment,
    sourceSha: 'a'.repeat(40),
    sourceRef: 'refs/heads/' + (environment === 'staging' ? 'rc' : 'main'),
    dirty: false,
    applicationVersion: '0.0.0',
    contractVersion: '1.0.0',
    contractSha256: 'b'.repeat(64),
    runtimeInputDigest: 'c'.repeat(64),
    sourceInputDigest: 'd'.repeat(64),
    inputManifestVersion: 1,
    targetPlatform: 'linux/amd64',
    configuration: profile,
  };
  const project = {
    projectId: profile.projectId,
    projectNumber: '123456789012',
    lifecycleState: 'ACTIVE',
  };
  const target = {
    schemaVersion: 1,
    purpose,
    region: 'asia-southeast2',
    resourceId: 'blogpost-' + purpose,
    image:
      'asia-southeast2-docker.pkg.dev/' +
      profile.projectId +
      '/blogpost/' +
      (purpose === 'api' ? 'backend' : 'backend-operations') +
      '@sha256:' +
      'e'.repeat(64),
  };
  const account =
    purpose === 'api'
      ? 'api'
      : purpose === 'migrate'
        ? 'migrator'
        : ['bootstrap-db', 'bootstrap-admin'].includes(purpose)
          ? 'bootstrap'
          : 'ops';
  const env = Object.entries({
    APP_ENV: environment,
    NODE_ENV: 'production',
    GCP_PROJECT_ID: profile.projectId,
    IDENTITY_PROJECT_ID: profile.projectId,
    API_ORIGIN: profile.apiOrigin,
    WEB_ORIGIN: profile.webOrigin,
    IDENTITY_TOKEN_AUDIENCE: profile.projectId,
    IDENTITY_TOKEN_ISSUER: profile.identity.idTokenIssuer,
    IDENTITY_SESSION_ISSUER: profile.identity.sessionIssuer,
    SQL_HOST: '/cloudsql/' + profile.sql.instanceConnectionName,
    INSTANCE_CONNECTION_NAME: profile.sql.instanceConnectionName,
    SQL_DATABASE: 'blogpost',
    MEDIA_ADAPTER: 'gcs',
    MEDIA_BUCKET: profile.media.bucket,
    MEDIA_BUCKET_PROJECT_ID: profile.projectId,
    RUNTIME_SERVICE_ACCOUNT: profile.serviceAccounts[account],
  }).map(([name, value]) => ({ name, value }));
  const required =
    purpose === 'bootstrap-db'
      ? ['SQL_ROOT_PASSWORD', 'SQL_MIGRATOR_PASSWORD', 'SQL_APP_PASSWORD']
      : purpose === 'migrate'
        ? ['SQL_MIGRATOR_PASSWORD']
        : purpose === 'api'
          ? ['SQL_APP_PASSWORD', 'CURSOR_SIGNING_KEY']
          : ['SQL_APP_PASSWORD'];
  const declarations = {
    SQL_ROOT_PASSWORD: 'SQL_ROOT_SECRET_REF',
    SQL_MIGRATOR_PASSWORD: 'SQL_MIGRATOR_SECRET_REF',
    SQL_APP_PASSWORD: 'SQL_APP_SECRET_REF',
    CURSOR_SIGNING_KEY: 'CURSOR_SECRET_REF',
  };
  for (const key of required) {
    const path = profile.secretVersions[key].split('/');
    env.push(
      { name: declarations[key], value: profile.secretVersions[key] },
      {
        name: key,
        valueSource: { secretKeyRef: { secret: path[3], version: path[5] } },
      },
    );
  }
  if (purpose === 'bootstrap-admin')
    env.push(
      ...Object.entries({
        INITIAL_ADMIN_UID: 'synthetic-user',
        INITIAL_ADMIN_EMAIL: 'private-admin@example.test',
        INITIAL_ADMIN_DISPLAY_NAME: 'Private Administrator',
        INITIAL_ADMIN_HANDLE: 'private-admin',
      }).map(([name, value]) => ({ name, value })),
    );
  const container = {
    image: target.image,
    env,
    volumeMounts: [{ name: 'cloudsql', mountPath: '/cloudsql' }],
  };
  const template = {
    serviceAccount: profile.serviceAccounts[account],
    containers: [container],
    volumes: [
      {
        name: 'cloudsql',
        cloudSqlInstance: { instances: [profile.sql.instanceConnectionName] },
      },
    ],
  };
  if (purpose === 'api') {
    container.ports = [{ containerPort: 8080 }];
    template.timeout = '60s';
    template.maxInstanceRequestConcurrency = 20;
  } else {
    container.command = ['node'];
    container.args = [
      'dist/ops/' + (purpose === 'verify' ? 'verify-db' : purpose) + '.js',
    ];
    template.maxRetries = 0;
    template.timeout = '600s';
  }
  const resource = {
    name:
      'projects/' +
      project.projectNumber +
      '/locations/asia-southeast2/' +
      (purpose === 'api' ? 'services' : 'jobs') +
      '/' +
      target.resourceId,
    uid: '8d5ca46a-7f59-4f64-9d91-fedc41b59e7a',
    generation: '9007199254740993',
    observedGeneration: '9007199254740993',
    etag: 'nonsecret-version-fingerprint',
    terminalCondition: { state: 'CONDITION_SUCCEEDED' },
    template:
      purpose === 'api' ? template : { taskCount: 1, parallelism: 1, template },
  };
  return { provenance, target, project, resource };
}
const template = (f) =>
  f.target.purpose === 'api'
    ? f.resource.template
    : f.resource.template.template;
const envEntry = (f, name) =>
  template(f).containers[0].env.find((entry) => entry.name === name);
for (const environment of ['staging', 'production'])
  for (const purpose of [
    'api',
    'bootstrap-db',
    'migrate',
    'verify',
    'bootstrap-admin',
    'maintenance',
  ]) {
    test(
      'valid ' +
        environment +
        ' ' +
        purpose +
        ' configuration binds image/account/SQL and actual secret mounts',
      () => {
        const f = fixture(environment, purpose);
        const receipt = verifyCloudRunConfiguration(f);
        assert.equal(receipt.evidenceSource, 'provided-json');
        assert.equal(receipt.scope, 'cloud-run-runtime-binding');
        assert.equal(receipt.observation.generation, '9007199254740993');
        assert.match(receipt.deploymentBindingDigest, /^[a-f0-9]{64}$/);
        assert.ok(!JSON.stringify(receipt).includes('private-admin'));
        assert.ok(
          !JSON.stringify(receipt).includes('example-sql-app/versions/1'),
        );
      },
    );
  }
const mutations = [
  [
    'wrong actual service account',
    (f) => {
      template(f).serviceAccount = profiles.staging.serviceAccounts.ops;
    },
  ],
  [
    'self-declared account disagrees with actual account',
    (f) => {
      envEntry(f, 'RUNTIME_SERVICE_ACCOUNT').value =
        profiles.staging.serviceAccounts.ops;
    },
  ],
  [
    'mutable image tag',
    (f) => {
      template(f).containers[0].image =
        f.target.image.split('@')[0] + ':latest';
    },
  ],
  [
    'other registry project',
    (f) => {
      f.target.image = f.target.image.replace(
        profiles.staging.projectId,
        'another-project',
      );
    },
  ],
  [
    'wrong region',
    (f) => {
      f.target.region = 'asia-southeast1';
    },
  ],
  [
    'wrong project number mapping',
    (f) => {
      f.project.projectNumber = '999';
    },
  ],
  [
    'inactive project',
    (f) => {
      f.project.lifecycleState = 'DELETE_REQUESTED';
    },
  ],
  [
    'unsettled generation',
    (f) => {
      f.resource.observedGeneration = '9007199254740992';
    },
  ],
  [
    'pending reconciliation',
    (f) => {
      f.resource.reconciling = true;
    },
  ],
  [
    'failed terminal condition',
    (f) => {
      f.resource.terminalCondition.state = 'CONDITION_FAILED';
    },
  ],
  [
    'sidecar',
    (f) => {
      template(f).containers.push(structuredClone(template(f).containers[0]));
    },
  ],
  [
    'extra SQL attachment',
    (f) => {
      template(f).volumes[0].cloudSqlInstance.instances.push(
        'other-project:asia-southeast2:db',
      );
    },
  ],
  [
    'unmounted SQL attachment',
    (f) => {
      template(f).containers[0].volumeMounts = [];
    },
  ],
  [
    'extra secret volume',
    (f) => {
      template(f).volumes.push({ name: 'credentials', secret: {} });
    },
  ],
  [
    'correct declaration with wrong actual version',
    (f) => {
      envEntry(f, 'SQL_APP_PASSWORD').valueSource.secretKeyRef.version = '2';
    },
  ],
  [
    'latest secret version',
    (f) => {
      envEntry(f, 'SQL_APP_PASSWORD').valueSource.secretKeyRef.version =
        'latest';
    },
  ],
  [
    'foreign secret',
    (f) => {
      envEntry(f, 'SQL_APP_PASSWORD').valueSource.secretKeyRef.secret =
        'projects/other-project/secrets/example-sql-app';
    },
  ],
  [
    'plaintext password mount',
    (f) => {
      const entry = envEntry(f, 'SQL_APP_PASSWORD');
      delete entry.valueSource;
      entry.value = 'private-do-not-leak';
    },
  ],
  [
    'duplicate env',
    (f) => {
      template(f).containers[0].env.push(
        structuredClone(envEntry(f, 'APP_ENV')),
      );
    },
  ],
  [
    'emulator variable',
    (f) => {
      template(f).containers[0].env.push({
        name: 'FIREBASE_AUTH_EMULATOR_HOST',
        value: 'local:9099',
      });
    },
  ],
  [
    'node execution override',
    (f) => {
      template(f).containers[0].env.push({
        name: 'NODE_OPTIONS',
        value: '--require /data/override.js',
      });
    },
  ],
  [
    'missing cursor declaration',
    (f) => {
      template(f).containers[0].env = template(f).containers[0].env.filter(
        (entry) => entry.name !== 'CURSOR_SECRET_REF',
      );
    },
  ],
  [
    'shell command',
    (f) => {
      template(f).containers[0].command = ['sh', '-c'];
      template(f).containers[0].args = ['node dist/main.js'];
    },
  ],
  [
    'malformed empty command',
    (f) => {
      template(f).containers[0].command = '';
    },
  ],
  [
    'wrong port',
    (f) => {
      template(f).containers[0].ports[0].containerPort = 9090;
    },
  ],
  [
    'wrong timeout',
    (f) => {
      template(f).timeout = '300s';
    },
  ],
  [
    'forged v1 input',
    (f) => {
      f.resource.apiVersion = 'serving.knative.dev/v1';
    },
  ],
];
for (const [name, mutate] of mutations)
  test('rejects ' + name, () => {
    const f = fixture();
    mutate(f);
    assert.throws(
      () => verifyCloudRunConfiguration(f),
      (error) =>
        /^[A-Z0-9_]+$/.test(error.code) &&
        !error.message.includes('private-do-not-leak'),
    );
  });
test('only same-project short, ID and observed-number secret references normalize equivalently', () => {
  const f = fixture();
  const first = verifyCloudRunConfiguration(f);
  for (const id of [f.project.projectId, f.project.projectNumber]) {
    const next = structuredClone(f);
    envEntry(next, 'SQL_APP_PASSWORD').valueSource.secretKeyRef.secret =
      'projects/' + id + '/secrets/example-sql-app';
    assert.equal(
      verifyCloudRunConfiguration(next).deploymentBindingDigest,
      first.deploymentBindingDigest,
    );
  }
  const reordered = structuredClone(f);
  template(reordered).containers[0].env.reverse();
  assert.equal(
    verifyCloudRunConfiguration(reordered).deploymentBindingDigest,
    first.deploymentBindingDigest,
  );
});
test('job commands, retry bounds and single-task behavior are checked independently of declarations', () => {
  for (const purpose of [
    'bootstrap-db',
    'migrate',
    'verify',
    'bootstrap-admin',
    'maintenance',
  ]) {
    for (const mutate of [
      (f) => {
        f.resource.template.parallelism = 2;
      },
      (f) => {
        f.resource.template.taskCount = 2;
      },
      (f) => {
        delete template(f).maxRetries;
      },
      (f) => {
        template(f).maxRetries = 2;
      },
      (f) => {
        template(f).containers[0].args = ['dist/main.js'];
      },
    ]) {
      const f = fixture('staging', purpose);
      mutate(f);
      assert.throws(() => verifyCloudRunConfiguration(f));
    }
  }
  const maintenance = fixture('staging', 'maintenance');
  template(maintenance).maxRetries = 1;
  verifyCloudRunConfiguration(maintenance);
});
test('generation and etag remain separate drift evidence while private initial-admin values are excluded from hashes', () => {
  const f = fixture('staging', 'bootstrap-admin');
  const first = verifyCloudRunConfiguration(f);
  envEntry(f, 'INITIAL_ADMIN_EMAIL').value = 'another-private@example.test';
  f.resource.etag = 'changed-version';
  const next = verifyCloudRunConfiguration(f);
  assert.equal(first.deploymentBindingDigest, next.deploymentBindingDigest);
  assert.notEqual(first.observation.etag, next.observation.etag);
  assert.ok(!JSON.stringify(next).includes('another-private'));
});
const response = (value) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
test('the checked-in synthetic target uses the supported strict schema', async () => {
  const f = fixture();
  f.target = JSON.parse(
    await readFile(
      new URL('../../config/deployment-target.example.json', import.meta.url),
      'utf8',
    ),
  );
  template(f).containers[0].image = f.target.image;
  assert.equal(verifyCloudRunConfiguration(f).status, 'PASSED');
});
test('live reader obtains project identity then exact service via bounded authenticated GETs', async () => {
  const f = fixture();
  const calls = [];
  const receipt = await verifyLiveCloudRunConfiguration({
    ...f,
    accessToken: 'synthetic.private-token',
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(
        options.headers.authorization,
        'Bearer synthetic.private-token',
      );
      assert.ok(options.signal instanceof AbortSignal);
      return response(calls.length === 1 ? f.project : f.resource);
    },
  });
  assert.equal(receipt.evidenceSource, 'live-api');
  assert.deepEqual(calls, [
    'https://cloudresourcemanager.googleapis.com/v1/projects/example-blogpost-staging',
    'https://run.googleapis.com/v2/projects/example-blogpost-staging/locations/asia-southeast2/services/blogpost-api',
  ]);
  assert.ok(!JSON.stringify(receipt).includes('private-token'));
});
test('live failures never fall back to provided JSON or echo token/provider diagnostics', async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error('private-provider-diagnostic');
    },
    async () => new Response('private-provider-diagnostic', { status: 403 }),
    async () =>
      new Response('private-provider-diagnostic', {
        headers: { 'content-type': 'text/html' },
      }),
    async () =>
      new Response('{invalid', {
        headers: { 'content-type': 'application/json' },
      }),
    async () =>
      new Response(new Uint8Array([255]), {
        headers: { 'content-type': 'application/json' },
      }),
    async () =>
      new Response(' '.repeat(1048577), {
        headers: { 'content-type': 'application/json' },
      }),
  ]) {
    await assert.rejects(
      verifyLiveCloudRunConfiguration({
        ...fixture(),
        accessToken: 'synthetic.private-token',
        fetchImpl,
      }),
      (error) =>
        error.code === 'CLOUD_READ_FAILED' &&
        !error.message.includes('private'),
    );
  }
  let called = false;
  await assert.rejects(
    verifyLiveCloudRunConfiguration({
      ...fixture(),
      accessToken: 'injected\r\nheader',
      fetchImpl: async () => {
        called = true;
      },
    }),
  );
  assert.equal(called, false);
});

test('live job lookup uses its exact resource and stops before lookup on project mismatch', async () => {
  const f = fixture('production', 'migrate');
  const calls = [];
  await verifyLiveCloudRunConfiguration({
    ...f,
    accessToken: 'synthetic-token',
    fetchImpl: async (url) => {
      calls.push(url);
      return response(calls.length === 1 ? f.project : f.resource);
    },
  });
  assert.equal(
    calls[1],
    'https://run.googleapis.com/v2/projects/example-blogpost-production/locations/asia-southeast2/jobs/blogpost-migrate',
  );
  let count = 0;
  await assert.rejects(
    verifyLiveCloudRunConfiguration({
      ...f,
      accessToken: 'synthetic-token',
      fetchImpl: async () => {
        count++;
        return response({ ...f.project, projectId: 'another-project' });
      },
    }),
    (error) => error.code === 'PROJECT_MISMATCH',
  );
  assert.equal(count, 1);
});

test('approved numeric secret rotation changes configuration and binding digests', () => {
  const f = fixture();
  const previous = verifyCloudRunConfiguration(f);
  f.provenance.configuration.secretVersions.SQL_APP_PASSWORD =
    f.provenance.configuration.secretVersions.SQL_APP_PASSWORD.replace(
      '/1',
      '/2',
    );
  f.provenance.runtimeInputDigest = '0'.repeat(64);
  envEntry(f, 'SQL_APP_SECRET_REF').value =
    f.provenance.configuration.secretVersions.SQL_APP_PASSWORD;
  envEntry(f, 'SQL_APP_PASSWORD').valueSource.secretKeyRef.version = '2';
  f.target.image = f.target.image.split('@')[0] + '@sha256:' + 'f'.repeat(64);
  template(f).containers[0].image = f.target.image;
  const current = verifyCloudRunConfiguration(f);
  assert.notEqual(current.configurationDigest, previous.configurationDigest);
  assert.notEqual(
    current.deploymentBindingDigest,
    previous.deploymentBindingDigest,
  );
});
test('CLI distinguishes file observations and reports only a safe error on private malformed inputs', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'blogpost-cloud-config-'));
  assert.ok(directory.startsWith(resolve(tmpdir()) + sep));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const f = fixture();
  const args = [];
  for (const [flag, value] of [
    ['provenance', f.provenance],
    ['target', f.target],
    ['project-file', f.project],
    ['resource-file', f.resource],
  ]) {
    const path = resolve(directory, flag + '.json');
    await writeFile(path, JSON.stringify(value));
    args.push('--' + flag, path);
  }
  const script = resolve('scripts/deploy/verify-config.mjs');
  const result = await promisify(execFile)(process.execPath, [script, ...args]);
  assert.equal(JSON.parse(result.stdout).evidenceSource, 'provided-json');
  assert.equal(result.stderr, '');
  await writeFile(
    resolve(directory, 'resource-file.json'),
    '{"private-password":"do-not-leak"}',
  );
  await assert.rejects(
    promisify(execFile)(process.execPath, [script, ...args]),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.equal(
        JSON.parse(error.stderr).event,
        'configuration_check_failed',
      );
      assert.ok(!error.stderr.includes('do-not-leak'));
      return true;
    },
  );
  await assert.rejects(
    promisify(execFile)(process.execPath, [
      script,
      ...args,
      '--access-token-file',
      resolve(directory, 'not-read.txt'),
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.deepEqual(JSON.parse(error.stderr), {
        event: 'configuration_check_failed',
        code: 'INVALID_INPUT',
      });
      assert.equal(error.stdout, '');
      return true;
    },
  );
});
