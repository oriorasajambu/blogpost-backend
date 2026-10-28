import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { readConfig } from '../platform/config/config.js';
import { canonical, digest } from '../platform/config/build-model.js';
import { connection } from '../platform/database/connection.js';
import { databaseError, migrationManifest } from './database-model.js';
import { schemaLock, releaseSchemaLock } from './database-lock.js';
import { runtimePermissions, schemaSnapshot } from './database-verification.js';
import { runJob } from './run.js';

await runJob(async () => {
  const config = readConfig(process.env, 'verify');
  if (
    config.environment !== 'development' ||
    process.env.BLOGPOST_DISPOSABLE_DATABASE !== '1' ||
    process.argv.slice(2).join(' ') !== '--write'
  )
    databaseError('DISPOSABLE_BASELINE_GENERATION_ONLY');
  const pool = new pg.Pool({ ...connection('app'), max: 1 });
  try {
    const client = await pool.connect();
    let locked = false;
    try {
      await schemaLock(client, true);
      locked = true;
      const snapshot = await schemaSnapshot(client);
      const runtime = await runtimePermissions(client);
      const baseline = {
        ...snapshot,
        migrationDigest: digest(await migrationManifest()),
        permissionDigest: runtime.permissionDigest,
      };
      const directory = new URL('../../config/database/', import.meta.url);
      await mkdir(directory, { recursive: true });
      await writeFile(
        new URL('schema-baseline.json', directory),
        canonical(baseline) + '\n',
      );
      process.stdout.write(
        JSON.stringify({
          event: 'database_baseline_generated',
          migrationDigest: baseline.migrationDigest,
          schemaDigest: baseline.schemaDigest,
        }) + '\n',
      );
    } finally {
      if (locked) await releaseSchemaLock(client, true).catch(() => {});
      client.release(true);
    }
  } finally {
    await pool.end();
  }
});
