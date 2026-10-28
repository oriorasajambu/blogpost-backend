import { createMock } from './server.js';

const port = Number(process.env.MOCK_SCENARIO_PORT ?? 4020);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Use a valid local scenario port.');
const { app } = createMock();
await app.listen({ host: '127.0.0.1', port });
process.stdout.write(`Blogpost fixture scenarios: http://127.0.0.1:${port}\n`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
