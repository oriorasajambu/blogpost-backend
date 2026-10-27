# Manual backend deployment through Google Cloud Console

Prepared 25 October 2026 for the interview-approved [backend plan](BLOGPOST_BACKEND_PLAN.md). Deploy the web app afterward using [the frontend guide](FRONTEND_WEB_DEPLOYMENT_GUIDE.md).

**Scope update:** normal releases now follow [VCS_GUIDELINE.md](VCS_GUIDELINE.md) and [CI_CD_GUIDELINE.md](CI_CD_GUIDELINE.md): reviewed marked main promotions publish artifacts and deploy automatically. Use this browser-only procedure for initial setup or deliberately recorded recovery. Its manual build path is an alternative, not a second normal release pipeline.

**Environment selection:** [BUILD_VARIANTS_PLAN.md](BUILD_VARIANTS_PLAN.md) adds a separate Staging project. Repeat provisioning in each selected project with independent resources, identities and secrets. In the instructions below, `PROJECT_ID` always means the explicitly selected environment, and resource-size/retention values are Production defaults unless overridden here:

| Input                    | Staging                                                  | Production                                       |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------ |
| Source / `APP_ENV`       | Reviewed RC SHA / `staging`                              | Main release SHA / `production`                  |
| Project and identity     | Staging project, provider, users, service accounts       | Independent Production project/provider/accounts |
| Cloud Run max / API pool | One instance / two connections                           | Two instances / three connections                |
| Daily SQL backups        | Three                                                    | Seven                                            |
| Data                     | Persistent synthetic content; separate admin/invitations | Live publication data                            |

Both use `NODE_ENV=production`, HTTPS, private buckets, and compatible migrations. Select the project in the Console before every resource/IAM operation; never grant a staging identity production access. Normal RC pushes deploy Staging automatically; normal marked main pushes publish/deploy Production. Local Docker Development follows the variant plan and never uses these cloud credentials.

[API_CONTRACT_V1.md](API_CONTRACT_V1.md) governs wrapped JSON, the five mandatory metadata headers, resource-version headers, and compatibility. Backend `/v1` URLs opened directly in a browser omit required metadata and intentionally return a wrapped 400; health URLs are exempt.

This manual setup/recovery guide uses browser forms and buttons. No local terminal, Cloud Shell, `gcloud`, or local Docker is required for these steps. Prepared repository files and compiled operations scripts are prerequisites. A Cloud Run Job's **Command/Arguments** fields select an already-built program inside the image; they are not instructions to open a terminal.

Console labels can change. Search for the named product/control when navigation differs, and check the linked official instructions. These procedures were checked against documentation, not executed in a live Google Cloud project.

## 1. Prerequisites and release inputs

Do not start provisioning until the implementation has passed its local checks. The empty planning workspace alone is not deployable.

- A Google Cloud account able to create/select a project and attach billing, with access to provision the listed resources and grant scoped IAM permissions. Organization policies must permit a publicly reachable Cloud Run service and the chosen location.
- A GitHub backend repository containing the application, locked dependencies, Dockerfile, versioned Prisma 7 migrations, OpenAPI fixtures, and `cloudbuild.yaml`.
- Permission to authorize the Google Cloud Build GitHub App for that repository. The Console connection flow redirects to GitHub for browser authorization; it requires no command line.
- A password manager to generate/store strong distinct SQL passwords, and a verified Google account for the initial admin. Do not put real values in these plan files or source control.
- The prepared image runs the API by default and includes the five operations entry points named in the backend plan. Build configuration tests against a disposable PostgreSQL database, never this cloud database.

Record these values in a private deployment worksheet:

