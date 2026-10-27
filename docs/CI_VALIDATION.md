# CI validation and delivery status

The three workflows separate work pushes/PR merge validation (`ci.yml`), RC pushes (`staging.yml`) and main pushes (`release.yml`). Checkouts use the immutable event SHA and full Git history. Work and fork checks receive no cloud, signing or publication permission. Actions and tool downloads use reviewed commit/checksum pins.

`policy` validates the actual event, branch route, PR merge parents, repository identity, full release marker and package/lock/contract agreement. It inspects every introduced commit, including deleted/renamed forbidden files, and rejects links, submodules and case-colliding source paths. The placeholder environment example has an explicit key/value allowlist. The pinned Gitleaks scan covers current publishable source, including docs, and complete reachable HEAD history. It uses fixed default rules, an explicit empty ignore file and ignores inline bypass comments. Raw scanner reports are removed; the private result retains rule/path/line/commit metadata without matched text or credential values. Three exact public noncredential strings have reasoned exceptions expiring on 25 January 2027; expiry fails validation. The scanner's pattern rules and default binary/archive exclusions are not proof that arbitrary credentials cannot exist.

The shared documentation predicate permits root README/license text and ordinary Markdown under `docs/`. The authoritative `API_CONTRACT_V1.md`, build-consumed files, executable docs and unknown paths select code checks. The same predicate controls frozen build inputs; `.release/release.json` may be docs-only only when `publish` becomes false and every other field stays unchanged. A code promotion requires an increased stable version, `publish:true` and first version `0.1.0`. Bootstrap `0.0.0` never publishes.

Documentation checks parse Markdown rather than scanning code examples for links. They check formatting, reference links, local target inventory and Markdown heading fragments without reading outside the repository. Plan snapshots and the copied contract guide now have repository-local references.

PR-only `ci-gate` and work `push-gate` use `always()`. Policy/docs must succeed. Code suites may be skipped only when policy explicitly selected docs-only; failed, cancelled, missing and other skipped dependencies fail the aggregate. Draft PRs are not merge-ready. Promotion additionally requires its evidence job. RC/main aggregates require source proof and delivery success as well as selected validation.

The read-only source-proof adapter checks the actual RC/main push workflow and original numeric repository/owner IDs, queries GitHub's associated merged PR, requires a manual merge by the solo owner, and compares its exact head with the second Git parent. Main requires the same-repository RC promotion and a result tree identical to that approved RC head. The first Git parent supplies the previous main state even if GitHub's current base ref has advanced. Missing, ambiguous or unavailable API evidence fails. Local tests use mocked GitHub responses; no actual workflow run is claimed yet.

Run locally on the pinned toolchain:

```sh
npm run test:ci
npm run security:test
npm run security:check
npm run docs:check
```

The Git/scanner regressions use disposable local repositories. Scanner binaries live in ignored `.local/tools/`; they add no Docker images. The SDK/SQL suite continues to use disposable tmpfs data and the shared Development image.

Promotion and delivery are deliberately unavailable. Their current jobs exit nonzero without requesting credentials or mutating an external system. Current-RC staging receipts, owner validation, live artifact agreement, real cloud profiles/federation, immutable release assets, stale-deployment guards and backup/rollout/recovery orchestration are still required implementation work. Passing work CI does not enable or prove deployment. See [implementation status](IMPLEMENTATION_STATUS.md) and [repository setup](REPOSITORY_SETUP.md).
