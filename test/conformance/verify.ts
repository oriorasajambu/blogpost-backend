import {
  catalog,
  contractSha256,
} from '../../scripts/deploy/wire-contract.mjs';
import { backendScenarios } from './backend-scenarios.js';
export {
  assertConforms,
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
  };
}
