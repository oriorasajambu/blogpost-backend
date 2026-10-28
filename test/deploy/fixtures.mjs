import { readFile } from 'node:fs/promises';
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
      : purpose === 'migrate' || purpose === 'inspect'
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
      : purpose === 'migrate' || purpose === 'inspect'
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
      'dist/ops/' +
        (['verify', 'inspect'].includes(purpose) ? purpose + '-db' : purpose) +
        '.js',
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
export { profiles, fixture, template, envEntry };