| Input                        | Initial value/instruction                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROJECT_ID`                 | Choose a globally unique project ID; do not reuse a sample value                                                                                                          |
| `PROJECT_NUMBER`             | Copy from the project's dashboard                                                                                                                                         |
| `APP_ENV`                    | `staging` or `production`; must match selected image and project                                                                                                          |
| `REGION`                     | `asia-southeast2` (Jakarta)                                                                                                                                               |
| `SQL_INSTANCE`               | `blogpost-db`                                                                                                                                                             |
| `INSTANCE_CONNECTION_NAME`   | Copy exact `PROJECT_ID:REGION:INSTANCE_ID` from SQL Overview                                                                                                              |
| Database/schema              | Database `blogpost`, schema `blogpost`                                                                                                                                    |
| SQL users                    | `blogpost_app`, `blogpost_migrator`; temporary root user `postgres`                                                                                                       |
| `MEDIA_BUCKET`               | Globally unique name such as `PROJECT_ID-blogpost-media`                                                                                                                  |
| Artifact Registry repository | `blogpost`, Docker, same region                                                                                                                                           |
| API Cloud Run service        | `blogpost-api`                                                                                                                                                            |
| Backend source ref           | Staging: exact reviewed RC commit; Production: exact main release/tag; record full SHA                                                                                    |
| `API_ORIGIN`, `WEB_ORIGIN`   | Record both stable canonical HTTPS origins before the paired image build; copy actual endpoint URLs or use reviewed domains you control, never infer a generated hostname |
| Initial admin                | Verified Google email; UID copied after first sign-in                                                                                                                     |

Use isolated Staging and Production cloud projects plus per-feature local Docker stacks. Estimate both projects and set separate budgets before provisioning; the original US$30 target is not a combined guarantee. English content and Indonesian readership remain defaults. Keep each environment's database/compute in Jakarta unless a verified availability issue requires a documented change.

## 2. Project, budget, and APIs

1. Open [Google Cloud Console](https://console.cloud.google.com/), choose the project selector, and create/select the intended project. Check the project ID before every major operation.
2. Open **Billing**, link the billing account, then **Budgets & alerts → Create budget**. Scope an alerts-only monthly budget to this selected project using its reviewed regional estimate and chosen headroom, with actual-spend thresholds at 50%, 80%, and 100%, plus a 100% forecast alert. Repeat for the other project and review combined exposure. Verify recipients.
3. In **APIs & Services → Library**, enable Cloud Run Admin, Cloud Build, Artifact Registry, Cloud SQL Admin, Secret Manager, Cloud Storage, Identity Toolkit/Identity Platform, Cloud Scheduler, Cloud Logging, and Cloud Monitoring APIs as prompted. Preserve automatically created Google service-agent roles.

Retire the earlier US$30 combined assumption; separate SQL environments require a fresh estimate. Alerts-only budgets do not stop spending and reporting may lag. Supported spend-cap products differ, so do not assume they protect this whole stack. [Budget documentation](https://docs.cloud.google.com/billing/docs/how-to/budgets).

Before creating SQL, inspect its displayed monthly estimate including storage/backups. Cloud SQL is billed while running, even when Cloud Run scales to zero; shared-core instances have no Cloud SQL SLA. Builds, images, logs, storage, soft-deleted objects, backups, and network transfer add costs. If the estimate exceeds your target, revise the budget or capacity deliberately before creation. [SQL pricing](https://cloud.google.com/sql/pricing), [shared-core limitations](https://docs.cloud.google.com/sql/docs/postgres/faq).

**Checkpoint:** Correct billed project selected, APIs enabled, budget recipients/thresholds saved, and the SQL estimate understood.

## 3. Create runtime/build identities and restricted identity permissions

Open **IAM & Admin → Service Accounts → Create service account**. Create these accounts without downloading keys:

| Service account ID   | Purpose                                                   |
| -------------------- | --------------------------------------------------------- |
| `blogpost-build`     | Tests/builds/pushes backend and web images; cannot deploy |
| `blogpost-api`       | API runtime                                               |
| `blogpost-migrate`   | Database schema migrations only                           |
| `blogpost-ops`       | Runtime-permission verification and scheduled retention   |
| `blogpost-bootstrap` | Temporary database/bootstrap-admin operations             |
| `blogpost-web`       | Web runtime, used in the next guide                       |
| `blogpost-scheduler` | Invokes the maintenance job only                          |

In **IAM & Admin → Roles → Create role**, create project custom role `BlogpostIdentitySession` with only `firebaseauth.users.get` and `firebaseauth.users.createSession`. Assign it to `blogpost-api`. Create another role `BlogpostIdentityLookup` with only `firebaseauth.users.get`, assigned to `blogpost-bootstrap`. These enable revocation-aware identity lookup and session creation without broad user-management authority. [Identity Platform API permissions](https://docs.cloud.google.com/identity-platform/docs/access-control).

Grant **Cloud SQL Client** (`roles/cloudsql.client`) on this project to `blogpost-api`, `blogpost-migrate`, `blogpost-ops`, and `blogpost-bootstrap`. Grant **Logs Writer** (`roles/logging.logWriter`) to `blogpost-build`. Add resource-scoped registry/storage/secret grants in later steps, after those resources exist.

The human creating a trigger/job/service needs **Service Account User** on its selected service account, as well as the relevant product administration permissions. Grant that to the operator, not every runtime account. Project setup may require help from the organization's IAM/billing administrator; do not compensate by giving runtime/build accounts Owner or Editor.

## 4. Create private media storage and image repository

1. Open **Cloud Storage → Buckets → Create**. Enter `MEDIA_BUCKET`, choose regional Jakarta and Standard storage.
2. Select **Uniform** access and enforce **public access prevention**. Use Google-managed encryption, seven-day soft delete, no bucket retention lock, no object versioning, and no age-based rule that deletes live media. Create.
3. On the bucket's **Permissions** tab, grant **Storage Object Admin** (`roles/storage.objectAdmin`) to `blogpost-api` and `blogpost-ops` only. No `allUsers`/`allAuthenticatedUsers` grant. This role is bucket-scoped, not project Storage Admin.
4. Open **Artifact Registry → Repositories → Create repository**. Name `blogpost`, format Docker, standard repository, Jakarta location; enable immutable tags if offered. Create, then grant **Artifact Registry Writer** (`roles/artifactregistry.writer`) on this repository to `blogpost-build`.

Cloud Run's service agent pulls same-project images using its managed permissions. If image pull is denied under custom organizational IAM, inspect that service agent's registry read access; the application does not need a downloaded key. [Private bucket control](https://docs.cloud.google.com/storage/docs/using-public-access-prevention), [uniform access](https://docs.cloud.google.com/storage/docs/uniform-bucket-level-access), [repository creation](https://docs.cloud.google.com/artifact-registry/docs/repositories/create-repos).

**Checkpoint:** Storage is private; bucket grants are limited; Docker repository exists. A published image is still served by the API, never by making this bucket public.

## 5. Create Cloud SQL with explicit low-cost settings

1. Open **SQL → Create instance → PostgreSQL**.
2. Select **Enterprise** edition, PostgreSQL 17, instance ID `blogpost-db`, and a generated `postgres` password saved in the password manager. Avoid an Enterprise Plus/production preset silently selecting larger resources.
3. Set region Jakarta and **single zone** availability. Under machine configuration, choose shared-core `db-f1-micro` when offered. Set initial SSD capacity to 10 GB. Use a bounded storage-growth policy: enable automatic growth with a 20 GB limit if the UI exposes the limit; otherwise disable automatic growth initially and configure a disk alert before loading data.
4. Under connections, enable **Public IP** but leave **Authorized networks empty**. The application uses the Cloud SQL connector/socket with IAM, not an internet-open database port. No `0.0.0.0/0` entry and no VPC connector/NAT are required for this baseline.
5. Choose **standard backups**, automatic daily backup window during low traffic, retention seven successful daily backups, and a suitable regional backup location. Disable PITR for the agreed daily-backup baseline; review its current default explicitly. Keep deletion protection on. Confirm the final estimate and create.
6. Wait until healthy. Open Overview and copy the exact connection name. Open **Databases → Create database**, name `blogpost`.

Do not create `blogpost_app` through a default user wizard that might grant broad built-in privileges. The prepared bootstrap job creates/restricts the app/migrator roles and schema. No runtime process uses `postgres`. [Instance settings](https://docs.cloud.google.com/sql/docs/postgres/create-instance), [backup choices](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/backups).

**Checkpoint:** Healthy single-zone instance, correct edition/tier, database created, no authorized public networks, daily backups configured, connection name recorded.

## 6. Create password secrets and finish scoped IAM

Open **Security → Secret Manager → Create secret**. Use automatic replication and create version 1 of:

| Secret ID                       | Value                                                                    | Secret Accessor principals                                       |
| ------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `blogpost-db-root-password`     | Current `postgres` password, temporary bootstrap only                    | `blogpost-bootstrap`                                             |
| `blogpost-db-app-password`      | New distinct strong generated password                                   | `blogpost-api`, `blogpost-ops`, temporarily `blogpost-bootstrap` |
| `blogpost-db-migrator-password` | Different generated password                                             | `blogpost-migrate`, temporarily `blogpost-bootstrap`             |
| `blogpost-cursor-signing-key`   | Separate cryptographically random 64-character lowercase hexadecimal key | `blogpost-api` only                                              |

For each secret open **Permissions → Grant access**, and assign **Secret Manager Secret Accessor** (`roles/secretmanager.secretAccessor`) to only the listed accounts. Use per-secret access, not project-wide access. Reference explicit numeric versions in jobs/services so rollback is predictable. Creating the app/migrator secrets does not itself create the SQL users; the next operation does.

Never put these values in build substitutions, plaintext ordinary runtime variables, GitHub Actions, image layers, source files, or the release worksheet. Ordinary configuration fields contain usernames/paths; password fields use secret references.

## 7. Connect GitHub and build manually

Prepared build configuration must validate the selected `APP_ENV`/source and record environment/input provenance. For Staging bootstrap use reviewed RC source with staging inputs. Production bootstrap/recovery uses a main-built artifact; if the first main run has published before initial services exist, copy its published digest and continue provisioning rather than rebuilding from RC. See the variant plan's first-service sequence. Keep all build substitutions nonsecret and use the selected project's registry/account.

The implemented profile requires both canonical API/web origins, identity audience/issuers, SQL/storage resources, purpose-specific accounts and numeric secret-version references before building. Record them in the environment worksheet and prepare the reviewed nonsecret profile described in [the build runbook](../BUILD_PROVENANCE.md). If endpoint names are not established yet, finish endpoint planning/provisioning before producing a runnable paired artifact. An origin/reference change requires a new authorized-ref build and verification. Deployment validation compares actual Cloud Run account/SQL/secret mounts with that baked profile.

1. Open **Cloud Build → Repositories**, choose **2nd gen**, select Jakarta, and create a GitHub host connection. Complete GitHub App authorization for the intended repository, then use **Link repositories** to attach it.
2. Open **Cloud Build → Triggers → Create trigger**. Name `blogpost-backend-manual`, same region, event **Manual invocation**, source the linked **Cloud Build 2nd gen** repository, and the existing intended release branch/tag.
3. Configuration: repository file `cloudbuild.yaml`. Select `blogpost-build` as service account. Keep approval optional/off for this solo workflow because starting the build and releasing the image are already explicit human actions. Do not select push/PR events or Cloud Run's continuous repository deployment shortcut.
4. The prepared build configuration must use `CLOUD_LOGGING_ONLY` for custom-service-account logging, run all required checks, and build the API `runtime` and job `operations` targets from the same captured commit/profile. Push immutable build tags such as `asia-southeast2-docker.pkg.dev/PROJECT_ID/blogpost/backend:build-BUILD_ID` and `.../backend-operations:build-BUILD_ID`. It must not deploy or touch cloud SQL/secrets.
5. Save. On the trigger row click **Run**, select the reviewed existing source ref, then **Run trigger**. Open the build and inspect tests/build/push steps. Wait for success.
6. In the successful build's source details record the full resolved commit SHA. In Artifact Registry copy both API and operations digest URIs (`.../backend@sha256:...`, `.../backend-operations@sha256:...`), and record build ID, contract version, migration version and provenance digests.

Use Cloud Build 2nd gen specifically: it supports manual triggers, while the current Developer Connect repository integration does not. [Repository capability comparison](https://docs.cloud.google.com/build/docs/repositories), [GitHub linking](https://docs.cloud.google.com/build/docs/automating-builds/github/connect-repo-github), [manual trigger instructions](https://docs.cloud.google.com/build/docs/manually-build-code-source-repos).

**Checkpoint:** Green build, immutable digest and exact source SHA recorded, no running service/release automatically changed.

## 8. Run prepared database operations from Jobs

For each job below open **Cloud Run → Jobs → Create job**, choose the recorded **operations digest** from the same captured source/profile as the API, Jakarta, one task, parallelism one, 1 vCPU, 512 MiB, 10-minute task timeout, zero automatic retries. Use the table's service identity. Under advanced configuration add the SQL instance using **Cloud SQL connections → Add connection**. Set ordinary variables and secret references as specified.

Common variables: matching `APP_ENV`, `NODE_ENV=production`, `GCP_PROJECT_ID=PROJECT_ID`, `IDENTITY_PROJECT_ID=PROJECT_ID`, baked `API_ORIGIN`/`WEB_ORIGIN`, `IDENTITY_TOKEN_AUDIENCE=PROJECT_ID`, `IDENTITY_TOKEN_ISSUER=https://securetoken.google.com/PROJECT_ID`, `IDENTITY_SESSION_ISSUER=https://session.firebase.google.com/PROJECT_ID`, `SQL_DATABASE=blogpost`, `INSTANCE_CONNECTION_NAME`, `SQL_HOST=/cloudsql/INSTANCE_CONNECTION_NAME`, `MEDIA_ADAPTER=gcs`, `MEDIA_BUCKET` and `MEDIA_BUCKET_PROJECT_ID=PROJECT_ID`. Set `RUNTIME_SERVICE_ACCOUNT` to the job's actual service-account email. All values must match its baked profile. The program selects its SQL username and pool bound by purpose/environment.

