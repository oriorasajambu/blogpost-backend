import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './fixtures.mjs';
import { cloudRunRolloutClient } from '../../scripts/deploy/rollout-client.mjs';
import {
  executeCloudRunRollout,
  recoverCloudRunRollout,
} from '../../scripts/deploy/rollout.mjs';
import { fileRolloutJournal } from '../../scripts/deploy/rollout-journal.mjs';
import { probeFixture } from './probe-fixtures.mjs';
import { contractSha256 } from '../../scripts/deploy/wire-contract.mjs';
import { metricSample, metricsFixture } from './metrics-fixtures.mjs';
import {
  OBSERVATION_DURATION,
  METRICS_MAX_DRAIN,
} from '../../scripts/deploy/metrics-policy.mjs';

const REVISION = 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION';
const clone = structuredClone;
function harness(environment = 'staging') {
  const old = fixture(environment);
  old.resource.createTime = '2026-10-27T00:00:00Z';
  const previous = 'blogpost-api-known-good';
  old.resource.template.revision = previous;
  old.resource.template.labels = { team: 'editorial' };
  old.resource.template.annotations = { 'example.test/managed': 'preserve' };
  old.resource.template.executionEnvironment = 'EXECUTION_ENVIRONMENT_GEN2';
  old.resource.template.scaling = { minInstanceCount: 0, maxInstanceCount: 2 };
  old.resource.template.containers[0].resources = {
    limits: { cpu: '1', memory: '1Gi' },
    cpuIdle: true,
    startupCpuBoost: false,
  };
  old.resource.template.containers[0].env.push(
    { name: 'BUILD_SHA', value: old.provenance.sourceSha },
    { name: 'RUNTIME_INPUT_DIGEST', value: old.provenance.runtimeInputDigest },
  );
  old.resource.scaling = {
    minInstanceCount: 0,
    maxInstanceCount: 2,
    scalingMode: 'AUTOMATIC',
  };
  old.resource.ingress = 'INGRESS_TRAFFIC_ALL';
  old.resource.labels = { infrastructure: 'console' };
  old.resource.uri = old.provenance.configuration.apiOrigin;
  old.resource.traffic = [
    { type: REVISION, revision: previous, percent: 100 },
    { type: REVISION, revision: previous, percent: 0, tag: 'known-good' },
  ];
  old.resource.trafficStatuses = clone(old.resource.traffic);
  old.resource.latestReadyRevision =
    old.resource.name + '/revisions/' + previous;
  old.resource.latestCreatedRevision = old.resource.latestReadyRevision;
  const candidate = clone(old);
  candidate.provenance.sourceSha = 'f'.repeat(40);
  candidate.provenance.runtimeInputDigest = '1'.repeat(64);
  candidate.target.image = candidate.target.image.replace(
    'e'.repeat(64),
    '2'.repeat(64),
  );
  const request = {
    schemaVersion: 1,
    attemptId: '12345-1',
    provenance: candidate.provenance,
    target: candidate.target,
    previous: [
      { revision: previous, provenance: old.provenance, target: old.target },
    ],
  };
  const state = {
    service: clone(old.resource),
    revisions: new Map(),
    operations: new Map(),
    calls: [],
    patches: [],
    saves: [],
    authorizations: [],
    probes: [],
    metrics: [],
    now: Date.parse('2026-10-28T00:00:00Z'),
    record: null,
    tokenCalls: 0,
    loseResponse: null,
    operationPending: false,
  };
  function revision(template) {
    const { revision: id, ...fields } = clone(template);
    return {
      ...fields,
      name: state.service.name + '/revisions/' + id,
      service: state.service.name,
      generation: '1',
      observedGeneration: '1',
      conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }],
    };
  }
  state.revisions.set(previous, revision(state.service.template));
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const fetchImpl = async (url, options) => {
    state.calls.push({
      url,
      options: clone({ ...options, signal: undefined }),
    });
    if (state.beforeRequest) await state.beforeRequest(url, options);
    if (url.startsWith('https://cloudresourcemanager.googleapis.com/'))
      return json(old.project);
    if (options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      assert.equal(
        body.etag,
        state.service.etag,
        'provider optimistic concurrency',
      );
      assert.match(
        state.record.phase,
        /_intent$/,
        'intent is durable before the write',
      );
      const phase = state.record.pending.phase;
      state.patches.push({ body, phase, url });
      state.service.traffic = body.traffic;
      if (body.template) {
        state.service.template = body.template;
        state.service.latestCreatedRevision =
          state.service.name + '/revisions/' + body.template.revision;
        state.service.latestReadyRevision = state.service.latestCreatedRevision;
        state.revisions.set(body.template.revision, revision(body.template));
      }
      state.service.generation = String(BigInt(state.service.generation) + 1n);
      state.service.observedGeneration = state.service.generation;
      state.service.etag = 'etag-' + state.service.generation;
      state.service.trafficStatuses = body.traffic.map((entry) => ({
        ...entry,
        ...(entry.tag
          ? {
              uri: 'https://' + entry.tag + '---blogpost-api-fixture.a.run.app',
            }
          : {}),
      }));
      const operation = {
        name:
          'projects/' +
          old.project.projectNumber +
          '/locations/asia-southeast2/operations/op-' +
          state.patches.length,
        done: true,
        response: clone(state.service),
      };
      state.operations.set(operation.name.split('/').at(-1), operation);
      if (state.loseResponse === phase)
        throw new Error('private provider diagnostic');
      return json({ name: operation.name });
    }
    if (url.includes('/operations/')) {
      const operation = clone(state.operations.get(url.split('/').at(-1)));
      return json(
        state.operationPending
          ? { name: operation.name, done: false }
          : operation,
      );
    }
    if (url.includes('/revisions/'))
      return json(
        state.revisions.get(url.split('/').at(-1)) ?? {},
        state.revisions.has(url.split('/').at(-1)) ? 200 : 404,
      );
    return json(state.service);
  };
  const journal = {
    async load() {
      return clone(state.record);
    },
    async save(record, expectedVersion) {
      assert.equal(state.record?.version ?? 0, expectedVersion);
      state.record = clone(record);
      state.saves.push(clone(record));
    },
  };
  const options = {
    request,
    client: cloudRunRolloutClient({
      ...candidate,
      getAccessToken: async () => {
        state.tokenCalls++;
        return 'synthetic-token';
      },
      fetchImpl,
    }),
    journal,
    clock: {
      now: () => state.now,
      sleep: async (ms) => {
        state.now += ms;
      },
    },
    authorize: async (input) => {
      state.authorizations.push(input.phase);
      return state.authorize ? state.authorize(input) : true;
    },
    probe: async (input) => {
      state.probes.push(input);
      return { ok: state.probe ? await state.probe(input) : true };
    },
    metrics: async (input) => {
      state.metrics.push(input);
      return metricSample(input, state.metric ? state.metric(input) : {});
    },
  };
  return { options, state, old, candidate, previous, json, fetchImpl };
}

