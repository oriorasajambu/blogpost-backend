import type { AppConfig } from '../platform/config/config.js';
import { databaseError } from './database-model.js';

export function databaseExecution(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (config.environment === 'development') return null;
  const job = env.CLOUD_RUN_JOB;
  const name = env.CLOUD_RUN_EXECUTION;
  if (
    !job ||
    !name ||
    !/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(job) ||
    !/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ||
    /\s/.test(job + name) ||
    env.CLOUD_RUN_TASK_COUNT !== '1' ||
    env.CLOUD_RUN_TASK_INDEX !== '0' ||
    env.CLOUD_RUN_TASK_ATTEMPT !== '0'
  )
    databaseError('CLOUD_JOB_EXECUTION_IDENTITY_REQUIRED');
  return `projects/${config.build.configuration!.projectId}/locations/asia-southeast2/jobs/${job}/executions/${name}`;
}
export function databaseReceipt(
  config: AppConfig,
  kind: 'MIGRATIONS' | 'RUNTIME',
  result: Record<string, unknown>,
) {
  return {
    schemaVersion: 1,
    event: 'database_verification',
    application: 'backend',
    environment: config.environment,
    kind,
    builtFromSha: config.build.sourceSha,
    runtimeInputDigest: config.runtimeInputDigest,
    sourceInputDigest: config.build.sourceInputDigest,
    configurationDigest: config.configurationDigest,
    applicationVersion: config.build.applicationVersion,
    contractVersion: config.build.contractVersion,
    contractSha256: config.build.contractSha256,
    execution: databaseExecution(config),
    verifiedAt: new Date().toISOString(),
    result: 'PASSED',
    evidence: result,
  };
}
