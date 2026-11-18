import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountsService } from '../../src/modules/accounts/accounts.service.js';
import { readConfig } from '../../src/platform/config/config.js';
import { developmentEnv } from '../helpers.js';

type Row = { id: string; status: 'PENDING' | 'ACTIVE' | 'DISABLED' };
function service(rows: Map<string, Row>, raced = false) {
  const created: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const tx = {
    member: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (raced) {
          // Another request wins the unique identity constraint first.
          rows.set(String(data.identityUid), {
            id: 'winner',
            status: 'PENDING',
          });
          throw new Error('unique');
        }
        created.push(data);
        return { id: data.id as string, status: data.status as Row['status'] };
      },
    },
    auditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) =>
        void audits.push(data),
    },
  };
  const database = {
    prisma: {
      member: {
        findUnique: async ({ where }: { where: { identityUid: string } }) =>
          rows.get(where.identityUid) ?? null,
      },
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(tx),
    },
  };
  const accounts = new AccountsService(
    readConfig(developmentEnv),
    {} as never,
    database as never,
    { enabled: true } as never,
  );
  const memberFor = (user: object) =>
    (
      accounts as unknown as {
        memberFor: (u: object, t: string) => Promise<Row | null>;
      }
    ).memberFor(user, 'a'.repeat(32));
  return { memberFor, created, audits };
}
const user = {
  uid: 'uid-1',
  email: 'a@example.test',
  disabled: false,
  passwordProviders: [{ uid: 'a@example.test' }],
};

test('a password account left without a member row by a failed cleanup is recovered as pending', async () => {
  const { memberFor, created, audits } = service(new Map());
  const member = await memberFor(user);
  assert.equal(member?.status, 'PENDING');
  assert.equal(created.length, 1);
  assert.deepEqual(
    {
      active: created[0]!.active,
      status: created[0]!.status,
      role: created[0]!.role,
      uid: created[0]!.identityUid,
    },
    { active: false, status: 'PENDING', role: 'AUTHOR', uid: 'uid-1' },
  );
  assert.equal(audits[0]!.action, 'ACCOUNT_RECOVERED');
});
test('an existing member is returned untouched and nothing is created', async () => {
  const { memberFor, created } = service(
    new Map([['uid-1', { id: 'm1', status: 'ACTIVE' }]]),
  );
  assert.deepEqual(await memberFor(user), { id: 'm1', status: 'ACTIVE' });
  assert.equal(created.length, 0);
});
test('accounts that are not password registrations or are disabled are never turned into members', async () => {
  for (const other of [
    { ...user, passwordProviders: [] },
    { ...user, disabled: true },
    { ...user, email: undefined },
  ]) {
    const { memberFor, created } = service(new Map());
    assert.equal(await memberFor(other), null);
    assert.equal(created.length, 0);
  }
});
test('losing a creation race returns the winner instead of failing', async () => {
  const { memberFor } = service(new Map(), true);
  assert.deepEqual(await memberFor(user), { id: 'winner', status: 'PENDING' });
});
