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

Still required before normal delivery:

- Verify the split `ci.yml`, `staging.yml`, `release.yml` checks on GitHub and finish trusted compatibility/promotion/release/evidence machinery. Promotion/delivery currently fail closed without credentials; local CI policy and security checks are implemented.
- Publish/review the foundation PR and observe `ci-gate` on the intended target before making it required. No unavailable check has been enabled.
- Set merge-commit-only policy, disable squash/rebase and automatic merge/head deletion, and configure permanent-branch/tag rules with the solo review model. At the metadata observation, squash and rebase were still enabled; protection has not been asserted complete.
- Establish Staging/Production project worksheets, restricted identities/federation, reviewed actual profiles and live-provider evidence. Use the real repository/owner numeric IDs above in federation conditions; project IDs/numbers remain owner inputs.
- Complete immutable contract/release packaging, counterpart/client verification, staging/manual acceptance, populated migrations and backup/rollback recovery before promotion.

This record describes observed setup progress. It does not replace [repository policy](REPOSITORY_POLICY.md), trusted workflow evidence, or the owner's review.
