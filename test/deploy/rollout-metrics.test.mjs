import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metricsFixture, metricSample } from './metrics-fixtures.mjs';
import { createCloudRunMetricsCollector } from '../../scripts/deploy/rollout-metrics.mjs';
import { RolloutError } from '../../scripts/deploy/rollout-client.mjs';
import {
  assessServiceMetrics,
  serviceMetricsWindow,
  METRICS_PUBLICATION_LAG,
  OBSERVATION_DURATION,
  METRICS_MAX_DRAIN,
} from '../../scripts/deploy/metrics-policy.mjs';

for (const environment of ['staging', 'production'])
  test(
    environment +
      ' collector queries only the scoped mature service counts and retains exact integers',
    async () => {
      const h = metricsFixture(environment);
      const result = await h.collector(h.state.input);
      assert.equal(result.available, true);
      assert.equal(result.requests, 20);
      assert.equal(result.serverErrors, 0);
      assert.equal(result.evidenceSource, 'injected-transport');
      assert.equal(result.buckets.length, 5);
      const assessment = assessServiceMetrics(result, { ...h.state.input });
      assert.equal(assessment.state, 'available');
      assert.equal(assessment.highErrors, false);
      assert.ok(
        h.state.input.now - result.windowEnd >= METRICS_PUBLICATION_LAG,
      );
      const call = h.state.calls[0];
      const url = new URL(call.url);
      assert.equal(url.origin, 'https://monitoring.googleapis.com');
      assert.equal(
        url.pathname,
        '/v3/projects/' + h.f.project.projectId + '/timeSeries',
      );
      assert.equal(url.searchParams.get('view'), 'FULL');
      assert.equal(
        url.searchParams.get('aggregation.perSeriesAligner'),
        'ALIGN_SUM',
      );
      assert.equal(
        url.searchParams.get('aggregation.crossSeriesReducer'),
        'REDUCE_SUM',
      );
      assert.equal(
        url.searchParams.getAll('aggregation.groupByFields').length,
        4,
      );
      assert.match(
        url.searchParams.get('filter'),
        /resource\.type="cloud_run_revision"/,
      );
      assert.match(
        url.searchParams.get('filter'),
        /resource\.labels\.project_id=/,
      );
      assert.equal(call.options.method, 'GET');
      assert.equal(call.options.redirect, 'error');
      assert.equal(call.options.credentials, 'omit');
      assert.equal(h.state.tokenCalls, 1);
      assert.ok(!JSON.stringify(result).includes('synthetic-token'));
    },
  );

test('warmup is explicit, bounded and makes no provider or credential request', async () => {
  const h = metricsFixture();
  h.state.input.now = h.state.input.record.observationStartedAt + 30000;
  const result = await h.collector(h.state.input);
  assert.equal(result.available, false);
  assert.equal(result.pending, true);
  assert.equal(assessServiceMetrics(result, h.state.input).state, 'warming');
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.state.tokenCalls, 0);
  h.state.input.now = result.readyAt;
  assert.equal((await h.collector(h.state.input)).available, true);
});

test('all observation offsets mature within the bounded drain and cover both boundaries', () => {
  const base = Date.parse('2026-10-28T00:00:00Z');
  for (let offset = 0; offset < 60000; offset += 997) {
    const startedAt = base + offset;
    const first = serviceMetricsWindow(startedAt, startedAt);
    const last = serviceMetricsWindow(
      startedAt,
      startedAt + OBSERVATION_DURATION + METRICS_MAX_DRAIN,
    );
    assert.ok(first.firstStart <= startedAt);
    assert.equal(last.warming, false);
    assert.ok(last.windowEnd >= startedAt + OBSERVATION_DURATION);
    assert.equal(last.windowEnd, last.targetEnd);
  }
});

test('pagination merges disjoint points, refreshes credentials and never follows a returned URL', async () => {
  const h = metricsFixture();
  const base = h.page();
  h.state.pages = (token) =>
    token === null
      ? {
          unit: '1',
          timeSeries: [
            {
              ...base.timeSeries[0],
              points: base.timeSeries[0].points.slice(0, 3),
            },
          ],
          nextPageToken: 'opaque/second?token',
        }
      : {
          unit: '1',
          timeSeries: [
            {
              ...base.timeSeries[0],
              points: base.timeSeries[0].points.slice(3),
            },
          ],
        };
  const result = await h.collector(h.state.input);
  assert.equal(result.available, true);
  assert.equal(result.requests, 20);
  assert.equal(result.pages, 2);
  assert.equal(h.state.tokenCalls, 2);
  assert.ok(
    h.state.calls.every(
      (call) =>
        new URL(call.url).origin === 'https://monitoring.googleapis.com',
    ),
  );
  assert.equal(
    new URL(h.state.calls[1].url).searchParams.get('pageToken'),
    'opaque/second?token',
  );
});

