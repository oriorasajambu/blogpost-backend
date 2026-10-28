# Deployment ancestry evaluator

`evaluateDeploymentAncestry` in `scripts/deploy/deployment-ancestry.mjs` compares an API deployment candidate with successful deployment records and actual positive-traffic revision inputs. It implements the Git ancestry decision needed by the [rollout executor](CLOUD_RUN_ROLLOUT.md), but is not yet connected to its authorization callback or a workflow.

The caller supplies an environment, project, Jakarta region and `blogpost-api` service; a candidate full Git SHA and immutable image digest; scoped successful records; and scoped live revisions with their traffic percentages. Each record/revision identifies the full SHA, digest and revision. Live percentages must be positive, unique by revision and sum to 100. The evaluator rejects cross-scope data, conflicting revision bindings, multiple image digests for the same SHA, malformed inputs and missing Git commits.

For every distinct recorded or serving source, the evaluator reads the local Git object graph. A candidate ancestor of a later source produces `skipped_stale`; a candidate descended from all compared sources produces `eligible`. Any unrelated history fails for investigation, including when another source already makes the candidate stale. An equal SHA is eligible only for this ancestry check; it does not authorize a rerun, establish release identity or skip other preconditions.

The Git reader refuses shallow history and legacy grafts, disables replacement references and lazy object fetching, checks that all supplied objects are commits, and bounds each subprocess and the whole comparison. Tests use actual disposable Git commits, divergent history, shallow repositories and replacement references. The result is explicitly labeled `caller-supplied-unverified`.

## Remaining trust and integration

The caller must independently collect and authenticate a complete, fresh, environment-scoped list of successful deployments and actual serving revision labels/digests. This function cannot establish completeness, freshness, provider identity, workflow permissions or artifact authenticity from supplied JSON. It does not implement a GitHub deployment ledger, pagination, deployment status writes, workflow summaries or release `latest` handling. An empty successful-record list is accepted only as data; proving that it is complete is the caller's responsibility.

The future trusted authorization must run this comparison before mutation and again immediately before the traffic switch, pair it with fresh Cloud Run state and etag checks, and handle `skipped_stale` distinctly from failure. Cross-runner serialization, authenticated evidence and separately timed recovery remain necessary. This module alone never grants permission to mutate traffic. No cloud request or write occurs here; normal delivery stays closed until the remaining requirements are met.
