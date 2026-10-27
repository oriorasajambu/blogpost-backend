# Backend repository policy

Repository: `oriorasajambu/blogpost-backend`. The owner selected **UNLICENSED** on 27 October 2026; no open-source license has been selected. The npm application stays private.

Permanent branches are `main` and `rc`. Work branches use lowercase `feature/`, `bug/`, `chore/` or `docs/` names. Executable Development work uses feature/bug/chore branches. Staging artifacts come from clean reviewed RC source; Production artifacts come from clean main source. Never retain `master` after initialization.

The minimal initial main commit contains only README, a sanitized configuration example, ignore rules, this policy and `.release/release.json` at version `0.0.0` with `publish: false`. It is the one bootstrap exception to normal PR governance. Create RC at that exact commit, then add application/CI work through `chore/repository-foundation` and a PR targeting RC.

Normal changes require a PR, passing checks, resolved conversations, and the owner's manual inspection and merge. The solo owner requires zero independent approvals. Use merge commits; disable squash/rebase, automatic merge, merge queues and automatic head deletion. Block force pushes/deletion on permanent branches and keep routine bypass lists empty. Do not configure a required check until it has appeared on the intended PR target.

Only `push` and `pull_request` workflow events are permitted. Work pushes use `push-gate`; PRs use `ci-gate`; RC delivery uses `staging-evidence`. Main promotion additionally requires trusted current staging evidence and owner validation. Separate Staging/Production cloud identities and resources; ordinary work/fork runs receive no cloud or signing credentials.

Keep real `.env` files, credentials, runner tokens, signing material, caches and local data out of Git and artifacts. Check complete PR history for forbidden credential files, including files added and removed within one PR. Published contract/release assets are immutable. Never replace a release's bytes on rerun.

The current `0.0.0` marker does not authorize release publication or deployment. Actual cloud configuration, provider/client checks, reviewed contract packaging, CI/security gates, staging/manual acceptance and recovery evidence must be complete before normal delivery is enabled.
