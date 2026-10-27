import { createHash } from 'node:crypto';

export type BuildEnvironment = 'development' | 'staging' | 'production';
export interface CloudProfile {
  schemaVersion: 1;
  environment: 'staging' | 'production';
  projectId: string;
  apiOrigin: string;
  webOrigin: string;
  identity: { audience: string; idTokenIssuer: string; sessionIssuer: string };
  sql: { instanceConnectionName: string; database: string; schema: 'blogpost' };
  media: { adapter: 'gcs'; bucket: string; projectId: string };
  serviceAccounts: {
    api: string;
    migrator: string;
    ops: string;
    bootstrap: string;
  };
  secretVersions: {
    SQL_APP_PASSWORD: string;
    SQL_MIGRATOR_PASSWORD: string;
    SQL_ROOT_PASSWORD: string;
    CURSOR_SIGNING_KEY: string;
  };
}
export interface BuildProvenance {
  schemaVersion: 1;
  application: 'backend';
  kind: 'ARTIFACT' | 'VALIDATION';
  environment: BuildEnvironment;
  sourceSha: string | null;
  sourceRef: string;
  dirty: boolean;
  applicationVersion: string;
  contractVersion: string;
  contractSha256: string;
  runtimeInputDigest: string;
  sourceInputDigest: string;
  inputManifestVersion: 1;
  targetPlatform: 'linux/amd64';
  configuration: CloudProfile | null;
}
export const RUNTIME_PURPOSES = Object.freeze([
  'api',
  'bootstrap-db',
  'migrate',
  'verify',
  'bootstrap-admin',
  'maintenance',
] as const);
export type RuntimePurpose = (typeof RUNTIME_PURPOSES)[number];
export type SecretName = keyof CloudProfile['secretVersions'];
export const SECRET_REFERENCE_NAMES: Readonly<Record<SecretName, string>> =
  Object.freeze({
    SQL_APP_PASSWORD: 'SQL_APP_SECRET_REF',
    SQL_MIGRATOR_PASSWORD: 'SQL_MIGRATOR_SECRET_REF',
    SQL_ROOT_PASSWORD: 'SQL_ROOT_SECRET_REF',
    CURSOR_SIGNING_KEY: 'CURSOR_SECRET_REF',
  });
