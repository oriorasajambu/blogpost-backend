import { test } from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/platform/config/config.js';
import { developmentEnv, metadata } from '../helpers.js';

test('scenario control routes are absent from the real Nest application', async () => {
  const app = await createApp(
    readConfig({
      ...developmentEnv,
      ...process.env,
      SQL_ROOT_PASSWORD: undefined,
      SQL_MIGRATOR_PASSWORD: undefined,
    }),
  );
  await app.init();
  try {
    for (const path of ['/__mock/reset', '/__mock/clock', '/__mock/fault'])
      await request(app.getHttpServer())
        .post(path)
        .set(metadata)
        .send({})
        .expect(404);
  } finally {
    await app.close();
  }
});
