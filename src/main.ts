import 'dotenv/config';
import { createApp } from './app.js';
import { readConfig } from './platform/config/config.js';

try {
  const config = readConfig();
  const app = await createApp(config);
  await app.listen(config.port, '0.0.0.0');
  process.stdout.write(
    `${JSON.stringify({ severity: 'INFO', event: 'started', environment: config.environment })}\n`,
  );
} catch {
  process.stderr.write('{"severity":"ERROR","event":"startup_failed"}\n');
  process.exitCode = 1;
}
