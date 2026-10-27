# Backend build provenance

`npm run build:prepare` creates a bounded frozen source context and a nonsecret provenance context under ignored `.local/build-metadata/`. `npm run build:image` passes both to Docker. Use the build helper for Development, API runtime and operations targets; direct build arguments cannot supply build identity. See [ADR-0001](adr/0001-baked-build-provenance.md) for the decision and pending review.

```powershell
npm run build:native
npm run test:build
npm run test:build-images
npm run build:image -- --environment development --target development --tag blogpost-local:development
```

Native preparation writes `.build/provenance.json` for native Development startup. The stack helper prepares its own metadata automatically. After the initial unborn bootstrap, local Development requires an executable `feature/`, `bug/` or `chore/` branch. Dirty files are permitted and explicitly recorded. Cloud builds require a clean exact `rc` or `main` snapshot; detached CI uses matching trusted event SHA/ref and the intended push workflow.

`test:build-images` copies the frozen source into an ignored disposable Git fixture, creates clean synthetic `rc`/`main` refs and tests both optimized API/operations targets with network access disabled. It verifies truthful baked metadata, startup pairing, non-root/read-only files, metadata privacy, unavailable-SQL readiness and operator rejection of the wrong environment. The fixture and two temporary image tags are removed afterward. Its ignored `.local/conformance/build-images.json` receipt explicitly identifies synthetic evidence; it proves no actual GCP deployment or provider integration. Run `npm run docker:cache` after a verification batch to trim unused layers while preserving downloads.

The disposable SDK/PostgreSQL runner pins backend/auth image IDs for its whole run and records their baked provenance alongside the candidate digests. Its operation inventory comes from the frozen source context. A matching source-input digest connects these real SQL checks to the optimized environment checks without claiming the environment-specific images have identical bytes.

The two files under `config/environments/` are synthetic examples. Their `.test` origins, projects, buckets, accounts and version references are not provisioned resources. Prepare reviewed actual nonsecret inputs separately, for example in ignored `.local/profiles/staging.json`. Never put secret values into the profile or pass them to a Docker build. A Staging build then uses:

```powershell
npm run build:image -- --environment staging --profile .local/profiles/staging.json --target runtime --tag blogpost-api:staging-check
npm run build:image -- --environment staging --profile .local/profiles/staging.json --target operations --tag blogpost-operations:staging-check
```

The [manual Cloud Build recovery recipe](CLOUDBUILD_RECOVERY.md) instead requires the actual nonsecret profile committed at `config/environments/staging.json` or `production.json`, so its reviewed source and both image targets bind the same exact inputs. Those files have not been supplied. Private local profiles are not copied into cloud source. Its disposable SQL runner uses Docker API report copying and optimized smoke scripts use stdin, avoiding daemon-side assumptions about workspace bind paths. No actual Cloud Build run or provider provenance is established by local checks.

Both optimized environments require `NODE_ENV=production`. `APP_ENV` must match the baked environment. API startup checks `GCP_PROJECT_ID`, `IDENTITY_PROJECT_ID`, `API_ORIGIN`, `WEB_ORIGIN`, `IDENTITY_TOKEN_AUDIENCE`, `IDENTITY_TOKEN_ISSUER`, `IDENTITY_SESSION_ISSUER`, `INSTANCE_CONNECTION_NAME`, `SQL_HOST`, `SQL_DATABASE`, `MEDIA_ADAPTER`, `MEDIA_BUCKET`, `MEDIA_BUCKET_PROJECT_ID` and `RUNTIME_SERVICE_ACCOUNT` against the baked pairing. It rejects emulator/mock inputs, local credential files, database-URL overrides and unapproved SQL port/schema values.

Secret values arrive only at runtime. Required declaration metadata depends on the command:

| Purpose                        | Account     | Required values                              | Required version declarations                                          |
| ------------------------------ | ----------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| API                            | `api`       | Application SQL password, cursor key         | `SQL_APP_SECRET_REF`, `CURSOR_SECRET_REF`                              |
| SQL bootstrap                  | `bootstrap` | Root, migrator and application SQL passwords | `SQL_ROOT_SECRET_REF`, `SQL_MIGRATOR_SECRET_REF`, `SQL_APP_SECRET_REF` |
| Migration                      | `migrator`  | Migrator SQL password                        | `SQL_MIGRATOR_SECRET_REF`                                              |
| SQL verification / maintenance | `ops`       | Application SQL password                     | `SQL_APP_SECRET_REF`                                                   |
| First administrator            | `bootstrap` | Application SQL password                     | `SQL_APP_SECRET_REF`                                                   |

Each declaration is an exact `projects/PROJECT/secrets/NAME/versions/NUMBER` path matching the profile. `latest`, secret values, mixed projects and shared account identities are rejected. API startup rejects root/migrator SQL credentials. Validation occurs before SQL, identity or storage connections. The [deployment configuration checker](DEPLOYMENT_CONFIGURATION.md) compares actual service/job account, SQL and secret mounts with those declarations. Trusted cloud workflow wiring, image attestation and actual-provider verification remain pending.

`runtimeInputDigest` covers the conservative versioned manifest plus environment/profile; `sourceInputDigest` records environment-independent source inputs for cross-environment evidence. Docs-only equivalence excludes only root README, Markdown below `docs/` and the release marker's publish flag. Unknown paths, contract docs, executable docs, workflow/config/schema changes and versions invalidate equivalence. The actual artifact source SHA remains separate and is exposed as `buildSha`. `/v1/meta` keeps its existing optional deployment fields and does not expose resource names, accounts, secret references or secret values.

Build-stage validation metadata is Development-only and accepted solely by the test process. Final runtime/operations images receive the real prepared record at a fixed root-owned path. Production images contain neither the metadata test generator nor source/test directories. The current local implementation is not a completed release pipeline: trusted CI identity, actual cloud pairing, staging receipts, owner validation, immutable assets and recovery gates remain open.
