import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  normalizeCloudProfile,
  type BuildProvenance,
} from '../src/platform/config/build-model.js';
export const cloudProfile = normalizeCloudProfile({
  schemaVersion: 1,
  environment: 'staging',
  projectId: 'blogpost-staging',
  apiOrigin: 'https://api.staging.example.com',
  webOrigin: 'https://staging.example.com',
  identity: {
    audience: 'blogpost-staging',
    idTokenIssuer: 'https://securetoken.google.com/blogpost-staging',
    sessionIssuer: 'https://session.firebase.google.com/blogpost-staging',
  },
  sql: {
    instanceConnectionName: 'blogpost-staging:asia-southeast2:db',
    database: 'blogpost',
    schema: 'blogpost',
  },
  media: {
    adapter: 'gcs',
    bucket: 'blogpost-staging-media',
    projectId: 'blogpost-staging',
  },
  serviceAccounts: {
    api: 'blogpost-api@blogpost-staging.iam.gserviceaccount.com',
    migrator: 'blogpost-migrate@blogpost-staging.iam.gserviceaccount.com',
    ops: 'blogpost-ops@blogpost-staging.iam.gserviceaccount.com',
    bootstrap: 'blogpost-bootstrap@blogpost-staging.iam.gserviceaccount.com',
  },
  secretVersions: {
    SQL_APP_PASSWORD: 'projects/blogpost-staging/secrets/sql-app/versions/1',
    SQL_MIGRATOR_PASSWORD:
      'projects/blogpost-staging/secrets/sql-migrator/versions/1',
    SQL_ROOT_PASSWORD: 'projects/blogpost-staging/secrets/sql-root/versions/1',
    CURSOR_SIGNING_KEY: 'projects/blogpost-staging/secrets/cursor/versions/1',
  },
});
const contractBytes = readFileSync('contracts/openapi-v1.json');
export const cloudProvenance: BuildProvenance = {
  schemaVersion: 1,
  application: 'backend',
  kind: 'ARTIFACT',
  environment: 'staging',
  sourceSha: 'a'.repeat(40),
  sourceRef: 'refs/heads/rc',
  dirty: false,
  applicationVersion: JSON.parse(readFileSync('package.json', 'utf8'))
    .version as string,
  contractVersion: '1.0.0',
  contractSha256: createHash('sha256').update(contractBytes).digest('hex'),
  runtimeInputDigest: 'b'.repeat(64),
  sourceInputDigest: 'c'.repeat(64),
  inputManifestVersion: 1,
  targetPlatform: 'linux/amd64',
  configuration: cloudProfile,
};
