import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { digest } from '../../src/platform/config/build-model.ts';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
import { databaseContext } from '../../scripts/deploy/database-proof.mjs';
import { fixture } from './fixtures.mjs';

const baseline = JSON.parse(
  await readFile('config/database/schema-baseline.json', 'utf8'),
);
const migrations = [];
for (const id of await readdir('prisma/migrations'))
  if (/^\d+_/.test(id))
    migrations.push({
      id,
      sha256: sha256(
        await readFile('prisma/migrations/' + id + '/migration.sql'),
      ),
    });
migrations.sort((a, b) => a.id.localeCompare(b.id));
export const sql = {
  migrations,
  migrationDigest: digest(migrations),
  schemaDigest: baseline.schemaDigest,
  permissionDigest: baseline.permissionDigest,
};
export const now = Date.parse('2026-10-27T15:10:00.000Z');

export function databaseFixture(environment = 'staging', purpose = 'inspect') {
  const f = fixture(environment, purpose);
  const context = {
    executionName: f.target.resourceId + '-abc12',
    jobUid: f.resource.uid,
    executionUid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    executorServiceAccount:
      'blogpost-deployer@' +
      f.provenance.configuration.projectId +
      '.iam.gserviceaccount.com',
    notBefore: '2026-10-27T15:00:00.000Z',
    workflow: {
      repositoryId: '42',
      runId: '100',
      runAttempt: 1,
      workflow: environment === 'staging' ? 'staging' : 'release',
    },
  };
  const plan = databaseContext(f.provenance, f.target, context);
  f.resource.template.labels = plan.labels;
  const minute = { migrate: '02', inspect: '05', verify: '08' }[purpose];
  const start = '2026-10-27T15:' + minute + ':00.000Z';
  const completion = '2026-10-27T15:' + minute + ':59.000Z';
  const verifiedAt = '2026-10-27T15:' + minute + ':58.000Z';
  const providerJob = f.resource.name;
  const providerExecution =
    providerJob + '/executions/' + context.executionName;
  const execution = {
    name: providerExecution,
    uid: context.executionUid,
    generation: '1',
    observedGeneration: '1',
    etag: 'execution-etag',
    creator: context.executorServiceAccount,
    job: providerJob,
    labels: plan.labels,
    createTime: start.replace('.000Z', '.000000000Z'),
    startTime: start,
    completionTime: completion,
    updateTime: completion,
    parallelism: 1,
    taskCount: 1,
    succeededCount: 1,
    conditions: [{ type: 'Completed', state: 'CONDITION_SUCCEEDED' }],
    template: structuredClone(f.resource.template.template),
  };
  const task = {
    ...structuredClone(execution.template),
    name: providerExecution + '/tasks/0',
    uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    generation: '1',
    observedGeneration: '1',
    etag: 'task-etag',
    job: providerJob,
    execution: providerExecution,
    createTime: start.replace('.000Z', '.000000Z'),
    startTime: start,
    completionTime: completion,
    conditions: [{ type: 'Completed', state: 'CONDITION_SUCCEEDED' }],
    lastAttemptResult: { exitCode: 0, status: {} },
    index: 0,
  };
  const evidence =
    purpose === 'verify'
      ? {
          schemaVersion: 1,
          migrationDigest: sql.migrationDigest,
          schemaDigest: sql.schemaDigest,
          permissionDigest: sql.permissionDigest,
          deniedProbes: 4,
          connectionBudget: {
            maximum: 100,
            reserved: 3,
            database_limit: -1,
            database_connections: 3,
            total_connections: 8,
          },
        }
      : {
          migrationDigest: sql.migrationDigest,
          historyDigest: 'f'.repeat(64),
          applied: migrations.map((m) => m.id),
          pending: [],
          resolvedAttempts: 0,
          migrations,
          ...(purpose === 'migrate' ? { newlyApplied: [] } : {}),
        };
  const build = f.provenance;
  const record = {
    schemaVersion: 1,
    event: 'database_verification',
    application: 'backend',
    environment,
    kind: { inspect: 'HISTORY', migrate: 'MIGRATIONS', verify: 'RUNTIME' }[
      purpose
    ],
    builtFromSha: build.sourceSha,
    runtimeInputDigest: build.runtimeInputDigest,
    sourceInputDigest: build.sourceInputDigest,
    configurationDigest: digest(build.configuration),
    applicationVersion: build.applicationVersion,
    contractVersion: build.contractVersion,
    contractSha256: build.contractSha256,
    execution: plan.executionName,
    verifiedAt,
    result: 'PASSED',
    evidence,
  };
  const logPage = {
    entries: [
      {
        logName:
          'projects/' +
          build.configuration.projectId +
          '/logs/run.googleapis.com%2Fstdout',
        resource: {
          type: 'cloud_run_job',
          labels: {
            project_id: build.configuration.projectId,
            location: f.target.region,
            job_name: f.target.resourceId,
          },
        },
        labels: {
          'run.googleapis.com/execution_name': context.executionName,
          'run.googleapis.com/task_index': '0',
          'run.googleapis.com/task_attempt': '0',
        },
        insertId: 'fixed-provider-entry',
        timestamp: verifiedAt,
        receiveTimestamp: verifiedAt,
        severity: 'DEFAULT',
        jsonPayload: record,
      },
    ],
  };
  return {
    provenance: f.provenance,
    target: f.target,
    project: f.project,
    job: f.resource,
    context,
    execution,
    tasks: { tasks: [task] },
    logPage,
    expectedSql: sql,
    now,
  };
}
export function providerTransport(f, alter = () => {}) {
  const calls = [];
  const plan = databaseContext(f.provenance, f.target, f.context);
  const jobUrl = 'https://run.googleapis.com/v2/' + plan.jobName;
  const executionUrl = 'https://run.googleapis.com/v2/' + plan.executionName;
  const transport = async (url, options) => {
    calls.push({ url, options });
    const index = calls.length;
    let value;
    if (
      url ===
      'https://cloudresourcemanager.googleapis.com/v1/projects/' +
        f.provenance.configuration.projectId
    )
      value = f.project;
    else if (url === jobUrl) value = f.job;
    else if (url === executionUrl) value = f.execution;
    else if (url === executionUrl + '/tasks?pageSize=2') value = f.tasks;
    else if (url === 'https://logging.googleapis.com/v2/entries:list')
      value = f.logPage;
    else throw Error('Unexpected provider endpoint');
    const response = {
      value: structuredClone(value),
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    };
    alter(response, { url, options, index });
    return new Response(response.body ?? JSON.stringify(response.value), {
      status: response.status,
      headers: response.headers,
    });
  };
  return { transport, calls };
}
