import { setTimeout as sleep } from 'node:timers/promises';
import { digest } from '../../src/platform/config/build-model.ts';
import {
  cloudRunExpectations,
  verifyCloudRunConfiguration,
  verifyCloudRunRevisionTemplate,
} from './cloud-run-config.mjs';
import { refuse, RolloutError } from './rollout-client.mjs';

const REVISION = 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION';
const POLL = 5000;
const STARTUP = 300000;
const OBSERVE = 900000;
const INTERVAL = 30000;
const OUTPUT = new Set([
  'uid',
  'generation',
  'observedGeneration',
  'createTime',
  'updateTime',
  'deleteTime',
  'expireTime',
  'creator',
  'lastModifier',
  'urls',
  'uri',
  'terminalCondition',
  'conditions',
  'latestReadyRevision',
  'latestCreatedRevision',
  'trafficStatuses',
  'reconciling',
  'etag',
  'satisfiesPzs',
]);
const REVISION_FIELDS = [
  'labels',
  'annotations',
  'scaling',
  'vpcAccess',
  'timeout',
  'serviceAccount',
  'containers',
  'volumes',
  'executionEnvironment',
  'encryptionKey',
  'maxInstanceRequestConcurrency',
  'serviceMesh',
  'encryptionKeyRevocationAction',
  'encryptionKeyShutdownDuration',
  'sessionAffinity',
  'nodeSelector',
  'client',
  'clientVersion',
  'gpuZonalRedundancyDisabled',
];
const clone = structuredClone;
const same = (a, b) => digest(a) === digest(b);
const short = (name) =>
  typeof name === 'string' ? name.split('/').at(-1) : '';
