import 'dotenv/config';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../platform/config/config.js';
import { connection } from '../platform/database/connection.js';
import { StorageAdapter, storageFailure } from '../modules/media/storage.js';
import { MaintenanceService } from '../modules/operations/maintenance.service.js';
import { runJob } from './run.js';

await runJob(async () => {
  const config = readConfig(process.env, 'maintenance');
  const storage = new StorageAdapter(config);
  const pool = new pg.Pool({ ...connection('app'), max: 1 });
  try {
    const namespace = createHash('sha256')
      .update(JSON.stringify(config.media))
      .digest('hex');
    const result = await new MaintenanceService(
      pool,
      storage,
      'media-orphans:' + namespace,
    ).run();
    process.stdout.write(
      JSON.stringify({ event: 'maintenance_result', ...result }) + '\n',
    );
    if (result.failures) throw storageFailure();
  } finally {
    await storage.onModuleDestroy();
    await pool.end();
  }
});
