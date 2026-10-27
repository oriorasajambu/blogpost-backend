import { createHash } from 'node:crypto';
import {
  digest,
  validateProvenance,
  cloudRuntimeBinding,
  requiredSecretNames,
  type BuildProvenance,
  type RuntimePurpose,
} from './build-model.js';
import { readProvenance } from './provenance.js';
export const APP_CONFIG = Symbol('APP_CONFIG');

export type AppEnvironment = 'development' | 'staging' | 'production';
export interface AppConfig {
  environment: AppEnvironment;
  port: number;
  buildSha: string;
  revision: string | null;
  identityProject: string;
  identityEmulatorHost: string | null;
  cursorSigningKey: string | null;
  media: {
    adapter: 'local' | 'gcs';
    localRoot: string | null;
    bucket: string | null;
  };
  apiOrigin: string;
  webOrigin: string;
  configurationDigest: string;
  runtimeInputDigest: string;
  build: BuildProvenance;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value?.trim()) throw new Error(`Missing configuration: ${key}`);
  return value;
}

export function readConfig(
  env: NodeJS.ProcessEnv = process.env,
  purpose: RuntimePurpose = 'api',
  provenance: BuildProvenance = readProvenance(),
): AppConfig {
  const build = validateProvenance(provenance, process.env.NODE_ENV === 'test');
  const environment = required(env, 'APP_ENV');
  if (!['development', 'staging', 'production'].includes(environment))
    throw new Error('Invalid APP_ENV');
  if (
    build.environment !== environment ||
    (env.BUILD_ENV && env.BUILD_ENV !== build.environment)
  )
    throw new Error('Build/runtime environment mismatch');
  const buildSha = build.sourceSha ?? 'local';
  if (
    (env.BUILD_SHA && env.BUILD_SHA !== buildSha) ||
    (env.RUNTIME_INPUT_DIGEST &&
      env.RUNTIME_INPUT_DIGEST !== build.runtimeInputDigest)
  )
    throw new Error('Runtime cannot override build provenance');
  const cloud = environment !== 'development';
  const identityProject = required(env, 'IDENTITY_PROJECT_ID');
  const apiOrigin = required(env, 'API_ORIGIN');
  const webOrigin = required(env, 'WEB_ORIGIN');
  for (const origin of [apiOrigin, webOrigin]) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password)
      throw new Error('Origins must be canonical origins without credentials');
    if (cloud && url.protocol !== 'https:')
      throw new Error('Cloud requires HTTPS');
    if (!cloud && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw new Error('Development origins must use loopback');
  }
  required(env, 'SQL_HOST');
  required(env, 'SQL_DATABASE');
  const requiredSecrets = requiredSecretNames(purpose);
  for (const key of requiredSecrets) required(env, key);
  const cursorSigningKey =
    purpose === 'api' ? required(env, 'CURSOR_SIGNING_KEY') : null;
  if (
    cursorSigningKey !== null &&
    (cursorSigningKey.length !== 64 || !/^[a-f0-9]{64}$/.test(cursorSigningKey))
  )
    throw new Error('Invalid CURSOR_SIGNING_KEY');
  if (
    (env.SQL_ROOT_PASSWORD && purpose !== 'bootstrap-db') ||
    (env.SQL_MIGRATOR_PASSWORD &&
      !['bootstrap-db', 'migrate', 'inspect'].includes(purpose))
  )
    throw new Error(
      'Privileged SQL credentials must not be mounted on the API',
    );
  if (cloud) {
    const profile = build.configuration;
    if (!profile || profile.environment !== environment)
      throw new Error('Missing baked environment pairing');
    if (env.NODE_ENV !== 'production')
      throw new Error('Cloud requires NODE_ENV=production');
    if (
      Object.keys(env).some((key) =>
        /EMULATOR|MOCK|FIXTURE|DEBUG_IDENTITY/.test(key),
      )
    )
      throw new Error('Cloud forbids emulator/mock configuration');
    if (env.MEDIA_ADAPTER !== 'gcs')
      throw new Error('Cloud requires private GCS');
    if (identityProject.startsWith('demo-'))
      throw new Error('Cloud forbids demo identity');
    const project = required(env, 'GCP_PROJECT_ID');
    if (project !== identityProject || project !== profile.projectId)
      throw new Error('Identity project mismatch');
    if (required(env, 'MEDIA_BUCKET_PROJECT_ID') !== project)
      throw new Error('Storage project mismatch');
    required(env, 'MEDIA_BUCKET');
    if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(env.MEDIA_BUCKET!))
      throw new Error('Invalid MEDIA_BUCKET');
    if (env.MEDIA_LOCAL_ROOT)
      throw new Error('Cloud forbids local media roots');
    const instance = required(env, 'INSTANCE_CONNECTION_NAME');
    if (
      instance.split(':')[0] !== project ||
      env.SQL_HOST !== `/cloudsql/${instance}`
    )
      throw new Error('Cloud SQL attachment/project mismatch');
    const paired = cloudRuntimeBinding(build, purpose).literals;
    for (const [key, value] of Object.entries(paired))
      if (required(env, key) !== value)
        throw new Error('Runtime configuration does not match its artifact');
    if (
      (env.SQL_PORT && env.SQL_PORT !== '5432') ||
      (env.SQL_SCHEMA && env.SQL_SCHEMA !== profile.sql.schema) ||
      env.DATABASE_URL ||
      env.GOOGLE_APPLICATION_CREDENTIALS
    )
      throw new Error('Unapproved cloud connection override');
  } else {
    if (env.K_SERVICE || env.NODE_ENV === 'production')
      throw new Error('Development cannot run in Cloud Run or production mode');
    if (!identityProject.startsWith('demo-') || env.MEDIA_ADAPTER !== 'local')
      throw new Error('Development requires demo identity and local media');
    required(env, 'FIREBASE_AUTH_EMULATOR_HOST');
    const emulator = new URL(`http://${env.FIREBASE_AUTH_EMULATOR_HOST}`);
    const hostParts = /^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+):([0-9]{1,5})$/i.exec(
      env.FIREBASE_AUTH_EMULATOR_HOST!,
    );
    if (
      !hostParts ||
      Number(hostParts[1]) < 1 ||
      Number(hostParts[1]) > 65535 ||
      !emulator.hostname ||
      emulator.username ||
      emulator.password ||
      emulator.pathname !== '/' ||
      emulator.search ||
      emulator.hash ||
      /\s|\//.test(env.FIREBASE_AUTH_EMULATOR_HOST!)
    )
      throw new Error('Invalid identity emulator host');
    required(env, 'MEDIA_LOCAL_ROOT');
  }
  const port = Number(env.PORT ?? '8080');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid PORT');
  // Only allowlisted nonsecret values enter this digest.
  const configurationDigest = cloud
    ? digest(build.configuration)
    : createHash('sha256')
        .update(
          JSON.stringify({
            environment,
            identityProject,
            apiOrigin,
            webOrigin,
            sqlHost: env.SQL_HOST,
            database: env.SQL_DATABASE,
            mediaAdapter: env.MEDIA_ADAPTER,
            bucket: env.MEDIA_BUCKET ?? null,
          }),
        )
        .digest('hex');
  const runtimeInputDigest = build.runtimeInputDigest;
  return {
    environment: environment as AppEnvironment,
    port,
    buildSha,
    revision: env.K_REVISION ?? null,
    identityProject,
    identityEmulatorHost: cloud ? null : env.FIREBASE_AUTH_EMULATOR_HOST!,
    cursorSigningKey,
    media: {
      adapter: cloud ? 'gcs' : 'local',
      localRoot: cloud ? null : env.MEDIA_LOCAL_ROOT!,
      bucket: cloud ? env.MEDIA_BUCKET! : null,
    },
    apiOrigin,
    webOrigin,
    configurationDigest,
    runtimeInputDigest,
    build,
  };
}
