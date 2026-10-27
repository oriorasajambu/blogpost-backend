# Cloud environment worksheet

The owner supplied these projects and selected default Cloud Run HTTPS URLs on 27 October 2026. Project identities were read through the configured Cloud SDK; the unrelated CLI default project was left unchanged.

| Environment | Project ID         | Verified project number | Region            |
| ----------- | ------------------ | ----------------------- | ----------------- |
| Staging     | `blogpost-staging` | `393487571647`          | `asia-southeast2` |
| Production  | `blogpost-512905`  | `520873230275`          | `asia-southeast2` |

Both projects are ACTIVE. At that observation, their Cloud Run API was disabled and service discovery could not run. No service, database, bucket, account, secret, release or deployment is asserted by this worksheet.

Use short planned service names `blogpost-api` and `blogpost-web` independently in each project. Google documents deterministic service URLs that can be planned before creation; see [HTTPS invocation and deterministic URLs](https://docs.cloud.google.com/run/docs/triggering/https-request). The source record is [config/cloud-projects.json](../config/cloud-projects.json).

| Environment | Planned API origin                                          | Planned web origin                                          |
| ----------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Staging     | `https://blogpost-api-393487571647.asia-southeast2.run.app` | `https://blogpost-web-393487571647.asia-southeast2.run.app` |
| Production  | `https://blogpost-api-520873230275.asia-southeast2.run.app` | `https://blogpost-web-520873230275.asia-southeast2.run.app` |

These origins are planned, not observed serving endpoints. Verify the actual service URLs/default-URL configuration after authorized provisioning and before claiming live environment pairing. Each DNS segment remains below the deterministic URL limit. Host-only cookies and distinct identity/provider projects continue to isolate environments.

Before the actual profiles can be finalized, provision/verify the approved regional SQL, registry/private bucket, purpose-specific identities, numeric secret-version references, federation conditions, backups/budgets/alerts and retained-revision recovery state. Keep credentials out of this record. The actual runnable profiles are separate from this planning data and from the synthetic examples. Staging uses reviewed RC source; Production uses final main release artifacts and the documented first-service bootstrap sequence.

The [two-project cost estimate](CLOUD_COST_ESTIMATE.md) records observed Jakarta rates, explicit workload/retention assumptions and proposed IDR budget amounts. Read-only checks confirm billing enabled and IDR billing currency for both projects. Existing budgets could not be inspected while the Budget API is disabled; neither absence nor completed budget setup is claimed. Budget amounts/recipients and native IDR creation estimates still require review before paid resources are created.
