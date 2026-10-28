import {
  metricsIdentity,
  serviceMetricsWindow,
  METRICS_MINUTE,
} from '../../scripts/deploy/metrics-policy.mjs';
import { fixture } from './fixtures.mjs';
import { createCloudRunMetricsCollector } from '../../scripts/deploy/rollout-metrics.mjs';
export function metricSample(input, overrides = {}) {
  const identity = metricsIdentity(input.request, input.record, input.now);
  const window = serviceMetricsWindow(
    input.record.observationStartedAt,
    input.now,
  );
  if (overrides.available === false)
    return {
      ...identity,
      available: false,
      pending: false,
      reason: 'METRICS_PROVIDER_UNAVAILABLE',
      ...overrides,
    };
  if (window.warming)
    return {
      ...identity,
      available: false,
      pending: true,
      reason: 'METRICS_WARMING_UP',
      readyAt: window.readyAt,
    };
  const requests = overrides.requests ?? 20;
  const serverErrors = overrides.serverErrors ?? 0;
  return {
    ...identity,
    available: true,
    pending: false,
    evidenceSource: 'injected-transport',
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    requests,
    serverErrors,
    buckets: Array.from({ length: 5 }, (_, index) => ({
      end: window.windowStart + (index + 1) * METRICS_MINUTE,
      requests: index === 0 ? requests : 0,
      serverErrors: index === 0 ? serverErrors : 0,
    })),
    ...overrides,
  };
}

export function metricsFixture(environment = 'staging') {
  const f = fixture(environment);
  const request = {
    schemaVersion: 1,
    attemptId: '12345-1',
    provenance: f.provenance,
    target: f.target,
    previous: [],
  };
  const record = {
    schemaVersion: 1,
    id: request.attemptId,
    phase: 'observing',
    projectId: f.project.projectId,
    projectNumber: f.project.projectNumber,
    serviceUid: f.resource.uid,
    serviceCreatedAt: Date.parse('2026-10-27T00:00:00Z') + 1,
    serviceName: f.resource.name,
    sourceSha: f.provenance.sourceSha,
    image: f.target.image,
    observationStartedAt: Date.parse('2026-10-28T00:00:20Z'),
  };
  const state = {
    input: { request, record, now: record.observationStartedAt + 600000 },
    calls: [],
    tokenCalls: 0,
    errors: 0,
    errorsAt: null,
    mutation: null,
    pages: null,
  };
  function page() {
    const { windowStart, windowEnd } = serviceMetricsWindow(
      state.input.record.observationStartedAt,
      state.input.now,
    );
    const labels = {
      project_id: state.input.request.provenance.configuration.projectId,
      location: state.input.request.target.region,
      service_name: state.input.request.target.resourceId,
    };
    const series = (code, counts) => ({
      metric: {
        type: 'run.googleapis.com/request_count',
        labels: { response_code_class: code },
      },
      resource: { type: 'cloud_run_revision', labels },
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      points: counts
        .map((value, index) => ({
          interval: {
            startTime: new Date(
              windowStart + index * METRICS_MINUTE,
            ).toISOString(),
            endTime: new Date(
              windowStart + (index + 1) * METRICS_MINUTE,
            ).toISOString(),
          },
          value: { int64Value: String(value) },
        }))
        .reverse(),
    });
    const successes = [4, 4, 4, 4, 4];
    const failures = [0, 0, 0, 0, 0];
    const errorIndex =
      state.errorsAt === null
        ? 0
        : (state.errorsAt - windowStart) / METRICS_MINUTE - 1;
    if (Number.isInteger(errorIndex) && errorIndex >= 0 && errorIndex < 5) {
      successes[errorIndex] -= state.errors;
      failures[errorIndex] = state.errors;
    }
    const result = {
      unit: '1',
      timeSeries: [series('2xx', successes)],
    };
    if (failures.some(Boolean)) result.timeSeries.push(series('5xx', failures));
    return result;
  }
  const transport = async (url, options) => {
    state.calls.push({ url, options });
    const token = new URL(url).searchParams.get('pageToken');
    const value = state.pages ? state.pages(token) : page();
    state.mutation?.(value);
    return new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const getAccessToken = async () => {
    state.tokenCalls++;
    return 'synthetic-token';
  };
  const collector = createCloudRunMetricsCollector({
    getAccessToken,
    fetchImpl: transport,
    clock: () => state.input.now,
  });
  return { f, state, page, transport, getAccessToken, collector };
}
