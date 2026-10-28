import type { Transaction } from '../../modules/members/members.repository.js';
import { ApiError } from '../errors/api-error.js';

export async function transactionTime(tx: Transaction): Promise<Date> {
  const rows = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  return rows[0]!.now;
}
export async function consumeRate(
  tx: Transaction,
  memberId: string,
  action: 'WRITE' | 'IDENTITY' | 'UPLOAD',
  now: Date,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rate:${memberId}:${action}`}, 0))`;
  await tx.rateLimitBucket.deleteMany({
    where: { memberId, action, expiresAt: { lte: now } },
  });
  const used = await tx.rateLimitBucket.aggregate({
    where: { memberId, action, expiresAt: { gt: now } },
    _sum: { count: true },
    _min: { expiresAt: true },
  });
  if (
    (used._sum.count ?? 0) >=
    (action === 'WRITE' ? 30 : action === 'UPLOAD' ? 10 : 5)
  )
    throw new ApiError(
      429,
      'RATE_LIMITED',
      'Too many operations',
      'Wait before starting another operation.',
      [],
      null,
      Math.max(
        1,
        Math.ceil((used._min.expiresAt!.getTime() - now.getTime()) / 1000),
      ),
    );
  await tx.rateLimitBucket.upsert({
    where: {
      memberId_action_windowStart: { memberId, action, windowStart: now },
    },
    create: {
      memberId,
      action,
      windowStart: now,
      count: 1,
      expiresAt: new Date(now.getTime() + 60_000),
    },
    update: { count: { increment: 1 } },
  });
}
