# Contract authoring status

`openapi-v1.json` and `openapi-v1.yaml` describe all 52 application operations plus infrastructure probes from the approved [wire baseline](CONTRACT.md). They remain an **unreleased draft**. `1.0.0` is the intended contract release version. Schema coverage does not imply backend implementation or frontend-kickoff readiness; each operation explicitly records `x-runtime-implemented`.

The design-first source is in `src/`, independent of Nest controllers. Generated request/response fixtures live in `fixtures/operations/`; every error family has shared examples. Markdown fixtures include supported constructs, literal HTML-like text, unsafe links/images, explicit decorative images and Unicode/UTF-8 counting. The backend pure validators consume these fixtures.

```powershell
npm run contract:build
npm run contract:typescript
npm run contract:kotlin
npm run contract:kotlin:test
npm run contract:compatibility:test
npm run contract:manifest
```

Append `-- --check` to the build/typescript/kotlin commands to verify reproducibility without rewriting files. The checked-in TypeScript consumer exercises generated create/read/conflict DTOs and required versus optional request fields through `npm run typecheck`. The [Kotlin consumer](consumers/kotlin/README.md) compiles generated Retrofit/Gson signatures and validates required fields, unknown-enum fallback, HTTP/envelope agreement, errors, request presence and recovery behavior on the approved JVM baseline, with dependency locks and strict checksum verification.

The compatibility runner uses checksum-pinned official oasdiff 1.34.1 binaries in ignored `.local/tools/`, with external references disabled. Its regressions prove unchanged/additive responses are accepted and operation/header/input-bound/response-field/enum regressions are rejected. To compare a verified historical contract, run `npm run contract:compatibility -- --base PATH`. No published baseline exists yet; the compatibility report explicitly records that absence rather than claiming a pass. Structural comparison still requires semantic review and old-client replay checks.

The separate [stateful mock](../mock/README.md) implements all 52 operations with shared-schema validation, workflow/recovery scenarios and a real Prism proxy smoke check. Run `npm run mock` with the pinned runtime, or use the optional Docker mock service documented there. Mock success does not establish real SQL/auth/cloud behavior.

The independent [conformance harness](../test/conformance/README.md) verifies observed HTTP against the canonical package. The isolated SDK/PostgreSQL suites observe success for all 52 application operations, including editorial workflows, public reading/redirects/availability, English search, taxonomy administration and real filesystem media staging/delivery. The read-only probe can exercise metadata, feed, search and public taxonomy, while 47 protected/resource cases need disposable fixtures. Both live scopes remain incomplete. Operation coverage does not claim maintenance, actual GCS/provider staging, client journeys, a historical released-client rehearsal or a completed release.

Remaining frontend-kickoff gates: prepare complete real-backend conformance checks, verify semantic/old-client cases beyond the standalone consumer checks, package mock/source assets with checksums, and review the immutable package. Android module integration, resource/shrinker validation, full backend conformance and cross-client journeys are additional client/application-release gates; contract freeze does not claim that all business endpoints are implemented. Do not publish/freeze this draft or pin it into released clients before the contract gates pass. No GitHub contract release has been created.
