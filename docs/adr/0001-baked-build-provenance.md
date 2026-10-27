# ADR-0001: Bake source provenance and environment pairing into backend artifacts

**Status:** Proposed
**Date:** 2026-10-27
**Deciders:** Repository owner, as part of release-readiness review

## Context

The build-variant plan requires separate Development, Staging and Production artifacts, truthful source identity, conservative docs-only equivalence and immutable resource/secret-version references. Runtime environment variables cannot be the authority for their own build identity. The current repository is still an uncommitted local bootstrap; that cannot produce a cloud artifact.

## Decision

Prepare a bounded source inventory and provenance record before Docker builds. Cloud inventory reads blobs from the captured clean Git commit rather than mutable working files. Development captures working bytes and records dirty/unborn state. Materialize an immutable, content-addressed source snapshot and supply a separate Docker named context containing the provenance JSON. Copy that record into a fixed root-owned location in the final image; do not offer a runtime path override.

The versioned manifest includes unknown files by default, dependency locks, executable configuration, scripts, workflows, migrations, contract inputs and application version. Only root README and Markdown below `docs/` are approved nonexecuting exclusions. Normalize the release marker without its `publish` flag, and keep the entire marker out of the Docker source context. Keep actual commit SHA outside equivalence hashing. Preserve a source-input digest for cross-environment evidence and a separate runtime-input digest including environment/profile. Neither proves that two images have identical bytes.

Cloud profiles bind origins, project, identity issuers/audience, SQL instance/database/schema, private storage, purpose-specific service accounts and four distinct numeric secret-version references. The API and all operator entrypoints reject runtime environment, resource, account or required reference mismatches before opening dependencies. Configuration digests include normalized declarations, never plaintext secrets or hashes of secret values. Deployment tooling must independently compare declarations with the actual Cloud Run service/job specification; the application cannot attest which secret version produced a value.

Native preparation is Development-only. It rejects linked output paths and replaces metadata atomically. Local source guards prevent accidental builds; authorization continues to depend on verified identity and current SQL permissions. Cloud federation and protected workflow execution must enforce their own repository/ref/workflow identity.

## Options Considered

| Option                                        | Complexity | Cost                 | Scale                 | Familiarity        | Benefit                                            | Limitation                                                                       |
| --------------------------------------------- | ---------- | -------------------- | --------------------- | ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Runtime variables for build facts             | Low        | Low                  | Constant              | Existing setup     | Easy startup                                       | Facts can be rewritten together with the environment                             |
| Build arguments plus live working directory   | Medium     | Low                  | Bounded repository    | Docker conventions | Separates some build/runtime values                | Can misidentify dirty source, normalized Git bytes or concurrent edits           |
| Frozen Git/working snapshot plus baked record | Medium     | Bounded local copies | 20,000 files / 200 MB | Node/Git/Docker    | Binds recorded inputs to the actual Docker context | Requires preparation, inventory review and additional drift checks at deployment |

## Trade-off Analysis

The selected snapshot approach makes CRLF normalization and docs-only comparisons reproducible while retaining the actual artifact SHA. Conservative inclusion can trigger unnecessary rebuilds, which is preferable to silently reusing stale executable inputs. Snapshot directories consume host space, so they stay ignored under `.local/`; Docker verification reuses shared tags and preserves only download caches after cleanup. A local JSON record is self-description rather than a signature or authorization credential. Trusted CI, signed release assets and live cloud-spec verification remain separate requirements.

## Consequences

- Repointing an image by changing runtime origins, project, SQL/storage resource or secret-reference declarations fails startup.
- Source changes require a rebuilt disposable test image; integration tests do not overlay new source onto an old artifact.
- Numeric secret-version changes require a new paired artifact and new staging evidence. Changing a secret value alone cannot change the digest.
- Cloud configuration, release evidence and actual service-spec verification remain required before deployment approval.

## Action Items

1. [x] Implement snapshot preparation, source guards, manifest digests and fixed-path metadata loading.
2. [x] Apply environment pairing to API and database/maintenance/bootstrap entrypoints.
3. [x] Complete local cross-environment artifact and operator verification using clean synthetic refs and disposable SQL.
4. [ ] Complete live-provider verification, image/execution linkage and trusted deployment receipts; the runtime-binding service/job checker and read-only adapter are implemented locally.
5. [ ] Obtain owner review with the remaining contract, client, recovery and release gates.