| Job                     | Identity             | Command / one Arguments entry                       | Additional configuration                                                                                                                                                                               |
| ----------------------- | -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blogpost-bootstrap-db` | `blogpost-bootstrap` | Command `node`; argument `dist/ops/bootstrap-db.js` | `SQL_ROOT_PASSWORD`, `SQL_APP_PASSWORD`, `SQL_MIGRATOR_PASSWORD` from their numeric secret versions; corresponding `SQL_ROOT_SECRET_REF`, `SQL_APP_SECRET_REF`, `SQL_MIGRATOR_SECRET_REF` declarations |
| `blogpost-migrate`      | `blogpost-migrate`   | Command `node`; argument `dist/ops/migrate.js`      | `SQL_MIGRATOR_PASSWORD` from its numeric version; `SQL_MIGRATOR_SECRET_REF`                                                                                                                            |
| `blogpost-verify-db`    | `blogpost-ops`       | Command `node`; argument `dist/ops/verify-db.js`    | `SQL_APP_PASSWORD` from its numeric version; `SQL_APP_SECRET_REF`                                                                                                                                      |

Each `*_SECRET_REF` declaration is the exact nonsecret path `projects/PROJECT_ID/secrets/SECRET_ID/versions/NUMBER` from the reviewed profile. Each password is mounted separately through **Secret Manager** at that same numeric version. The deployment check verifies the mount itself, not just the declaration string.

Do not combine the command and argument into one shell string. Jobs do not need an HTTP listener or public ingress.

1. Create `blogpost-bootstrap-db`, open it, click **Execute**, then inspect the execution's logs/status. Expected: app/migrator roles created, neither superuser nor `cloudsqlsuperuser`, dedicated schema owned by migrator, explicit privileges applied. Safe reruns must verify state without resetting passwords/data.
2. Create/execute `blogpost-migrate`. Expected: all committed Prisma 7 migrations applied; application grants updated; `SchemaMeta` version updated. No `migrate dev`, reset, schema push, or downloaded-at-runtime CLI is allowed.
3. Create/execute `blogpost-verify-db`. Expected: schema/index checks pass, runtime connection succeeds, runtime DDL/migration-history mutation is denied, and available connection budget is reported. It must roll back any permission-probe transaction.
4. Disable root secret version 1 and remove bootstrap access to root/migrator secrets; delete the temporary bootstrap-db job. Rotate the `postgres` password in SQL **Users** and keep the new value in the password manager, not on the API. Keep bootstrap's app-password and identity-lookup access only until first-admin setup.

Migrations operate on the live schema once deployed; later migrations require the release procedure below. A failed migration is a stop condition: inspect logs and resolve with a reviewed repair image/job. Do not mark a migration applied merely to obtain green status. [Creating jobs](https://cloud.google.com/run/docs/create-jobs), [executing jobs](https://docs.cloud.google.com/run/docs/execute/jobs), [Prisma 7 deployment migration behavior](https://docs.prisma.io/docs/cli/migrate/deploy).

**Checkpoint:** Three successful operations, least-privilege SQL verified, root secret disabled, root bootstrap job removed.

## 9. Deploy the API image

1. Open **Cloud Run → Services → Deploy container** and select the recorded API runtime digest from Artifact Registry. Name `blogpost-api`, region Jakarta.
2. Select request-based billing, autoscaling minimum 0 and service maximum 2 instances. Container: 1 vCPU, 1 GiB, concurrency 20, timeout 60 seconds, port 8080, default image entrypoint. Use second-generation execution environment when offered.
3. Select **Allow public access** in Security, with all ingress. Android and anonymous readers must reach the API; Nest still verifies credentials/roles on protected endpoints. Cloud Run IAM authentication is a different mechanism from Identity Platform user authentication. [Public access control](https://docs.cloud.google.com/run/docs/authenticating/public).
4. Set service account `blogpost-api`. Add the Cloud SQL connection. Add the ordinary variables below. Mount `SQL_APP_PASSWORD` and `CURSOR_SIGNING_KEY` from their reviewed explicit Secret Manager versions.

| Variable                                                   | Value                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `NODE_ENV`                                                 | `production`                                                   |
| `APP_ENV`                                                  | Selected `staging` or `production`; matches image provenance   |
| `GCP_PROJECT_ID`                                           | `PROJECT_ID`                                                   |
| `IDENTITY_PROJECT_ID`                                      | Same selected environment's identity project                   |
| `API_ORIGIN`, `WEB_ORIGIN`                                 | Exact canonical HTTPS origins in the baked profile             |
| `IDENTITY_TOKEN_AUDIENCE`                                  | `PROJECT_ID`                                                   |
| `IDENTITY_TOKEN_ISSUER`                                    | `https://securetoken.google.com/PROJECT_ID`                    |
| `IDENTITY_SESSION_ISSUER`                                  | `https://session.firebase.google.com/PROJECT_ID`               |
| `SQL_DATABASE`                                             | `blogpost`                                                     |
| `INSTANCE_CONNECTION_NAME`, `SQL_HOST`                     | Exact connection name and `/cloudsql/INSTANCE_CONNECTION_NAME` |
| `MEDIA_ADAPTER`, `MEDIA_BUCKET`, `MEDIA_BUCKET_PROJECT_ID` | `gcs`, actual private bucket, selected `PROJECT_ID`            |
| `RUNTIME_SERVICE_ACCOUNT`                                  | Actual `blogpost-api` service-account email                    |
| `SQL_APP_SECRET_REF`, `CURSOR_SECRET_REF`                  | Exact numeric secret-version paths in the profile              |

