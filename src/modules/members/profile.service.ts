import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { ApiError, type FieldIssue } from '../../platform/errors/api-error.js';
import {
  transactionTime,
  consumeRate,
} from '../../platform/database/rate-limits.js';
import { isUnicodeScalarText } from '../../platform/text/unicode.js';
import { MembersRepository, databaseFailure } from './members.repository.js';
import { toMe, type Me } from './member.js';
import type { VerifiedIdentity } from '../identity/identity.js';

export interface ProfilePatch {
  displayName?: string;
  bio?: string | null;
}
export function profilePatch(value: unknown): ProfilePatch {
  const issues: FieldIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid profile',
      'Provide a profile object.',
    );
  const data = value as Record<string, unknown>;
  let truncated = false;
  for (const key of Object.keys(data).sort())
    if (!['displayName', 'bio'].includes(key)) {
      if (issues.length === 50) {
        truncated = true;
        continue;
      }
      issues.push({
        location: 'body',
        field:
          key.length > 256
            ? ''
            : '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'),
        code: 'UNKNOWN_FIELD',
        params: {},
      });
    }
  if (!Object.keys(data).length)
    issues.push({ location: 'body', field: '', code: 'REQUIRED', params: {} });
  for (const [key, maximum] of [
    ['displayName', 80],
    ['bio', 500],
  ] as const) {
    if (!Object.hasOwn(data, key)) continue;
    const text = data[key];
    if (key === 'bio' && text === null) continue;
    if (
      typeof text !== 'string' ||
      !isUnicodeScalarText(text) ||
      text.includes('\0') ||
      [...text].length > maximum ||
      (key === 'displayName' && !text.trim())
    )
      issues.push({
        location: 'body',
        field: '/' + key,
        code: 'INVALID_VALUE',
        params: {},
      });
  }
  if (issues.length)
    throw new ApiError(
      422,
      'VALIDATION_FAILED',
      'Invalid profile',
      'Correct the profile fields.',
      issues
        .sort((left, right) =>
          left.field < right.field ? -1 : left.field > right.field ? 1 : 0,
        )
        .slice(0, 50),
      truncated || issues.length > 50 ? { truncated: true } : null,
    );
  return data as ProfilePatch;
}
function hash(value: unknown): string {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, part]) => [key, canonical(part)]),
      );
    return value;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export interface ProfileResult {
  data: Me;
  replayed: boolean;
  expiresAt: string;
}
@Injectable()
export class ProfileService {
  constructor(
    @Inject(MembersRepository) private readonly members: MembersRepository,
  ) {}
  async update(
    identity: VerifiedIdentity,
    input: ProfilePatch,
    expectedVersion: number,
    key: string,
    traceId: string,
  ): Promise<ProfileResult> {
    const route = '/v1/me';
    const requestHash = hash({ expectedVersion, body: input });
    try {
      return await this.members.database.prisma.$transaction(
        async (tx) => {
          // Fast rejection of a concurrent identical operation, before waiting on the member row.
          const locks = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(
          hashtextextended(${JSON.stringify([identity.uid, 'PATCH', route, key])}, 0)) AS locked`;
          if (!locks[0]!.locked)
            throw new ApiError(
              409,
              'IDEMPOTENCY_IN_PROGRESS',
              'Operation in progress',
              'Retry the same request after this operation completes.',
              [],
              null,
              1,
            );
          const actor = await this.members.lock(tx, identity.uid);
          const now = await transactionTime(tx);
          const scope = {
            identityUid: identity.uid,
            method: 'PATCH',
            route,
            key,
          };
          const unique = { identityUid_method_route_key: scope };
          let record = await tx.idempotencyRecord.findUnique({ where: unique });
          if (record && record.expiresAt <= now) {
            await tx.idempotencyRecord.delete({ where: unique });
            record = null;
          }
          if (record) {
            if (record.requestHash !== requestHash)
              throw new ApiError(
                409,
                'IDEMPOTENCY_KEY_REUSED',
                'Operation key reused',
                'Use a new key for changed input.',
              );
            if (record.result === null || record.statusCode !== 200)
              throw new ApiError(
                409,
                'IDEMPOTENCY_IN_PROGRESS',
                'Operation in progress',
                'Retry the identical request later.',
                [],
                null,
                1,
              );
            return {
              data: record.result as unknown as Me,
              replayed: true,
              expiresAt: record.expiresAt.toISOString(),
            };
          }
          if (actor.version !== expectedVersion)
            throw new ApiError(
              412,
              'VERSION_CONFLICT',
              'Profile changed',
              'Fetch the current profile before resolving this conflict.',
              [],
              {
                resourceType: 'MEMBER',
                resourceId: actor.id,
                expectedVersion,
                currentVersion: actor.version,
                changedFields: [],
              },
            );
          await consumeRate(tx, actor.id, 'WRITE', now);
          const changes: { displayName?: string; bio?: string } = {};
          if (
            input.displayName !== undefined &&
            input.displayName !== actor.displayName
          )
            changes.displayName = input.displayName;
          if (Object.hasOwn(input, 'bio') && (input.bio ?? '') !== actor.bio)
            changes.bio = input.bio ?? '';
          let data = toMe(actor);
          if (Object.keys(changes).length) {
            if (actor.version === 2147483647)
              throw new ApiError(
                409,
                'RESOURCE_QUOTA_EXCEEDED',
                'Version limit reached',
                'The profile cannot be changed.',
              );
            data = toMe(
              await tx.member.update({
                where: { id: actor.id },
                data: { ...changes, version: { increment: 1 } },
              }),
            );
            await tx.auditEvent.create({
              data: {
                actorId: actor.id,
                action: 'PROFILE_UPDATED',
                subjectType: 'MEMBER',
                subjectId: actor.id,
                traceId,
                changes: { fields: Object.keys(changes) },
              },
            });
          }
          const expiresAt = new Date(now.getTime() + 86_400_000);
          await tx.idempotencyRecord.create({
            data: {
              ...scope,
              requestHash,
              result: data as unknown as Prisma.InputJsonValue,
              statusCode: 200,
              expiresAt,
            },
          });
          return { data, replayed: false, expiresAt: expiresAt.toISOString() };
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
}