for (const env of ['staging', 'production'])
  test(
    env +
      ' rollout preserves configuration, creates zero allocation, promotes explicitly and observes fifteen minutes',
    async () => {
      const h = harness(env);
      const original = clone(h.state.service);
      const result = await executeCloudRunRollout(h.options);
      assert.equal(result.status, 'succeeded');
      assert.equal(result.success, true);
      assert.equal(result.observationRounds, 38);
      assert.equal(result.metricsComplete, true);
      assert.ok(result.metricsCoveredFrom <= result.observationStartedAt);
      assert.ok(
        result.metricsCoveredUntil >=
          result.observationStartedAt + OBSERVATION_DURATION,
      );
      assert.ok(
        result.updatedAt - result.observationStartedAt <=
          OBSERVATION_DURATION + METRICS_MAX_DRAIN,
      );
      assert.ok(result.updatedAt - result.observationStartedAt >= 900000);
      assert.deepEqual(h.state.authorizations, ['candidate', 'promote']);
      assert.equal(h.state.patches.length, 2);
      const first = h.state.patches[0];
      assert.equal(
        first.body.traffic.find(
          (entry) => entry.revision === result.candidateRevision,
        ).percent,
        0,
      );
      assert.equal(first.body.traffic.find((entry) => !entry.tag).percent, 100);
      assert.equal(
        first.body.template.annotations['example.test/managed'],
        'preserve',
      );
      assert.deepEqual(
        first.body.template.containers[0].resources,
        original.template.containers[0].resources,
      );
      assert.deepEqual(h.state.service.scaling, original.scaling);
      assert.deepEqual(h.state.service.labels, original.labels);
      assert.equal(
        h.state.service.template.containers[0].env.find(
          (entry) => entry.name === 'BUILD_SHA',
        ).value,
        h.candidate.provenance.sourceSha,
      );
      assert.equal(h.state.patches[1].body.template, undefined);
      assert.deepEqual(
        h.state.patches[1].body.traffic.map((item) => [
          item.revision,
          item.percent,
        ]),
        [
          [result.candidateRevision, 100],
          [h.previous, 0],
        ].sort((a, b) =>
          JSON.stringify({
            type: REVISION,
            revision: a[0],
            percent: a[1],
          }).localeCompare(
            JSON.stringify({ type: REVISION, revision: b[0], percent: b[1] }),
          ),
        ),
      );
      assert.equal(
        h.state.probes.filter((item) => item.phase === 'candidate').length,
        3,
      );
      assert.equal(
        h.state.probes.filter((item) => item.phase === 'convergence').length,
        3,
      );
      assert.ok(
        h.state.calls.every(
          (item) =>
            item.options.redirect === 'error' &&
            item.options.credentials === 'omit',
        ),
      );
      assert.equal(h.state.tokenCalls, h.state.calls.length);
      assert.ok(
        h.state.patches.every(
          (item) =>
            new URL(item.url).searchParams.get('allowMissing') === 'false',
        ),
      );
      assert.ok(!JSON.stringify(result).includes('synthetic-token'));
      assert.ok(
        !JSON.stringify(result).includes('private provider diagnostic'),
      );
    },
  );