function name(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(value))
    refuse('INVALID_REVISION');
  return value;
}
function traffic(value, status = false) {
  if (!Array.isArray(value) || !value.length || value.length > 40)
    refuse('EXPLICIT_TRAFFIC_REQUIRED');
  const keys = new Set();
  let total = 0;
  const map = value.map((item) => {
    if (
      !item ||
      item.type !== REVISION ||
      Object.keys(item).some(
        (key) =>
          ![
            'type',
            'revision',
            'percent',
            'tag',
            ...(status ? ['uri'] : []),
          ].includes(key),
      )
    )
      refuse('EXPLICIT_TRAFFIC_REQUIRED');
    const revision = name(short(item.revision));
    // TrafficTarget.revision must be a short name, not an arbitrary resource.
    if (revision !== item.revision) refuse('INVALID_REVISION');
    const percent = item.percent ?? 0;
    if (!Number.isInteger(percent) || percent < 0 || percent > 100)
      refuse('INVALID_TRAFFIC');
    total += percent;
    if (
      item.tag !== undefined &&
      (typeof item.tag !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(item.tag))
    )
      refuse('INVALID_TRAFFIC_TAG');
    const key = item.tag ?? '';
    // Untagged split traffic may name different revisions; tag names are unique.
    const identity = key ? 'tag:' + key : 'revision:' + revision;
    if (keys.has(identity) || (!percent && !item.tag))
      refuse('AMBIGUOUS_TRAFFIC');
    keys.add(identity);
    return {
      type: REVISION,
      revision,
      percent,
      ...(item.tag ? { tag: item.tag } : {}),
    };
  });
  if (total !== 100) refuse('INVALID_TRAFFIC');
  return map.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function settled(service) {
  if (
    !service ||
    service.deleteTime ||
    service.reconciling ||
    service.terminalCondition?.state !== 'CONDITION_SUCCEEDED' ||
    !/^[1-9][0-9]{0,18}$/.test(service.generation ?? '') ||
    service.generation !== service.observedGeneration ||
    typeof service.etag !== 'string' ||
    !/^[\x21-\x7e]{1,256}$/.test(service.etag)
  )
    refuse('SERVICE_NOT_SETTLED');
  if (
    !service.template?.revision ||
    short(service.latestReadyRevision) !== short(service.template.revision) ||
    short(service.latestCreatedRevision) !== short(service.template.revision)
  )
    refuse('SERVICE_NOT_SETTLED');
  if (!same(traffic(service.traffic), traffic(service.trafficStatuses, true)))
    refuse('TRAFFIC_NOT_SETTLED');
}
function invariant(service) {
  return digest(
    Object.fromEntries(
      Object.entries(service).filter(
        ([key]) => !OUTPUT.has(key) && !['traffic', 'template'].includes(key),
      ),
    ),
  );
}
function templateHash(template) {
  return digest(
    Object.fromEntries(
      Object.entries(template).filter(([key]) => key !== 'revision'),
    ),
  );
}
function budgets(service, template) {
  const resources = template.containers?.[0]?.resources;
  if (
    resources?.limits?.cpu !== '1' ||
    resources.limits.memory !== '1Gi' ||
    resources.cpuIdle !== true ||
    Object.keys(resources.limits).some(
      (key) => !['cpu', 'memory'].includes(key),
    ) ||
    (template.scaling?.minInstanceCount ?? 0) !== 0 ||
    (template.scaling?.maxInstanceCount !== undefined &&
      (!Number.isInteger(template.scaling.maxInstanceCount) ||
        template.scaling.maxInstanceCount < 1 ||
        template.scaling.maxInstanceCount > 2)) ||
    (service.scaling?.minInstanceCount ?? 0) !== 0 ||
    ![1, 2].includes(service.scaling?.maxInstanceCount) ||
    ![undefined, 'AUTOMATIC'].includes(service.scaling?.scalingMode) ||
    service.scaling?.manualInstanceCount ||
    template.nodeSelector ||
    template.gpuZonalRedundancyDisabled
  )
    refuse('RESOURCE_BUDGET_MISMATCH');
}
function expectation(request) {
  if (
    !request ||
    request.schemaVersion !== 1 ||
    !/^[1-9][0-9]{0,19}-[1-9][0-9]{0,3}$/.test(request.attemptId ?? '')
  )
    refuse('INVALID_ATTEMPT');
  const { build, profile, kind } = cloudRunExpectations(
    request.provenance,
    request.target,
  );
  if (kind !== 'services' || request.target.resourceId !== 'blogpost-api')
    refuse('API_SERVICE_REQUIRED');
  if (
    !Array.isArray(request.previous) ||
    !request.previous.length ||
    request.previous.length > 20
  )
    refuse('PREVIOUS_ARTIFACTS_REQUIRED');
  const previous = new Map();
  for (const item of request.previous) {
    name(item.revision);
    const old = cloudRunExpectations(item.provenance, item.target);
    if (
      previous.has(item.revision) ||
      !same(old.profile, profile) ||
      item.target.purpose !== 'api' ||
      item.target.resourceId !== request.target.resourceId ||
      item.target.region !== request.target.region
    )
      refuse('PREVIOUS_ARTIFACT_MISMATCH');
    previous.set(item.revision, item);
  }
  const revision = name(
    request.target.resourceId +
      '-r' +
      request.attemptId +
      '-' +
      build.sourceSha.slice(0, 12),
  );
  if (previous.has(revision)) refuse('CANDIDATE_ALREADY_REFERENCED');
  return {
    build,
    profile,
    previous,
    revision,
    tag: 'candidate-' + request.attemptId,
  };
}
function projectIdentity(project, profile) {
  if (
    !project ||
    project.projectId !== profile.projectId ||
    project.lifecycleState !== 'ACTIVE' ||
    !/^[1-9][0-9]{0,18}$/.test(project.projectNumber ?? '')
  )
    refuse('PROJECT_MISMATCH');
}
function serviceIdentity(service, project, target, uid) {
  const suffix =
    '/locations/' + target.region + '/services/' + target.resourceId;
  if (
    ![project.projectId, project.projectNumber].some(
      (id) => service?.name === 'projects/' + id + suffix,
    ) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      service.uid ?? '',
    ) ||
    (uid && uid !== service.uid)
  )
    refuse('SERVICE_IDENTITY_CHANGED');
}
async function revisionCheck(client, service, project, artifact, expectedHash) {
  const id = artifact.revision;
  const revision = await client.revision(service.name + '/revisions/' + id);
  if (
    revision.name !== service.name + '/revisions/' + id ||
    revision.service !== service.name ||
    revision.deleteTime ||
    revision.reconciling ||
    !revision.conditions?.some(
      (condition) =>
        condition.type === 'Ready' && condition.state === 'CONDITION_SUCCEEDED',
    ) ||
    revision.observedGeneration !== revision.generation ||
    !/^[1-9][0-9]{0,18}$/.test(revision.generation ?? '')
  )
    refuse('REVISION_NOT_READY');
  verifyCloudRunRevisionTemplate({ ...artifact, project, template: revision });
  budgets(service, revision);
  const projected = Object.fromEntries(
    REVISION_FIELDS.filter((key) => Object.hasOwn(revision, key)).map((key) => [
      key,
      revision[key],
    ]),
  );
  const hash = templateHash(projected);
  if (expectedHash && hash !== expectedHash)
    refuse('REVISION_CONFIGURATION_CHANGED');
  return { revision: id, image: artifact.target.image, templateHash: hash };
}
function candidateTemplate(base, request, expected) {
  const template = clone(base);
  template.revision = expected.revision;
  template.labels = {
    ...template.labels,
    'blogpost-source': expected.build.sourceSha,
    'blogpost-rollout': request.attemptId,
  };
  template.containers[0].image = request.target.image;
  for (const entry of template.containers[0].env) {
    if (entry.name === 'BUILD_SHA') entry.value = expected.build.sourceSha;
    if (entry.name === 'RUNTIME_INPUT_DIGEST')
      entry.value = expected.build.runtimeInputDigest;
  }
  return template;
}
function candidateTraffic(record) {
  return traffic([
    ...record.previousTraffic,
    {
      type: REVISION,
      revision: record.candidateRevision,
      percent: 0,
      tag: record.tag,
    },
  ]);
}
function promotedTraffic(record) {
  // Retain existing zero-traffic tags for recovery; allocation is explicit.
  return traffic([
    ...record.previousTraffic
      .filter((item) => item.tag)
      .map((item) => ({ ...item, percent: 0 })),
    {
      type: REVISION,
      revision: record.candidateRevision,
      percent: 100,
      tag: record.tag,
    },
  ]);
}
function candidateOrigin(service, record) {
  const entries = service.trafficStatuses.filter(
    (item) =>
      item.tag === record.tag &&
      item.revision === record.candidateRevision &&
      item.type === REVISION,
  );
  if (entries.length !== 1) refuse('CANDIDATE_URL_UNAVAILABLE');
  let url;
  try {
    url = new URL(entries[0].uri);
  } catch {
    refuse('CANDIDATE_URL_UNAVAILABLE');
  }
  // The trusted probe implementation must also pin the TLS peer and forbid
  // redirects. No Google bearer token is ever passed to that implementation.
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.run.app') ||
    !url.hostname.startsWith(record.tag + '---' + record.serviceId + '-') ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    refuse('CANDIDATE_URL_UNAVAILABLE');
  return url.origin;
}
function timeSource(clock) {
  const source = clock ?? { now: Date.now, sleep };
  let last = 0;
  return {
    now() {
      const value = source.now();
      if (!Number.isSafeInteger(value) || value < last || value <= 0)
        refuse('INVALID_CLOCK');
      last = value;
      return value;
    },
    sleep: (ms) => source.sleep(ms),
  };
}

