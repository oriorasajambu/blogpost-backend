# Cloud database execution evidence

The database evidence reader checks the actual Cloud Run job, execution, task and structured stdout record through bounded provider reads. It is implemented and tested with injected provider responses; no live GCP execution has been verified yet. Deployment and promotion remain closed while the trusted writer, actual profiles/federation, rollout and recovery path are unfinished.

## Job purposes and SQL observations

| Purpose   | Program                  | SQL credential | Record                                                                       |
| --------- | ------------------------ | -------------- | ---------------------------------------------------------------------------- |
| `migrate` | `dist/ops/migrate.js`    | Migrator       | `MIGRATIONS`: complete matching history after migration/grants               |
| `inspect` | `dist/ops/inspect-db.js` | Migrator       | `HISTORY`: read-only observation of a valid applied prefix and pending chain |
| `verify`  | `dist/ops/verify-db.js`  | Application    | `RUNTIME`: exact schema, permission baseline and actual denial probes        |

Inspection takes a shared schema lock and a repeatable-read read-only transaction. It never applies SQL or restores grants. A successful inspection can report pending migrations before backup/apply; it is an observation rather than readiness. The ready-state combiner requires no pending migrations and matching fresh runtime verification. The [database runbook](DATABASE_VERIFICATION.md) describes the underlying SQL checks and disposable baseline generator.

The generated baseline now includes the expected effective-permission digest. Runtime verification must match it, and the provider reader derives expected migration/schema/permission values from immutable Git blobs at the artifact's actual source SHA. Working files or a caller-supplied hash cannot replace those expectations. Reused docs-only artifacts keep their real build SHA; candidate equivalence is a separate staging-writer responsibility.

## Provider identity and configuration

The caller supplies an operation context captured by the trusted workflow: execution name, original job/execution UIDs, expected executor service account, phase start time and original repository/workflow run/attempt identity. Persist the provider operation handle before waiting; this reader does not create or retry executions.

Before execution, the trusted producer must set these execution-template labels from its actual run:

| Label                       | Value                                                     |
| --------------------------- | --------------------------------------------------------- |
| `blogpost-repository-id`    | Original repository's numeric ID                          |
| `blogpost-workflow-run`     | Actual GitHub run ID                                      |
| `blogpost-workflow-attempt` | Actual run attempt                                        |
| `blogpost-workflow`         | `staging` or `release`, matching the artifact environment |
| `blogpost-source-sha`       | SHA that actually built the operations image              |

Current job labels and the immutable execution's labels must agree. The executor must be the expected same-project deployment account, distinct from runtime accounts. Provider project identity, original UIDs, settled generations/etags, successful completion, one task, index zero, no retries/cancellations/failures and exit code zero are required. See Google's [execution](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions) and [task](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions.tasks) resources.

The job, captured execution template and actual task all use the shared binding checker. Image digest, purpose-specific runtime identity, command/arguments, SQL instance attachment, literal settings and numeric Secret Manager selectors must match baked expectations. Execution overrides cannot repoint those settings. The reader re-fetches the job, execution and tasks after reading logs; replacement, deletion, changed configuration or expired observations fail.

## Log and record binding

The fixed Cloud Logging query selects only this project's regional job stdout, exact execution, task index/attempt and `database_verification` JSON event within the bounded execution window. Google documents those [platform log labels](https://docs.cloud.google.com/logging/docs/api/platform-logs). Reading uses [entries.list](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list); its POST is a query, not a log write.

Exactly one complete matching record is required. Missing, duplicate, partial/paginated, wrong-resource, stderr/error, split or stale records fail. Provider timestamps accept normalized UTC seconds and three/six/nine fractional digits with calendar validation. Clock skew is limited to five minutes and records to 24 hours. Resource responses are capped at 1 MiB, the filtered log response at 256 KiB and a record at 64 KiB. Tokens go only to the fixed Google API hosts; redirects, cookies, arbitrary URLs, unbounded pagination and diagnostic-body logging are absent.

Record provenance, execution reference, workflow identity and exact migration inventory must agree. History is an ordered prefix; completed migration records have no pending work. Runtime records must match schema/permission baselines and all four denial probes. The combiner requires compatible history/runtime image, source/input/configuration/contract and workflow identities, distinct executions and runtime verification after history inspection. Connection observations are reported for the deployment resource-budget check; this reader does not prove scaling headroom by itself.

Fresh network results receive a private in-process trust binding. Editing a result or loading a serialized object cannot turn it into a fresh live result merely by declaring `evidenceSource:live-api`. Explicit offline combination stays marked as provided observations. Serialized evidence must eventually be carried by the authenticated staging artifact, not loaded as an untrusted privileged-job input.

## CLI and remaining integration

From the Git checkout, use `node scripts/ci/verify-database.mjs` with `--provenance`, `--target` and `--context` files. Select exactly one of `--access-token-file` for live reads or `--observations` for bounded offline debugging. There is no expected-SQL override and no fallback between modes. File results say `provided-json`; live results say `live-api`. Errors emit only a safe code, never provider diagnostics, token values or private input contents. Never run credential-bearing verification on work/fork PRs.

The trusted RC/main writer must still supply authenticated artifact provenance, original-run/source authorization and the correct operation context, then archive and bind the joined SQL proof to its receipt. Current promotion receipts have not yet been upgraded to carry that joined proof. Actual provider IAM/configuration, image/source attestation, backup/compatible-upgrade policy, live SQL drift invalidation, counterpart execution and rollout/recovery must be verified before enabling delivery. Read-only PR checks continue to receive no cloud credential.