test('candidate needs three consecutive passing rounds', async () => {
  const h = harness();
  let count = 0;
  h.state.probe = ({ phase }) => phase !== 'candidate' || ++count !== 3;
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.success, true);
  assert.equal(count, 6);
});

test('failed candidate retains old traffic and never promotes', async () => {
  const h = harness();
  h.state.probe = ({ phase }) => phase !== 'candidate';
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.phase, 'candidate_failed');
  assert.equal(h.state.patches.length, 1);
  assert.equal(
    h.state.service.traffic.find((item) => item.percent === 100).revision,
    h.previous,
  );
});

test('two consecutive post-switch failures restore the exact map and still fail deployment', async () => {
  const h = harness();
  h.state.probe = ({ phase }) => phase !== 'observation';
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.status, 'rolled_back');
  assert.equal(result.success, false);
  assert.deepEqual(h.state.service.traffic, result.previousTraffic);
  assert.deepEqual(h.state.authorizations, [
    'candidate',
    'promote',
    'rollback',
  ]);
  assert.equal(h.state.patches[2].body.template, undefined);
});

test('one failed round resets after a healthy round', async () => {
  const h = harness();
  let count = 0;
  h.state.probe = ({ phase }) => phase !== 'observation' || ++count !== 1;
  assert.equal((await executeCloudRunRollout(h.options)).status, 'succeeded');
  assert.equal(h.state.patches.length, 2);
});

test('observation starts remain thirty seconds apart when probes take time', async () => {
  const h = harness();
  const starts = [];
  h.state.probe = ({ phase }) => {
    if (phase === 'observation') {
      starts.push(h.state.now);
      h.state.now += 5000;
    }
    return true;
  };
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.success, true);
  assert.equal(starts.length, 38);
  assert.ok(
    starts.slice(1).every((time, index) => time - starts[index] === 30000),
  );
});

test('missed observation slots cannot report success or trigger automatic recovery', async () => {
  const h = harness();
  h.state.probe = ({ phase }) => {
    if (phase === 'observation') h.state.now += 45000;
    return true;
  };
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.phase, 'observation_incomplete');
  assert.equal(result.reason, 'OBSERVATION_CADENCE_MISSED');
  assert.equal(h.state.patches.length, 2);
  await assert.rejects(recoverCloudRunRollout(h.options), {
    code: 'OBSERVATION_REQUIRES_OPERATOR',
  });
});

test('an unconfirmed last probe failure cannot report success', async () => {
  const h = harness();
  h.state.probe = ({ phase }) =>
    phase !== 'observation' ||
    h.state.now <
      h.state.record.observationStartedAt +
        OBSERVATION_DURATION +
        METRICS_MAX_DRAIN;
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.reason, 'PROBES_UNCONFIRMED');
  assert.equal(result.success, false);
  assert.equal(h.state.patches.length, 2);
});

