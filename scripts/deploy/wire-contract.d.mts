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
interface ResponseRule {
  headers?: Record<string, { schema: Record<string, unknown> }>;
  content?: Record<string, { schema: Record<string, unknown> }>;
  $ref?: string;
}
interface WireOperation {
  operationId: string;
  responses: Record<string, ResponseRule>;
}
export class ConformanceError extends Error {
  readonly operationId: string;
  readonly rule: string;
  constructor(operationId: string, rule: string);
}
export interface WireVerifier {
  assertConforms(operationId: string, exchange: Exchange): any;
  assertHealth(exchange: Exchange): any;
  wireOperation(operationId: string): WireOperation;
  operationFor(method: string, path: string): PlannedOperation | undefined;
  readonly catalog: PlannedOperation[];
  readonly contractSha256: string;
}
export function createWireVerifier(
  bytes: Uint8Array,
  catalog: PlannedOperation[],
): WireVerifier;
export function assertConforms(operationId: string, exchange: Exchange): any;
export function wireOperation(operationId: string): WireOperation;
export function operationFor(
  method: string,
  path: string,
): PlannedOperation | undefined;
export const catalog: PlannedOperation[];
export const contractSha256: string;
