import { canonical, digest } from '../../src/platform/config/build-model.ts';
import {
  databaseContext,
  verifyDatabaseExecution,
  sqlExpectations,
  cloudTime,
  object,
  text,
  hash,
  reject,
  verifySqlEvidence,
} from './database-proof.mjs';

// Serialized files and self-declared source labels cannot acquire this capability.
const liveProofs = new WeakMap();

async function requestJson(url, token, transport, body, limit = 1048576) {
  try {
    const response = await transport(url, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (
      response.status !== 200 ||
      response.redirected ||
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers.get('content-type') ?? '',
      )
    )
      reject('CLOUD_DATABASE_READ_FAILED');
    const reader = response.body?.getReader();
    if (!reader) reject('CLOUD_DATABASE_READ_FAILED');
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) reject('CLOUD_DATABASE_READ_FAILED');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    reject('CLOUD_DATABASE_READ_FAILED');
  }
}
export function databaseLogQuery(provenance, target, context, execution) {
  const plan = databaseContext(provenance, target, context);
  const lower = new Date(cloudTime(execution.startTime) - 300000).toISOString();
  const upper = new Date(
    cloudTime(execution.completionTime) + 300000,
  ).toISOString();
  return {
    resourceNames: ['projects/' + plan.build.configuration.projectId],
    pageSize: 2,
    orderBy: 'timestamp asc',
    filter: [
      'resource.type="cloud_run_job"',
      'resource.labels.project_id="' + plan.build.configuration.projectId + '"',
      'resource.labels.location="' + target.region + '"',
      'resource.labels.job_name="' + target.resourceId + '"',
      'logName="projects/' +
        plan.build.configuration.projectId +
        '/logs/run.googleapis.com%2Fstdout"',
      'labels."run.googleapis.com/execution_name"="' +
        context.executionName +
        '"',
      'labels."run.googleapis.com/task_index"="0"',
      'labels."run.googleapis.com/task_attempt"="0"',
      'jsonPayload.event="database_verification"',
      'timestamp>="' + lower + '"',
      'timestamp<="' + upper + '"',
    ].join(' AND '),
  };
}
export async function verifyLiveDatabaseExecution({
  provenance,
  target,
  context,
  expectedSql,
  accessToken,
  transport = fetch,
  now = Date.now,
}) {
  const plan = databaseContext(provenance, target, context);
  expectedSql = sqlExpectations(expectedSql);
  text(accessToken, /^[A-Za-z0-9._~+/=-]{1,4096}$/, 4096);
  const clock = typeof now === 'function' ? now : () => now;
  const project = await requestJson(
    'https://cloudresourcemanager.googleapis.com/v1/projects/' +
      plan.build.configuration.projectId,
    accessToken,
    transport,
  );
  if (
    project.projectId !== plan.build.configuration.projectId ||
    project.lifecycleState !== 'ACTIVE' ||
    typeof project.projectNumber !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(project.projectNumber)
  )
    reject('CLOUD_PROJECT_DISAGREES');
  const jobUrl = 'https://run.googleapis.com/v2/' + plan.jobName;
  const executionUrl = 'https://run.googleapis.com/v2/' + plan.executionName;
  const job = await requestJson(jobUrl, accessToken, transport);
  const execution = await requestJson(executionUrl, accessToken, transport);
  const tasks = await requestJson(
    executionUrl + '/tasks?pageSize=2',
    accessToken,
    transport,
  );
  const logs = await requestJson(
    'https://logging.googleapis.com/v2/entries:list',
    accessToken,
    transport,
    databaseLogQuery(provenance, target, context, execution),
    262144,
  );
  const first = verifyDatabaseExecution({
    provenance,
    target,
    context,
    expectedSql,
    project,
    job,
    execution,
    tasks,
    logPage: logs,
    now: clock(),
  });
  // A completed execution is immutable, but can be deleted. The job can also be
  // edited/replaced while records are read. Observe both again without a fallback.
  const finalJob = await requestJson(jobUrl, accessToken, transport);
  const finalExecution = await requestJson(
    executionUrl,
    accessToken,
    transport,
  );
  const finalTasks = await requestJson(
    executionUrl + '/tasks?pageSize=2',
    accessToken,
    transport,
  );
  const final = verifyDatabaseExecution({
    provenance,
    target,
    context,
    expectedSql,
    project,
    job: finalJob,
    execution: finalExecution,
    tasks: finalTasks,
    logPage: logs,
    now: clock(),
  });
  if (canonical(first) !== canonical(final))
    reject('CLOUD_DATABASE_EVIDENCE_CHANGED');
  const proof = {
    ...final,
    evidenceSource: 'live-api',
    observedAt: new Date(clock()).toISOString(),
  };
  liveProofs.set(proof, digest(proof));
  return proof;
}

