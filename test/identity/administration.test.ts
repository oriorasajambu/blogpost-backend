import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { lockAdministrativeState } from '../../src/platform/database/operation.js';
import { identityFixture, type DTO, type Account } from './fixture.js';
import { createApp } from '../../src/app.js';
import { assertConforms, coverage } from '../conformance/verify.js';
import { metadata } from '../helpers.js';

test(
  'real administrative membership and invitation lifecycle with SQL races and secret-free recovery',
  { timeout: 120_000 },
  async (t) => {
    const f = await identityFixture(t);
    const db = f.database.prisma;
    const req = f.request;
    const issue = (
      account: Account,
      email: string,
      role = 'AUTHOR',
      key: string = randomUUID(),
      status = 201,
    ) =>
      req<DTO['InvitationIssueResult']>(
        'createInvitation',
        '/v1/admin/invitations',
        status,
        { method: 'POST', account, body: { email, role }, key },
      );
    const accept = (
      account: Account,
      token: string,
      key: string = randomUUID(),
      status: number | readonly number[] = 200,
    ) =>
      req<DTO['Me']>('acceptInvitation', '/v1/invitations/accept', status, {
        method: 'POST',
        account,
        body: { token },
        key,
      });
    const change = (
      account: Account,
      id: string,
      action: 'revoke' | 'reissue',
      version: number,
      key: string = randomUUID(),
      status = action === 'reissue' ? 201 : 200,
    ) =>
      req<DTO['InvitationIssueResult'] & DTO['Invitation']>(
        action === 'reissue' ? 'reissueInvitation' : 'revokeInvitation',
        `/v1/admin/invitations/${id}/${action}`,
        status,
        { method: 'POST', account, body: {}, key, version },
      );
    const update = (
      account: Account,
      id: string,
      body: unknown,
      version: number,
      key: string = randomUUID(),
      status: number | readonly number[] = 200,
    ) =>
      req<DTO['AdminMember']>(
        'updateMember',
        `/v1/admin/members/${id}`,
        status,
        { method: 'PATCH', account, body, version, key },
      );
    const secret = (result: DTO['InvitationIssueResult']) => {
      assert.equal(result.linkAvailable, true);
      assert.ok(result.inviteUrl);
      const url = new URL(result.inviteUrl);
      assert.equal(url.origin, f.config.webOrigin);
      assert.equal(url.pathname, '/invitations/accept');
      const token = url.searchParams.get('token')!;
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(Buffer.from(token, 'base64url').length, 32);
      return token;
    };
    const operator = await f.member('ADMIN');
    const author = await f.member('AUTHOR');
    const editor = await f.member('EDITOR');
    await t.test(
      'anonymous/author/editor access and forged role claims cannot expose administration',
      async () => {
        for (const account of [undefined, author, editor])
          for (const [path, operation] of [
            ['/v1/admin/members', 'listMembers'],
            [`/v1/admin/members/${author.row.id}`, 'getMember'],
            ['/v1/admin/invitations', 'listInvitations'],
            ['/v1/admin/audit-events', 'listAuditEvents'],
          ])
            await req(operation!, path!, account ? 403 : 401, { account });
        await f.admin.setCustomUserClaims(author.uid, {
          role: 'ADMIN',
          active: true,
        });
        const claimed = await f.google(
          'claimed-role',
          author.subject,
          author.email,
        );
        await req('listMembers', '/v1/admin/members', 403, {
          account: claimed,
          headers: { 'X-Role': 'ADMIN', 'X-Member-ID': operator.row.id },
        });
        const session = await req<DTO['WebSession']>(
          'createWebSession',
          '/v1/auth/web-session',
          200,
          { method: 'POST', body: { idToken: operator.token } },
        );
        await req('listMembers', '/v1/admin/members', 200, {
          headers: {
            'X-Blogpost-Web-Session': session.body.data.sessionCookie,
          },
        });
        const listed = await req<DTO['AdminMember']>(
          'getMember',
          `/v1/admin/members/${author.row.id}`,
          200,
          { account: operator },
        );
        assert.equal(listed.body.data.email, author.email);
        assert.deepEqual(Object.keys(listed.body.data).sort(), [
          'active',
          'bio',
          'createdAt',
          'displayName',
          'email',
          'handle',
          'id',
          'role',
          'updatedAt',
          'version',
        ]);
      },
    );
    await t.test(
      'keyset cursors handle timestamp ties, bind caller/filters/size and survive a second API instance',
      async () => {
        const ids: string[] = [];
        for (let i = 0; i < 4; i++) {
          const row = await f.member('EDITOR');
          ids.push(row.row.id);
          await db.member.update({
            where: { id: row.row.id },
            data: {
              active: false,
              createdAt: new Date('2020-01-01T00:00:00.000Z'),
            },
          });
        }
        const filter = '/v1/admin/members?role=EDITOR&active=false&pageSize=2';
        const first = await req<DTO['AdminMember'][]>(
          'listMembers',
          filter,
          200,
          { account: operator },
        );
        assert.equal(first.body.meta.pagination.hasMore, true);
        const cursor = first.body.meta.pagination.nextCursor!;
        const secondApp = await createApp(f.config);
        await secondApp.listen(0, '127.0.0.1');
        const address = secondApp.getHttpServer().address();
        assert.ok(address && typeof address !== 'string');
        try {
          const second = await req<DTO['AdminMember'][]>(
            'listMembers',
            filter + '&cursor=' + encodeURIComponent(cursor),
            200,
            {
              account: operator,
              baseOrigin: `http://127.0.0.1:${address.port}`,
            },
          );
          assert.deepEqual(
            [...first.body.data, ...second.body.data].map((row) => row.id),
            ids.sort(),
          );
          assert.equal(second.body.meta.pagination.hasMore, false);
          assert.equal(second.body.meta.pagination.nextCursor, null);
        } finally {
          await secondApp.close();
        }
        for (const path of [
          filter.replace('pageSize=2', 'pageSize=3'),
          filter.replace('role=EDITOR', 'role=AUTHOR'),
        ])
          assert.equal(
            (
              await req(
                'listMembers',
                path + '&cursor=' + encodeURIComponent(cursor),
                400,
                { account: operator },
              )
            ).body.error.code,
            'INVALID_CURSOR',
          );
        const other = await f.member('ADMIN');
        await req(
          'listMembers',
          filter + '&cursor=' + encodeURIComponent(cursor),
          400,
          { account: other },
        );
        const tampered =
          cursor.slice(0, -1) + (cursor.endsWith('0') ? '1' : '0');
        await req(
          'listMembers',
          filter + '&cursor=' + encodeURIComponent(tampered),
          400,
          { account: operator },
        );
        for (const query of [
          'role=SUPERADMIN',
          'active=1',
          'pageSize=51',
          'active=true&active=false',
          'unknown=x',
        ])
          await req('listMembers', '/v1/admin/members?' + query, 422, {
            account: operator,
          });
        await req('getMember', '/v1/admin/members/not-a-uuid', 422, {
          account: operator,
        });
        await req('getMember', `/v1/admin/members/${randomUUID()}`, 404, {
          account: operator,
        });
      },
    );
    await t.test(
      'role/reactivation updates are versioned, auditable, no-op safe and replay original results',
      async () => {
        const target = await f.member('AUTHOR');
        const key = randomUUID();
        const changed = await update(
          operator,
          target.row.id,
          { role: 'EDITOR' },
          1,
          key,
        );
        assert.equal(changed.body.data.version, 2);
        await update(operator, target.row.id, { active: false }, 2);
        await req('getMe', '/v1/me', 403, { account: target });
        const enabled = await update(
          operator,
          target.row.id,
          { role: 'ADMIN', active: true },
          3,
        );
        assert.equal(enabled.body.data.version, 4);
        await req('listMembers', '/v1/admin/members', 200, { account: target });
        const replay = await update(
          operator,
          target.row.id,
          { role: 'EDITOR' },
          1,
          key,
        );
        assert.deepEqual(replay.body.data, changed.body.data);
        assert.equal(replay.body.meta.idempotency?.replayed, true);
        assert.notEqual(replay.body.traceId, changed.body.traceId);
        await update(operator, target.row.id, { active: true }, 4);
        assert.equal(
          (await db.member.findUniqueOrThrow({ where: { id: target.row.id } }))
            .version,
          4,
        );
        assert.equal(
          await db.auditEvent.count({
            where: { subjectId: target.row.id, action: 'MEMBER_UPDATED' },
          }),
          3,
        );
        await update(operator, target.row.id, { role: 'AUTHOR' }, 1, key, 409);
        await update(
          operator,
          target.row.id,
          { role: 'AUTHOR' },
          1,
          randomUUID(),
          412,
        );
        for (const input of [
          { role: ['ADMIN'] },
          { role: null },
          { active: 'true' },
          { email: target.email },
          {},
          { displayName: 'Changed' },
        ])
          await update(operator, target.row.id, input, 4, randomUUID(), 422);
        const audit = await req<DTO['AuditEvent'][]>(
          'listAuditEvents',
          `/v1/admin/audit-events?subjectId=${target.row.id}&subjectType=MEMBER&action=MEMBER_UPDATED`,
          200,
          { account: operator },
        );
        assert.equal(audit.body.data.length, 3);
        assert.equal(
          JSON.stringify(audit.body.data).includes(target.email),
          false,
        );
        assert.ok(
          audit.body.data.some(
            (event) =>
              (event.changes as { role?: { to: string } }).role?.to ===
              'EDITOR',
          ),
        );
      },
    );
    await t.test(
      'demotion and disablement revoke access before completed administrative replay',
      async () => {
        const actor = await f.member('ADMIN');
        const target = await f.member('AUTHOR');
        const key = randomUUID();
        await update(actor, target.row.id, { role: 'EDITOR' }, 1, key);
        await update(operator, actor.row.id, { role: 'AUTHOR' }, 1);
        assert.equal(
          (await update(actor, target.row.id, { role: 'EDITOR' }, 1, key, 403))
            .body.error.code,
          'INSUFFICIENT_PERMISSION',
        );
        await update(operator, actor.row.id, { role: 'ADMIN' }, 2);
        await update(operator, actor.row.id, { active: false }, 3);
        assert.equal(
          (await update(actor, target.row.id, { role: 'EDITOR' }, 1, key, 403))
            .body.error.code,
          'ACCESS_REVOKED',
        );
      },
    );
    await t.test(
      'invitations store only token hashes and replay receipts without recovering the link',
      async () => {
        const issuer = await f.member('ADMIN');
        const invited = await f.google('invited');
        const outsider = await f.google('wrong-email');
        const key = randomUUID();
        const first = await issue(
          issuer,
          ' ' + invited.email.toUpperCase() + ' ',
          'EDITOR',
          key,
        );
        const data = first.body.data;
        const token = secret(data);
        assert.equal(data.invitation.email, invited.email);
        const row = await db.invitation.findUniqueOrThrow({
          where: { id: data.invitation.id },
        });
        assert.equal(
          row.tokenHash,
          createHash('sha256').update(token).digest('hex'),
        );
        assert.ok(
          Math.abs(
            Date.parse(data.invitation.expiresAt) -
              Date.parse(data.invitation.createdAt) -
              7 * 86_400_000,
          ) < 1000,
        );
        const replay = await issue(issuer, invited.email, 'EDITOR', key);
        assert.equal(replay.body.data.inviteUrl, null);
        assert.equal(replay.body.data.linkAvailable, false);
        assert.equal(replay.body.meta.idempotency?.replayed, true);
        assert.deepEqual(replay.body.data.invitation, data.invitation);
        assert.equal(
          replay.response.headers.get('location'),
          first.response.headers.get('location'),
        );
        const stored = JSON.stringify(
          await db.idempotencyRecord.findMany({
            where: { identityUid: issuer.uid },
          }),
        );
        assert.equal(stored.includes(token), false);
        assert.equal(stored.includes(data.inviteUrl!), false);
        assert.equal(
          (await accept(outsider, token, randomUUID(), 403)).body.error.code,
          'INVITATION_ACCOUNT_MISMATCH',
        );
        assert.equal(
          (await issue(issuer, invited.email, 'EDITOR', randomUUID(), 409)).body
            .error.code,
          'WORKFLOW_CONFLICT',
        );
        assert.equal(
          await db.invitation.count({ where: { email: invited.email } }),
          1,
        );
        const acceptanceKey = randomUUID();
        const accepted = await accept(invited, token, acceptanceKey);
        assert.equal(accepted.body.data.role, 'EDITOR');
        assert.equal(accepted.body.data.email, invited.email);
        assert.equal(
          (
            await db.member.findUniqueOrThrow({
              where: { id: accepted.body.data.id },
            })
          ).identityUid,
          invited.uid,
        );
        const profile = await req<DTO['Me']>('updateMe', '/v1/me', 200, {
          method: 'PATCH',
          account: invited,
          body: { displayName: 'Updated invited staff' },
          key: randomUUID(),
          version: 1,
        });
        const acceptedReplay = await accept(invited, token, acceptanceKey);
        assert.deepEqual(acceptedReplay.body.data, accepted.body.data);
        assert.equal(acceptedReplay.body.meta.idempotency?.replayed, true);
        assert.equal(
          (await accept(invited, token, randomUUID(), 410)).body.error.code,
          'INVITATION_USED',
        );
        await update(
          issuer,
          accepted.body.data.id,
          { active: false },
          profile.body.data.version,
        );
        assert.equal(
          (await accept(invited, token, acceptanceKey, 403)).body.error.code,
          'ACCESS_REVOKED',
        );
        assert.equal(
          await db.auditEvent.count({
            where: { subjectId: row.id, action: 'INVITATION_ACCEPTED' },
          }),
          1,
        );
        const listed = await req<DTO['Invitation']>(
          'getInvitation',
          `/v1/admin/invitations/${row.id}`,
          200,
          { account: issuer },
        );
        assert.equal(listed.body.data.status, 'ACCEPTED');
        assert.equal(listed.body.data.version, 2);
        assert.equal(
          JSON.stringify(await db.auditEvent.findMany()).includes(token),
          false,
        );
      },
    );
    await t.test(
      'reissue rotates the secret and revokes the old invitation, including original replay receipts',
      async () => {
        const issuer = await f.member('ADMIN');
        const invited = await f.google('rotation');
        const first = await issue(issuer, invited.email);
        const oldToken = secret(first.body.data);
        const oldId = first.body.data.invitation.id;
        const key = randomUUID();
        const replaced = await change(issuer, oldId, 'reissue', 1, key);
        const newToken = secret(replaced.body.data);
        assert.notEqual(newToken, oldToken);
        assert.notEqual(replaced.body.data.invitation.id, oldId);
        assert.equal(
          (await accept(invited, oldToken, randomUUID(), 410)).body.error.code,
          'INVITATION_REVOKED',
        );
        const replay = await change(issuer, oldId, 'reissue', 1, key);
        assert.equal(replay.body.data.inviteUrl, null);
        assert.equal(replay.body.data.linkAvailable, false);
        assert.equal(replay.body.meta.idempotency?.replayed, true);
        const revoked = await change(
          issuer,
          replaced.body.data.invitation.id,
          'revoke',
          1,
        );
        assert.equal(revoked.body.data.status, 'REVOKED');
        assert.equal(revoked.body.data.version, 2);
        assert.equal(
          (await accept(invited, newToken, randomUUID(), 410)).body.error.code,
          'INVITATION_REVOKED',
        );
        const third = await change(issuer, oldId, 'reissue', 2);
        await accept(invited, secret(third.body.data));
        await change(
          issuer,
          third.body.data.invitation.id,
          'reissue',
          2,
          randomUUID(),
          410,
        );
        const pending = await req<DTO['Invitation'][]>(
          'listInvitations',
          '/v1/admin/invitations?status=REVOKED&pageSize=1',
          200,
          { account: issuer },
        );
        assert.ok(
          pending.body.data.every(
            (invitation) => invitation.status === 'REVOKED',
          ),
        );
        assert.equal(pending.body.meta.pagination.hasMore, true);
      },
    );
    await t.test(
      'expiry is derived from database time and existing members cannot reactivate/escalate through invitations',
      async () => {
        const issuer = await f.member('ADMIN');
        const invited = await f.google('expiry');
        const first = await issue(issuer, invited.email);
        const token = secret(first.body.data);
        await db.invitation.update({
          where: { id: first.body.data.invitation.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        assert.equal(
          (await accept(invited, token, randomUUID(), 410)).body.error.code,
          'INVITATION_EXPIRED',
        );
        const list = await req<DTO['Invitation'][]>(
          'listInvitations',
          '/v1/admin/invitations?status=EXPIRED',
          200,
          { account: issuer },
        );
        assert.ok(
          list.body.data.some(
            (row) => row.id === first.body.data.invitation.id,
          ),
        );
        const renewed = await change(
          issuer,
          first.body.data.invitation.id,
          'reissue',
          1,
        );
        await accept(invited, secret(renewed.body.data));
        await issue(issuer, invited.email, 'ADMIN', randomUUID(), 409);
        const existing = await f.member('AUTHOR');
        await db.member.update({
          where: { id: existing.row.id },
          data: { email: `old-${randomUUID()}@example.test` },
        });
        const outdated = await issue(issuer, existing.email, 'ADMIN');
        assert.equal(
          (
            await accept(
              existing,
              secret(outdated.body.data),
              randomUUID(),
              409,
            )
          ).body.error.code,
          'MEMBER_ALREADY_EXISTS',
        );
        assert.equal(
          (
            await db.member.findUniqueOrThrow({
              where: { id: existing.row.id },
            })
          ).role,
          'AUTHOR',
        );
      },
    );
    await t.test(
      'two concurrent token acceptances create one membership and one acceptance audit',
      async () => {
        const issuer = await f.member('ADMIN');
        const invited = await f.google('acceptance-race');
        const first = await issue(issuer, invited.email, 'ADMIN');
        const token = secret(first.body.data);
        const outcomes = await Promise.all([
          accept(invited, token, randomUUID(), [200, 410]),
          accept(invited, token, randomUUID(), [200, 410]),
        ]);
        assert.deepEqual(
          outcomes.map((result) => result.response.status).sort(),
          [200, 410],
        );
        assert.equal(
          await db.member.count({ where: { identityUid: invited.uid } }),
          1,
        );
        assert.equal(
          await db.auditEvent.count({
            where: {
              subjectId: first.body.data.invitation.id,
              action: 'INVITATION_ACCEPTED',
            },
          }),
          1,
        );
        assert.equal(
          (
            await db.member.findUniqueOrThrow({
              where: { identityUid: invited.uid },
            })
          ).role,
          'ADMIN',
        );
      },
    );
    await t.test(
      'a lost secret response recovers only its receipt and requires explicit reissue',
      async () => {
        const issuer = await f.member('ADMIN');
        const invited = await f.google('secret-response-loss');
        const key = randomUUID();
        let observed!: DTO['InvitationIssueResult'];
        let done!: () => void;
        let fail!: (error: unknown) => void;
        const committed = new Promise<void>((resolve, reject) => {
          done = resolve;
          fail = reject;
        });
        const proxy = createServer((incoming, outgoing) => {
          incoming.resume();
          void (async () => {
            const response = await fetch(f.origin + '/v1/admin/invitations', {
              method: 'POST',
              headers: {
                ...metadata,
                Authorization: `Bearer ${issuer.token}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': key,
              },
              body: JSON.stringify({ email: invited.email, role: 'AUTHOR' }),
              signal: AbortSignal.timeout(10_000),
            });
            const bytes = Buffer.from(await response.arrayBuffer());
            assert.equal(response.status, 201);
            assertConforms('createInvitation', {
              method: 'POST',
              path: '/v1/admin/invitations',
              status: response.status,
              headers: Object.fromEntries(response.headers),
              body: bytes,
            });
            observed = JSON.parse(bytes.toString()).data;
            done();
          })()
            .catch(fail)
            .finally(() => outgoing.destroy());
        });
        await new Promise<void>((resolve) =>
          proxy.listen(0, '127.0.0.1', resolve),
        );
        try {
          const address = proxy.address();
          assert.ok(address && typeof address !== 'string');
          await assert.rejects(
            fetch(`http://127.0.0.1:${address.port}/lost`, {
              method: 'POST',
              body: '{}',
              signal: AbortSignal.timeout(10_000),
            }),
          );
          await committed;
          const replay = await issue(issuer, invited.email, 'AUTHOR', key);
          assert.equal(replay.body.data.inviteUrl, null);
          assert.equal(replay.body.data.linkAvailable, false);
          assert.equal(
            await db.invitation.count({ where: { email: invited.email } }),
            1,
          );
          const oldToken = secret(observed);
          const renewed = await change(
            issuer,
            observed.invitation.id,
            'reissue',
            1,
          );
          assert.notEqual(secret(renewed.body.data), oldToken);
          await accept(invited, oldToken, randomUUID(), 410);
          await accept(invited, secret(renewed.body.data));
        } finally {
          await new Promise<void>((resolve) => proxy.close(() => resolve()));
        }
      },
    );
    await t.test(
      'invitation quotas are SQL-backed and matching completed receipts bypass exhausted quotas',
      async () => {
        const issuer = await f.member('ADMIN');
        const email = `limit-${randomUUID()}@example.test`;
        const key = randomUUID();
        await issue(issuer, email, 'AUTHOR', key);
        for (let i = 1; i < 5; i++)
          await issue(issuer, `limit-${randomUUID()}@example.test`);
        const limited = await issue(
          issuer,
          `limit-${randomUUID()}@example.test`,
          'AUTHOR',
          randomUUID(),
          429,
        );
        assert.equal(limited.body.error.code, 'RATE_LIMITED');
        assert.ok(Number(limited.response.headers.get('retry-after')) >= 1);
        const replay = await issue(issuer, email, 'AUTHOR', key);
        assert.equal(replay.body.meta.idempotency?.replayed, true);
        assert.equal(replay.body.data.inviteUrl, null);
        await issue(issuer, email, 'EDITOR', key, 409);
        for (const input of [
          { email, role: ['ADMIN'] },
          { email, role: 'ROOT' },
          { email, role: 'ADMIN', token: 'forged' },
          {},
        ])
          await req('createInvitation', '/v1/admin/invitations', 422, {
            method: 'POST',
            account: issuer,
            body: input,
            key: randomUUID(),
          });
        await req(
          'listInvitations',
          '/v1/admin/invitations?status=UNKNOWN',
          422,
          { account: issuer },
        );
        await req(
          'listAuditEvents',
          '/v1/admin/audit-events?subjectId=invalid',
          422,
          { account: issuer },
        );
      },
    );
    await t.test(
      'last-active-admin demotion and disablement races preserve an administrator transactionally',
      async () => {
        const previous = await db.member.findMany({
          where: { role: 'ADMIN', active: true },
          select: { id: true },
        });
        await db.member.updateMany({
          where: { id: { in: previous.map((row) => row.id) } },
          data: { active: false },
        });
        const left = await f.member('ADMIN');
        const right = await f.member('ADMIN');
        try {
          const results = await Promise.all([
            update(
              left,
              left.row.id,
              { role: 'AUTHOR' },
              1,
              randomUUID(),
              [200, 409],
            ),
            update(
              right,
              right.row.id,
              { role: 'AUTHOR' },
              1,
              randomUUID(),
              [200, 409],
            ),
          ]);
          assert.deepEqual(
            results.map((result) => result.response.status).sort(),
            [200, 409],
          );
          assert.equal(
            results.find((result) => result.response.status === 409)!.body.error
              .code,
            'LAST_ADMIN_REQUIRED',
          );
          assert.equal(
            await db.member.count({ where: { role: 'ADMIN', active: true } }),
            1,
          );
          await db.member.updateMany({
            where: { id: { in: [left.row.id, right.row.id] } },
            data: { role: 'ADMIN' },
          });
          const rows = await db.member.findMany({
            where: { id: { in: [left.row.id, right.row.id] } },
          });
          const disabled = await Promise.all(
            [left, right].map((account) =>
              update(
                account,
                account.row.id,
                { active: false },
                rows.find((row) => row.id === account.row.id)!.version,
                randomUUID(),
                [200, 409],
              ),
            ),
          );
          assert.deepEqual(
            disabled.map((result) => result.response.status).sort(),
            [200, 409],
          );
          assert.equal(
            disabled.find((result) => result.response.status === 409)!.body
              .error.code,
            'LAST_ADMIN_REQUIRED',
          );
          assert.equal(
            await db.member.count({ where: { role: 'ADMIN', active: true } }),
            1,
          );
        } finally {
          await db.member.updateMany({
            where: { id: { in: previous.map((row) => row.id) } },
            data: { active: true },
          });
        }
      },
    );
    await t.test(
      'permission changes while a request waits on the administrative lock prevent its commit',
      async () => {
        for (const field of ['role', 'active'] as const) {
          const actor = await f.member('ADMIN');
          const target = await f.member('AUTHOR');
          const key = randomUUID();
          let acquired!: () => void;
          let release!: () => void;
          const ready = new Promise<void>((resolve) => {
            acquired = resolve;
          });
          const finish = new Promise<void>((resolve) => {
            release = resolve;
          });
          const holder = db.$transaction(
            async (tx) => {
              await lockAdministrativeState(tx);
              acquired();
              await finish;
              await tx.member.update({
                where: { id: actor.row.id },
                data: {
                  ...(field === 'role'
                    ? { role: 'AUTHOR' }
                    : { active: false }),
                  version: { increment: 1 },
                },
              });
            },
            { timeout: 10_000 },
          );
          await ready;
          const waiting = update(
            actor,
            target.row.id,
            { role: 'EDITOR' },
            1,
            key,
            403,
          );
          try {
            let blocked = false;
            for (let attempt = 0; attempt < 40; attempt++) {
              const rows = await db.$queryRaw<
                { blocked: boolean }[]
              >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE usename = current_user AND state = 'active' AND wait_event_type = 'Lock'
              AND query LIKE '%pg_advisory_xact_lock%' AND pid <> pg_backend_pid()) AS blocked`;
              if (rows[0]?.blocked) {
                blocked = true;
                break;
              }
              await delay(25);
            }
            assert.equal(
              blocked,
              true,
              'Request must reach the real SQL lock before permissions change',
            );
          } finally {
            release();
            await holder;
          }
          const denied = await waiting;
          assert.equal(
            denied.body.error.code,
            field === 'role' ? 'INSUFFICIENT_PERMISSION' : 'ACCESS_REVOKED',
          );
          assert.equal(
            (
              await db.member.findUniqueOrThrow({
                where: { id: target.row.id },
              })
            ).role,
            'AUTHOR',
          );
          assert.equal(
            await db.idempotencyRecord.count({
              where: { identityUid: actor.uid, key },
            }),
            0,
          );
        }
      },
    );
    await t.test(
      'failed replacement rolls back the old invitation revocation and writes no operation result',
      async () => {
        const issuer = await f.member('ADMIN');
        const invited = await f.google('reissue-rollback');
        const first = await issue(issuer, invited.email);
        const id = first.body.data.invitation.id;
        await db.member.create({
          data: {
            identityUid: invited.uid,
            email: invited.email,
            role: 'AUTHOR',
            displayName: 'Existing staff',
            handle: `fixture-${randomUUID()}`,
          },
        });
        const key = randomUUID();
        assert.equal(
          (await change(issuer, id, 'reissue', 1, key, 409)).body.error.code,
          'MEMBER_ALREADY_EXISTS',
        );
        const original = await db.invitation.findUniqueOrThrow({
          where: { id },
        });
        assert.equal(original.revokedAt, null);
        assert.equal(original.version, 1);
        assert.equal(
          await db.invitation.count({ where: { email: invited.email } }),
          1,
        );
        assert.equal(
          await db.idempotencyRecord.count({
            where: { identityUid: issuer.uid, key },
          }),
          0,
        );
      },
    );
    await t.test(
      'a bounded SQL lock timeout returns a safe retryable error and permits the identical retry',
      async () => {
        const actor = await f.member('ADMIN');
        const target = await f.member('AUTHOR');
        const key = randomUUID();
        let acquired!: () => void;
        let release!: () => void;
        const ready = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const finish = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holder = db.$transaction(
          async (tx) => {
            await lockAdministrativeState(tx);
            acquired();
            await finish;
          },
          { timeout: 12_000 },
        );
        await ready;
        try {
          const unavailable = await update(
            actor,
            target.row.id,
            { role: 'EDITOR' },
            1,
            key,
            503,
          );
          assert.equal(unavailable.body.error.code, 'DEPENDENCY_UNAVAILABLE');
          assert.equal(unavailable.response.headers.get('retry-after'), '1');
          assert.equal(
            await db.idempotencyRecord.count({
              where: { identityUid: actor.uid, key },
            }),
            0,
          );
        } finally {
          release();
          await holder;
        }
        const retry = await update(
          actor,
          target.row.id,
          { role: 'EDITOR' },
          1,
          key,
        );
        assert.equal(retry.body.data.version, 2);
        assert.equal(retry.body.meta.idempotency?.replayed, false);
      },
    );
    const required = [
      'listMembers',
      'getMember',
      'updateMember',
      'listInvitations',
      'getInvitation',
      'createInvitation',
      'revokeInvitation',
      'reissueInvitation',
      'listAuditEvents',
      'acceptInvitation',
    ];
    for (const operation of required)
      assert.equal(
        f.executed.has(operation),
        true,
        `No observed success for ${operation}`,
      );
    const runId = process.env.BLOGPOST_IDENTITY_RUN_ID!;
    assert.match(runId, /^[a-f0-9]{12}$/);
    await writeFile(
      `/app/.local/conformance/administration-${runId}.json`,
      JSON.stringify(
        {
          ...coverage('backend', f.executed),
          observedOperations: [...f.executed],
          runId,
          testProject: f.config.identityProject,
          observedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
  },
);
