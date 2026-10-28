# Read-only backend rollout probes

`createReadOnlyRolloutProbe` in `scripts/deploy/rollout-probe.mjs` supplies the HTTP probe adapter for the [Cloud Run rollout executor](CLOUD_RUN_ROLLOUT.md). It makes bounded GET requests only. No workflow or operational CLI invokes it yet; cloud delivery remains closed. It does not create fixtures, authenticate a staff member, send a cloud access token, mutate data or attest a container image.

## Expected inputs

The adapter receives the executor's phase, reviewed origin, request/record and explicit expected serving artifacts. Candidate, convergence and observation phases accept only the candidate artifact. Rollback/recovery accepts only revisions in the original request's previous-artifact inventory. Every artifact must have a valid cloud build/target, the same environment/profile/project/region, and a contract document whose exact SHA-256 agrees with its provenance. The trusted delivery caller must independently authenticate the source, image and contract bytes; an HTTP response or supplied JSON cannot establish those facts.

The default document is the checked-in canonical contract. Additional explicitly supplied contract byte buffers support previous artifacts with different pinned contracts. Each selected contract must contain all required read operations. Contract examples do not define deployment policy: a source release can change a client recommendation or lifecycle declaration without changing the wire contract checksum.

Before HTTP collection, the default metadata reader loads the artifact's exact immutable Git blobs and recomputes its source/runtime input manifests. Both digests, package version and canonical contract checksum must match the expected provenance. It interprets only JSON literals, the explicit `API_LIMITS` constant and `CONTRACT_VERSION` in the committed metadata controller/envelope. It executes no source module, constructor, decorator, getter or arbitrary expression. Unknown/dynamic expressions fail and require an explicit reader update. Working-tree edits cannot change an accepted policy. Git reads have five-second subprocess bounds and policies are cached per exact artifact. Source provenance/image authenticity still requires the trusted caller; this local reader does not establish owner approval or provider attestation.

The probe compares the complete advertised capability, limit, client-policy and lifecycle projection with that source-bound policy, then binds build SHA, deployment environment/revision, runtime input digest and normalized configuration digest to an expected artifact. An explicitly injected policy reader is labeled `injected-policy`; the default is `immutable-git-inputs`. Neither label authenticates a serialized result. Missing/mismatched source or policy fails before HTTP collection; no contract-example or working-file fallback is selected.

The wire checker is shared with `test/conformance/verify.ts`. It independently checks the selected OpenAPI schema, documented status/content type/headers, duplicate JSON keys, strict UTF-8, envelope/status/trace/contract agreement, producer fields and private fields in public projections. It does not import Nest serializers or route handlers. The test facade keeps its existing 52-operation coverage accounting; this narrow rollout round cannot claim full application conformance or client/provider journeys.

## A complete round

Metadata is checked first. Three bounded workers then collect the remaining fixed reads. All eight checks must pass:

| Check                                            | Required result                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `/v1/meta`                                       | HTTP 200, full wire conformance and exact expected build/revision/configuration/capability projection              |
| `/health/live`                                   | HTTP 200 and the plain declared `{status:"ok"}` health response                                                    |
| `/health/ready`                                  | The same healthy response; SQL readiness failure fails the round                                                   |
| `/v1/public/posts?pageSize=1`                    | Valid public projection and matching bounded page size; empty is valid                                             |
| `/v1/public/search?q=blogpost&page=1&pageSize=1` | Valid public search and matching page/page size; empty is valid                                                    |
| `/v1/public/posts/by-slug/SAFE_SLUG`             | Valid canonical/redirect JSON with coherent slug/path/post, or `RESOURCE_NOT_FOUND` for the generated unknown slug |
| `/v1/me` without credentials                     | HTTP 401 with `AUTHENTICATION_REQUIRED` and a valid error envelope                                                 |
| `/v1/posts` without credentials                  | The same denial for the workspace list                                                                             |

Optional reviewed fixtures add a known public slug, a public image and a withdrawn image path. Fixture paths are restricted to the public media GET route with UUID-v4 post/media IDs and one of the three named variants. Public image fixtures require exact MIME, byte size and SHA-256 in addition to wire/binary validation. Withdrawn media must return a valid 404 `RESOURCE_NOT_FOUND`; a returned image fails. No arbitrary URL, credential, header or mutation can be supplied through fixture configuration. Missing image fixtures are recorded as skipped and do not count as verified media authorization.

Every request sends all five required metadata headers. One random device ID is reused for the adapter's lifetime and omitted from receipts. Requests use no authorization/cookie/debug/mock/fixture header, no redirect following and no browser credential store. Candidate HTTPS origins must have the exact provider tag/service prefix under `run.app`; all other phases require the reviewed baked stable API origin. Public returned paths or URLs are not followed automatically.

Responses must be `no-store`, `nosniff` and `no-referrer`, with no `Set-Cookie`. Staging must also advertise `noindex, nofollow, noarchive`. The adapter caps metadata at 64 KiB, other JSON at 1 MiB and a known image at its reviewed bounded byte size. It checks declared lengths and streamed bytes. After immutable-source resolution, each HTTP request has a five-second deadline and the HTTP collection phase twenty-five seconds; failures cancel remaining work and response streams. Cold-start failures can be retried only by the executor's bounded startup procedure.

## Results and operational limits

The returned `ok` result contains only phase, safe check names, time/duration, observed source/revision and contract checksum. Failures contain a stable rule and completed check names, never bodies, HTTP headers, image bytes, cookies, tokens or transport diagnostics. Default transport is labeled `live-http`; injected transport remains explicitly `injected-transport`. Neither label turns a serialized result into authenticated release evidence. Archive authenticity, freshness and workflow-attempt binding remain the future trusted collector's responsibility.

The executor now schedules observation starts on thirty-second slots instead of adding thirty seconds after each completed round. Missed slots make observation incomplete and retain traffic for operator assessment; they cannot be hidden as a successful shorter sample or converted into an automatic rollback. Two confirmed failed rounds and the separate 5xx threshold retain their defined guarded rollback behavior.

Tests use synthetic cloud identities/responses, real disposable Git histories, a real disposable loopback TCP server, bounded stalled streams, virtual rollout clocks and the shared wire checker. They prove source fingerprint drift is rejected, working-tree edits are ignored, and a changed client recommendation can pass against the unchanged canonical contract when the immutable source declares it. They connect the HTTP adapter to both successful observation and failed-observation rollback. Historical-contract tests use synthetic older bytes and are not evidence of a supported released predecessor. Actual Cloud Run/Google/GCS, effective IAM, real client journeys, Cloud Monitoring collection, authenticated durable recovery transfer and owner acceptance remain open. No cloud API, budget, recipient or paid resource is configured by this implementation.