export function combineDatabaseEvidence({
  history,
  runtime,
  expectedSql,
  now = Date.now(),
  requireLive = true,
}) {
  expectedSql = sqlExpectations(expectedSql);
  for (const proof of [history, runtime]) {
    object(proof, [
      'schemaVersion',
      'status',
      'scope',
      'evidenceSource',
      'environment',
      'purpose',
      'kind',
      'builtFromSha',
      'applicationVersion',
      'contractVersion',
      'contractSha256',
      'runtimeInputDigest',
      'sourceInputDigest',
      'configurationDigest',
      'image',
      'deploymentBindingDigest',
      'workflow',
      'recordSha256',
      'verifiedAt',
      'evidence',
      'observation',
      'limitations',
      ...(proof?.evidenceSource === 'live-api' ? ['observedAt'] : []),
    ]);
    if (
      proof.schemaVersion !== 1 ||
      proof.status !== 'VERIFIED' ||
      proof.scope !== 'database-execution' ||
      !['live-api', 'provided-json'].includes(proof.evidenceSource) ||
      (requireLive &&
        (liveProofs.get(proof) !== digest(proof) ||
          proof.evidenceSource !== 'live-api'))
    )
      reject('AUTHENTICATED_DATABASE_EVIDENCE_REQUIRED');
    const at = cloudTime(proof.verifiedAt);
    if (at > now + 300000 || at < now - 86400000)
      reject('DATABASE_EVIDENCE_EXPIRED');
    hash(proof.recordSha256);
    for (const key of [
      'runtimeInputDigest',
      'sourceInputDigest',
      'configurationDigest',
      'contractSha256',
      'deploymentBindingDigest',
    ])
      hash(proof[key]);
    text(proof.builtFromSha, /^[a-f0-9]{40}$/, 40);
    for (const key of ['applicationVersion', 'contractVersion'])
      text(
        proof[key],
        /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/,
        64,
      );
    if (!['staging', 'production'].includes(proof.environment))
      reject('CLOUD_DATABASE_TARGET_REQUIRED');
    text(
      proof.image,
      /^asia-southeast2-docker\.pkg\.dev\/[a-z][a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+@sha256:[a-f0-9]{64}$/,
      512,
    );
    object(proof.workflow, ['repositoryId', 'runId', 'runAttempt', 'workflow']);
    for (const key of ['repositoryId', 'runId'])
      text(proof.workflow[key], /^[1-9][0-9]{0,19}$/, 20);
    if (
      !Number.isSafeInteger(proof.workflow.runAttempt) ||
      proof.workflow.runAttempt < 1 ||
      proof.workflow.workflow !==
        (proof.environment === 'staging' ? 'staging' : 'release')
    )
      reject('WRONG_DATABASE_WORKFLOW');
    const observation = object(proof.observation, [
      'job',
      'execution',
      'task',
      'log',
    ]);
    for (const [key, names] of Object.entries({
      job: ['resourceName', 'uid', 'generation', 'etag'],
      execution: [
        'name',
        'uid',
        'generation',
        'etag',
        'startTime',
        'completionTime',
      ],
      task: [
        'name',
        'uid',
        'generation',
        'etag',
        'startTime',
        'completionTime',
      ],
    })) {
      const resource = object(observation[key], names);
      text(
        resource.uid,
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
        36,
      );
      text(resource.generation, /^[1-9][0-9]{0,19}$/, 20);
      text(resource.etag, /^[\x21-\x7e]{1,256}$/, 256);
    }
    const prefix =
      'projects/' +
      proof.image.split('/')[1] +
      '/locations/asia-southeast2/jobs/';
    text(
      observation.job.resourceName,
      /^projects\/[a-z][a-z0-9-]+\/locations\/asia-southeast2\/jobs\/[a-z][a-z0-9-]+$/,
      256,
    );
    if (
      !observation.job.resourceName.startsWith(prefix) ||
      !observation.execution.name.startsWith(
        observation.job.resourceName + '/executions/',
      ) ||
      !observation.task.name.startsWith(observation.execution.name + '/tasks/')
    )
      reject('WRONG_DATABASE_RESOURCE');
    text(
      observation.execution.name,
      /^projects\/[a-z0-9-]+\/locations\/asia-southeast2\/jobs\/[a-z0-9-]+\/executions\/[a-z0-9-]+$/,
      512,
    );
    text(
      observation.task.name,
      /^projects\/[a-z0-9-]+\/locations\/asia-southeast2\/jobs\/[a-z0-9-]+\/executions\/[a-z0-9-]+\/tasks\/[a-z0-9-]+$/,
      512,
    );
    object(observation.log, ['insertId', 'timestamp']);
    text(observation.log.insertId, /^[\x21-\x7e]{1,256}$/, 256);
    const started = cloudTime(observation.execution.startTime),
      completed = cloudTime(observation.execution.completionTime);
    const taskStarted = cloudTime(observation.task.startTime),
      taskCompleted = cloudTime(observation.task.completionTime);
    const logged = cloudTime(observation.log.timestamp);
    if (
      started > completed + 300000 ||
      taskStarted < started - 300000 ||
      taskCompleted > completed + 300000 ||
      taskStarted > taskCompleted + 300000 ||
      at < taskStarted - 300000 ||
      at > taskCompleted + 300000 ||
      Math.abs(logged - at) > 300000
    )
      reject('DATABASE_RECORD_TIME_DISAGREES');
    verifySqlEvidence(proof.kind, proof.evidence, expectedSql);
    const record = {
      schemaVersion: 1,
      event: 'database_verification',
      application: 'backend',
      environment: proof.environment,
      kind: proof.kind,
      builtFromSha: proof.builtFromSha,
      runtimeInputDigest: proof.runtimeInputDigest,
      sourceInputDigest: proof.sourceInputDigest,
      configurationDigest: proof.configurationDigest,
      applicationVersion: proof.applicationVersion,
      contractVersion: proof.contractVersion,
      contractSha256: proof.contractSha256,
      execution: observation.execution.name,
      verifiedAt: proof.verifiedAt,
      result: 'PASSED',
      evidence: proof.evidence,
    };
    if (digest(record) !== proof.recordSha256)
      reject('DATABASE_RECORD_DIGEST_DISAGREES');
    if (proof.evidenceSource === 'live-api') {
      const observed = cloudTime(proof.observedAt);
      if (observed > now + 300000 || observed < now - 60000)
        reject('DATABASE_LIVE_OBSERVATION_EXPIRED');
    }
  }
  if (
    history.kind !== 'HISTORY' ||
    history.purpose !== 'inspect' ||
    runtime.kind !== 'RUNTIME' ||
    runtime.purpose !== 'verify'
  )
    reject('DATABASE_RECORD_PAIR_REQUIRED');
  for (const key of [
    'environment',
    'builtFromSha',
    'runtimeInputDigest',
    'sourceInputDigest',
    'configurationDigest',
    'applicationVersion',
    'contractVersion',
    'contractSha256',
    'image',
    'workflow',
  ])
    if (canonical(history[key]) !== canonical(runtime[key]))
      reject('DATABASE_EVIDENCE_PAIR_DISAGREES');
  if (
    history.observation.execution.name === runtime.observation.execution.name ||
    cloudTime(runtime.verifiedAt) < cloudTime(history.verifiedAt) ||
    history.evidence.pending.length ||
    history.evidence.migrationDigest !== expectedSql.migrationDigest ||
    runtime.evidence.migrationDigest !== expectedSql.migrationDigest ||
    runtime.evidence.schemaDigest !== expectedSql.schemaDigest ||
    runtime.evidence.permissionDigest !== expectedSql.permissionDigest
  )
    reject('DATABASE_STATE_NOT_READY');
  hash(history.evidence.historyDigest);
  const evidence = { schemaVersion: 1, history, runtime };
  return {
    schemaVersion: 1,
    status: 'VERIFIED',
    scope: 'database-schema-permissions',
    evidenceSource: requireLive ? 'live-api' : 'provided-json',
    evidence,
    schemaVerification: {
      execution: runtime.observation.execution.name,
      historyExecution: history.observation.execution.name,
      verifiedAt: runtime.verifiedAt,
      migrationDigest: expectedSql.migrationDigest,
      historyDigest: history.evidence.historyDigest,
      schemaDigest: expectedSql.schemaDigest,
      permissionDigest: expectedSql.permissionDigest,
      evidenceSha256: digest(evidence),
    },
  };
}
