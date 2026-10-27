# Cloud Build recovery implementation

Cloud Build is the manually invoked bootstrap/recovery alternative described in the [backend plan](plans/BLOGPOST_BACKEND_PLAN.md) and [Console guide](plans/BACKEND_DEPLOYMENT_GUIDE.md). Normal delivery uses the three approved GitHub workflows. The recovery path must run locked checks, disposable PostgreSQL/SDK integration and contract compatibility checks, then build/push both optimized targets from one captured commit/profile. It must not deploy or migrate a cloud database.

The current increment implements context and reviewed-source verification libraries. **The executable recovery recipe (`cloudbuild.yaml`) and its orchestration are still missing.** No recovery build, image push, provider execution or IAM configuration is established by the local tests. Delivery remains closed. The owner's [estimate-only budget decision](CLOUD_COST_ESTIMATE.md) does not authorize provisioning or budget configuration.

## Observed build context

[Context validation](../scripts/cloudbuild/context.mjs) accepts only a build UUID, environment, selected project ID and Jakarta region as routing inputs. Environment/project numbers come from [cloud project planning](../config/cloud-projects.json). Routing inputs and substitutions cannot attest execution identity. The [live reader](../scripts/cloudbuild/reader.mjs) independently reads:

1. Metadata service account email, before requesting a short-lived metadata token. It must be the selected project's `blogpost-build` account.
2. The selected Resource Manager project, including its independent numeric identity and ACTIVE state.
3. The actual regional Cloud Build record, requiring WORKING status, bounded timestamps, the custom account and an unambiguous resolved 2nd gen connected-repository SHA.
4. Its actual `blogpost-backend-manual` trigger and connected repository. The trigger must use manual invocation, `cloudbuild.yaml`, the selected RC/main branch and the same account/repository. Automatic event sources, inline/alternate recipes, file filters, tag sources, private pools and build secret bindings are rejected. The connected remote URL must match the configured GitHub repository.
5. The build, trigger, repository and metadata email again, rejecting changes to the verified observations.

Reads use fixed metadata/Google hosts, GET only, bounded fatal-UTF-8 responses, timeouts and no redirects/cookies. Only Google API reads receive the metadata bearer token; metadata requests use the required metadata header. Provider diagnostics and credentials are not emitted. The token stays in memory.

Explicit JSON observations are labeled `provided-json`. Only the live-reader result receives a private in-process binding. A serialized, edited or expired result cannot satisfy `requireLiveCloudBuildContext`; the observation must remain fresh within sixty seconds. This is a capability for cooperating verification code, not a sandbox against arbitrary code already executing as the builder account.

Google documents that trigger-style substitution values can also be supplied to builds submitted through the CLI. Consequently `_APP_ENV`, `COMMIT_SHA`, `REVISION_ID` and `BRANCH_NAME` are checked for disagreement, but never used as independent evidence of trusted source. See [substitution behavior](https://docs.cloud.google.com/build/docs/configuring-builds/substitute-variable-values), [Build API](https://docs.cloud.google.com/build/docs/api/reference/rest/v1/projects.locations.builds), [trigger API](https://docs.cloud.google.com/build/docs/api/reference/rest/v1/projects.locations.triggers) and [connected repository API](https://docs.cloud.google.com/build/docs/api/reference/rest/v2/projects.locations.connections.repositories).

## Reviewed Git source

[Source verification](../scripts/cloudbuild/source.mjs) requires the fresh in-process context, a clean checkout on the authorized permanent branch, matching provider SHA, exact configured GitHub origin and unchanged repository/owner identities. Real Git ancestry must place the build SHA on the currently observed authorized branch. A reviewed older ancestor can support recovery; a detached history cannot. Source trees and introduced history pass the same forbidden-path/link/collision checks used by CI.

The shared [reviewed merge policy](../scripts/ci/source-proof.mjs) requires an actual two-parent merge and a unique live GitHub merged-PR association. It checks repository IDs, route, head SHA, closed/merged state, non-draft status, absent auto-merge and the configured solo owner as merger. Main additionally requires the existing release/version/promotion tree rules. The GitHub branch, local checkout/origin and context freshness are checked again after remote reads.

Cloud Build does not synthesize a GitHub Actions event to enter that policy. The Actions wrapper retains its own exact repository/event/workflow guards. A `MANUAL` trigger record establishes trigger configuration; it does not prove who invoked this build or replace owner acceptance.

## Verification and remaining work

`npm run test:ci` covers these libraries with a mock metadata/Google transport and real disposable Git histories. Synthetic credentials never leave the test transport. Tests exercise both environments, project-number aliases, malformed/oversized/redirected responses, substituted identities, alternate sources/triggers, changing observations, private in-process trust, stale context, unreviewed merges, moving branches and local source changes during reads. These are local regressions, not live provider evidence.

Still required before recovery is usable:

- Supply and verify `cloudbuild.yaml`, pinned builder tools, bounded orchestration and a captured source/profile shared by both optimized targets. Do not assume the provider's initial workspace contains the full Git history.
- Run the locked quality/security/generated-client/compatibility checks, actual disposable SQL/SDK/operator suites and optimized image smoke tests. Preserve actual tested source and environment provenance.
- Push only immutable invocation-specific tags after successful checks; record actual API/operations digests, build status/results and available source/image provenance. A successful context check alone proves neither recipe execution nor an image's contents.
- Verify effective IAM, the actual manual connection/trigger, provider runtime/tool compatibility and explicit human recovery authorization in the selected project. Give the builder no SQL, Secret Manager or deployment authority. The readonly guard additionally needs its fixed project/build/trigger/repository reads; exact effective bindings remain unverified.
- Keep publication, cloud execution, populated upgrade/backup recovery, rollout, counterpart acceptance and normal release gates separate. No local test or archived proof bypasses them.