Do not manually set reserved `PORT`; the port control injects it. The app binds `0.0.0.0` and validates both configured origins before serving. Its application pool is two connections in Staging and three in Production. Add an HTTP startup/liveness probe on `/health/live` if offered; do not use SQL-dependent readiness as a liveness-restart trigger. [Container configuration](https://docs.cloud.google.com/run/docs/configuring/services/containers), [SQL connection setup](https://docs.cloud.google.com/sql/docs/postgres/connect-run).

5. Create and wait for Ready. Copy generated `API_URL`; do not infer its hostname. Open `/health/live` and `/health/ready` in a browser and expect healthy responses. Open `/v1/meta` or `/v1/public/posts` directly only as a negative test: without the five client headers, expect wrapped HTTP 400 `INVALID_CLIENT_METADATA`. Successful metadata/feed checks occur through the implemented Web/Android metadata adapters after the client handoff; an empty feed then returns `data:[]` inside the envelope.
6. In service logs inspect startup, socket access, and error redaction. Confirm the SQL monitoring connection count fits: normal API pool budget 2 × 3 = 6, temporary revision overlap plus a 2-connection job still leaves administrative headroom under the actual database limit. Avoid concurrent migrations/rollouts if headroom is insufficient.

**Checkpoint:** API responds over HTTPS, SQL readiness succeeds, missing client metadata is rejected in the documented envelope, and storage remains private. Client-based credential/permission checks follow after handoff; metadata rejection alone does not prove authorization.

## 10. Configure Google identity and complete the web handoff

1. Open **Identity Platform** in the same project, enable it, and open **Providers → Add a provider → Google**. Keep email/password, anonymous sign-in, and other providers disabled.
2. In **Google Auth Platform**, configure branding/support email and the intended audience. For the learning launch use the available testing configuration with only your intended test accounts; add invited staff as OAuth test users where required. Broad access later may require consent-screen publication/verification.
3. Create/select the web OAuth client and enter the exact provider-requested client ID/secret in Identity Platform. Keep the OAuth secret in the provider configuration, never in a browser/APK. Register the exact auth-handler redirect URI displayed by Identity Platform, not a guessed callback path.
4. Copy the web SDK public configuration from **Configure your application**: API key, auth domain, project ID, app ID. Retain the web OAuth client ID for Android Credential Manager setup. Restrict client API keys according to the actual SDK/Identity Toolkit API usage; a key identifies a project and does not grant author access.
5. Follow [the frontend deployment guide](FRONTEND_WEB_DEPLOYMENT_GUIDE.md) to deploy at the canonical `WEB_ORIGIN` already selected for the paired builds. Add its exact hostname to Identity Platform authorized domains and its origin to OAuth authorized origins where applicable. Register the SDK auth-handler domain/redirect as instructed by the provider setup.
6. If an actual endpoint differs from the planned canonical origin, update the reviewed profiles, rebuild from the authorized refs and repeat configuration verification before deploying the paired digests. Do not use wildcard CORS or change only a runtime URL on an existing artifact.

Use no persistent browser refresh token and no database custom-role claims in the provider configuration; those are application behaviors from the plans. Application membership may reject an uninvited person even if Identity Platform created their identity. [Google provider setup](https://docs.cloud.google.com/identity-platform/docs/web/google).

### Bootstrap first admin without a public backdoor

1. Open the configured web sign-in page and sign in with the intended initial admin Google account. An initial “not invited” response is expected; the Identity Platform identity can still exist.
2. In **Identity Platform → Users**, find that account and copy its UID and verified email.
3. Create a private job `blogpost-bootstrap-admin`, using the paired operations digest/SQL connection/common variables, identity `blogpost-bootstrap`, command `node`, argument `dist/ops/bootstrap-admin.js`, `SQL_APP_PASSWORD` from its numeric secret version and matching `SQL_APP_SECRET_REF`. Set ordinary `INITIAL_ADMIN_UID`/`INITIAL_ADMIN_EMAIL` matching the verified identity, plus the chosen `INITIAL_ADMIN_DISPLAY_NAME` and stable `INITIAL_ADMIN_HANDLE`. Keep these one-time identity inputs out of public receipts.
4. Execute once. Expected: verified Google identity matched, first active admin created. If any active admin already exists, the script must only allow a harmless verification for the same member; otherwise fail.
5. Sign in again on web. Confirm `/studio/admin` works. Create editor/author invitations and manually share links as needed.
6. Delete the bootstrap-admin job and revoke bootstrap's remaining app-secret/identity lookup/SQL Client access. No bootstrap flag remains on the public API.

## 11. Retention job, backups, and monitoring

Create `blogpost-maintenance` as another private Cloud Run Job using the current paired operations digest and `blogpost-ops`: command `node`, argument `dist/ops/maintenance.js`, common profile configuration, `SQL_APP_PASSWORD` from its numeric version and matching `SQL_APP_SECRET_REF`, one task/parallelism one, timeout 10 minutes, at most one retry. It enforces the SQL advisory lock and idempotent deletion described in the backend plan.

Execute once manually and inspect its counts/result. Grant **Cloud Run Invoker** to `blogpost-scheduler` on this job only. Open job **Triggers → Add Scheduler Trigger**, name `blogpost-retention-daily`, choose a supported nearby Scheduler region, frequency `0 3 * * *`, timezone `Asia/Jakarta`, and select `blogpost-scheduler`. This schedules maintenance, not article publication. [Console job scheduling](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule).

In SQL **Backups**, check the daily window/retention and create an on-demand backup labelled with this release. Confirm an actual successful daily backup after the next window. In **Monitoring**, create verified notification channels and alert policies for: sustained API 5xx/readiness failure, SQL connections near its actual limit, database disk above 70%/90%, failed backup/maintenance execution, and memory pressure. Use standard metrics and narrowly scoped log-based alerts; no article/request-body logging. [Standard backup management](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/manage-standard-backups).

### Restore drill before considering recovery ready

1. In SQL **Backups**, choose a successful backup and Restore. Select a **new temporary instance** in the same project, matching engine version/capacity. Review the displayed target twice; never overwrite the live instance during a drill.
2. Record the restored instance connection name. Prepare a reviewed recovery profile for that socket and the matching numeric restored-credential references. Build a paired operations artifact from the authorized environment ref, verify its configuration, and create the temporary verification job from that digest. Confirm schema, representative posts/revisions/taxonomy, and runtime privilege restrictions.
3. Check media references against the existing private bucket without running cleanup. SQL backup does not back up image bytes. Restore accidentally deleted objects through the bucket's soft-deleted-object view while still within seven days, or document the loss if outside retention.
4. Record backup timestamp, elapsed restoration time, verification results, and the effective data-loss window. Remove only the clearly named temporary job/instance after verification, handling deletion protection on that temporary instance deliberately.

For a real incident, suspend maintenance and writes, restore to a new instance, inspect application-level deletion/withdrawal history so restoration does not republish removed content, then produce authorized-ref API/operations artifacts paired with the reviewed recovery target and numeric credential references. Verify the actual service/job bindings before switching traffic or running recovery jobs. Restoring a backup can lose changes since the backup, including editorial/security changes; reconcile membership/roles before reopening writes. SQL and GCS retention are separate failure domains. [Restore overview](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/restore).

## 12. Manual recovery release and rollback

Normal releases use the automatic CI/CD pipeline. Before invoking this alternative, record the reason and actual live revision/traffic; afterward reconcile deployment records so a stale Actions rerun cannot overwrite the recovery.

For every backend release:

1. Run the manual build trigger for the reviewed ref; record source SHA, test result, contract/schema version, image digest, and existing good API revision/digest.
2. Verify compatibility with the deployed web and supported Android versions. Migrations must use an expand/contract strategy and keep the current API compatible with the expanded schema.
3. Take an on-demand backup and wait for success. Update the migration job to the **new digest**, review configuration, execute, then run the matching verify job. Stop if either fails.
4. In the API service use **Edit & deploy new revision**, select the new digest, preserve secrets/SQL/scaling/security settings, and uncheck immediate traffic routing where offered. Give the candidate a temporary tag for its test URL.
5. Open candidate health routes and verify the expected wrapped missing-metadata rejection on a direct `/v1` browser request; confirm no private payload logs. Full local conformance/permission checks must already have passed for that source SHA. Then use **Manage traffic** to switch. The single-cloud-environment choice means real-origin authenticated smoke checks happen immediately after the switch.
6. Use stable Web/Android clients, which supply all five headers, to check successful public responses and the protected publish/correct/withdraw journey. Check wrapped errors, trace correlation, version conflicts, and idempotent retries. Roll back promptly on failure. Update operations jobs to compatible digest after success and record the release; remove the temporary tag when finished.

On application failure, use **Revisions → Manage traffic** to restore the recorded good revision to 100%, then verify. Configuration/secrets must still match that revision. Traffic rollback does **not** reverse a database migration; only roll back code compatible with the current schema. A destructive schema change needs a reviewed forward repair or the recovery procedure, with its stated data loss. Keep at least three known good image digests and every digest still used by jobs/services; never delete an image solely because its tag looks old. [Traffic/rollback controls](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration).

## 13. Troubleshooting and final checks

| Symptom                              | Console checks and recovery                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No repository/manual event available | For this recovery path use Cloud Build Repositories **2nd gen**, check region/connection/App installation authorization; normal automatic releases follow the CI/CD guideline |
| Build log destination error          | Selected custom build SA and prepared `CLOUD_LOGGING_ONLY`; Logs Writer grant                                                                                                 |
| Image push/pull denied               | Registry name/region and build Writer/service-agent Reader permissions; no downloaded keys                                                                                    |
| Container fails to start             | Correct image entrypoint/port/bind address, env validation, secret numeric version, startup logs                                                                              |
| Direct `/v1` browser URL returns 400 | Expected without the five metadata headers; use health URLs for direct positive checks and implemented clients/conformance fixtures for successful API checks                 |
| SQL connection denied                | Actual connection name, attached SQL connection, API enabled, runtime Cloud SQL Client, database role/password/schema                                                         |
| Connection exhaustion                | Pool max 3, max instances 2, overlapping revisions/jobs, actual SQL limit; reduce concurrency before raising limits blindly                                                   |
| Session creation denied              | Custom identity role has `firebaseauth.users.createSession`; token is Identity Platform-issued, recent, correct project, active member                                        |
| Google sign-in fails                 | Exact domains/origins/auth-handler URI, OAuth audience/test users, correct client type; inspect provider errors without logging tokens                                        |
| Private images fail                  | Bucket IAM, asset belongs to post/current revision, object generation exists; do not make storage public                                                                      |
| Migration fails                      | Preserve current service traffic, inspect failed step, produce reviewed repair image; never reset production                                                                  |
| Costs exceed plan                    | Billing service breakdown; SQL baseline, min instances, logs, old artifacts, backups/soft deletion, egress/builds; alerts are not a cap                                       |

Release checklist:

- [ ] Correct project and immutable source/image recorded; this manual setup/recovery action is coordinated with the normal CI/CD pipeline.
- [ ] No runtime/build account has Owner/Editor or a downloaded key; secrets are scoped and version-pinned.
- [ ] SQL app/migrator restrictions verified; root bootstrap access removed.
- [ ] API health/meta/published feed work and protected routes reject unauthorized access.
- [ ] Web/Android role, revision-conflict, publication, correction, withdrawal, private-media, and invitation checks pass.
- [ ] Daily backup/maintenance execution succeeds; restore drill is recorded.
- [ ] Logs/alerts/budget recipients verified; actual cost estimate accepted.
- [ ] Last good revision/digest and compatible rollback path recorded.

If retiring the demo, first preserve desired data and backups; stopping Cloud Run traffic does not stop SQL/storage charges. Remove only identified Blogpost resources through their Console pages, considering retained backups/soft-deleted objects and deletion protection. Do not delete the whole project if it contains other work.

Before staging can gate a promotion, verify its live `/v1/meta` build/deployment metadata, separate identity/membership, real storage behavior, daily backups, and current trusted RC evidence. No production data is copied into staging. Any manual config/revision/schema change invalidates affected evidence until the RC verification procedure runs again.
