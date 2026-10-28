import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { VerifiedIdentity } from '../identity/identity.js';
import { principal } from '../identity/member.guard.js';
import type { MemberRow } from './member.js';
import {
  databaseFailure,
  MembersRepository,
  type Transaction,
} from './members.repository.js';
import { ApiError } from '../../platform/errors/api-error.js';
import {
  ADMIN_STATE_LOCK,
  finishOperation,
  lockOperation,
  replayOperation,
  semanticHash,
  type OperationResult,
} from '../../platform/database/operation.js';
import {
  consumeRate,
  transactionTime,
} from '../../platform/database/rate-limits.js';

export function editor(member: MemberRow): MemberRow {
  if (member.role === 'AUTHOR')
    throw new ApiError(
      403,
      'INSUFFICIENT_PERMISSION',
      'Editor access required',
      'This action requires an editor or administrator.',
    );
  return member;
}
@Injectable()
export class EditorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    editor(principal(context.switchToHttp().getRequest<Request>()).member);
    return true;
  }
}
@Injectable()
export class EditorOperations {
  constructor(@Inject(MembersRepository) readonly members: MembersRepository) {}
  async read<T>(
    identity: VerifiedIdentity,
    work: (tx: Transaction, actor: MemberRow) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.members.database.prisma.$transaction(
        async (tx) =>
          work(tx, editor(await this.members.lock(tx, identity.uid))),
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
  async write<T>(
    identity: VerifiedIdentity,
    input: {
      method: string;
      route: string;
      key: string;
      body: unknown;
      expectedVersion?: number;
    },
    work: (
      tx: Transaction,
      actor: MemberRow,
      now: Date,
    ) => Promise<{
      data: T;
      version: number;
      status: number;
      location?: string;
    }>,
  ): Promise<OperationResult<T>> {
    const scope = {
      identityUid: identity.uid,
      method: input.method,
      route: input.route,
      key: input.key,
    };
    const hash = semanticHash({
      body: input.body,
      ...(input.expectedVersion !== undefined
        ? { expectedVersion: input.expectedVersion }
        : {}),
    });
    try {
      return await this.members.database.prisma.$transaction(
        async (tx) => {
          await lockOperation(tx, scope);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${ADMIN_STATE_LOCK}::bigint)`;
          const actor = editor(await this.members.lock(tx, identity.uid));
          const now = await transactionTime(tx);
          const replay = await replayOperation<T>(tx, scope, hash, now);
          if (replay) return replay;
          await consumeRate(tx, actor.id, 'WRITE', now);
          return finishOperation(
            tx,
            scope,
            hash,
            now,
            await work(tx, actor, now),
          );
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
}
