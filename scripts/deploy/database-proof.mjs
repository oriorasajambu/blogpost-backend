import { canonical, digest } from '../../src/platform/config/build-model.ts';
import {
  cloudRunExpectations,
  verifyCloudRunConfiguration,
  verifyCloudRunTaskTemplate,
} from './cloud-run-config.mjs';

export class DatabaseEvidenceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export const reject = (code) => {
  throw new DatabaseEvidenceError(code);
};
export function object(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (keys &&
      canonical(Object.keys(value).sort()) !== canonical([...keys].sort()))
  )
    reject('INVALID_DATABASE_EVIDENCE');
  return value;
}
export function text(value, pattern, max = 512) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    pattern.exec(value)?.[0] !== value
  )
    reject('INVALID_DATABASE_EVIDENCE');
  return value;
}
export const hash = (value) => text(value, /^[a-f0-9]{64}$/, 64);
const identifier = (value) =>
  text(value, /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 63);
const identifierNumber = (value) => text(value, /^[1-9][0-9]{0,19}$/, 20);
const same = (a, b, code) => {
  if (canonical(a) !== canonical(b)) reject(code);
};
export function cloudTime(value) {
  text(
    value,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(?:\d{3}|\d{6}|\d{9}))?Z$/,
    30,
  );
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    reject('INVALID_PROVIDER_TIME');
  return date.getTime();
}
export function sqlExpectations(value) {
  object(value, [
    'migrations',
    'migrationDigest',
    'schemaDigest',
    'permissionDigest',
  ]);
  hash(value.migrationDigest);
  hash(value.schemaDigest);
  hash(value.permissionDigest);
  if (
    !Array.isArray(value.migrations) ||
    value.migrations.length < 1 ||
    value.migrations.length > 256
  )
    reject('INVALID_EXPECTED_SQL');
  let previous = '';
  for (const item of value.migrations) {
    object(item, ['id', 'sha256']);
    text(item.id, /^\d{12,14}_[a-z0-9_]+$/, 128);
    hash(item.sha256);
    if (item.id <= previous) reject('INVALID_EXPECTED_SQL');
    previous = item.id;
  }
  if (digest(value.migrations) !== value.migrationDigest)
    reject('EXPECTED_MIGRATIONS_DISAGREE');
  return value;
}
export function databaseContext(provenance, target, context) {
  const { build } = cloudRunExpectations(provenance, target);
  if (
    build.kind !== 'ARTIFACT' ||
    build.environment === 'development' ||
    !['migrate', 'inspect', 'verify'].includes(target.purpose)
  )
    reject('CLOUD_DATABASE_TARGET_REQUIRED');
  object(context, [
    'executionName',
    'jobUid',
    'executionUid',
    'executorServiceAccount',
    'notBefore',
    'workflow',
  ]);
  identifier(context.executionName);
  for (const key of ['jobUid', 'executionUid'])
    text(
      context[key],
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      36,
    );
  text(
    context.executorServiceAccount,
    /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/,
    128,
  );
  if (
    !context.executorServiceAccount.endsWith(
      '@' + build.configuration.projectId + '.iam.gserviceaccount.com',
    ) ||
    Object.values(build.configuration.serviceAccounts).includes(
      context.executorServiceAccount,
    )
  )
    reject('WRONG_EXECUTION_CREATOR');
  cloudTime(context.notBefore);
  object(context.workflow, ['repositoryId', 'runId', 'runAttempt', 'workflow']);
  identifierNumber(context.workflow.repositoryId);
  identifierNumber(context.workflow.runId);
  if (
    !Number.isSafeInteger(context.workflow.runAttempt) ||
    context.workflow.runAttempt < 1 ||
    context.workflow.runAttempt > 1000000 ||
    context.workflow.workflow !==
      (build.environment === 'staging' ? 'staging' : 'release')
  )
    reject('WRONG_DATABASE_WORKFLOW');
  const jobName =
    'projects/' +
    build.configuration.projectId +
    '/locations/' +
    target.region +
    '/jobs/' +
    identifier(target.resourceId);
  return {
    build,
    jobName,
    executionName: jobName + '/executions/' + context.executionName,
    labels: {
      'blogpost-repository-id': context.workflow.repositoryId,
      'blogpost-workflow-run': context.workflow.runId,
      'blogpost-workflow-attempt': String(context.workflow.runAttempt),
      'blogpost-workflow': context.workflow.workflow,
      'blogpost-source-sha': build.sourceSha,
    },
  };
}
function canonicalName(name, project, profile) {
  text(
    name,
    /^projects\/[a-z0-9-]+\/locations\/asia-southeast2\/jobs\/[a-z0-9-]+(?:\/executions\/[a-z0-9-]+(?:\/tasks\/[a-z0-9-]+)?)?$/,
    512,
  );
  const parts = name.split('/');
  if (![profile.projectId, project.projectNumber].includes(parts[1]))
    reject('WRONG_DATABASE_RESOURCE');
  parts[1] = profile.projectId;
  return parts.join('/');
}
function settled(resource, now, notBefore) {
  object(resource);
  text(
    resource.uid,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    36,
  );
  identifierNumber(resource.generation);
  text(resource.etag, /^[\x21-\x7e]{1,256}$/, 256);
  if (
    resource.observedGeneration !== resource.generation ||
    ![undefined, false].includes(resource.reconciling) ||
    resource.deleteTime ||
    resource.expireTime
  )
    reject('DATABASE_EXECUTION_NOT_SETTLED');
  if (
    !Array.isArray(resource.conditions) ||
    !resource.conditions.length ||
    resource.conditions.length > 32
  )
    reject('DATABASE_EXECUTION_NOT_SETTLED');
  const types = new Set();
  for (const condition of resource.conditions) {
    text(condition.type, /^[A-Za-z][A-Za-z0-9]{0,63}$/, 64);
    if (types.has(condition.type) || condition.state !== 'CONDITION_SUCCEEDED')
      reject('DATABASE_EXECUTION_NOT_SUCCESSFUL');
    types.add(condition.type);
  }
  if (!types.has('Completed')) reject('DATABASE_EXECUTION_NOT_SUCCESSFUL');
  const created = cloudTime(resource.createTime),
    started = cloudTime(resource.startTime),
    completed = cloudTime(resource.completionTime);
  if (
    created > started + 300000 ||
    started > completed + 300000 ||
    started < notBefore - 300000 ||
    completed > now + 300000 ||
    completed < now - 86400000
  )
    reject('DATABASE_EXECUTION_TIME_DISAGREES');
  if (resource.updateTime && cloudTime(resource.updateTime) > now + 300000)
    reject('DATABASE_EXECUTION_TIME_DISAGREES');
  return { created, started, completed };
}
export function verifySqlEvidence(kind, evidence, expectedSql) {
  if (!['HISTORY', 'MIGRATIONS', 'RUNTIME'].includes(kind))
    reject('WRONG_DATABASE_RECORD');
  object(evidence);
  if (evidence.migrationDigest !== expectedSql.migrationDigest)
    reject('DATABASE_MIGRATION_MANIFEST_DISAGREES');
  if (kind === 'RUNTIME') {
    object(evidence, [
      'schemaVersion',
      'migrationDigest',
      'schemaDigest',
      'permissionDigest',
      'deniedProbes',
      'connectionBudget',
    ]);
    if (
      evidence.schemaVersion !== 1 ||
      evidence.schemaDigest !== expectedSql.schemaDigest ||
      evidence.permissionDigest !== expectedSql.permissionDigest ||
      evidence.deniedProbes !== 4
    )
      reject('DATABASE_RUNTIME_BASELINE_DISAGREES');
    const budget = object(evidence.connectionBudget, [
      'maximum',
      'reserved',
      'database_limit',
      'database_connections',
      'total_connections',
    ]);
    for (const value of Object.values(budget))
      if (!Number.isSafeInteger(value) || value < -1 || value > 10000000)
        reject('INVALID_DATABASE_CONNECTION_BUDGET');
    if (
      budget.maximum < 1 ||
      budget.reserved < 0 ||
      budget.reserved >= budget.maximum ||
      budget.database_limit === 0 ||
      budget.database_limit < -1 ||
      budget.database_connections < 1 ||
      budget.total_connections < budget.database_connections
    )
      reject('INVALID_DATABASE_CONNECTION_BUDGET');
  } else {
    object(evidence, [
      'migrationDigest',
      'historyDigest',
      'applied',
      'pending',
      'resolvedAttempts',
      'migrations',
      ...(kind === 'MIGRATIONS' ? ['newlyApplied'] : []),
    ]);
    hash(evidence.historyDigest);
    same(
      evidence.migrations,
      expectedSql.migrations,
      'DATABASE_MIGRATION_MANIFEST_DISAGREES',
    );
    if (
      !Array.isArray(evidence.applied) ||
      !Array.isArray(evidence.pending) ||
      !Number.isSafeInteger(evidence.resolvedAttempts) ||
      evidence.resolvedAttempts < 0 ||
      evidence.resolvedAttempts > 4096
    )
      reject('INVALID_DATABASE_HISTORY');
    const names = expectedSql.migrations.map((item) => item.id);
    same(
      evidence.applied,
      names.slice(0, evidence.applied.length),
      'DATABASE_HISTORY_IS_NOT_A_PREFIX',
    );
    same(
      evidence.pending,
      names.slice(evidence.applied.length),
      'DATABASE_HISTORY_IS_NOT_A_PREFIX',
    );
    if (kind === 'MIGRATIONS') {
      if (
        evidence.pending.length ||
        !Array.isArray(evidence.newlyApplied) ||
        evidence.newlyApplied.length > names.length
      )
        reject('INVALID_COMPLETED_MIGRATION');
      same(
        evidence.newlyApplied,
        names.slice(names.length - evidence.newlyApplied.length),
        'INVALID_COMPLETED_MIGRATION',
      );
    }
  }
  return evidence;
}
export function verifyDatabaseRecord({
  record,
  build,
  purpose,
  executionName,
  expectedSql,
  taskTimes,
  now,
}) {
  object(record, [
    'schemaVersion',
    'event',
    'application',
    'environment',
    'kind',
    'builtFromSha',
    'runtimeInputDigest',
    'sourceInputDigest',
    'configurationDigest',
    'applicationVersion',
    'contractVersion',
    'contractSha256',
    'execution',
    'verifiedAt',
    'result',
    'evidence',
  ]);
  if (Buffer.byteLength(canonical(record)) > 65536)
    reject('DATABASE_RECORD_LIMIT');
  const kind = { migrate: 'MIGRATIONS', inspect: 'HISTORY', verify: 'RUNTIME' }[
    purpose
  ];
  if (
    record.schemaVersion !== 1 ||
    record.event !== 'database_verification' ||
    record.application !== 'backend' ||
    record.kind !== kind ||
    record.result !== 'PASSED' ||
    record.environment !== build.environment ||
    record.execution !== executionName
  )
    reject('WRONG_DATABASE_RECORD');
  for (const [key, expected] of Object.entries({
    builtFromSha: build.sourceSha,
    runtimeInputDigest: build.runtimeInputDigest,
    sourceInputDigest: build.sourceInputDigest,
    configurationDigest: digest(build.configuration),
    applicationVersion: build.applicationVersion,
    contractVersion: build.contractVersion,
    contractSha256: build.contractSha256,
  }))
    if (record[key] !== expected)
      reject('DATABASE_RECORD_PROVENANCE_DISAGREES');
  const at = cloudTime(record.verifiedAt);
  if (
    at < taskTimes.started - 300000 ||
    at > taskTimes.completed + 300000 ||
    at > now + 300000 ||
    at < now - 86400000
  )
    reject('DATABASE_RECORD_TIME_DISAGREES');
  verifySqlEvidence(kind, record.evidence, expectedSql);
  return record;
}
export function verifyDatabaseExecution({
  provenance,
  target,
  context,
  expectedSql,
  project,
  job,
  execution,
  tasks,
  logPage,
  now = Date.now(),
}) {
  const plan = databaseContext(provenance, target, context),
    { build, jobName, executionName, labels } = plan;
  expectedSql = sqlExpectations(expectedSql);
  const binding = verifyCloudRunConfiguration({
    provenance,
    target,
    project,
    resource: job,
  });
  if (
    binding.observation.uid !== context.jobUid ||
    execution.uid !== context.executionUid
  )
    reject('DATABASE_RESOURCE_IDENTITY_DISAGREES');
  const profile = build.configuration;
  for (const key of Object.keys(labels))
    if (
      job.template?.labels?.[key] !== labels[key] ||
      execution.labels?.[key] !== labels[key]
    )
      reject('DATABASE_EXECUTION_WORKFLOW_DISAGREES');
  if (
    canonicalName(execution.name, project, profile) !== executionName ||
    canonicalName(execution.job, project, profile) !== jobName ||
    execution.creator !== context.executorServiceAccount
  )
    reject('WRONG_DATABASE_EXECUTION');
  const executionTimes = settled(execution, now, cloudTime(context.notBefore));
  if (
    execution.taskCount !== 1 ||
    execution.parallelism !== 1 ||
    execution.succeededCount !== 1 ||
    ['runningCount', 'failedCount', 'cancelledCount', 'retriedCount'].some(
      (key) => (execution[key] ?? 0) !== 0,
    )
  )
    reject('DATABASE_EXECUTION_TASKS_DISAGREE');
  const executionBinding = verifyCloudRunTaskTemplate({
    provenance,
    target,
    project,
    template: execution.template,
    taskCount: execution.taskCount,
    parallelism: execution.parallelism,
  });
  if (
    executionBinding.deploymentBindingDigest !== binding.deploymentBindingDigest
  )
    reject('DATABASE_EXECUTION_OVERRIDE');
  object(tasks);
  if (
    tasks.nextPageToken ||
    !Array.isArray(tasks.tasks) ||
    tasks.tasks.length !== 1
  )
    reject('DATABASE_TASK_LIST_INCOMPLETE');
  const task = tasks.tasks[0];
  const taskName = canonicalName(task.name, project, profile);
  if (
    !taskName.startsWith(executionName + '/tasks/') ||
    canonicalName(task.job, project, profile) !== jobName ||
    canonicalName(task.execution, project, profile) !== executionName ||
    (task.index ?? 0) !== 0 ||
    (task.retried ?? 0) !== 0
  )
    reject('WRONG_DATABASE_TASK');
  const taskTimes = settled(task, now, cloudTime(context.notBefore));
  if (
    taskTimes.started < executionTimes.started - 300000 ||
    taskTimes.completed > executionTimes.completed + 300000
  )
    reject('DATABASE_TASK_TIME_DISAGREES');
  const attempt = object(task.lastAttemptResult);
  if (
    attempt.exitCode !== 0 ||
    Object.hasOwn(attempt, 'termSignal') ||
    (attempt.status?.code ?? 0) !== 0
  )
    reject('DATABASE_TASK_FAILED');
  const taskBinding = verifyCloudRunTaskTemplate({
    provenance,
    target,
    project,
    template: { ...task, maxRetries: task.maxRetries ?? 0 },
  });
  if (taskBinding.deploymentBindingDigest !== binding.deploymentBindingDigest)
    reject('DATABASE_TASK_OVERRIDE');
  object(logPage);
  if (
    logPage.nextPageToken ||
    !Array.isArray(logPage.entries) ||
    logPage.entries.length !== 1
  )
    reject('DATABASE_LOG_MISSING_OR_AMBIGUOUS');
  const entry = logPage.entries[0];
  text(entry.insertId, /^[\x21-\x7e]{1,256}$/, 256);
  if (
    entry.logName !==
      'projects/' + profile.projectId + '/logs/run.googleapis.com%2Fstdout' ||
    entry.resource?.type !== 'cloud_run_job' ||
    entry.resource.labels?.project_id !== profile.projectId ||
    entry.resource.labels?.location !== target.region ||
    entry.resource.labels?.job_name !== target.resourceId ||
    entry.labels?.['run.googleapis.com/execution_name'] !==
      context.executionName ||
    entry.labels?.['run.googleapis.com/task_index'] !== '0' ||
    entry.labels?.['run.googleapis.com/task_attempt'] !== '0' ||
    ![undefined, 'DEFAULT', 'INFO'].includes(entry.severity) ||
    entry.textPayload ||
    entry.protoPayload ||
    entry.split
  )
    reject('WRONG_DATABASE_LOG');
  const timestamp = cloudTime(entry.timestamp),
    received = cloudTime(entry.receiveTimestamp);
  if (
    timestamp < taskTimes.started - 300000 ||
    timestamp > taskTimes.completed + 300000 ||
    received < timestamp - 300000 ||
    received > now + 300000
  )
    reject('DATABASE_LOG_TIME_DISAGREES');
  const record = verifyDatabaseRecord({
    record: entry.jsonPayload,
    build,
    purpose: target.purpose,
    executionName,
    expectedSql,
    taskTimes,
    now,
  });
  if (Math.abs(cloudTime(record.verifiedAt) - timestamp) > 300000)
    reject('DATABASE_LOG_TIME_DISAGREES');
  return {
    schemaVersion: 1,
    status: 'VERIFIED',
    scope: 'database-execution',
    evidenceSource: 'provided-json',
    environment: build.environment,
    purpose: target.purpose,
    kind: record.kind,
    builtFromSha: build.sourceSha,
    applicationVersion: build.applicationVersion,
    contractVersion: build.contractVersion,
    contractSha256: build.contractSha256,
    runtimeInputDigest: build.runtimeInputDigest,
    sourceInputDigest: build.sourceInputDigest,
    configurationDigest: digest(profile),
    image: target.image,
    deploymentBindingDigest: binding.deploymentBindingDigest,
    workflow: context.workflow,
    recordSha256: digest(record),
    verifiedAt: record.verifiedAt,
    evidence: record.evidence,
    observation: {
      job: { ...binding.observation, resourceName: jobName },
      execution: {
        name: executionName,
        uid: execution.uid,
        generation: execution.generation,
        etag: execution.etag,
        startTime: execution.startTime,
        completionTime: execution.completionTime,
      },
      task: {
        name: taskName,
        uid: task.uid,
        generation: task.generation,
        etag: task.etag,
        startTime: task.startTime,
        completionTime: task.completionTime,
      },
      log: { insertId: entry.insertId, timestamp: entry.timestamp },
    },
    limitations: [
      'Requires separately authenticated image/source provenance and provider IAM/resource/backup/rollout verification.',
    ],
  };
}