// authorize/probe/metrics are mandatory trusted integration seams, not imported
// JSON evidence or an operational workflow. There is intentionally no CLI.
function context(options) {
  const request = clone(options.request);
  const expected = expectation(request);
  if (
    ['authorize', 'probe', 'metrics'].some(
      (key) => typeof options[key] !== 'function',
    ) ||
    !options.journal?.load ||
    !options.journal?.save ||
    !options.client
  )
    refuse('TRUSTED_ADAPTERS_REQUIRED');
  return { ...options, request, expected, clock: timeSource(options.clock) };
}
async function persist(ctx, record, phase, fields = {}) {
  const next = {
    ...record,
    ...fields,
    phase,
    version: record.version + 1,
    updatedAt: ctx.clock.now(),
  };
  if (next.updatedAt - next.createdAt > 86400000)
    refuse('ROLLOUT_RECORD_EXPIRED');
  await ctx.journal.save(next, record.version);
  ctx.recordVersion = next.version;
  return next;
}
async function live(ctx, record, expectedTraffic, checkSettled = true) {
  const project = await ctx.client.project();
  projectIdentity(project, ctx.expected.profile);
  if (record && project.projectNumber !== record.projectNumber)
    refuse('PROJECT_MISMATCH');
  const service = await ctx.client.service();
  serviceIdentity(service, project, ctx.request.target, record?.serviceUid);
  if (record && invariant(service) !== record.serviceInvariant)
    refuse('SERVICE_CONFIGURATION_CHANGED');
  if (checkSettled) settled(service);
  if (expectedTraffic && !same(traffic(service.traffic), expectedTraffic))
    refuse('TRAFFIC_CHANGED');
  const allowedTemplates =
    record?.pending?.phase === 'candidate'
      ? [record.candidateTemplateHash, record.desiredTemplateHash]
      : [record?.candidateTemplateHash];
  if (record && !allowedTemplates.includes(templateHash(service.template)))
    refuse('CANDIDATE_CONFIGURATION_CHANGED');
  if (
    record &&
    short(service.template.revision) !==
      (templateHash(service.template) === record.desiredTemplateHash
        ? record.candidateRevision
        : record.baseRevision)
  )
    refuse('CANDIDATE_CONFIGURATION_CHANGED');
  return { project, service };
}
async function mutate(
  ctx,
  record,
  phase,
  expectedTraffic,
  desiredTraffic,
  template,
) {
  let { service } = await live(ctx, record, expectedTraffic);
  const authorization = await ctx.authorize({
    phase,
    request: clone(ctx.request),
    record: clone(record),
    service: clone(service),
  });
  if (authorization !== true) refuse('MUTATION_NOT_AUTHORIZED');
  // Re-observe after potentially slow ancestry/backup/schema/IAM checks. Both
  // the private journal CAS and the provider etag prevent competing writers.
  const fresh = await live(ctx, record, expectedTraffic);
  if (
    fresh.service.etag !== service.etag ||
    fresh.service.generation !== service.generation
  )
    refuse('SERVICE_CHANGED_DURING_AUTHORIZATION');
  service = fresh.service;
  const body = {
    name: service.name,
    etag: service.etag,
    ...(template ? { template } : {}),
    traffic: desiredTraffic,
  };
  const mask = template ? 'template,traffic' : 'traffic';
  record = await persist(ctx, record, phase + '_intent', {
    pending: {
      phase,
      mask,
      bodyDigest: digest(body),
      beforeGeneration: service.generation,
      beforeEtag: service.etag,
    },
    status: 'deploying',
  });
  const operation = await ctx.client.patch(body, mask);
  const id = short(operation.name);
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
    ![record.projectId, record.projectNumber].some(
      (project) =>
        operation.name ===
        'projects/' +
          project +
          '/locations/' +
          ctx.request.target.region +
          '/operations/' +
          id,
    )
  )
    refuse('OPERATION_SCOPE_MISMATCH');
  record = await persist(ctx, record, phase + '_pending', {
    pending: { ...record.pending, operationName: operation.name },
    ...(template ? { candidateTemplateHash: record.desiredTemplateHash } : {}),
  });
  await waitOperation(ctx, record);
  const result = await waitTraffic(ctx, record, desiredTraffic);
  record = await persist(ctx, record, phase + '_applied', {
    pending: null,
    resultingTraffic: traffic(result.service.traffic),
    generation: result.service.generation,
  });
  return { record, ...result };
}
async function waitOperation(ctx, record) {
  const deadline = ctx.clock.now() + STARTUP;
  for (let count = 0; count <= STARTUP / POLL; count++) {
    const operation = await ctx.client.operation(record.pending.operationName);
    if (
      operation.name !== record.pending.operationName ||
      ![undefined, false, true].includes(operation.done)
    )
      refuse('INVALID_OPERATION');
    if (operation.done) {
      if (
        operation.error ||
        operation.response?.name !== record.serviceName ||
        operation.response.uid !== record.serviceUid
      )
        refuse('PROVIDER_OPERATION_FAILED');
      return;
    }
    if (operation.error || operation.response) refuse('INVALID_OPERATION');
    if (ctx.clock.now() >= deadline) break;
    await ctx.clock.sleep(POLL);
  }
  refuse('PROVIDER_OPERATION_TIMEOUT');
}
async function waitTraffic(ctx, record, desired) {
  const deadline = ctx.clock.now() + STARTUP;
  for (let count = 0; count <= STARTUP / POLL; count++) {
    const value = await live(ctx, record, desired, false);
    try {
      settled(value.service);
      return value;
    } catch (error) {
      if (!['SERVICE_NOT_SETTLED', 'TRAFFIC_NOT_SETTLED'].includes(error.code))
        throw error;
    }
    if (ctx.clock.now() >= deadline) break;
    await ctx.clock.sleep(POLL);
  }
  refuse('TRAFFIC_CONVERGENCE_TIMEOUT');
}
async function probe(ctx, record, phase, origin, artifacts) {
  try {
    const result = await ctx.probe({
      phase,
      origin,
      artifacts: clone(artifacts),
      request: clone(ctx.request),
      record: clone(record),
    });
    return result?.ok === true;
  } catch {
    return false;
  }
}
async function stableProbes(ctx, record, phase, origin, artifacts) {
  const deadline = ctx.clock.now() + STARTUP;
  let passed = 0;
  for (let count = 0; count <= STARTUP / POLL; count++) {
    passed = (await probe(ctx, record, phase, origin, artifacts))
      ? passed + 1
      : 0;
    if (passed === 3) return true;
    if (ctx.clock.now() >= deadline) break;
    await ctx.clock.sleep(POLL);
  }
  return false;
}
function metricSample(sample, now) {
  if (!sample || sample.available !== true) return null;
  if (
    !Number.isSafeInteger(sample.requests) ||
    !Number.isSafeInteger(sample.serverErrors) ||
    sample.requests < 0 ||
    sample.serverErrors < 0 ||
    sample.serverErrors > sample.requests ||
    !Number.isSafeInteger(sample.windowStart) ||
    !Number.isSafeInteger(sample.windowEnd) ||
    sample.windowEnd - sample.windowStart !== 300000 ||
    sample.windowEnd > now ||
    now - sample.windowEnd > 60000
  )
    refuse('INVALID_METRIC_SAMPLE');
  return sample.requests >= 20 && sample.serverErrors / sample.requests > 0.05;
}
async function previousRevisions(ctx, record, service, project) {
  for (const previous of record.previousRevisions) {
    const artifact = ctx.expected.previous.get(previous.revision);
    if (!artifact || artifact.target.image !== previous.image)
      refuse('PREVIOUS_ARTIFACT_MISMATCH');
    await revisionCheck(
      ctx.client,
      service,
      project,
      artifact,
      previous.templateHash,
    );
  }
}
async function rollback(ctx, record, reason) {
  const desired = promotedTraffic(record);
  const { project, service } = await live(ctx, record, desired);
  await previousRevisions(ctx, record, service, project);
  ({ record } = await mutate(
    ctx,
    record,
    'rollback',
    desired,
    record.previousTraffic,
  ));
  const artifacts = record.previousRevisions.map((entry) =>
    ctx.expected.previous.get(entry.revision),
  );
  const healthy = await stableProbes(
    ctx,
    record,
    'rollback',
    ctx.expected.profile.apiOrigin,
    artifacts,
  );
  await live(ctx, record, record.previousTraffic);
  return persist(ctx, record, healthy ? 'rolled_back' : 'rollback_unhealthy', {
    status: healthy ? 'rolled_back' : 'failed',
    reason,
    success: false,
  });
}
async function failure(ctx, error) {
  if (['JOURNAL_VERSION_CONFLICT', 'JOURNAL_LOCKED'].includes(error.code))
    throw error;
  const record = await ctx.journal.load();
  if (!record || ['succeeded', 'rolled_back'].includes(record.status))
    throw error;
  if (
    record.requestDigest !== digest(ctx.request) ||
    record.version !== ctx.recordVersion
  )
    refuse('JOURNAL_VERSION_CONFLICT');
  let lastObservation = { available: false };
  try {
    const service = await ctx.client.service();
    if (
      service.name === record.serviceName &&
      service.uid === record.serviceUid &&
      typeof service.generation === 'string' &&
      /^[1-9][0-9]{0,18}$/.test(service.generation)
    )
      lastObservation = {
        available: true,
        generation: service.generation,
        desiredTraffic: traffic(service.traffic),
        observedTraffic: traffic(service.trafficStatuses, true),
      };
  } catch {
    /* Failure diagnostics never authorize a write or mask uncertainty. */
  }
  // Persisted intent is deliberately retained when a write response or polling
  // is lost. A failure handler must never guess whether that PATCH took effect.
  return persist(ctx, record, 'recovery_required', {
    status: 'failed',
    success: false,
    lastObservation,
    reason:
      error instanceof RolloutError ? error.code : 'TRUSTED_ADAPTER_FAILED',
  });
}

