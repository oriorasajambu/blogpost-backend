import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { readConfig } from '../../src/platform/config/config.js';
import { developmentEnv } from '../helpers.js';
import { CursorService, cursorQuery } from '../../src/platform/http/cursor.js';
import { identityThrottle } from '../../src/platform/http/identity-throttle.js';
import { memberPatch } from '../../src/modules/members/admin-members.service.js';
import {
  invitationInput,
  invitationToken,
} from '../../src/modules/invitations/invitation.service.js';
import { ApiError } from '../../src/platform/errors/api-error.js';

const errorCode = (code: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code;
const queryRequest = (originalUrl: string) => ({ originalUrl }) as Request;
test('dedicated cursor key validates, rotates independently and never affects the safe configuration digest', () => {
  const first = readConfig(developmentEnv);
  const next = readConfig({
    ...developmentEnv,
    CURSOR_SIGNING_KEY: '9'.repeat(64),
  });
  assert.equal(first.configurationDigest, next.configurationDigest);
  assert.notEqual(first.cursorSigningKey, next.cursorSigningKey);
  for (const value of [undefined, '', 'short', 'G'.repeat(64), '1'.repeat(63)])
    assert.throws(() =>
      readConfig({ ...developmentEnv, CURSOR_SIGNING_KEY: value }),
    );
  const job = readConfig(
    { ...developmentEnv, CURSOR_SIGNING_KEY: undefined },
    'bootstrap-admin',
  );
  assert.equal(job.cursorSigningKey, null);
  assert.throws(() => new CursorService(job));
});
test('cursor pagination binds user/route/normalized filters and survives separate service instances', () => {
  const config = readConfig(developmentEnv);
  const first = new CursorService(config);
  const other = new CursorService(config);
  const now = Date.parse('2026-10-26T00:00:00.000Z');
  const rows = Array.from({ length: 21 }, () => ({
    id: randomUUID(),
    createdAt: new Date(now - 1000),
  }));
  const query = cursorQuery(
    queryRequest('/v1/admin/members?active=false&role=EDITOR'),
    ['active', 'role'],
  );
  const page = first.page('uid-a', '/v1/admin/members', query, rows, now);
  assert.equal(page.rows.length, 20);
  assert.equal(page.pagination.hasMore, true);
  const same = cursorQuery(
    queryRequest(
      '/v1/admin/members?role=EDITOR&active=false&pageSize=20&cursor=' +
        page.pagination.nextCursor,
    ),
    ['role', 'active'],
  );
  assert.deepEqual(
    other.decode('uid-a', '/v1/admin/members', same, now + 1),
    rows[19],
  );
  assert.throws(
    () => other.decode('uid-b', '/v1/admin/members', same, now + 1),
    errorCode('INVALID_CURSOR'),
  );
  assert.throws(
    () => other.decode('uid-a', '/v1/admin/invitations', same, now + 1),
    errorCode('INVALID_CURSOR'),
  );
  assert.throws(
    () =>
      other.decode(
        'uid-a',
        '/v1/admin/members',
        { ...same, pageSize: 10 },
        now + 1,
      ),
    errorCode('INVALID_CURSOR'),
  );
  assert.throws(
    () =>
      other.decode(
        'uid-a',
        '/v1/admin/members',
        { ...same, filters: { active: true, role: 'EDITOR' } },
        now + 1,
      ),
    errorCode('INVALID_CURSOR'),
  );
  assert.throws(
    () => other.decode('uid-a', '/v1/admin/members', same, now + 86_400_000),
    errorCode('INVALID_CURSOR'),
  );
  const rotated = new CursorService({
    ...config,
    cursorSigningKey: '8'.repeat(64),
  });
  assert.throws(
    () => rotated.decode('uid-a', '/v1/admin/members', same, now + 1),
    errorCode('INVALID_CURSOR'),
  );
});
test('cursor parsing rejects duplicate/unknown/invalid fields without echoing query values', () => {
  for (const query of [
    'pageSize=0',
    'pageSize=51',
    'active=1',
    'role=ROOT',
    'active=true&active=false',
    'unknown=private-value',
    'cursor=',
  ])
    assert.throws(
      () => cursorQuery(queryRequest('/?' + query), ['active', 'role']),
      errorCode('VALIDATION_FAILED'),
    );
  const empty = new CursorService(readConfig(developmentEnv)).page(
    'uid',
    '/route',
    { pageSize: 20, filters: {} },
    [],
  );
  assert.deepEqual(empty.pagination, {
    kind: 'CURSOR',
    pageSize: 20,
    hasMore: false,
    nextCursor: null,
  });
});
test('member and invitation input validation never coerces role arrays or opens protected profile fields', () => {
  assert.deepEqual(memberPatch({ active: false }), { active: false });
  for (const input of [
    {},
    [],
    null,
    { role: ['ADMIN'] },
    { role: {} },
    { active: 1 },
    { email: 'private@example.test' },
  ])
    assert.throws(() => memberPatch(input), errorCode('VALIDATION_FAILED'));
  assert.deepEqual(
    invitationInput({ email: ' Alice+staff@Example.Test ', role: 'AUTHOR' }),
    { email: 'alice+staff@example.test', role: 'AUTHOR' },
  );
  for (const input of [
    { email: 'valid@example.test', role: ['ADMIN'] },
    { email: 'invalid', role: 'ADMIN' },
    { email: 'valid@example.test', role: 'ROOT' },
  ])
    assert.throws(() => invitationInput(input), errorCode('VALIDATION_FAILED'));
  assert.equal(invitationToken({ token: 'A'.repeat(43) }), 'A'.repeat(43));
  for (const input of [
    { token: 'short' },
    { token: 'A'.repeat(43), role: 'ADMIN' },
    {},
    null,
  ])
    assert.throws(() => invitationToken(input), errorCode('VALIDATION_FAILED'));
});
test('anonymous identity throttling trusts socket addresses, bounds global attempts and expires without persisted IPs', () => {
  let now = 1000;
  const middleware = identityThrottle(() => now);
  const attempt = (
    ip: string,
    method = 'POST',
    path = '/v1/invitations/accept',
  ) => {
    let failure: unknown;
    middleware(
      {
        method,
        path,
        socket: { remoteAddress: ip },
        headers: { 'x-forwarded-for': randomUUID() },
      } as unknown as Request,
      {} as Response,
      (error) => {
        failure = error;
      },
    );
    return failure;
  };
  for (let index = 0; index < 30; index++)
    assert.equal(attempt('127.0.0.1'), undefined);
  assert.ok(errorCode('RATE_LIMITED')(attempt('127.0.0.1')));
  for (let index = 0; index < 170; index++)
    assert.equal(attempt(`fixture-${index}`), undefined);
  assert.ok(errorCode('RATE_LIMITED')(attempt('new-socket')));
  assert.equal(attempt('127.0.0.1', 'OPTIONS'), undefined);
  assert.equal(attempt('127.0.0.1', 'POST', '/v1/auth/web-session'), undefined);
  now += 60_000;
  assert.equal(attempt('127.0.0.1'), undefined);
});
