# Cloud Run runtime-binding verification

`deploy:verify-config` compares a selected image's baked provenance with a Cloud Run v2 service/job observation. It verifies the actual image URI, account, SQL volume/mount and Secret Manager version selectors, in addition to the runtime declaration variables. The API and this checker share purpose-specific binding definitions. A matching declaration string alone does not establish a matching secret mount.

The checked-in `config/deployment-target.example.json` is synthetic. Prepare a reviewed actual target in ignored `.local/deploy/target.json`. Its exact schema contains `schemaVersion: 1`, `purpose`, `region`, `resourceId` and an Artifact Registry `image` URI pinned by SHA-256. Supported purposes are `api`, `bootstrap-db`, `migrate`, `verify`, `bootstrap-admin` and `maintenance`. The region and registry project must match the reviewed Jakarta profile. Supply the provenance extracted from that verified image or its trusted immutable manifest; this command does not attest that an arbitrary provenance file belongs to an image.

For trusted automation, obtain a short-lived OAuth access token through the intended cloud identity and place it in a private runner-temporary file. Pass its path, never its value:

```powershell
npm run deploy:verify-config -- --provenance .local/deploy/provenance.json --target .local/deploy/target.json --access-token-file .local/deploy/access-token.txt
```

The live reader performs authenticated GETs only to Resource Manager and Cloud Run. It first resolves the profile project ID to its active numeric project identity, then reads the exact service/job. Redirects, non-JSON/error responses, invalid UTF-8 and responses over 1 MiB fail. It reads no secret payload and changes no cloud resources. No token, provider error body or plaintext password appears in output. The caller must remove its temporary credential file after use. Cloud workflow/federation wiring and actual-provider verification remain pending.

Offline observations are supported for fixtures and investigation:

```powershell
npm run deploy:verify-config -- --provenance .local/deploy/provenance.json --target .local/deploy/target.json --project-file .local/deploy/project-v1.json --resource-file .local/deploy/cloud-run-v2.json
```

File observations are explicitly marked `provided-json`. Only a fresh API read performed by the live adapter produces `live-api`. The modes cannot be mixed, and a failed live read never falls back to local data. Ordinary editable JSON is not trusted release evidence. Run `npm run test:deploy` to exercise both modes without cloud credentials. Image builds run these tests on the pinned Node runtime as well.

The checker requires settled matching generation/observed generation, a successful terminal condition, resource UID/etag, one container, an approved command, and the exact owning-project SQL mount. API requests use port 8080, timeout 60 seconds and concurrency 20. Jobs use one task/parallelism one, ten-minute timeout, zero retries except maintenance's allowed single retry. Missing retry configuration is rejected because Cloud Run's default is not zero. It rejects mutable image tags, extra environment inputs or secret volumes, emulator/debug hooks, shell wrappers, duplicate variables, plaintext password mounts, mismatched actual accounts and different secret versions/projects. Same-project short, project-ID and observed numeric-project secret names normalize to one reference.

Successful receipts use scope `cloud-run-runtime-binding`. `configurationDigest` matches the application's normalized baked profile. `deploymentBindingDigest` covers the checked image/program, account, SQL binding, request/job controls and nonsecret/reference environment projection. Neither hashes plaintext secret values. The four private first-administrator inputs are deliberately excluded from digests and output; their presence is checked. Resource UID, generation and etag are retained separately so a caller can invalidate earlier evidence after edits or recreation. Never convert the 64-bit generation to a JavaScript number.

This is one release check. CPU/memory/autoscaling budgets, IAM, bucket ownership, domain routing, actual serving revisions/traffic/health, executed-job overrides/results, image attestations and trusted workflow receipts need their own evidence. Compare current live identity/generation/etag with the accepted observation before reusing a receipt. Complete staging, owner validation and recovery gates before enabling deployment.

The separate [rollout executor](CLOUD_RUN_ROLLOUT.md) reuses the runtime-binding projection for actual revision observations and adds preserved budgets, explicit traffic, etag updates, observation and recovery state. It has simulated transport coverage and mandatory trusted collector interfaces; it is not connected to delivery workflows or an operational CLI. This read-only configuration command's receipt scope is unchanged.

The parser follows the official [Cloud Run service](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services), [job](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs), [environment/secret selector](https://docs.cloud.google.com/run/docs/reference/rest/v2/Container#secretkeyselector), [SQL volume](https://docs.cloud.google.com/run/docs/reference/rest/v2/Volume) and [Resource Manager project](https://docs.cloud.google.com/resource-manager/reference/rest/v1/projects) schemas. It deliberately accepts v2 Cloud Run observations; a v1 Knative export requires an explicit reviewed adapter.
