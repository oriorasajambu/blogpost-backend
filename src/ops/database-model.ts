import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { digest } from '../platform/config/build-model.js';

export const SCHEMA_LOCK = 78201907;
export const APP_TABLES = [
  'AuditEvent',
  'Category',
  'IdempotencyRecord',
  'Invitation',
  'MaintenanceCheckpoint',
  'MediaAsset',
  'MediaUploadAttempt',
  'Member',
  'Post',
  'PublishedSearch',
  'RateLimitBucket',
  'ReviewEvent',
  'Revision',
  'RevisionMedia',
  'RevisionTag',
  'SchemaMeta',
  'SlugHistory',
  'Tag',
] as const;
export const TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
] as const;
export function databaseError(code: string): never {
  throw Object.assign(new Error('Database verification did not succeed.'), {
    code,
  });
}
export function tablePrivileges(table: string): readonly string[] {
  if (!(APP_TABLES as readonly string[]).includes(table)) return [];
  if (table === 'SchemaMeta') return ['SELECT'];
  const privileges = ['SELECT', 'INSERT'];
  if (
    ![
      'Revision',
      'RevisionMedia',
      'RevisionTag',
      'ReviewEvent',
      'AuditEvent',
    ].includes(table)
  )
    privileges.push('UPDATE');
  if (
    !['Revision', 'RevisionMedia', 'RevisionTag', 'SlugHistory'].includes(table)
  )
    privileges.push('DELETE');
  return privileges;
}
export interface MigrationEntry {
  id: string;
  sha256: string;
}
export async function migrationManifest(
  directory = new URL('../../prisma/migrations/', import.meta.url),
): Promise<MigrationEntry[]> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    databaseError('INVALID_MIGRATION_DIRECTORY');
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length < 2 || entries.length > 257)
    databaseError('INVALID_MIGRATION_INVENTORY');
  const result: MigrationEntry[] = [];
  let bytesRead = 0;
  for (const entry of entries) {
    if (entry.name === 'migration_lock.toml' && entry.isFile()) {
      if ((await lstat(new URL(entry.name, directory))).size > 4096)
        databaseError('MIGRATION_SIZE_LIMIT');
      const lock = await readFile(new URL(entry.name, directory), 'utf8');
      if (lock.trim() !== 'provider = "postgresql"')
        databaseError('INVALID_MIGRATION_PROVIDER');
      continue;
    }
    if (!entry.isDirectory() || !/^\d{12,14}_[a-z0-9_]+$/.test(entry.name))
      databaseError('INVALID_MIGRATION_INVENTORY');
    const folder = new URL(entry.name + '/', directory);
    const files = await readdir(folder, { withFileTypes: true });
    if (
      files.length !== 1 ||
      files[0]?.name !== 'migration.sql' ||
      !files[0].isFile()
    )
      databaseError('INVALID_MIGRATION_FILE');
    const file = new URL('migration.sql', folder);
    if ((await lstat(file)).size > 1048576)
      databaseError('MIGRATION_SIZE_LIMIT');
    const bytes = await readFile(file);
    bytesRead += bytes.length;
    if (!bytes.length || bytesRead > 4194304)
      databaseError('MIGRATION_SIZE_LIMIT');
    result.push({
      id: entry.name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  if (
    !entries.some((entry) => entry.name === 'migration_lock.toml') ||
    !result.length
  )
    databaseError('INVALID_MIGRATION_INVENTORY');
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
export interface MigrationRow {
  id: string;
  migration_name: string;
  checksum: string;
  started_at: Date;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  applied_steps_count: number;
}
export function migrationState(
  manifest: MigrationEntry[],
  rows: MigrationRow[],
) {
  const expected = new Map(manifest.map((item) => [item.id, item.sha256]));
  if (
    !manifest.length ||
    expected.size !== manifest.length ||
    rows.length > 4096
  )
    databaseError('INVALID_MIGRATION_HISTORY');
  const seen = new Set<string>();
  const successful = new Set<string>();
  const history = [];
  for (const row of rows) {
    if (
      row.id.length !== 36 ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.id) ||
      seen.has(row.id) ||
      !expected.has(row.migration_name) ||
      row.checksum.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(row.checksum) ||
      !Number.isSafeInteger(row.applied_steps_count) ||
      row.applied_steps_count < 0 ||
      !(row.started_at instanceof Date) ||
      !Number.isFinite(row.started_at.getTime())
    )
      databaseError('INVALID_MIGRATION_HISTORY');
    seen.add(row.id);
    const finish = row.finished_at ?? row.rolled_back_at;
    if (!finish) databaseError('UNRESOLVED_MIGRATION');
    if (
      !(finish instanceof Date) ||
      !Number.isFinite(finish.getTime()) ||
      finish < row.started_at ||
      (row.finished_at && row.rolled_back_at)
    )
      databaseError('INVALID_MIGRATION_HISTORY');
    if (row.finished_at) {
      if (row.checksum !== expected.get(row.migration_name))
        databaseError('MIGRATION_CHECKSUM_MISMATCH');
      if (successful.has(row.migration_name))
        databaseError('DUPLICATE_APPLIED_MIGRATION');
      successful.add(row.migration_name);
    }
    // Resolved rolled-back attempts remain in the fingerprint. Their original failed
    // bytes can differ after deliberate repair; only the successful bytes must match.
    history.push({
      id: row.id,
      migration: row.migration_name,
      sha256: row.checksum,
      startedAt: row.started_at.toISOString(),
      finishedAt: row.finished_at?.toISOString() ?? null,
      rolledBackAt: row.rolled_back_at?.toISOString() ?? null,
      steps: row.applied_steps_count,
    });
  }
  let pending = false;
  for (const entry of manifest) {
    if (!successful.has(entry.id)) pending = true;
    else if (pending) databaseError('MIGRATION_HISTORY_IS_NOT_A_PREFIX');
  }
  return {
    migrationDigest: digest(manifest),
    historyDigest: digest(history.sort((a, b) => a.id.localeCompare(b.id))),
    applied: manifest
      .filter((entry) => successful.has(entry.id))
      .map((entry) => entry.id),
    pending: manifest
      .filter((entry) => !successful.has(entry.id))
      .map((entry) => entry.id),
    resolvedAttempts: history.filter((entry) => entry.rolledBackAt !== null)
      .length,
  };
}