for (const [requests, errors, rollback] of [
  [20, 2, true],
  [20, 1, false],
  [19, 19, false],
])
  test(
    '5xx threshold: ' + requests + ' requests, ' + errors + ' errors',
    async () => {
      const h = harness();
      h.state.metric = () => ({ requests, serverErrors: errors });
      const result = await executeCloudRunRollout(h.options);
      assert.equal(result.status, rollback ? 'rolled_back' : 'succeeded');
      if (rollback) assert.equal(result.reason, 'SERVICE_5XX_THRESHOLD');
    },
  );

test('missing metrics fails observation and retains candidate traffic for assessment', async () => {
  const h = harness();
  h.state.metric = () => ({ available: false });
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.phase, 'observation_incomplete');
  assert.equal(result.reason, 'METRICS_UNAVAILABLE');
  await assert.rejects(recoverCloudRunRollout(h.options), {
    code: 'OBSERVATION_REQUIRES_OPERATOR',
  });
  assert.equal(h.state.patches.length, 2);
  assert.equal(
    h.state.service.traffic.find((item) => item.percent === 100).revision,
    result.candidateRevision,
  );
});

test('invalid metrics cannot trigger success or an automatic rollback', async () => {
  const h = harness();
  h.state.metric = ({ now }) => ({
    available: true,
    requests: 20,
    serverErrors: 10,
    windowStart: now - 299999,
    windowEnd: now,
  });
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.phase, 'observation_incomplete');
  assert.equal(result.reason, 'METRICS_UNAVAILABLE');
  await assert.rejects(recoverCloudRunRollout(h.options), {
    code: 'OBSERVATION_REQUIRES_OPERATOR',
  });
  assert.equal(h.state.patches.length, 2);
});

test('unhealthy rollback is recorded as failure with the actual previous map', async () => {
  const h = harness();
  h.state.probe = ({ phase }) => !['observation', 'rollback'].includes(phase);
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.phase, 'rollback_unhealthy');
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.resultingTraffic, result.previousTraffic);
});

for (const [field, change, code] of [
  [
    'floating latest',
    (h) => {
      h.state.service.traffic[0] = {
        type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',
        percent: 100,
      };
    },
    'EXPLICIT_TRAFFIC_REQUIRED',
  ],
  [
    'empty traffic',
    (h) => {
      h.state.service.traffic = [];
    },
    'EXPLICIT_TRAFFIC_REQUIRED',
  ],
  [
    'CPU',
    (h) => {
      h.state.service.template.containers[0].resources.limits.cpu = '2';
    },
    'RESOURCE_BUDGET_MISMATCH',
  ],
  [
    'service cap',
    (h) => {
      h.state.service.scaling.maxInstanceCount = 10;
    },
    'RESOURCE_BUDGET_MISMATCH',
  ],
  [
    'unknown previous image',
    (h) => {
      h.state.revisions.get(h.previous).containers[0].image =
        h.candidate.target.image;
    },
    'IMAGE_MISMATCH',
  ],
])
  test(field + ' is refused before any mutation', async () => {
    const h = harness();
    change(h);
    await assert.rejects(executeCloudRunRollout(h.options), { code });
    assert.equal(h.state.patches.length, 0);
  });

test('changed identity or infrastructure after candidate prevents promotion and rollback', async () => {
  const h = harness();
  h.state.authorize = ({ phase }) => {
    if (phase === 'promote') h.state.service.scaling.maxInstanceCount = 5;
    return true;
  };
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.reason, 'SERVICE_CONFIGURATION_CHANGED');
  assert.equal(h.state.patches.length, 1);
});

test('authorization denial and generation races perform no write', async () => {
  for (const race of [false, true]) {
    const h = harness();
    h.state.authorize = () => {
      if (race) h.state.service.etag = 'competing-writer';
      return race;
    };
    const result = await executeCloudRunRollout(h.options);
    assert.equal(
      result.reason,
      race ? 'SERVICE_CHANGED_DURING_AUTHORIZATION' : 'MUTATION_NOT_AUTHORIZED',
    );
    assert.equal(h.state.patches.length, 0);
  }
});

