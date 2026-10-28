# Cloud Run rollout request metrics

`createCloudRunMetricsCollector` in `scripts/deploy/rollout-metrics.mjs` implements the metrics callback for the [API rollout executor](CLOUD_RUN_ROLLOUT.md). Tests connect the actual collector and executor using synthetic Google transport and virtual clocks. No actual Cloud Monitoring request or provider rehearsal has been performed. No workflow invokes the executor; delivery stays closed.

## Scope and counts

The collector accepts only the reviewed staging or production API artifact and its request-bound observation record. It fixes the Google Monitoring host, project, Jakarta region, `blogpost-api` service and `cloud_run_revision` resource type. A read uses `run.googleapis.com/request_count`, sixty-second `ALIGN_SUM` and `REDUCE_SUM`, grouped by project, location, service and response-code class. Counts cover the whole service across revisions. Every returned response class contributes to the denominator; `5xx` contributes to the numerator. There is no rate conversion or candidate-only denominator.

The executor validates five ordered minute buckets, integer totals, exact window bounds, request digest, observation start, project/service identity and collection freshness. It compares the threshold with integer arithmetic: at least twenty requests and strictly more than 5% server errors. Exactly 5% does not trigger automatic rollback. Counts and validated bucket fields are journaled before a threshold rollback; callback extras and provider diagnostics are omitted.

Google's [Cloud Run metric definition](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z#run) describes minute sampling and up to two minutes of visibility delay. The metric counts completed requests that reach a container; it excludes some platform failures. Read-only HTTP probes therefore remain necessary.

## Mature windows and observation

The policy selects a conservative three-minute publication lag and rounds down to a complete minute. This is a local policy derived from Google's sampling/visibility description, not a provider availability guarantee. A five-minute window is pending until it can include the start of observation. Pending warmup makes no credential or provider request and cannot masquerade as available counts.

After fifteen minutes of observation, the executor may continue for up to four additional minutes of scheduled starts while the final minute becomes visible. It keeps the thirty-second HTTP probe cadence and live service guards active. Success requires contiguous mature windows covering the entire fifteen minutes, including the rounded boundary minutes. A failure first reported in the final minute can still trigger the defined guarded rollback. Reserve job time beyond the last scheduled start for bounded in-flight reads, persistence and recovery; nineteen minutes is not a total job deadline.

Each minute must have an explicit provider point from at least one response class. A missing `5xx` class contributes zero only when other reported data covers every minute. An explicit zero point is accepted; an absent minute, empty result, partial provider response, failed read, stale sample, malformed count or coverage gap makes metrics unavailable. The implementation does not establish that all provider telemetry has arrived merely because the response is structurally complete.

Unavailable metrics after warmup, missed probe slots or an unconfirmed final failed probe produce `observation_incomplete` and retain current traffic for operator assessment. They cannot become successful zero-error evidence or be converted into automatic rollback by calling independent recovery. Two consecutive failing HTTP rounds and the confirmed 5xx threshold retain their guarded rollback behavior throughout the final metrics wait.

Monitoring does not expose the Cloud Run service UID as a metric label. The executor pins and rechecks the live service UID and creation time, and the collector rejects any window predating that creation time. This prevents mixing a newly recreated service with earlier same-name history. A newly created service without enough eligible history cannot complete this observation.

## Transport and trust boundary

The adapter uses only the [time-series list API](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list). It obtains a short-lived token separately for each page, forbids redirects/cookies and bounds each token/request/body read to five seconds and the entire collection to twenty seconds. Pages are limited to four, each at most 128 KiB. Opaque pagination tokens are encoded only as query values; repeated tokens, duplicate points, excessive pages and partial execution errors fail collection.

The deadline stops waiting even when an injected transport or stream cancellation hook does not settle. Cleanup is requested without awaiting that hook, so a noncooperative implementation may continue work in the background; the caller does not treat it as a successful result.

Strict UTF-8/JSON parsing rejects duplicate keys and excessive nesting. Returned series must match the exact scope and reduced labels, contain integer `DELTA` or aligned `GAUGE` counts and use the expected minute intervals. Rate, floating-point, cumulative, overflowed and out-of-window data are rejected. Response bodies, tokens, pagination values and transport/provider diagnostics are excluded from results and journal records.

Default transport is labeled `live-api`; injected transport and clocks are identified explicitly. These labels and identity fields are consistency checks, not authentication. The future trusted workflow must select the real adapter, establish effective read permissions and archive fresh attempt-bound evidence with independently verified source/image/database preconditions. Actual provider schema, aggregation behavior, timing and operational error paths still require a controlled rehearsal. Trusted mutation authorization, stale-deployment records, authenticated cross-runner persistence, independently timed recovery, real client journeys and owner/release acceptance remain open. This component enables no API, configures no alert/budget/recipient and creates no paid resource.
