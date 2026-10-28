import { createHash } from 'node:crypto';
import { digest } from '../../../src/platform/config/build-model.ts';
import { committedFiles } from '../../build/inputs.mjs';
import { sha as sourceSha } from '../policy.mjs';
import {
  sqlExpectations,
  object,
  reject,
} from '../../deploy/database-proof.mjs';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function expectedDatabaseSql(root, sha) {
  sourceSha(sha);
  const files = committedFiles(root, sha);
  const baselineFile = files.find(
    (file) => file.path === 'config/database/schema-baseline.json',
  );
  if (!baselineFile?.bytes || baselineFile.bytes.length > 1048576)
    reject('EXPECTED_SQL_BASELINE_REQUIRED');
  const baseline = JSON.parse(baselineFile.bytes.toString('utf8'));
  object(baseline, [
    'schemaVersion',
    'postgresMajor',
    'definitions',
    'migrationDigest',
    'schemaDigest',
    'permissionDigest',
  ]);
  if (
    baseline.schemaVersion !== 1 ||
    baseline.postgresMajor !== 17 ||
    digest(baseline.definitions) !== baseline.schemaDigest
  )
    reject('INVALID_EXPECTED_SQL');
  const migrations = files
    .filter((file) =>
      /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(file.path),
    )
    .map((file) => ({
      id: file.path.split('/')[2],
      sha256: sha256(file.bytes),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return sqlExpectations({
    migrations,
    migrationDigest: baseline.migrationDigest,
    schemaDigest: baseline.schemaDigest,
    permissionDigest: baseline.permissionDigest,
  });
}
