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

On 28 October 2026, the owner selected keeping the budget proposal as an estimate only. No Budget API enablement, budget/recipient configuration or paid resource creation is authorized by that proposal. Continue local implementation and retain the setup gates.

Later on 28 October 2026, the owner separately authorized Staging provisioning, including Cloud SQL. Production remains unprovisioned and no budget was configured. Staging resources created through the Cloud SDK:

| Resource            | Staging value                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service accounts    | `blogpost-build`, `-api`, `-migrate`, `-ops`, `-bootstrap`, `-web`, `-scheduler`; no keys, no Owner/Editor                                          |
| Custom roles        | `BlogpostIdentitySession` (`blogpost-api`), `BlogpostIdentityLookup` (`blogpost-bootstrap`), `BlogpostBuildContextReader` (`blogpost-build`)        |
| Media bucket        | `blogpost-staging-blogpost-media`; Jakarta Standard, uniform access, public access prevention, 7-day soft delete                                    |
| Artifact Registry   | `blogpost` Docker repository, Jakarta, immutable tags; `blogpost-build` writer only                                                                 |
| Cloud SQL           | `blogpost-db`, PostgreSQL 17 Enterprise `db-f1-micro`, zonal, no authorized networks, 3 daily backups, no PITR                                      |
| Secrets (version 2) | `blogpost-db-root-password`, `blogpost-db-app-password`, `blogpost-db-migrator-password`, `blogpost-cursor-signing-key`; version 1 of each disabled |
| Cloud Build         | 2nd gen GitHub connection `blogpost-backend`; manual trigger `blogpost-backend-manual` on `rc` with `_APP_ENV=staging`                              |
| Operations jobs     | `blogpost-migrate`, `blogpost-verify-db`; `blogpost-bootstrap-db` ran once and was deleted                                                          |
| Identity Platform   | Enabled; Google provider only, email/password, anonymous and phone sign-in off                                                                      |

The committed [Staging profile](../config/environments/staging.json) records these nonsecret references. The migrator account is `blogpost-migrate`, matching the Console guide rather than the synthetic example.

The first app, migrator and cursor secret versions were generated with a trailing carriage return (Windows `openssl` CRLF output), which the API rejected at startup (`Invalid CURSOR_SIGNING_KEY`). They were replaced by version 2 values of exactly 64 lowercase hexadecimal characters, the database role passwords were changed to match through a one-off `postgres` job, and every version 1 was disabled. The rotated `postgres` password is root version 2, readable by no runtime identity. When generating secret values, strip both `
` and `
` and check the length before storing.

The Staging database has been bootstrapped, migrated (five migrations) and verified. The `blogpost-api` service exists but is not yet serving; it is private until public access is explicitly approved. The first administrator is not yet bootstrapped and the planned origins remain unobserved.