test('aggregated gauge points and empty dropped labels preserve the same counts', async () => {
  const h = metricsFixture();
  h.state.mutation = (page) => {
    const series = page.timeSeries[0];
    series.metricKind = 'GAUGE';
    series.metric.labels.route = '';
    series.resource.labels.revision_name = '';
    for (const point of series.points) delete point.interval.startTime;
  };
  const result = await h.collector(h.state.input);
  assert.equal(result.available, true);
  assert.equal(result.requests, 20);
});

for (const [name, mutation] of [
  [
    'partial execution',
    (p) => {
      p.executionErrors = [
        { code: 13, message: 'private-provider-diagnostic' },
      ];
    },
  ],
  [
    'unreachable region',
    (p) => {
      p.unreachable = ['private-provider-diagnostic'];
    },
  ],
  [
    'missing minute',
    (p) => {
      p.timeSeries[0].points.pop();
    },
  ],
  [
    'empty result',
    (p) => {
      p.timeSeries = [];
    },
  ],
  [
    'other project',
    (p) => {
      p.timeSeries[0].resource.labels.project_id = 'foreign-project';
    },
  ],
  [
    'other service',
    (p) => {
      p.timeSeries[0].resource.labels.service_name = 'other-api';
    },
  ],
  [
    'other region',
    (p) => {
      p.timeSeries[0].resource.labels.location = 'us-central1';
    },
  ],
  [
    'unreduced revision',
    (p) => {
      p.timeSeries[0].resource.labels.revision_name = 'unreduced-revision';
    },
  ],
  [
    'other metric',
    (p) => {
      p.timeSeries[0].metric.type =
        'serviceruntime.googleapis.com/api/request_count';
    },
  ],
  [
    'rate values',
    (p) => {
      p.timeSeries[0].valueType = 'DOUBLE';
    },
  ],
  [
    'cumulative values',
    (p) => {
      p.timeSeries[0].metricKind = 'CUMULATIVE';
    },
  ],
  [
    'malformed code class',
    (p) => {
      p.timeSeries[0].metric.labels.response_code_class = '500';
    },
  ],
  [
    'wrong unit',
    (p) => {
      p.unit = 'ms';
    },
  ],
  [
    'negative count',
    (p) => {
      p.timeSeries[0].points[0].value.int64Value = '-1';
    },
  ],
  [
    'unsafe integer',
    (p) => {
      p.timeSeries[0].points[0].value.int64Value = '9007199254740992';
    },
  ],
  [
    'leading zero',
    (p) => {
      p.timeSeries[0].points[0].value.int64Value = '04';
    },
  ],
  [
    'floating count',
    (p) => {
      p.timeSeries[0].points[0].value = { doubleValue: 4 };
    },
  ],
  [
    'overlapping interval',
    (p) => {
      p.timeSeries[0].points[0].interval.startTime =
        p.timeSeries[0].points[0].interval.endTime;
    },
  ],
  [
    'duplicate point',
    (p) => {
      p.timeSeries[0].points[1] = p.timeSeries[0].points[0];
    },
  ],
  [
    'duplicate class',
    (p) => {
      p.timeSeries.push(p.timeSeries[0]);
    },
  ],
])
  test(
    name + ' remains unavailable and cannot become a zero-error sample',
    async () => {
      const h = metricsFixture();
      h.state.mutation = mutation;
      const result = await h.collector(h.state.input);
      assert.equal(result.available, false);
      assert.equal(result.pending, false);
      assert.equal(result.requests, undefined);
      assert.equal(
        assessServiceMetrics(result, h.state.input).state,
        'unavailable',
      );
      assert.ok(
        !JSON.stringify(result).includes('private-provider-diagnostic'),
      );
    },
  );

test('overflow across individually safe counts and duplicate pages fail closed', async () => {
  const h = metricsFixture();
  h.state.mutation = (p) => {
    for (const point of p.timeSeries[0].points)
      point.value.int64Value = '9007199254740991';
  };
  assert.equal(
    (await h.collector(h.state.input)).reason,
    'METRICS_COUNT_INVALID',
  );
  h.state.mutation = null;
  h.state.pages = () => ({ ...h.page(), nextPageToken: 'same-token' });
  const result = await h.collector(h.state.input);
  assert.equal(result.available, false);
  assert.equal(result.requests, undefined);
  assert.ok(h.state.calls.length <= 3);
});