for (const phase of ['candidate', 'promote', 'rollback'])
  test(
    'lost ' +
      phase +
      ' response is reconciled independently without replaying the mutation',
    async () => {
      const h = harness();
      h.state.loseResponse = phase;
      if (phase === 'rollback')
        h.state.probe = ({ phase }) => phase !== 'observation';
      const interrupted = await executeCloudRunRollout(h.options);
      assert.equal(interrupted.phase, 'recovery_required');
      assert.equal(interrupted.pending.phase, phase);
      assert.equal(interrupted.pending.operationName, undefined);
      const count = h.state.patches.length;
      h.state.loseResponse = null;
      h.state.probe = () => true;
      const recovered = await recoverCloudRunRollout(h.options);
      assert.equal(recovered.success, false);
      assert.equal(
        recovered.phase,
        phase === 'promote' ? 'rolled_back' : 'recovered_previous',
      );
      assert.equal(
        h.state.patches.length,
        count + (phase === 'promote' ? 1 : 0),
      );
      assert.equal(
        h.state.service.traffic.find((item) => item.percent === 100).revision,
        h.previous,
      );
    },
  );

test('persisted provider operation can be resumed after the first polling timeout', async () => {
  const h = harness();
  h.state.operationPending = true;
  const interrupted = await executeCloudRunRollout(h.options);
  assert.equal(interrupted.reason, 'PROVIDER_OPERATION_TIMEOUT');
  assert.match(interrupted.pending.operationName, /operations\/op-1$/);
  h.state.operationPending = false;
  const recovered = await recoverCloudRunRollout(h.options);
  assert.equal(recovered.phase, 'recovered_previous');
  assert.equal(h.state.patches.length, 1);
});

test('recovery refuses a newer traffic map and cannot acquire authority from another request', async () => {
  const h = harness();
  h.state.loseResponse = 'promote';
  await executeCloudRunRollout(h.options);
  const wrong = clone(h.options.request);
  wrong.provenance.sourceSha = '3'.repeat(40);
  await assert.rejects(
    recoverCloudRunRollout({ ...h.options, request: wrong }),
    { code: 'RECOVERY_RECORD_MISMATCH' },
  );
  h.state.service.traffic = [
    { type: REVISION, revision: 'newer-owner-release', percent: 100 },
  ];
  h.state.service.trafficStatuses = clone(h.state.service.traffic);
  const result = await recoverCloudRunRollout(h.options);
  assert.equal(result.reason, 'RECOVERY_TRAFFIC_CHANGED');
  assert.equal(h.state.patches.length, 2);
});

test('an unchanged generation after a lost response remains uncertain', async () => {
  const h = harness();
  const initial = clone(h.state.service);
  h.state.loseResponse = 'candidate';
  await executeCloudRunRollout(h.options);
  h.state.service = initial;
  const result = await recoverCloudRunRollout(h.options);
  assert.equal(result.reason, 'WRITE_OUTCOME_UNCERTAIN');
  assert.equal(h.state.patches.length, 1);
});

test('terminal success cannot be replayed or automatically downgraded', async () => {
  const h = harness();
  await executeCloudRunRollout(h.options);
  await assert.rejects(executeCloudRunRollout(h.options), {
    code: 'ROLLOUT_ALREADY_RECORDED',
  });
  await assert.rejects(recoverCloudRunRollout(h.options), {
    code: 'TERMINAL_ROLLOUT',
  });
  assert.equal(h.state.patches.length, 2);
});

test('fixed REST adapter rejects foreign operation/revision names and unbounded responses', async () => {
  const h = harness();
  await h.options.client.project();
  for (const bad of [
    [],
    undefined,
    [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }],
  ])
    assert.throws(
      () =>
        h.options.client.patch(
          { name: h.state.service.name, etag: 'x', traffic: bad },
          'traffic',
        ),
      { code: 'PATCH_EXPLICIT_TRAFFIC_REQUIRED' },
    );
  assert.throws(
    () =>
      h.options.client.operation(
        'projects/foreign/locations/asia-southeast2/operations/x',
      ),
    { code: 'OPERATION_SCOPE_MISMATCH' },
  );
  assert.throws(
    () =>
      h.options.client.revision(
        'projects/foreign/locations/asia-southeast2/services/blogpost-api/revisions/x',
      ),
    { code: 'REVISION_SCOPE_MISMATCH' },
  );
  assert.throws(
    () =>
      h.options.client.patch(
        { name: h.state.service.name, etag: 'x', traffic: [], template: {} },
        '*',
      ),
    { code: 'PATCH_SCOPE_MISMATCH' },
  );
  const client = cloudRunRolloutClient({
    ...h.candidate,
    getAccessToken: async () => 'synthetic-token',
    fetchImpl: async () =>
      new Response(' '.repeat(1048577), {
        headers: { 'content-type': 'application/json' },
      }),
  });
  await assert.rejects(client.project(), { code: 'PROVIDER_READ_FAILED' });
});

