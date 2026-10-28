import { Inject, Injectable } from '@nestjs/common';
import type { VerifiedIdentity } from '../identity/identity.js';
import {
  databaseFailure,
  MembersRepository,
  type Transaction,
} from './members.repository.js';
import type { MemberRow } from './member.js';
import { administrator } from './admin.guard.js';
import {
  lockAdministrativeState,
  lockOperation,
  replayOperation,
  finishOperation,
  semanticHash,
  type OperationResult,
  type OperationScope,
} from '../../platform/database/operation.js';
import {
  transactionTime,
  consumeRate,
} from '../../platform/database/rate-limits.js';
export interface AdminMutation<T> {
  data: T;
  version: number;
  status: number;
  location?: string;
  persistedData?: T;
}
@Injectable()
export class AdminOperations {
  constructor(@Inject(MembersRepository) readonly members: MembersRepository) {}
  async read<T>(
    identity: VerifiedIdentity,
    work: (tx: Transaction, actor: MemberRow, now: Date) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.members.database.prisma.$transaction(
        async (tx) => {
          const actor = administrator(
            await this.members.lock(tx, identity.uid),
          );
          return work(tx, actor, await transactionTime(tx));
        },
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
      identityLimit?: boolean;
    },
    work: (
      tx: Transaction,
      actor: MemberRow,
      now: Date,
    ) => Promise<AdminMutation<T>>,
  ): Promise<OperationResult<T>> {
    const scope: OperationScope = {
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
          // Acquire the same administrative lock as bootstrap before taking member-row locks.
          await lockAdministrativeState(tx);
          const actor = administrator(
            await this.members.lock(tx, identity.uid),
          );
          const now = await transactionTime(tx);
          const replay = await replayOperation<T>(tx, scope, hash, now);
          if (replay) return replay;
          await consumeRate(tx, actor.id, 'WRITE', now);
          if (input.identityLimit)
            await consumeRate(tx, actor.id, 'IDENTITY', now);
          const result = await work(tx, actor, now);
          return finishOperation(
            tx,
            scope,
            hash,
            now,
            result,
            result.persistedData ?? result.data,
          );
        },
        { maxWait: 3000, timeout: 5000 },
      );
    } catch (error) {
      return databaseFailure(error);
    }
  }
}
