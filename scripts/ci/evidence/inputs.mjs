import {
  digest,
  normalizeCloudProfile,
  validateProvenance,
} from '../../../src/platform/config/build-model.ts';
import { committedFiles, inputManifest } from '../../build/inputs.mjs';
import { fail, metadata, sha } from '../policy.mjs';
import { sha256 } from './model.mjs';
import { expectedDatabaseSql } from './database-inputs.mjs';

// Expectations are computed from immutable Git blobs; this does not build or attest an image.
export async function expectedCandidateInputs(root, candidateSha, profile) {
  sha(candidateSha);
  profile = normalizeCloudProfile(profile);
  if (profile.environment !== 'staging') fail('STAGING_PROFILE_REQUIRED');
  const marker = metadata(root, candidateSha);
  const files = committedFiles(root, candidateSha);
  const manifest = await inputManifest(root, 'staging', profile, files);
  const contract = files.find(
    (file) => file.path === 'contracts/openapi-v1.json',
  );
  const migrations = files
    .filter((file) =>
      /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(file.path),
    )
    .map((file) => ({
      id: file.path.split('/')[2],
      sha256: sha256(file.bytes),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!contract?.bytes || !migrations.length)
    fail('CANDIDATE_CONTRACT_OR_MIGRATIONS_MISSING');
  return {
    build: validateProvenance({
      schemaVersion: 1,
      application: 'backend',
      kind: 'ARTIFACT',
      environment: 'staging',
      sourceSha: candidateSha,
      sourceRef: 'refs/heads/rc',
      dirty: false,
      applicationVersion: marker.version,
      contractVersion: marker.apiContractVersion,
      contractSha256: sha256(contract.bytes),
      runtimeInputDigest: digest(manifest),
      sourceInputDigest: digest({
        schemaVersion: 1,
        targetPlatform: manifest.targetPlatform,
        entries: manifest.entries,
      }),
      inputManifestVersion: 1,
      targetPlatform: 'linux/amd64',
      configuration: profile,
    }),
    migrationDigest: digest(migrations),
    migrations,
    sql: expectedDatabaseSql(root, candidateSha),
  };
}
