import {
  assertConforms as verifyExchange,
  catalog,
  contractSha256,
} from '../../scripts/deploy/wire-contract.mjs';
import { backendScenarios } from './backend-scenarios.js';
export {
  wireOperation,
  operationFor,
  catalog,
  contractSha256,
  ConformanceError,
} from '../../scripts/deploy/wire-contract.mjs';
export interface PlannedOperation {
  method: string;
  path: string;
  operationId: string;
  access: string;
  expectedVersion: boolean;
  idempotent: boolean;
}
export interface Exchange {
  method: string;
  path: string;
  status: number;
  headers: Record<string, string | string[] | number | undefined>;
  body: string | Buffer;
}
export interface VerifiedObservation {
  operationId: string;
  status: number;
  errorCode: string | null;
  replayed: boolean;
  binary: boolean;
  count: number;
}
const observations = new Map<string, VerifiedObservation>();
/** Records only exchanges which passed the independent checker; never bodies or headers. */
export function assertConforms(operationId: string, exchange: Exchange) {
  const body = verifyExchange(operationId, exchange);
  const observation = {
    operationId,
    status: exchange.status,
    errorCode: (body.error?.code as string | undefined) ?? null,
    replayed: body.meta?.idempotency?.replayed === true,
    binary: body.binary === true,
  };
  const key = JSON.stringify(observation);
  const previous = observations.get(key);
  observations.set(key, { ...observation, count: (previous?.count ?? 0) + 1 });
  return body;
}
const operations = new Map(
  catalog.map((operation) => [operation.operationId, operation]),
);
/** Reports actual evidence only; an authored operation or fixture never counts as execution. */
export function coverage(
  target: 'mock' | 'backend',
  executed: ReadonlySet<string>,
) {
  const unknown = [...executed].filter((id) => !operations.has(id));
  if (unknown.length) throw new Error('Coverage contains an unknown operation');
  if ([...backendScenarios.keys()].some((id) => !operations.has(id)))
    throw new Error(
      'Backend scenario registration contains an unknown operation',
    );
  const pending = catalog
    .filter((operation) => !executed.has(operation.operationId))
    .map((operation) => operation.operationId);
  return {
    target,
    contractSha256,
    total: catalog.length,
    executed: executed.size,
    complete: pending.length === 0,
    pending,
    configuredBackendOperations: [...backendScenarios.keys()],
    verifiedObservations: [...observations.values()].sort(
      (a, b) =>
        a.operationId.localeCompare(b.operationId) ||
        a.status - b.status ||
        String(a.errorCode).localeCompare(String(b.errorCode)) ||
        Number(a.replayed) - Number(b.replayed),
    ),
  };
}