test('provider deadlines bound token, transport, body and uncertain writes', async () => {
  const h = harness();
  let canceled = false;
  const never = () => new Promise(() => {});
  const clients = [
    cloudRunRolloutClient({
      ...h.candidate,
      getAccessToken: never,
      fetchImpl: never,
    }),
    cloudRunRolloutClient({
      ...h.candidate,
      getAccessToken: async () => 'synthetic-token',
      fetchImpl: never,
    }),
    cloudRunRolloutClient({
      ...h.candidate,
      getAccessToken: async () => 'synthetic-token',
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              canceled = true;
              return never();
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    }),
  ];
  const writeClient = cloudRunRolloutClient({
    ...h.candidate,
    getAccessToken: async () => 'synthetic-token',
    fetchImpl: async (url) =>
      url.startsWith('https://cloudresourcemanager.googleapis.com/')
        ? h.json(h.old.project)
        : never(),
  });
  await writeClient.project();
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const start = Date.now();
    await Promise.all([
      ...clients.map((client) =>
        assert.rejects(client.project(), { code: 'PROVIDER_READ_FAILED' }),
      ),
      assert.rejects(
        writeClient.patch(
          {
            name: h.state.service.name,
            etag: h.state.service.etag,
            traffic: h.state.service.traffic,
          },
          'traffic',
        ),
        { code: 'PROVIDER_WRITE_UNCERTAIN' },
      ),
    ]);
    assert.equal(canceled, true);
    assert.ok(Date.now() - start < 19000);
  } finally {
    clearInterval(keepAlive);
  }
});

test('rollback restores a previous split across distinct verified revisions', async () => {
  const h = harness();
  const second = 'blogpost-api-other-good';
  const artifact = clone(h.options.request.previous[0]);
  artifact.revision = second;
  artifact.provenance.sourceSha = '4'.repeat(40);
  artifact.target.image = artifact.target.image.replace(
    'e'.repeat(64),
    '5'.repeat(64),
  );
  h.options.request.previous.push(artifact);
  const revision = clone(h.state.revisions.get(h.previous));
  revision.name = h.state.service.name + '/revisions/' + second;
  revision.containers[0].image = artifact.target.image;
  revision.containers[0].env.find((entry) => entry.name === 'BUILD_SHA').value =
    artifact.provenance.sourceSha;
  h.state.revisions.set(second, revision);
  h.state.service.traffic[0].percent = 70;
  h.state.service.traffic.push({
    type: REVISION,
    revision: second,
    percent: 30,
  });
  h.state.service.trafficStatuses = clone(h.state.service.traffic);
  h.state.probe = ({ phase }) => phase !== 'observation';
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.status, 'rolled_back');
  assert.deepEqual(h.state.service.traffic, result.previousTraffic);
  assert.equal(result.previousRevisions.length, 2);
  assert.equal(
    h.state.service.traffic.find((item) => item.revision === second).percent,
    30,
  );
});

test('rollback denial records the actual traffic and stops further writes', async () => {
  const h = harness();
  h.state.authorize = ({ phase }) => phase !== 'rollback';
  h.state.probe = ({ phase }) => phase !== 'observation';
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.phase, 'recovery_required');
  assert.equal(result.reason, 'MUTATION_NOT_AUTHORIZED');
  assert.equal(result.lastObservation.available, true);
  assert.equal(
    result.lastObservation.desiredTraffic.find((item) => item.percent === 100)
      .revision,
    result.candidateRevision,
  );
  assert.equal(h.state.patches.length, 2);
});

test('an earlier executor cannot overwrite a newer journal version', async () => {
  const h = harness();
  h.state.authorize = () => {
    h.state.record = {
      ...h.state.record,
      version: h.state.record.version + 1,
      phase: 'another-recovery-process',
    };
    return true;
  };
  h.options.journal.save = async (record, expectedVersion) => {
    if ((h.state.record?.version ?? 0) !== expectedVersion) {
      const { RolloutError } =
        await import('../../scripts/deploy/rollout-client.mjs');
      throw new RolloutError('JOURNAL_VERSION_CONFLICT');
    }
    h.state.record = clone(record);
  };
  await assert.rejects(executeCloudRunRollout(h.options), {
    code: 'JOURNAL_VERSION_CONFLICT',
  });
  assert.equal(h.state.record.phase, 'another-recovery-process');
  assert.equal(h.state.patches.length, 0);
});