export async function executeCloudRunRollout(options) {
  const ctx = context(options);
  if (await ctx.journal.load()) refuse('ROLLOUT_ALREADY_RECORDED');
  try {
    const { project, service } = await live(ctx, null);
    const old = ctx.expected.previous.get(short(service.template.revision));
    if (!old) refuse('PREVIOUS_ARTIFACT_MISMATCH');
    verifyCloudRunConfiguration({ ...old, project, resource: service });
    budgets(service, service.template);
    if (
      Object.keys(service.template).some(
        (key) => key !== 'revision' && !REVISION_FIELDS.includes(key),
      )
    )
      refuse('UNSUPPORTED_REVISION_FIELD');
    const previousTraffic = traffic(service.traffic);
    if (
      previousTraffic.some(
        (entry) =>
          !ctx.expected.previous.has(entry.revision) ||
          entry.tag === ctx.expected.tag,
      )
    )
      refuse('PREVIOUS_ARTIFACT_MISMATCH');
    const required = new Set([
      short(service.template.revision),
      ...previousTraffic.map((item) => item.revision),
    ]);
    if (required.size !== ctx.expected.previous.size)
      refuse('PREVIOUS_ARTIFACT_MISMATCH');
    const previous = [];
    for (const revision of required)
      previous.push(
        await revisionCheck(
          ctx.client,
          service,
          project,
          ctx.expected.previous.get(revision),
        ),
      );
    if (
      previous.find((entry) => entry.revision === old.revision).templateHash !==
      templateHash(service.template)
    )
      refuse('CURRENT_REVISION_CONFIGURATION_MISMATCH');
    const template = candidateTemplate(
      service.template,
      ctx.request,
      ctx.expected,
    );
    verifyCloudRunRevisionTemplate({ ...ctx.request, project, template });
    const createdAt = ctx.clock.now();
    let record = {
      schemaVersion: 1,
      id: ctx.request.attemptId,
      version: 1,
      phase: 'prepared',
      status: 'deploying',
      success: false,
      requestDigest: digest(ctx.request),
      sourceSha: ctx.expected.build.sourceSha,
      image: ctx.request.target.image,
      environment: ctx.expected.build.environment,
      projectId: project.projectId,
      projectNumber: project.projectNumber,
      serviceName: service.name,
      serviceId: ctx.request.target.resourceId,
      serviceUid: service.uid,
      serviceInvariant: invariant(service),
      previousTraffic,
      previousRevisions: previous,
      candidateRevision: ctx.expected.revision,
      tag: ctx.expected.tag,
      baseRevision: short(service.template.revision),
      candidateTemplateHash: templateHash(service.template),
      desiredTemplateHash: templateHash(template),
      createdAt,
      updatedAt: createdAt,
      pending: null,
    };
    await ctx.journal.save(record, 0);
    ctx.recordVersion = record.version;
    // The base template is checked immediately before PATCH; subsequent reads
    // must match the exact candidate configuration that was copied from it.
    const result = await mutate(
      ctx,
      record,
      'candidate',
      previousTraffic,
      candidateTraffic(record),
      template,
    );
    record = result.record;
    const candidate = {
      revision: record.candidateRevision,
      provenance: ctx.request.provenance,
      target: ctx.request.target,
    };
    await revisionCheck(
      ctx.client,
      result.service,
      project,
      candidate,
      record.desiredTemplateHash,
    );
    const origin = candidateOrigin(result.service, record);
    if (!(await stableProbes(ctx, record, 'candidate', origin, [candidate])))
      return persist(ctx, record, 'candidate_failed', {
        status: 'failed',
        reason: 'CANDIDATE_PROBES_FAILED',
      });
    record = await persist(ctx, record, 'candidate_ready');
    const promoted = await mutate(
      ctx,
      record,
      'promote',
      candidateTraffic(record),
      promotedTraffic(record),
    );
    record = promoted.record;
    // The provider routing state can settle before all requests reach the new
    // build. Allow three stable read-only rounds before starting observation.
    if (
      !(await stableProbes(
        ctx,
        record,
        'convergence',
        ctx.expected.profile.apiOrigin,
        [candidate],
      ))
    )
      return await rollback(ctx, record, 'ROUTING_CONVERGENCE_FAILED');
    const started = ctx.clock.now();
    record = await persist(ctx, record, 'observing', {
      observationStartedAt: started,
    });
    let failed = 0;
    let metricsMissing = false;
    let cadenceMissed = false;
    let rounds = 0;
    let nextProbeAt = started + INTERVAL;
    do {
      const now = ctx.clock.now();
      if (now > nextProbeAt) {
        nextProbeAt += Math.ceil((now - nextProbeAt) / INTERVAL) * INTERVAL;
        cadenceMissed = true;
      }
      if (nextProbeAt > started + OBSERVE) break;
      await ctx.clock.sleep(Math.max(0, nextProbeAt - ctx.clock.now()));
      await live(ctx, record, promotedTraffic(record));
      failed = (await probe(
        ctx,
        record,
        'observation',
        ctx.expected.profile.apiOrigin,
        [candidate],
      ))
        ? 0
        : failed + 1;
      if (failed >= 2)
        return await rollback(ctx, record, 'POST_SWITCH_PROBES_FAILED');
      let sample;
      try {
        sample = await ctx.metrics({
          request: clone(ctx.request),
          record: clone(record),
          now: ctx.clock.now(),
        });
      } catch {
        sample = { available: false };
      }
      const highErrors = metricSample(sample, ctx.clock.now());
      if (highErrors === null) metricsMissing = true;
      if (highErrors)
        return await rollback(ctx, record, 'SERVICE_5XX_THRESHOLD');
      rounds++;
      record = await persist(ctx, record, 'observing', {
        observationRounds: rounds,
        metricsMissing,
        cadenceMissed,
      });
      nextProbeAt += INTERVAL;
    } while (nextProbeAt <= started + OBSERVE && rounds < OBSERVE / INTERVAL);
    await live(ctx, record, promotedTraffic(record));
    const incomplete = metricsMissing || failed > 0 || cadenceMissed;
    return persist(
      ctx,
      record,
      incomplete ? 'observation_incomplete' : 'succeeded',
      {
        status: incomplete ? 'failed' : 'succeeded',
        success: !incomplete,
        cadenceMissed,
        reason: metricsMissing
          ? 'METRICS_UNAVAILABLE'
          : failed
            ? 'PROBES_UNCONFIRMED'
            : cadenceMissed
              ? 'OBSERVATION_CADENCE_MISSED'
              : null,
      },
    );
  } catch (error) {
    return failure(ctx, error);
  }
}