export function requiredSecretNames(
  purpose: RuntimePurpose,
): readonly SecretName[] {
  if (!RUNTIME_PURPOSES.includes(purpose)) return invalid();
  return purpose === 'bootstrap-db'
    ? ['SQL_ROOT_PASSWORD', 'SQL_MIGRATOR_PASSWORD', 'SQL_APP_PASSWORD']
    : purpose === 'migrate'
      ? ['SQL_MIGRATOR_PASSWORD']
      : purpose === 'api'
        ? ['SQL_APP_PASSWORD', 'CURSOR_SIGNING_KEY']
        : ['SQL_APP_PASSWORD'];
}
export function cloudRuntimeBinding(
  build: BuildProvenance,
  purpose: RuntimePurpose,
) {
  const profile = build.configuration;
  if (
    !profile ||
    build.environment === 'development' ||
    profile.environment !== build.environment
  )
    return invalid();
  const secrets: Record<string, string> = {};
  const literals: Record<string, string> = {
    APP_ENV: build.environment,
    NODE_ENV: 'production',
    GCP_PROJECT_ID: profile.projectId,
    IDENTITY_PROJECT_ID: profile.projectId,
    API_ORIGIN: profile.apiOrigin,
    WEB_ORIGIN: profile.webOrigin,
    IDENTITY_TOKEN_AUDIENCE: profile.identity.audience,
    IDENTITY_TOKEN_ISSUER: profile.identity.idTokenIssuer,
    IDENTITY_SESSION_ISSUER: profile.identity.sessionIssuer,
    INSTANCE_CONNECTION_NAME: profile.sql.instanceConnectionName,
    SQL_HOST: '/cloudsql/' + profile.sql.instanceConnectionName,
    SQL_DATABASE: profile.sql.database,
    MEDIA_ADAPTER: 'gcs',
    MEDIA_BUCKET: profile.media.bucket,
    MEDIA_BUCKET_PROJECT_ID: profile.media.projectId,
    RUNTIME_SERVICE_ACCOUNT:
      profile.serviceAccounts[
        purpose === 'api'
          ? 'api'
          : purpose === 'migrate'
            ? 'migrator'
            : purpose === 'bootstrap-db' || purpose === 'bootstrap-admin'
              ? 'bootstrap'
              : 'ops'
      ],
  };
  for (const name of requiredSecretNames(purpose)) {
    secrets[name] = profile.secretVersions[name];
    literals[SECRET_REFERENCE_NAMES[name]] = profile.secretVersions[name];
  }
  return {
    literals,
    secrets,
    serviceAccount: literals.RUNTIME_SERVICE_ACCOUNT!,
  };
}
function invalid(): never {
  throw new Error('Invalid build or environment profile');
}
export function canonical(value: unknown): string {
  function sort(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => [key, sort(value)]),
      );
    return value;
  }
  return JSON.stringify(sort(value));
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function shape(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  if (canonical(Object.keys(value).sort()) !== canonical([...keys].sort()))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || pattern.exec(value)?.[0] !== value)
    return invalid();
  return value;
}
function origin(value: unknown): string {
  if (typeof value !== 'string') return invalid();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid();
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== value ||
    parsed.username ||
    parsed.password
  )
    return invalid();
  return value;
}
export function normalizeCloudProfile(value: unknown): CloudProfile {
  const p = shape(value, [
    'schemaVersion',
    'environment',
    'projectId',
    'apiOrigin',
    'webOrigin',
    'identity',
    'sql',
    'media',
    'serviceAccounts',
    'secretVersions',
  ]);
  if (
    p.schemaVersion !== 1 ||
    !['staging', 'production'].includes(String(p.environment))
  )
    return invalid();
  const project = text(p.projectId, /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
  const identity = shape(p.identity, [
    'audience',
    'idTokenIssuer',
    'sessionIssuer',
  ]);
  if (
    identity.audience !== project ||
    identity.idTokenIssuer !== 'https://securetoken.google.com/' + project ||
    identity.sessionIssuer !== 'https://session.firebase.google.com/' + project
  )
    return invalid();
  const sql = shape(p.sql, ['instanceConnectionName', 'database', 'schema']);
  const instance = text(
    sql.instanceConnectionName,
    /^[a-z][a-z0-9-]+:[a-z]+-[a-z]+[0-9]:[a-z][a-z0-9-]{0,97}$/,
  );
  if (instance.split(':')[0] !== project || sql.schema !== 'blogpost')
    return invalid();
  const media = shape(p.media, ['adapter', 'bucket', 'projectId']);
  if (media.adapter !== 'gcs' || media.projectId !== project) return invalid();
  const accounts = shape(p.serviceAccounts, [
    'api',
    'migrator',
    'ops',
    'bootstrap',
  ]);
  for (const value of Object.values(accounts)) {
    const parts = typeof value === 'string' ? value.split('@') : [];
    text(parts[0], /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
    if (parts.length !== 2 || parts[1] !== project + '.iam.gserviceaccount.com')
      return invalid();
  }
  if (new Set(Object.values(accounts)).size !== 4) return invalid();
  const refs = shape(p.secretVersions, [
    'SQL_APP_PASSWORD',
    'SQL_MIGRATOR_PASSWORD',
    'SQL_ROOT_PASSWORD',
    'CURSOR_SIGNING_KEY',
  ]);
  for (const value of Object.values(refs)) {
    text(
      value,
      /^projects\/[a-z0-9-]+\/secrets\/[A-Za-z0-9_-]{1,255}\/versions\/[1-9][0-9]{0,18}$/,
    );
    if (
      typeof value !== 'string' ||
      !value.startsWith('projects/' + project + '/secrets/')
    )
      return invalid();
  }
  if (
    new Set(
      Object.values(refs).map((ref) => String(ref).split('/versions/')[0]),
    ).size !== 4
  )
    return invalid();
  const profile: CloudProfile = {
    schemaVersion: 1,
    environment: p.environment as CloudProfile['environment'],
    projectId: project,
    apiOrigin: origin(p.apiOrigin),
    webOrigin: origin(p.webOrigin),
    identity: identity as unknown as CloudProfile['identity'],
    sql: {
      instanceConnectionName: instance,
      database: text(sql.database, /^[a-z][a-z0-9_]{0,62}$/),
      schema: 'blogpost',
    },
    media: {
      adapter: 'gcs',
      bucket: text(media.bucket, /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/),
      projectId: project,
    },
    serviceAccounts: accounts as unknown as CloudProfile['serviceAccounts'],
    secretVersions: refs as unknown as CloudProfile['secretVersions'],
  };
  if (profile.apiOrigin === profile.webOrigin) return invalid();
  return JSON.parse(canonical(profile)) as CloudProfile;
}
export function validateProvenance(
  value: unknown,
  allowValidation = false,
): BuildProvenance {
  const b = shape(value, [
    'schemaVersion',
    'application',
    'kind',
    'environment',
    'sourceSha',
    'sourceRef',
    'dirty',
    'applicationVersion',
    'contractVersion',
    'contractSha256',
    'runtimeInputDigest',
    'sourceInputDigest',
    'inputManifestVersion',
    'targetPlatform',
    'configuration',
  ]);
  if (
    b.schemaVersion !== 1 ||
    b.inputManifestVersion !== 1 ||
    b.application !== 'backend' ||
    b.targetPlatform !== 'linux/amd64' ||
    !['development', 'staging', 'production'].includes(String(b.environment)) ||
    typeof b.dirty !== 'boolean'
  )
    return invalid();
  if (
    b.kind !== 'ARTIFACT' &&
    !(
      allowValidation &&
      b.kind === 'VALIDATION' &&
      b.environment === 'development'
    )
  )
    return invalid();
  const sha = b.sourceSha === null ? null : text(b.sourceSha, /^[a-f0-9]{40}$/);
  const sourceRef = text(
    b.sourceRef,
    /^(?:refs\/(?:heads|pull)\/[A-Za-z0-9_./-]+|unborn:[a-zA-Z0-9_/-]+)$/,
  );
  if (
    (sha === null &&
      (!/^unborn:(main|master)$/.test(sourceRef) ||
        b.environment !== 'development' ||
        b.dirty !== true)) ||
    (sha !== null && sourceRef.startsWith('unborn:'))
  )
    return invalid();
  text(
    b.applicationVersion,
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
  text(
    b.contractVersion,
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/,
  );
  text(b.contractSha256, /^[a-f0-9]{64}$/);
  text(b.runtimeInputDigest, /^[a-f0-9]{64}$/);
  text(b.sourceInputDigest, /^[a-f0-9]{64}$/);
  if (b.environment === 'development') {
    if (b.configuration !== null) return invalid();
  } else {
    const profile = normalizeCloudProfile(b.configuration);
    if (
      profile.environment !== b.environment ||
      b.dirty ||
      sha === null ||
      sourceRef !==
        'refs/heads/' + (b.environment === 'staging' ? 'rc' : 'main')
    )
      return invalid();
    b.configuration = profile;
  }
  return JSON.parse(canonical(b)) as unknown as BuildProvenance;
}
