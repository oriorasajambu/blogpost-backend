# Contract conformance checks

`verify.ts` is the test facade for the shared independent wire checker in `scripts/deploy/wire-contract.mjs`. It reads the canonical OpenAPI and operation catalog, checks documented statuses/headers and JSON schemas, enforces HTTP/body trace/status/version agreement and replay metadata, validates binary MIME/magic, rejects duplicate JSON keys and malformed UTF-8, and catches private workspace/profile/storage fields in public JSON projections. It remains independent of the mock's response validator and Nest handlers. Failures identify only an operation and rule; they do not embed response bodies or credentials. The separate [rollout probe](../../docs/ROLLOUT_PROBES.md) reuses the checker for bounded read-only delivery rounds; it does not alter this facade's full-operation coverage accounting.

Current producers must emit only declared fields at modeled object boundaries; intentional dictionary schemas remain extensible. This catches accidental extra ORM columns before delivery. It does not change the additive response policy for older consumers: a future producer declares new fields in its own versioned package, while historical clients continue to ignore unfamiliar additions.

The mock suite applies this verifier to its observed application responses, including errors and image bytes. Its coverage assertion requires a verified success for each of the 52 operations. The real Nest integration check uses actual loopback HTTP for metadata success and 400/401/422 errors. Its lazy SQL pool uses synthetic loopback settings; no saved database is needed for that check.

```powershell
npm run test:mock
npm run test:integration
npm run test:identity
```

`test:integration` also includes the existing real-PostgreSQL integration tests and needs the configured development database. To run only the read-only metadata conformance case, use `npx --no-install tsx --test test/integration/conformance.test.ts`.

## Probe a running backend

Use the API origin printed by your stack helper in place of the example port:

```powershell
npm run contract:conformance -- --base-url http://127.0.0.1:51999 --scope implemented
npm run contract:conformance -- --base-url http://127.0.0.1:51999 --scope full
```

The default scope is `full`. The read-only probe can exercise metadata, public feed, search and public taxonomy without seeding data. Forty-seven registered protected/resource operations require the disposable fixture. Implemented/full scopes therefore remain incomplete even when all five read-only cases pass. The probe uses the explicit fixture classification; anonymous resource reads are not enabled merely because they use GET. Scope acceptance and complete coverage are separate, and missing cases never count as passing.

Reports are ignored `.local/conformance/backend-{scope}.json` files containing the contract hash, target origin, observation time, served build SHA, observed operation/status results and pending operation IDs. They contain no tokens, cookies, raw requests or response bodies. The CLI caps buffered responses, rejects credential-bearing origins, prevents fixture paths from escaping the selected origin and follows no redirects.

`backend-scenarios.ts` registers scenarios separately from immutable wire assets. `npm run test:identity` creates fresh internal-only PostgreSQL/Auth Emulator instances on tmpfs, gives each job a bounded tmpfs media directory, and observes all 52 application operations. Its report binds coverage to the current canonical hash/run and passes only after seven identity, foundation, administrative, editorial, public/taxonomy, media and maintenance suites. Cases include retries/lost responses, current authorization, immutable publication, archive and migration races, weighted English search, the exact 1,000-result window, public privacy, safe availability failures and taxonomy uniqueness/versions. Media checks use actual multipart requests, Sharp and filesystem objects; cover expiry, same-key concurrency, lease takeover, uncertain storage/SQL outcomes, permission/publication changes during I/O, quotas, corruption, and private/current-public binary access. Maintenance gets a clean schema on the same verified disposable database so projection-only descriptors from earlier SQL fixtures cannot be deleted as if they were storage objects. Its real filesystem/SQL checks cover retained revisions, partial cleanup/purge, permanent slugs, quota release after deletion, job/operation locks, grace periods, retention, orphan pagination and the operator entrypoint. No saved volumes or mock credentials are used. GCS request-precondition/inventory unit tests do not establish actual bucket IAM or cloud delivery; real Google/GCS staging remains required.

Add further explicit resource fixtures as handlers are implemented. Protected or mutating operations cannot be enabled by merely sending the mock's example credentials or replaying arbitrary fixture writes against a remote database. A configured operation without an applicable real fixture adapter fails its scoped check. The authoring `x-runtime-implemented` annotation does not select execution or count as evidence.

## Semantic coverage and remaining work

The workflow suite includes legacy-shaped draft saves that omit newer optional cover/Markdown fields, preservation of stored cover presentation, stale completed replay after a newer edit, creator/clientDraftId recovery, changed-input key rejection, object-key reordering and diagnostic-metadata independence. It also covers the existing review/publication, withdrawal/media, invitation-secret, authorization-change and response-loss journeys. These are mock state-machine checks; they do not prove SQL transaction/locking behavior.

No historical contract/client release exists yet. These legacy-shaped requests exercise the agreed compatibility rules rather than claiming a rehearsal with a previously released application. Full wire-operation coverage is only one input to release readiness: real identity, SQL/editorial/media/search semantics, client/BFF behavior, provider staging, immutable packaging and owner review remain required. A green mock run or implemented-scope probe is not a complete backend conformance or release receipt.
