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

The independent [conformance harness](../test/conformance/README.md) verifies observed HTTP against the canonical package. `npm run contract:conformance:full -- --build --copy-reports` uses disposable SDK/PostgreSQL/filesystem fixtures. Its report requires verified successes for all 52 operations, per-operation metadata rejection, protected anonymous denial, replay/binary observations and critical error families from one contract-bound run. The separate remote read-only probe exercises only five public cases and remains incomplete; it never performs arbitrary writes. Local fixture completeness does not claim actual GCS/provider staging, client journeys, a historical released-client rehearsal or a completed application release.

Build the versioned handoff with `npm run contract:package`, repeat with `-- --check` to compare exact bytes, and verify with `npm run contract:package:verify -- .local/contracts/blogpost-api-contract-1.0.0/blogpost-api-contract-1.0.0.tar.gz`. The archive contains OpenAPI, examples, generated consumers, stateful mock, source/toolchain inputs, an internal file manifest and checksums; the adjacent `SHA256SUMS` pins the archive. `HANDOFF.md` inside explains extracted-package validation and supported commands. Checksums establish integrity, not publisher authenticity. The package remains an unreleased review candidate until owner review and explicit publication; no GitHub contract release has been created.

Compatibility checks protect structural rules plus defaults, custom text/counting/encoding semantics and explicit defaults for newly added optional inputs. Legacy-shaped mock saves/retries and the standalone consumer suites exercise agreed v1 behavior. No historical released baseline exists, so these checks do not claim a historical release comparison. Android module/resource/shrinker integration, Web session/CSRF behavior, real provider validation and cross-client journeys remain separate client/application-release gates.
