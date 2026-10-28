import { digest } from '../../src/platform/config/build-model.ts';

export const METRICS_MINUTE = 60000;
export const METRICS_WINDOW = 300000;
export const OBSERVATION_DURATION = 900000;
// Cloud Run samples every minute and documents up to two minutes of visibility
// delay. This policy adds one minute and rounds down to a complete minute.
export const METRICS_PUBLICATION_LAG = 180000;
export const METRICS_MAX_DRAIN = 240000;
export const METRICS_COLLECTION_LIMIT = 20000;
const safeTime = (value) =>
  Number.isSafeInteger(value) &&
  value > 0 &&
  value < 8640000000000000 - 3600000;

export function serviceMetricsWindow(startedAt, requestedAt) {
  if (
    !safeTime(startedAt) ||
    !safeTime(requestedAt) ||
    requestedAt < startedAt ||
    requestedAt - startedAt > OBSERVATION_DURATION + METRICS_MAX_DRAIN + 60000
  )
    throw new Error('INVALID_METRICS_CLOCK');
  const firstStart = Math.floor(startedAt / METRICS_MINUTE) * METRICS_MINUTE;
  const targetEnd =
    Math.ceil((startedAt + OBSERVATION_DURATION) / METRICS_MINUTE) *
    METRICS_MINUTE;
  const readyAt = firstStart + METRICS_WINDOW + METRICS_PUBLICATION_LAG;
  const windowEnd = Math.min(
    targetEnd,
    Math.floor((requestedAt - METRICS_PUBLICATION_LAG) / METRICS_MINUTE) *
      METRICS_MINUTE,
  );
  return {
    warming: windowEnd < firstStart + METRICS_WINDOW,
    firstStart,
    targetEnd,
    readyAt,
    windowStart: windowEnd - METRICS_WINDOW,
    windowEnd,
  };
}

export function metricsIdentity(request, record, requestedAt) {
  return {
    schemaVersion: 1,
    scope: 'cloud-run-service-request-counts',
    requestDigest: digest(request),
    serviceUid: record.serviceUid,
    serviceCreatedAt: record.serviceCreatedAt,
    projectId: record.projectId,
    region: request.target.region,
    serviceId: request.target.resourceId,
    observationStartedAt: record.observationStartedAt,
    requestedAt,
  };
}
const count = (value) => Number.isSafeInteger(value) && value >= 0;
// This is consistency/freshness validation, not provider authentication. The
// trusted caller must select the actual collector and authenticate its archive.
export function assessServiceMetrics(sample, { request, record, now }) {
  const invalid = () => ({
    state: 'unavailable',
    reason: 'METRICS_INVALID_SAMPLE',
  });
  try {
    if (
      !safeTime(now) ||
      !safeTime(record.serviceCreatedAt) ||
      record.serviceCreatedAt > record.observationStartedAt ||
      !sample ||
      typeof sample !== 'object' ||
      !safeTime(sample.requestedAt) ||
      sample.requestedAt > now ||
      now - sample.requestedAt > METRICS_COLLECTION_LIMIT
    )
      return invalid();
    const identity = metricsIdentity(request, record, sample.requestedAt);
    if (Object.entries(identity).some(([key, value]) => sample[key] !== value))
      return invalid();
    const policy = serviceMetricsWindow(
      record.observationStartedAt,
      sample.requestedAt,
    );
    if (sample.available === false) {
      if (sample.pending === true)
        return policy.warming &&
          sample.reason === 'METRICS_WARMING_UP' &&
          sample.readyAt === policy.readyAt
          ? { state: 'warming', readyAt: policy.readyAt }
          : invalid();
      return { state: 'unavailable', reason: 'METRICS_UNAVAILABLE' };
    }
    if (
      sample.available !== true ||
      policy.warming ||
      policy.windowStart < record.serviceCreatedAt ||
      sample.pending ||
      sample.windowStart !== policy.windowStart ||
      sample.windowEnd !== policy.windowEnd ||
      !Array.isArray(sample.buckets) ||
      sample.buckets.length !== 5
    )
      return invalid();
    let requests = 0n;
    let serverErrors = 0n;
    for (let index = 0; index < 5; index++) {
      const bucket = sample.buckets[index];
      if (
        !bucket ||
        bucket.end !== policy.windowStart + (index + 1) * METRICS_MINUTE ||
        !count(bucket.requests) ||
        !count(bucket.serverErrors) ||
        bucket.serverErrors > bucket.requests
      )
        return invalid();
      requests += BigInt(bucket.requests);
      serverErrors += BigInt(bucket.serverErrors);
    }
    if (
      requests > BigInt(Number.MAX_SAFE_INTEGER) ||
      serverErrors > requests ||
      !count(sample.requests) ||
      !count(sample.serverErrors) ||
      requests !== BigInt(sample.requests) ||
      serverErrors !== BigInt(sample.serverErrors)
    )
      return invalid();
    return {
      state: 'available',
      windowStart: policy.windowStart,
      windowEnd: policy.windowEnd,
      firstStart: policy.firstStart,
      targetEnd: policy.targetEnd,
      requests: sample.requests,
      serverErrors: sample.serverErrors,
      highErrors: requests >= 20n && serverErrors * 20n > requests,
    };
  } catch {
    return invalid();
  }
}
