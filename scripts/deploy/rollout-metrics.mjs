import { cloudRunExpectations } from './cloud-run-config.mjs';
import { refuse, RolloutError } from './rollout-client.mjs';
import {
  abortable,
  cancelQuietly,
  discardResponse,
} from './transport-deadline.mjs';
import {
  serviceMetricsWindow,
  metricsIdentity,
  METRICS_MINUTE,
  METRICS_COLLECTION_LIMIT,
} from './metrics-policy.mjs';

const METRIC = 'run.googleapis.com/request_count';
const GROUPS = [
  'resource.labels.project_id',
  'resource.labels.location',
  'resource.labels.service_name',
  'metric.labels.response_code_class',
];
const MAX_PAGES = 4;
const PAGE_BYTES = 131072;
const SAFE_FAILURES = new Set([
  'METRICS_INTERVAL_INVALID',
  'METRICS_COUNT_INVALID',
  'METRICS_JSON_INVALID',
  'METRICS_TOKEN_UNAVAILABLE',
  'METRICS_PROVIDER_UNAVAILABLE',
  'METRICS_BODY_LIMIT',
  'METRICS_BODY_UNAVAILABLE',
  'METRICS_BODY_LENGTH',
  'METRICS_PARTIAL_RESPONSE',
  'METRICS_SERIES_INVALID',
  'METRICS_SERIES_DUPLICATED',
  'METRICS_POINT_INVALID',
  'METRICS_POINT_DUPLICATED_OR_OUTSIDE_WINDOW',
  'METRICS_CLOCK_MISMATCH',
  'METRICS_RESOURCE_TOO_NEW',
  'METRICS_PAGE_LIMIT',
  'METRICS_PAGE_TOKEN_INVALID',
  'METRICS_MINUTE_MISSING',
  'METRICS_REQUEST_TIMEOUT',
  'METRICS_READ_FAILED',
]);
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function sameKeys(value, keys) {
  return (
    object(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}
function groupedLabels(value, required, dropped) {
  return (
    object(value) &&
    Object.keys(value).every(
      (key) =>
        required.includes(key) || (dropped.includes(key) && value[key] === ''),
    ) &&
    required.every((key) => Object.hasOwn(value, key))
  );
}
function timestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:00(?:\.0{1,9})?Z$/.test(value)
  )
    refuse('METRICS_INTERVAL_INVALID');
  const result = Date.parse(value);
  if (
    !Number.isSafeInteger(result) ||
    result % METRICS_MINUTE ||
    new Date(result).toISOString().slice(0, 16) !== value.slice(0, 16)
  )
    refuse('METRICS_INTERVAL_INVALID');
  return result;
}
function integer(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/.test(value))
    refuse('METRICS_COUNT_INVALID');
  const result = BigInt(value);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) refuse('METRICS_COUNT_INVALID');
  return result;
}
function json(bytes) {
  let text, value;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    refuse('METRICS_JSON_INVALID');
  }
  const tokens =
    text.match(
      /"(?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g,
    ) ?? [];
  if (tokens.length > 20000) refuse('METRICS_JSON_INVALID');
  const stack = [];
  for (const token of tokens) {
    if (token === '{' || token === '[') {
      stack.push({
        object: token === '{',
        key: token === '{',
        keys: new Set(),
      });
      if (stack.length > 32) refuse('METRICS_JSON_INVALID');
    } else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && stack.at(-1)?.object) stack.at(-1).key = true;
    else if (
      token.startsWith('"') &&
      stack.at(-1)?.object &&
      stack.at(-1).key
    ) {
      const frame = stack.at(-1);
      const key = JSON.parse(token);
      if (frame.keys.has(key)) refuse('METRICS_JSON_INVALID');
      frame.keys.add(key);
      frame.key = false;
    }
  }
  if (!object(value)) refuse('METRICS_JSON_INVALID');
  return value;
}
async function read(url, getAccessToken, transport, roundSignal) {
  const signal = AbortSignal.any([roundSignal, AbortSignal.timeout(5000)]);
  const token = await abortable(getAccessToken({ signal }), signal);
  if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/=-]{1,4096}$/.test(token))
    refuse('METRICS_TOKEN_UNAVAILABLE');
  const response = await abortable(
    transport(url.href, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
      redirect: 'error',
      credentials: 'omit',
      signal,
    }),
    signal,
    discardResponse,
  );
  if (
    response.status !== 200 ||
    response.redirected ||
    (response.url && response.url !== url.href) ||
    !/^application\/json(?:\s*;|$)/i.test(
      response.headers.get('content-type') ?? '',
    )
  ) {
    discardResponse(response);
    refuse('METRICS_PROVIDER_UNAVAILABLE');
  }
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > PAGE_BYTES)
  ) {
    discardResponse(response);
    refuse('METRICS_BODY_LIMIT');
  }
  const reader = response.body?.getReader();
  if (!reader) refuse('METRICS_BODY_UNAVAILABLE');
  const abort = () => {
    cancelQuietly(reader);
  };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > PAGE_BYTES) refuse('METRICS_BODY_LIMIT');
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    signal.removeEventListener('abort', abort);
    cancelQuietly(reader);
    reader.releaseLock();
  }
  if (
    length !== null &&
    !response.headers.has('content-encoding') &&
    Number(length) !== size
  )
    refuse('METRICS_BODY_LENGTH');
  return json(Buffer.concat(chunks));
}
function inputContext(input) {
  if (!input || !object(input.request) || !object(input.record))
    refuse('METRICS_INPUT_INVALID');
  const request = structuredClone(input.request);
  const record = structuredClone(input.record);
  const { build, profile, kind } = cloudRunExpectations(
    request.provenance,
    request.target,
  );
  if (
    kind !== 'services' ||
    request.target.resourceId !== 'blogpost-api' ||
    !['observing', 'metrics_draining'].includes(record.phase) ||
    record.id !== request.attemptId ||
    record.projectId !== profile.projectId ||
    !/^[1-9][0-9]{0,18}$/.test(record.projectNumber ?? '') ||
    record.sourceSha !== build.sourceSha ||
    record.image !== request.target.image ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      record.serviceUid ?? '',
    ) ||
    ![profile.projectId, record.projectNumber].some(
      (id) =>
        record.serviceName ===
        'projects/' +
          id +
          '/locations/' +
          request.target.region +
          '/services/' +
          request.target.resourceId,
    )
  )
    refuse('METRICS_SCOPE_MISMATCH');
  const window = serviceMetricsWindow(record.observationStartedAt, input.now);
  if (
    !Number.isSafeInteger(record.serviceCreatedAt) ||
    record.serviceCreatedAt <= 0 ||
    record.serviceCreatedAt > record.observationStartedAt
  )
    refuse('METRICS_SCOPE_MISMATCH');
  return { request, record, profile, window, requestedAt: input.now };
}
function urlFor(context, token) {
  const url = new URL(
    'https://monitoring.googleapis.com/v3/projects/' +
      context.profile.projectId +
      '/timeSeries',
  );
  url.searchParams.set(
    'filter',
    [
      'metric.type="' + METRIC + '"',
      'resource.type="cloud_run_revision"',
      'resource.labels.project_id="' + context.profile.projectId + '"',
      'resource.labels.location="' + context.request.target.region + '"',
      'resource.labels.service_name="' +
        context.request.target.resourceId +
        '"',
    ].join(' AND '),
  );
  url.searchParams.set(
    'interval.startTime',
    new Date(context.window.windowStart).toISOString(),
  );
  url.searchParams.set(
    'interval.endTime',
    new Date(context.window.windowEnd).toISOString(),
  );
  url.searchParams.set('aggregation.alignmentPeriod', '60s');
  url.searchParams.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
  url.searchParams.set('aggregation.crossSeriesReducer', 'REDUCE_SUM');
  for (const group of GROUPS)
    url.searchParams.append('aggregation.groupByFields', group);
  url.searchParams.set('view', 'FULL');
  url.searchParams.set('pageSize', '100');
  if (token) url.searchParams.set('pageToken', token);
  return url;
}
function accumulate(page, context, classes, buckets) {
  if (
    Object.keys(page).some(
      (key) =>
        ![
          'timeSeries',
          'nextPageToken',
          'executionErrors',
          'unreachable',
          'unit',
        ].includes(key),
    ) ||
    (page.executionErrors !== undefined &&
      (!Array.isArray(page.executionErrors) || page.executionErrors.length)) ||
    (page.unreachable !== undefined &&
      (!Array.isArray(page.unreachable) || page.unreachable.length)) ||
    (page.unit !== undefined && page.unit !== '1') ||
    !Array.isArray(page.timeSeries) ||
    page.timeSeries.length > 5
  )
    refuse('METRICS_PARTIAL_RESPONSE');
  const seen = new Set();
  for (const series of page.timeSeries) {
    if (
      !object(series) ||
      series.metric?.type !== METRIC ||
      !groupedLabels(
        series.metric.labels,
        ['response_code_class'],
        ['response_code', 'route'],
      ) ||
      !/^[1-5]xx$/.test(series.metric.labels.response_code_class) ||
      series.resource?.type !== 'cloud_run_revision' ||
      !groupedLabels(
        series.resource.labels,
        ['project_id', 'location', 'service_name'],
        ['revision_name', 'configuration_name'],
      ) ||
      series.resource.labels.project_id !== context.profile.projectId ||
      series.resource.labels.location !== context.request.target.region ||
      series.resource.labels.service_name !==
        context.request.target.resourceId ||
      !['DELTA', 'GAUGE'].includes(series.metricKind) ||
      series.valueType !== 'INT64' ||
      (series.unit !== undefined && series.unit !== '1') ||
      !Array.isArray(series.points) ||
      !series.points.length ||
      series.points.length > 5
    )
      refuse('METRICS_SERIES_INVALID');
    const code = series.metric.labels.response_code_class;
    if (seen.has(code)) refuse('METRICS_SERIES_DUPLICATED');
    seen.add(code);
    const identity = series.metricKind;
    if (classes.has(code) && classes.get(code).kind !== identity)
      refuse('METRICS_SERIES_INVALID');
    if (!classes.has(code))
      classes.set(code, { kind: identity, ends: new Set() });
    let previous = Infinity;
    for (const point of series.points) {
      if (!object(point.interval) || !sameKeys(point.value, ['int64Value']))
        refuse('METRICS_POINT_INVALID');
      const end = timestamp(point.interval.endTime);
      if (
        end >= previous ||
        end <= context.window.windowStart ||
        end > context.window.windowEnd ||
        classes.get(code).ends.has(end)
      )
        refuse('METRICS_POINT_DUPLICATED_OR_OUTSIDE_WINDOW');
      const start = point.interval.startTime;
      if (
        series.metricKind === 'DELTA'
          ? timestamp(start) !== end - METRICS_MINUTE
          : start !== undefined && timestamp(start) !== end
      )
        refuse('METRICS_INTERVAL_INVALID');
      previous = end;
      classes.get(code).ends.add(end);
      const value = integer(point.value.int64Value);
      const bucket = buckets.get(end);
      if (!bucket) refuse('METRICS_INTERVAL_INVALID');
      bucket.present = true;
      bucket.requests += value;
      if (code === '5xx') bucket.serverErrors += value;
    }
  }
}

