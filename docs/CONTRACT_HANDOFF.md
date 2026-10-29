# Contract 1.0.0 handoff

The technical handoff is a reproducible, unreleased review candidate. The API design and canonical OpenAPI bytes are unchanged. Owner review and explicit immutable publication precede contract freeze; cloud and client application-release acceptance remain separate.

## Build and verify

```powershell
npm run contract:build -- --check
npm run contract:typescript -- --check
npm run contract:kotlin -- --check
npm run contract:kotlin:test
npm run contract:compatibility:test
npm run contract:conformance:full -- --build --copy-reports
npm run contract:package
npm run contract:package -- --check
npm run contract:package:verify -- .local/contracts/blogpost-api-contract-1.0.0/blogpost-api-contract-1.0.0.tar.gz
```

The output directory contains the versioned tar.gz, external archive `SHA256SUMS` and `PACKAGE-MANIFEST.json`. The archive has normalized member ordering, permissions, timestamps and gzip metadata. It contains 377 source/fixture/toolchain files, including its own manifest and per-file checksums, without dependencies, caches, environment files or credentials. Its `HANDOFF.md` lists supported extracted-package commands and prerequisites. The root dependency lockfile is preserved; a consumer can install it independently with `npm ci --ignore-scripts`. Verify the archive before extraction and retain the reviewed archive checksum when pinning it in a client repository. Checksums establish integrity, not publisher identity.

File verification checks the external archive checksum first, then validates a single bounded gzip stream, its CRC/size trailer, canonical tar structure and all internal checksums. It accepts another valid deflate representation without re-compressing it. The build-time `--check` command separately requires byte-for-byte reproducibility from the pinned tooling. Local generation/verification does not distribute the archive; CI artifact distribution and an explicitly approved immutable publication remain follow-up actions.

## Evidence and scope

The isolated full report is `.local/conformance/backend-full.json`. Acceptance requires observed successes for all 52 application operations, both health probes, metadata rejection on every application operation, anonymous denial on all 42 protected operations, binary and idempotent-replay observations, and all 38 applicable backend error families. Every suite must bind the same invocation, disposable identity project and canonical contract checksum. Missing, stale, malformed or incomplete observations fail. The remaining two declared error families have explicit scope explanations in the report: browser CSRF is enforced by the Web BFF, and the initial v1 major has not been retired. Error fixtures for all 40 families remain schema-checked.

Identity evidence uses Authentication Emulator tokens, real SDK verification, actual isolated PostgreSQL and filesystem media. The 500/504 boundary cases inject dependency failures and are labeled as such. This does not prove Google/GCS IAM, real cloud failures, browser sessions/CSRF, Android module/shrinker behavior or cross-client release journeys. The remote read-only probe remains intentionally incomplete and never turns fixture JSON into remote mutation authority.

Compatibility verification includes structural oasdiff regressions and explicit default/text/counting/encoding rules, plus the legacy-shaped mock save/retry cases and defensive Kotlin consumer. There is no historical published contract or client baseline; synthetic compatibility regressions are not presented as a historical release rehearsal.

For product review, use the [wire plan](../contracts/CONTRACT.md), [operation inventory](../contracts/operation-inventory.json), [named request/response fixtures](../contracts/fixtures/operations/createPost.request.json) and [mock scenarios](../mock/README.md). Review permissions, draft/review/publish/withdraw behavior, conflict/retry recovery and public/private fields against the approved baseline. The handoff itself grants no deployment or publication permission.