test('an unexpected tagged URL is never offered to the probe adapter', async () => {
  const h = harness();
  h.state.beforeRequest = (url) => {
    if (url.includes('/operations/'))
      h.state.service.trafficStatuses.find((item) =>
        item.tag?.startsWith('candidate-'),
      ).uri = 'https://foreign.example.test/';
  };
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.reason, 'CANDIDATE_URL_UNAVAILABLE');
  assert.equal(h.state.probes.length, 0);
  assert.equal(h.state.patches.length, 1);
});

test('mandatory trusted adapters cannot be replaced by JSON booleans', async () => {
  const h = harness();
  await assert.rejects(
    executeCloudRunRollout({ ...h.options, authorize: true }),
    { code: 'TRUSTED_ADAPTERS_REQUIRED' },
  );
  assert.equal(h.state.calls.length, 0);
});

test('unverifiable template fields and a current revision mismatch fail before mutation', async () => {
  for (const unsupported of [true, false]) {
    const h = harness();
    if (unsupported) h.state.service.template.unknownProviderField = true;
    else
      h.state.revisions.get(h.previous).annotations = {
        'example.test/managed': 'different',
      };
    await assert.rejects(executeCloudRunRollout(h.options), {
      code: unsupported
        ? 'UNSUPPORTED_REVISION_FIELD'
        : 'CURRENT_REVISION_CONFIGURATION_MISMATCH',
    });
    assert.equal(h.state.patches.length, 0);
  }
});

for (const shouldFail of [false, true])
  test(
    'rollout uses the real read-only wire adapter through ' +
      (shouldFail
        ? 'failed observation and recovery'
        : 'successful observation'),
    async () => {
      const h = harness();
      h.options.request.provenance.contractSha256 = contractSha256;
      for (const previous of h.options.request.previous)
        previous.provenance.contractSha256 = contractSha256;
      const http = probeFixture();
      http.state.mutation = (response) => {
        if (
          shouldFail &&
          http.state.input.phase === 'observation' &&
          response.path === '/v1/public/posts'
        )
          response.headers['cache-control'] = 'public';
      };
      h.options.probe = async (input) => {
        http.state.input = input;
        return http.probe(input);
      };
      const result = await executeCloudRunRollout(h.options);
      assert.equal(result.status, shouldFail ? 'rolled_back' : 'succeeded');
      assert.equal(result.success, !shouldFail);
      assert.ok(http.state.calls.length >= 8 * 8);
      assert.ok(
        http.state.calls.every(
          (call) =>
            call.method === 'GET' &&
            !call.headers.Authorization &&
            !call.headers.Cookie,
        ),
      );
    },
  );

for (const mode of ['success', 'late-errors', 'missing-final-minute'])
  test(
    'rollout connects the Monitoring collector through ' + mode,
    async () => {
      const h = harness();
      const metrics = metricsFixture();
      h.options.metrics = async (input) => {
        metrics.state.input = input;
        const targetEnd =
          Math.ceil(
            (input.record.observationStartedAt + OBSERVATION_DURATION) / 60000,
          ) * 60000;
        if (mode === 'late-errors') {
          metrics.state.errorsAt = targetEnd;
          metrics.state.errors = 2;
        }
        if (mode === 'missing-final-minute')
          metrics.state.mutation = (page) => {
            if (
              page.timeSeries[0].points[0].interval.endTime ===
              new Date(targetEnd).toISOString()
            )
              page.timeSeries[0].points.shift();
          };
        return metrics.collector(input);
      };
      const result = await executeCloudRunRollout(h.options);
      assert.ok(metrics.state.calls.length > 0);
      assert.equal(metrics.state.calls.length, metrics.state.tokenCalls);
      assert.ok(
        metrics.state.calls.every(
          (call) =>
            new URL(call.url).origin === 'https://monitoring.googleapis.com' &&
            call.options.method === 'GET',
        ),
      );
      assert.ok(
        result.metricObservations.some((sample) => sample.state === 'warming'),
      );
      if (mode === 'success') {
        assert.equal(result.status, 'succeeded');
        assert.equal(result.metricsComplete, true);
        assert.ok(
          result.metricsCoveredUntil >=
            result.observationStartedAt + OBSERVATION_DURATION,
        );
        assert.ok(
          result.updatedAt - result.observationStartedAt <=
            OBSERVATION_DURATION + METRICS_MAX_DRAIN,
        );
      } else if (mode === 'late-errors') {
        assert.equal(result.status, 'rolled_back');
        assert.equal(result.reason, 'SERVICE_5XX_THRESHOLD');
        assert.equal(result.metricObservations.at(-1).serverErrors, 2);
        assert.ok(
          result.metricObservations.at(-1).windowEnd >=
            result.observationStartedAt + OBSERVATION_DURATION,
        );
        assert.equal(h.state.patches.length, 3);
      } else {
        assert.equal(result.phase, 'observation_incomplete');
        assert.equal(result.metricsComplete, false);
        assert.equal(result.reason, 'METRICS_UNAVAILABLE');
        assert.equal(h.state.patches.length, 2);
        await assert.rejects(recoverCloudRunRollout(h.options), {
          code: 'OBSERVATION_REQUIRES_OPERATOR',
        });
      }
    },
  );