export async function recoverCloudRunRollout(options) {
  const ctx = context(options);
  let record = await ctx.journal.load();
  if (
    !record ||
    record.schemaVersion !== 1 ||
    record.id !== ctx.request.attemptId ||
    record.requestDigest !== digest(ctx.request) ||
    record.candidateRevision !== ctx.expected.revision ||
    record.tag !== ctx.expected.tag ||
    record.image !== ctx.request.target.image ||
    record.sourceSha !== ctx.expected.build.sourceSha ||
    record.projectId !== ctx.expected.profile.projectId ||
    record.environment !== ctx.expected.build.environment ||
    !same(traffic(record.previousTraffic), record.previousTraffic) ||
    !Array.isArray(record.previousRevisions) ||
    !ctx.expected.previous.has(record.baseRevision) ||
    record.previousRevisions.length !== ctx.expected.previous.size ||
    new Set(record.previousRevisions.map((entry) => entry.revision)).size !==
      record.previousRevisions.length ||
    record.previousTraffic.some(
      (entry) => !ctx.expected.previous.has(entry.revision),
    ) ||
    !Number.isSafeInteger(record.createdAt) ||
    record.createdAt <= 0 ||
    record.createdAt > ctx.clock.now() ||
    ctx.clock.now() - record.createdAt > 86400000
  )
    refuse('RECOVERY_RECORD_MISMATCH');
  if (record.status === 'succeeded' || record.status === 'rolled_back')
    refuse('TERMINAL_ROLLOUT');
  if (record.phase === 'observation_incomplete')
    refuse('OBSERVATION_REQUIRES_OPERATOR');
  ctx.recordVersion = record.version;
  try {
    if (record.pending?.operationName) await waitOperation(ctx, record);
    // A lost PATCH response has no operation ID. Reconciliation requires an
    // actually settled service and a generation change; no mutation is retried.
    const current = await live(ctx, record);
    if (
      record.pending &&
      BigInt(current.service.generation) <=
        BigInt(record.pending.beforeGeneration)
    )
      refuse('WRITE_OUTCOME_UNCERTAIN');
    if (
      record.pending?.phase === 'candidate' &&
      templateHash(current.service.template) === record.desiredTemplateHash
    )
      record = await persist(ctx, record, 'candidate_reconciled', {
        candidateTemplateHash: record.desiredTemplateHash,
      });
    await previousRevisions(ctx, record, current.service, current.project);
    const actual = traffic(current.service.traffic);
    if (
      same(actual, record.previousTraffic) ||
      same(actual, candidateTraffic(record))
    ) {
      // No allocation moved (or a previous rollback already completed). A
      // tagged candidate may remain; cleanup is a separate reviewed operation.
      const artifacts = record.previousRevisions.map((entry) =>
        ctx.expected.previous.get(entry.revision),
      );
      if (
        !(await stableProbes(
          ctx,
          record,
          'recovery_previous',
          ctx.expected.profile.apiOrigin,
          artifacts,
        ))
      )
        refuse('PREVIOUS_PROBES_FAILED');
      await live(ctx, record, actual);
      record = await persist(ctx, record, 'recovered_previous', {
        pending: null,
        status: 'failed',
        success: false,
        resultingTraffic: actual,
        reason: 'PREVIOUS_TRAFFIC_RETAINED',
      });
      return record;
    }
    if (!same(actual, promotedTraffic(record)))
      refuse('RECOVERY_TRAFFIC_CHANGED');
    return await rollback(ctx, record, 'INTERRUPTED_ROLLOUT');
  } catch (error) {
    return failure(ctx, error);
  }
}
