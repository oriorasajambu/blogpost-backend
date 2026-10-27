# Repository setup record

Observed on 27 October 2026 through the connected GitHub account and Git transport:

| Field                    | Recorded value                             |
| ------------------------ | ------------------------------------------ |
| Repository               | `oriorasajambu/blogpost-backend`           |
| Repository ID            | `1433164464`                               |
| Owner ID                 | `69578296`                                 |
| Visibility               | Public                                     |
| Owner license decision   | UNLICENSED                                 |
| Default branch           | `main`                                     |
| Initial main/RC commit   | `1cfff4fb301268d7cd390f8d9d4b4405c89351b1` |
| Local application branch | `chore/repository-foundation`              |

The published root contains only `.env.example`, `.gitignore`, `.release/release.json`, README and repository policy. Main and RC start from that exact root. No master branch remains. The application/CI foundation is prepared on `chore/repository-foundation` for review; current PR and Actions state must be checked on GitHub. The owner selected keeping the source unlicensed rather than adding an open-source license.

The initial root is the VCS plan's single policy-only bootstrap exception. Normal code follows a PR targeting RC and the owner's manual inspection/merge. No main promotion, release or deployment was performed.

The application is published in [draft PR #1](https://github.com/oriorasajambu/blogpost-backend/pull/1). At head `1e43acb78635990d77862d203caf45f90a0f96fa`, both the [push run](https://github.com/oriorasajambu/blogpost-backend/actions/runs/40451987086) and [PR run](https://github.com/oriorasajambu/blogpost-backend/actions/runs/40451991484) pass policy, docs, foundation, SDK/SQL and Kotlin checks. The push aggregate passes. The PR aggregate rejects `draft:true` as intended; no owner review or merge is inferred.

Observed repository settings now permit only merge commits, with automatic merge and head deletion disabled. Actions defaults are read-only and cannot approve reviews; first-time fork contributors require workflow approval. RC ruleset `25934525` was enabled only after PR-only `ci-gate` appeared. It binds that status to GitHub Actions app `15368`, requires the current base and resolved conversations, permits zero required approvals for the solo model, blocks force pushes/deletion and has no bypass. The additional unattributed-change approval default is explicitly disabled. Tag ruleset `25934477` blocks updates/deletion of `v*`, permits initial creation and has no bypass. Immutable releases are enabled; no release/tag was created.

Still required before normal delivery:

- Finish trusted compatibility/promotion/release/evidence machinery. Work checks have run on GitHub; actual RC/main delivery is unverified and deliberately fails closed without credentials.
- Owner inspection and a ready-for-review transition are still required for the foundation PR. Do not bypass its draft gate or infer approval from passing tests.
- Configure the main ruleset when the first actual RC-to-main candidate/check appears on that target, following the bootstrap order. RC/tag settings above are observed; main protection is not claimed complete.
- Establish Staging/Production project worksheets, restricted identities/federation, reviewed actual profiles and live-provider evidence. Use the real repository/owner numeric IDs above in federation conditions; project IDs/numbers remain owner inputs.
- Complete immutable contract/release packaging, counterpart/client verification, staging/manual acceptance, populated migrations and backup/rollback recovery before promotion.

This record describes observed setup progress. It does not replace [repository policy](REPOSITORY_POLICY.md), trusted workflow evidence, or the owner's review.
