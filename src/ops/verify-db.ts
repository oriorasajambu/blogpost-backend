import 'dotenv/config';
import pg from 'pg';
import { readConfig } from '../platform/config/config.js';
import { connection } from '../platform/database/connection.js';
import { runJob } from './run.js';
import { schemaLock, releaseSchemaLock } from './database-lock.js';
import { databaseError, migrationManifest } from './database-model.js';
import { digest } from '../platform/config/build-model.js';
import { databaseExecution, databaseReceipt } from './database-receipt.js';
import {
  expectedSchema,
  runtimePermissions,
  schemaSnapshot,
} from './database-verification.js';

await runJob(async () => {
  const config = readConfig(process.env, 'verify');
  databaseExecution(config);
  const pool = new pg.Pool({ ...connection('app'), max: 1 });
  try {
    const client = await pool.connect();
    let locked = false;
    try {
      await schemaLock(client, true);
      locked = true;
      const expected = await expectedSchema();
      if (expected.migrationDigest !== digest(await migrationManifest()))
        databaseError('STALE_SCHEMA_BASELINE');
      const observed = await schemaSnapshot(client);
      if (expected.schemaDigest !== observed.schemaDigest)
        databaseError('DATABASE_SCHEMA_DRIFT');
      const runtime = await runtimePermissions(client);
      if (runtime.permissionDigest !== expected.permissionDigest)
        databaseError('RUNTIME_PERMISSION_BASELINE_DRIFT');
      process.stdout.write(
        JSON.stringify(
          databaseReceipt(config, 'RUNTIME', {
            schemaVersion: 1,
            migrationDigest: expected.migrationDigest,
            schemaDigest: observed.schemaDigest,
            ...runtime,
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