// No monitoring write, API enablement, alert, billing or arbitrary URL method.
// The executor independently rechecks the current Cloud Run UID/configuration.
export function createCloudRunMetricsCollector({
  getAccessToken,
  fetchImpl = fetch,
  clock = Date.now,
} = {}) {
  if (
    typeof getAccessToken !== 'function' ||
    typeof fetchImpl !== 'function' ||
    typeof clock !== 'function'
  )
    refuse('METRICS_ADAPTERS_REQUIRED');
  return async (input) => {
    const context = inputContext(input);
    const identity = metricsIdentity(
      context.request,
      context.record,
      context.requestedAt,
    );
    const evidenceSource =
      fetchImpl === fetch ? 'live-api' : 'injected-transport';
    const common = {
      ...identity,
      evidenceSource,
      clockSource: clock === Date.now ? 'wall-clock' : 'injected-clock',
    };
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(METRICS_COLLECTION_LIMIT),
    ]);
    try {
      const began = clock();
      if (
        !Number.isSafeInteger(began) ||
        began < context.requestedAt ||
        began - context.requestedAt > METRICS_COLLECTION_LIMIT
      )
        refuse('METRICS_CLOCK_MISMATCH');
      if (context.window.warming)
        return {
          ...common,
          available: false,
          pending: true,
          reason: 'METRICS_WARMING_UP',
          readyAt: context.window.readyAt,
        };
      if (context.window.windowStart < context.record.serviceCreatedAt)
        refuse('METRICS_RESOURCE_TOO_NEW');
      const classes = new Map();
      const buckets = new Map(
        Array.from({ length: 5 }, (_, index) => [
          context.window.windowStart + (index + 1) * METRICS_MINUTE,
          { present: false, requests: 0n, serverErrors: 0n },
        ]),
      );
      const tokens = new Set();
      let token;
      let pages = 0;
      do {
        if (++pages > MAX_PAGES) refuse('METRICS_PAGE_LIMIT');
        const page = await read(
          urlFor(context, token),
          getAccessToken,
          fetchImpl,
          signal,
        );
        accumulate(page, context, classes, buckets);
        token = page.nextPageToken;
        if (
          token !== undefined &&
          (typeof token !== 'string' ||
            (token &&
              (!/^[\x21-\x7e]{1,2048}$/.test(token) || tokens.has(token))))
        )
          refuse('METRICS_PAGE_TOKEN_INVALID');
        if (token) tokens.add(token);
      } while (token);
      signal.throwIfAborted();
      const completedAt = clock();
      if (
        !Number.isSafeInteger(completedAt) ||
        completedAt < context.requestedAt ||
        completedAt - context.requestedAt > METRICS_COLLECTION_LIMIT
      )
        refuse('METRICS_CLOCK_MISMATCH');
      let requests = 0n,
        serverErrors = 0n;
      const result = [];
      for (const [end, bucket] of buckets) {
        if (!bucket.present) refuse('METRICS_MINUTE_MISSING');
        requests += bucket.requests;
        serverErrors += bucket.serverErrors;
        if (requests > BigInt(Number.MAX_SAFE_INTEGER))
          refuse('METRICS_COUNT_INVALID');
        result.push({
          end,
          requests: Number(bucket.requests),
          serverErrors: Number(bucket.serverErrors),
        });
      }
      return {
        ...common,
        available: true,
        pending: false,
        windowStart: context.window.windowStart,
        windowEnd: context.window.windowEnd,
        requests: Number(requests),
        serverErrors: Number(serverErrors),
        buckets: result,
        pages,
      };
    } catch (error) {
      return {
        ...common,
        available: false,
        pending: false,
        reason:
          error instanceof RolloutError && SAFE_FAILURES.has(error.code)
            ? error.code
            : signal.aborted ||
                ['TimeoutError', 'AbortError'].includes(error?.name)
              ? 'METRICS_REQUEST_TIMEOUT'
              : 'METRICS_READ_FAILED',
      };
    } finally {
      controller.abort();
    }
  };
}