test('transport, malformed JSON, duplicate keys and response limits never expose diagnostics', async () => {
  const h = metricsFixture();
  const bodies = [
    () => {
      throw new RolloutError('private-token-diagnostic');
    },
    () => {
      throw new Error('private-token-diagnostic');
    },
    () => new Response('private-token-diagnostic', { status: 403 }),
    () =>
      new Response('{"timeSeries":[],"timeSeries":[]}', {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(Buffer.from([0xc3, 0x28]), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(' '.repeat(131073), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://foreign.example.test' },
      }),
  ];
  for (const response of bodies) {
    const collector = createCloudRunMetricsCollector({
      getAccessToken: h.getAccessToken,
      fetchImpl: async () => response(),
      clock: () => h.state.input.now,
    });
    const result = await collector(h.state.input);
    assert.equal(result.available, false);
    assert.ok(!JSON.stringify(result).includes('private-token-diagnostic'));
    assert.equal(result.requests, undefined);
  }
});

test('a stalled token broker is bounded before the provider request starts', async () => {
  const h = metricsFixture();
  const keepAlive = setInterval(() => {}, 1000);
  let calls = 0;
  try {
    const collector = createCloudRunMetricsCollector({
      getAccessToken: () => new Promise(() => {}),
      fetchImpl: async () => {
        calls++;
        return h.transport();
      },
      clock: () => h.state.input.now,
    });
    const started = Date.now();
    const result = await collector(h.state.input);
    assert.equal(result.available, false);
    assert.equal(result.reason, 'METRICS_REQUEST_TIMEOUT');
    assert.equal(calls, 0);
    assert.ok(Date.now() - started < 8000);
  } finally {
    clearInterval(keepAlive);
  }
});

test('a stalled provider body is canceled within the request deadline', async () => {
  const h = metricsFixture();
  let canceled = false;
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const collector = createCloudRunMetricsCollector({
      getAccessToken: h.getAccessToken,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              canceled = true;
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      clock: () => h.state.input.now,
    });
    const began = Date.now();
    const result = await collector(h.state.input);
    assert.equal(result.reason, 'METRICS_REQUEST_TIMEOUT');
    assert.equal(result.available, false);
    assert.equal(canceled, true);
    assert.ok(Date.now() - began < 8000);
  } finally {
    clearInterval(keepAlive);
  }
});

test('pagination loops and page limits cannot return partial counts', async () => {
  for (const repeating of [true, false]) {
    const h = metricsFixture();
    let page = 0;
    h.state.pages = () => ({
      unit: '1',
      timeSeries: [],
      nextPageToken: repeating ? 'same-token' : 'page-' + ++page,
    });
    const result = await h.collector(h.state.input);
    assert.equal(result.available, false);
    assert.equal(result.requests, undefined);
    assert.equal(
      result.reason,
      repeating ? 'METRICS_PAGE_TOKEN_INVALID' : 'METRICS_PAGE_LIMIT',
    );
    assert.ok(h.state.calls.length <= 4);
  }
});

test('service recreation history and a mismatched collection clock are not usable metrics', async () => {
  const h = metricsFixture();
  const policy = serviceMetricsWindow(
    h.state.input.record.observationStartedAt,
    h.state.input.now,
  );
  h.state.input.now = policy.readyAt;
  h.state.input.record.serviceCreatedAt =
    h.state.input.record.observationStartedAt - 1000;
  assert.equal(
    (await h.collector(h.state.input)).reason,
    'METRICS_RESOURCE_TOO_NEW',
  );
  assert.equal(h.state.tokenCalls, 0);
  const badClock = createCloudRunMetricsCollector({
    getAccessToken: h.getAccessToken,
    fetchImpl: h.transport,
    clock: () => h.state.input.now + 20001,
  });
  assert.equal(
    (await badClock(h.state.input)).reason,
    'METRICS_CLOCK_MISMATCH',
  );
  assert.equal(h.state.calls.length, 0);
});

test('sample binding, maturity and exact threshold arithmetic resist replay and rounding', () => {
  const h = metricsFixture();
  const good = metricSample(h.state.input, { requests: 20, serverErrors: 1 });
  assert.equal(assessServiceMetrics(good, h.state.input).highErrors, false);
  const high = metricSample(h.state.input, { requests: 20, serverErrors: 2 });
  assert.equal(assessServiceMetrics(high, h.state.input).highErrors, true);
  const large = metricSample(h.state.input, {
    requests: Number.MAX_SAFE_INTEGER,
    serverErrors: 450359962737049,
  });
  assert.equal(assessServiceMetrics(large, h.state.input).highErrors, false);
  const above = metricSample(h.state.input, {
    requests: Number.MAX_SAFE_INTEGER,
    serverErrors: 450359962737050,
  });
  assert.equal(assessServiceMetrics(above, h.state.input).highErrors, true);
  for (const patch of [
    { projectId: 'foreign-project' },
    { serviceUid: 'unrelated-uid' },
    { requestDigest: '0'.repeat(64) },
    { windowEnd: h.state.input.now },
    { requestedAt: h.state.input.now - 20001 },
    { pending: true },
  ])
    assert.equal(
      assessServiceMetrics({ ...good, ...patch }, h.state.input).state,
      'unavailable',
    );
});
