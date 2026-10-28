# CI validation and delivery status

The three workflows separate work pushes/PR merge validation (`ci.yml`), RC pushes (`staging.yml`) and main pushes (`release.yml`). Checkouts use the immutable event SHA and full Git history. Work and fork checks receive no cloud, signing or publication permission. Actions and tool downloads use reviewed commit/checksum pins.

`policy` validates the actual event, branch route, PR merge parents, repository identity, full release marker and package/lock/contract agreement. It inspects every introduced commit, including deleted/renamed forbidden files, and rejects links, submodules and case-colliding source paths. The placeholder environment example has an explicit key/value allowlist. The pinned Gitleaks scan covers current publishable source, including docs, and complete reachable HEAD history. It uses fixed default rules, an explicit empty ignore file and ignores inline bypass comments. Raw scanner reports are removed; the private result retains rule/path/line/commit metadata without matched text or credential values. Three exact public noncredential strings have reasoned exceptions expiring on 25 January 2027; expiry fails validation. The scanner's pattern rules and default binary/archive exclusions are not proof that arbitrary credentials cannot exist.

The shared documentation predicate permits root README/license text and ordinary Markdown under `docs/`. The authoritative `API_CONTRACT_V1.md`, build-consumed files, executable docs and unknown paths select code checks. The same predicate controls frozen build inputs; `.release/release.json` may be docs-only only when `publish` becomes false and every other field stays unchanged. A code promotion requires an increased stable version, `publish:true` and first version `0.1.0`. Bootstrap `0.0.0` never publishes.

Documentation checks parse Markdown rather than scanning code examples for links. They check formatting, reference links, local target inventory and Markdown heading fragments without reading outside the repository. Plan snapshots and the copied contract guide now have repository-local references.

PR-only `ci-gate` and work `push-gate` use `always()`. Policy/docs must succeed. Code suites may be skipped only when policy explicitly selected docs-only; failed, cancelled, missing and other skipped dependencies fail the aggregate. Draft PRs are not merge-ready. Promotion additionally requires its evidence job. RC/main aggregates require source proof and delivery success as well as selected validation.

The read-only source-proof adapter checks the actual RC/main push workflow and original numeric repository/owner IDs, queries GitHub's associated merged PR, requires a manual merge by the solo owner, and compares its exact head with the second Git parent. Main requires the same-repository RC promotion and a result tree identical to that approved RC head. The first Git parent supplies the previous main state even if GitHub's current base ref has advanced. Missing, ambiguous or unavailable API evidence fails. Source-proof regressions use mocked GitHub responses; actual RC/main delivery remains unverified.

The owner-authorized public push through `05347e9` passed the real [work push run](https://github.com/oriorasajambu/blogpost-backend/actions/runs/40622093058). The latest [PR validation at that SHA](https://github.com/oriorasajambu/blogpost-backend/actions/runs/40622230572) passed policy, docs, foundation, SDK/SQL and Kotlin checks; its merge gate correctly failed because PR #1 remains a draft. The preceding PR run was superseded/cancelled when its description was updated. These runs prove that published source's selected checks, not subsequent local increments, cloud delivery or owner acceptance.

Run locally on the pinned toolchain:

```sh
npm run test:ci
npm run security:test
npm run security:check
npm run docs:check
```

The Git/scanner regressions use disposable local repositories. Scanner binaries live in ignored `.local/tools/`; they add no Docker images. The SDK/SQL suite continues to use disposable tmpfs data and the shared Development image. Its [database operator checks](DATABASE_VERIFICATION.md) cover history/schema/privilege drift and migration/maintenance coordination; CI also verifies the compiled production-dependency operations jobs with an invocation-owned temporary image.

The [populated recovery rehearsal](DATABASE_RECOVERY_REHEARSAL.md) is selected after that SDK/SQL job in all three workflows. It adds the synthetic migration-boundary, logical restore/atomic-failure and separate filesystem-media checks. It was not present in `05347e9`; local evidence remains separate from those earlier GitHub runs. After the owner approved the two newer commits, the complete [work push at `3381c92`](https://github.com/oriorasajambu/blogpost-backend/actions/runs/40626564080) passed, including that actual recovery step. The latest [PR run at that code head](https://github.com/oriorasajambu/blogpost-backend/actions/runs/40626881980) passed every selected code check; its final merge gate rejected draft readiness. This still establishes no RC/main delivery or provider release.

Promotion now invokes the [staging-evidence reader](STAGING_EVIDENCE.md) with read-only GitHub access before the explicit closed delivery gate. Delivery remains unavailable: trusted provider rollout/SQL receipts, actual profiles/federation, live counterpart checks, immutable release assets, stale-deployment guards and backup/rollout/recovery orchestration still require implementation and evidence. Passing work CI does not enable or prove deployment. See [implementation status](IMPLEMENTATION_STATUS.md), [cloud worksheet](CLOUD_ENVIRONMENTS.md) and [repository setup](REPOSITORY_SETUP.md).

The local [Cloud Run rollout executor](CLOUD_RUN_ROLLOUT.md) now implements conditional zero-traffic candidate creation, exact promotion, bounded observation and independently callable traffic recovery. Its real REST client is tested with simulated provider responses; trusted authorization/probe/metrics collectors and durable cross-runner recovery integration remain open. No workflow invokes it or receives additional permissions. This local increment has not been publicly pushed or represented by the earlier GitHub runs.