test('HTTP failures during the metrics drain still use guarded rollback', async () => {
  const h = harness();
  h.state.probe = ({ phase }) =>
    phase !== 'observation' ||
    h.state.now <= h.state.record.observationStartedAt + OBSERVATION_DURATION;
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.status, 'rolled_back');
  assert.equal(result.reason, 'POST_SWITCH_PROBES_FAILED');
  assert.ok(
    result.updatedAt - result.observationStartedAt > OBSERVATION_DURATION,
  );
});

test('provider creation timestamps are recorded and future or missing identities cannot start mutation', async () => {
  for (const time of [undefined, '2027-10-28T00:00:00Z']) {
    const h = harness();
    h.state.service.createTime = time;
    await assert.rejects(executeCloudRunRollout(h.options), {
      code: 'SERVICE_IDENTITY_CHANGED',
    });
    assert.equal(h.state.patches.length, 0);
  }
});

test('metric journal records only validated count fields and never callback diagnostics', async () => {
  const h = harness();
  h.state.metric = (input) => {
    const base = metricSample(input);
    return base.available
      ? {
          buckets: base.buckets.map((bucket) => ({
            ...bucket,
            diagnostic: 'private-token-diagnostic',
          })),
        }
      : {};
  };
  const result = await executeCloudRunRollout(h.options);
  assert.equal(result.status, 'succeeded');
  assert.ok(!JSON.stringify(result).includes('private-token-diagnostic'));
  assert.ok(
    !JSON.stringify(h.state.saves).includes('private-token-diagnostic'),
  );
});

test('private file journal persists atomically, enforces CAS and detects corruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blogpost-rollout-'));
  try {
    const journal = await fileRolloutJournal(root, '12345-1');
    assert.equal(await journal.load(), null);
    const first = { id: '12345-1', version: 1, phase: 'prepared' };
    await journal.save(first, 0);
    assert.deepEqual(await journal.load(), first);
    await assert.rejects(journal.save({ ...first, version: 1 }, 0), {
      code: 'JOURNAL_VERSION_CONFLICT',
    });
    await journal.save({ ...first, version: 2, phase: 'candidate_intent' }, 1);
    await writeFile(
      join(root, '.local/deploy/rollouts/12345-1.lock'),
      'operator-inspection-required',
    );
    await assert.rejects(journal.save({ ...first, version: 3 }, 2), {
      code: 'JOURNAL_LOCKED',
    });
    const path = join(root, '.local/deploy/rollouts/12345-1.json');
    const bytes = await readFile(path, 'utf8');
    await writeFile(path, bytes.replace('candidate_intent', 'promote_intent'));
    await assert.rejects(journal.load(), { code: 'INVALID_JOURNAL' });
    await assert.rejects(fileRolloutJournal(root, '../escape'), {
      code: 'INVALID_ATTEMPT',
    });
  } finally {
    const resolved = await import('node:fs/promises').then(({ realpath }) =>
      realpath(root),
    );
    assert.ok(
      resolved.startsWith(
        await import('node:fs/promises').then(({ realpath }) =>
          realpath(tmpdir()),
        ),
      ),
    );
    assert.ok(resolved.includes('blogpost-rollout-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
