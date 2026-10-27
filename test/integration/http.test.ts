import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/platform/config/config.js';
import { metadata, developmentEnv } from '../helpers.js';

let app: INestApplication;
const webOrigin = process.env.WEB_ORIGIN ?? developmentEnv.WEB_ORIGIN!;
before(async () => {
  app = await createApp(
    readConfig({
      ...developmentEnv,
      ...process.env,
      SQL_ROOT_PASSWORD: undefined,
      SQL_MIGRATOR_PASSWORD: undefined,
    }),
  );
  await app.init();
});
after(async () => {
  await app?.close();
});
test('health is unwrapped and exempt from metadata; readiness reads real schema', async () => {
  const live = await request(app.getHttpServer())
    .get('/health/live')
    .expect(200);
  assert.deepEqual(live.body, { status: 'ok' });
  await request(app.getHttpServer()).get('/health/ready').expect(200);
});
test('meta returns the canonical envelope, trace, and safe capabilities', async () => {
  const parent = '4bf92f3577b34da6a3ce929d0e0e4736';
  const result = await request(app.getHttpServer())
    .get('/v1/meta')
    .set(metadata)
    .set('traceparent', `00-${parent}-00f067aa0ba902b7-01`)
    .expect(200);
  assert.equal(result.body.traceId, parent);
  assert.equal(result.headers['x-trace-id'], parent);
  assert.equal(Object.keys(result.body).length, 8);
  assert.equal(result.body.data.apiMajor, 1);
  assert.deepEqual(result.body.data.features, []);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['x-api-contract-version'], '1.0.0');
  assert.equal(result.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
  assert.equal(
    JSON.stringify(result.body).includes(process.env.SQL_APP_PASSWORD!),
    false,
  );
});
test('missing metadata returns 400 with all five safe issues', async () => {
  const result = await request(app.getHttpServer()).get('/v1/meta').expect(400);
  assert.equal(result.body.error.code, 'INVALID_CLIENT_METADATA');
  assert.equal(result.body.error.fieldErrors.length, 5);
  assert.equal(result.body.statusCode, result.status);
});
test('credential mixups return wrapped errors even on public endpoints', async () => {
  const result = await request(app.getHttpServer())
    .get('/v1/meta')
    .set(metadata)
    .set('Authorization', 'Bearer secret')
    .set('X-Blogpost-Web-Session', 'secret')
    .expect(400);
  assert.equal(result.body.error.code, 'AMBIGUOUS_CREDENTIALS');
});
test('malformed single credentials produce safe wrapped 401 responses', async () => {
  const result = await request(app.getHttpServer())
    .get('/v1/meta')
    .set(metadata)
    .set('Authorization', 'Basic never-echo-this')
    .expect(401);
  assert.equal(result.body.error.code, 'INVALID_CREDENTIAL');
  assert.equal(result.body.statusCode, result.status);
  assert.equal(JSON.stringify(result.body).includes('never-echo-this'), false);
});
test('CORS preflight is bodyless, metadata exempt, and restricts the origin', async () => {
  const allowed = await request(app.getHttpServer())
    .options('/v1/meta')
    .set('Origin', webOrigin)
    .set('Access-Control-Request-Method', 'GET')
    .expect(204);
  assert.equal(allowed.text, '');
  assert.equal(allowed.headers['access-control-allow-origin'], webOrigin);
  const rejected = await request(app.getHttpServer())
    .options('/v1/meta')
    .set('Origin', 'https://untrusted.example')
    .set('Access-Control-Request-Method', 'GET');
  assert.notEqual(
    rejected.headers['access-control-allow-origin'],
    'https://untrusted.example',
  );
});
test('metadata errors remain readable through CORS and duplicated metadata is rejected', async () => {
  const missing = await request(app.getHttpServer())
    .get('/v1/meta')
    .set('Origin', webOrigin)
    .expect(400);
  assert.equal(missing.headers['access-control-allow-origin'], webOrigin);
  const duplicate = await request(app.getHttpServer())
    .get('/v1/meta')
    .set(metadata)
    .set({ 'X-Device-ID': [metadata['X-Device-ID'], metadata['X-Device-ID']] })
    .expect(400);
  assert.equal(duplicate.body.error.code, 'INVALID_CLIENT_METADATA');
});
test('malformed JSON and oversize bodies use safe error envelopes', async () => {
  const malformed = await request(app.getHttpServer())
    .post('/v1/meta')
    .set(metadata)
    .set('Content-Type', 'application/json')
    .send('{"secret":')
    .expect(400);
  assert.equal(malformed.body.error.code, 'MALFORMED_JSON');
  assert.equal(malformed.body.traceId, malformed.headers['x-trace-id']);
  const large = await request(app.getHttpServer())
    .post('/v1/meta')
    .set(metadata)
    .send({ text: 'x'.repeat(1048576) })
    .expect(413);
  assert.equal(large.body.error.code, 'PAYLOAD_TOO_LARGE');
});
test('HEAD omits the body and unknown paths never expose framework internals', async () => {
  const head = await request(app.getHttpServer())
    .head('/v1/meta')
    .set(metadata)
    .expect(200);
  assert.equal(head.text, undefined);
  const missing = await request(app.getHttpServer())
    .get('/v1/unknown')
    .set(metadata)
    .expect(404);
  assert.equal(missing.body.error.code, 'RESOURCE_NOT_FOUND');
});
test('unsupported methods return Allow and unknown query properties are rejected', async () => {
  const method = await request(app.getHttpServer())
    .post('/v1/meta')
    .set(metadata)
    .send({})
    .expect(405);
  assert.equal(method.headers.allow, 'GET, HEAD, OPTIONS');
  assert.equal(method.body.error.code, 'METHOD_NOT_ALLOWED');
  const query = await request(app.getHttpServer())
    .get('/v1/meta?secret=hidden')
    .set(metadata)
    .expect(422);
  assert.equal(query.body.error.fieldErrors[0].code, 'UNKNOWN_FIELD');
  assert.equal(JSON.stringify(query.body).includes('hidden'), false);
});
