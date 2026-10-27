import 'dotenv/config';
import pg from 'pg';
import { readConfig } from '../platform/config/config.js';
import { digest } from '../platform/config/build-model.js';
import { connection } from '../platform/database/connection.js';
import { databaseError, migrationManifest } from './database-model.js';
import { databaseExecution, databaseReceipt } from './database-receipt.js';
import { schemaLock, releaseSchemaLock } from './database-lock.js';
import { expectedSchema, readMigrationState } from './database-verification.js';
import { runJob } from './run.js';

await runJob(async () => {
  const config = readConfig(process.env, 'inspect');
  databaseExecution(config);
  const manifest = await migrationManifest();
  const baseline = await expectedSchema();
  if (baseline.migrationDigest !== digest(manifest))
    databaseError('STALE_SCHEMA_BASELINE');
  const pool = new pg.Pool({ ...connection('migrator'), max: 1 });
  try {
    const client = await pool.connect();
    let locked = false;
    try {
      await schemaLock(client, true);
      locked = true;
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      let state;
      try {
        state = await readMigrationState(client, manifest);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      // A valid prefix may have pending migrations before backup/apply. HISTORY
      // observes that state; readiness requires pending=[] in the trusted writer.
      process.stdout.write(
        JSON.stringify(
          databaseReceipt(config, 'HISTORY', {
            ...state,
            migrations: manifest,
          }),
        ) + '\n',
      );
    } finally {
      if (locked) await releaseSchemaLock(client, true).catch(() => {});
      client.release(true);
    }
  } finally {
    await pool.end();
  }
});
