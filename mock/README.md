# Stateful contract mock

This separate development server implements the authored 52-operation catalog with in-memory state. JSON requests/responses are checked against the same OpenAPI document used by the contract tests. It does not establish SQL transaction correctness, real identity verification, Cloud Storage behavior or production readiness.

With Node 24.22.1 and the root dependencies installed:

```powershell
npm run mock
```

That one task installs the isolated, locked Prism toolchain when needed, starts Fastify on loopback port 4020, then starts the Prism response-validation proxy on client-facing port 4010. Fastify validates requests and returns canonical errors; Prism rejects invalid upstream responses. This preserves the eight-field envelope for negative request cases. Ctrl+C stops both processes. `MOCK_PORT` and `MOCK_SCENARIO_PORT` allow isolated concurrent instances.

To use the pinned Docker runtime:

```powershell
node scripts/dev/stack.mjs create foundation
node scripts/dev/stack.mjs mock foundation
```

The optional Compose service reuses the backend development image, starts no database/auth dependencies, receives no SQL credentials, and publishes only `127.0.0.1:4010`. Its synthetic state resets whenever its process restarts. Set `MOCK_PORT` in the ignored stack `.env` to choose another host port. Stop just this service with `docker compose --env-file PATH_TO_STACK_ENV stop mock`. The scenario-control port is not published.

`npm run mock:smoke` temporarily starts both processes, checks actual JSON/error/editorial/binary traffic through Prism, and stops both. `npm run test:mock` runs isolated scenarios with a fixed clock and deterministic resource IDs, including a real connection closed after commit and recovery of the single original result. Every operation must execute a schema-valid success; that coverage check supplements workflow/error scenarios.

## Fixture identities

Send `Authorization: Bearer TOKEN` with the five required client metadata headers.

| Token               | Initial state                                                 |
| ------------------- | ------------------------------------------------------------- |
| `mock-author`       | Active author; owns the seeded published article              |
| `mock-other-author` | A different active author                                     |
| `mock-editor`       | Active editor                                                 |
| `mock-admin`        | Active admin                                                  |
| `mock-uninvited`    | Verified `invited@example.test`, initially without membership |
| `mock-expired`      | Expired credential error                                      |

Current membership controls roles/active status, including before replay. Fixture credentials never authenticate to the real API. Session exchange treats a normal fixture token as fresh sign-in; `mock-stale-author` represents authentication too old for exchange. Mock sessions expire after five days. `MOCK_WEB_ORIGIN`, default `http://localhost:3000`, controls invitation links; Compose uses the stack's reserved web origin.

The initial published fixture has a private stored pixel. New drafts use immutable revisions; public reads keep the published snapshot until another reviewed revision is published. Staging an upload changes no post version. The mock models ownership, media references/expiry/withdrawal, review targets, slug history, trash/restore, profiles, roles and invitations.

## Local controls

Only the separate Fastify server exposes these loopback-only endpoints. They are absent from the Nest application and final runtime image. Fixed-clock tests reset to their initial instant; human instances use wall-clock time plus advances, with fixture dates relative to reset.

| Endpoint             | JSON body                                                                                  | Effect                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `POST /__mock/reset` | `{}` or no body                                                                            | Fresh state, clock, IDs and faults                        |
| `POST /__mock/clock` | `{"milliseconds":86400000}`                                                                | Advance time, at most one year per call                   |
| `POST /__mock/fault` | `{"operationId":"createPost","mode":"drop-after-commit"}`                                  | Commit, record result, then close the response socket     |
| Same                 | `{"operationId":"createPost","mode":"in-progress"}`                                        | A 30-second lease; 409 with Retry-After                   |
| Same                 | `{"operationId":"savePostDraft","mode":"latency","milliseconds":100}`                      | Delay once, then recheck authorization; at most 2 seconds |
| Same                 | `{"operationId":"getMe","mode":"network"}`                                                 | Close before domain work                                  |
| Same                 | `{"operationId":"createPost","mode":"error","status":503,"code":"DEPENDENCY_UNAVAILABLE"}` | Safe canonical error before domain work                   |

For Docker, reset by restarting the mock service or sending a loopback request inside its container. Keep invitation URLs and session cookies out of shared logs/issues.

## Limits and remaining gates

Single-threaded mock mutations do not prove SQL locking/races. Search uses representative published-only token matching rather than PostgreSQL English stemming/ranking. Binary variants use the real shared Sharp normalizer; storage is in memory. SQL services, real authentication, private storage adapters, search and maintenance remain backend work.

The contract remains an unreleased draft. Generated Kotlin compilation and defensive decoding are verified in the standalone JVM consumer. The independent [conformance harness](../test/conformance/README.md) checks every observed mock application response and includes legacy-shaped save/retry regressions. Complete real-backend scenario adapters, remaining semantic/client checks, checksummed package assets and owner review remain required before freeze.
