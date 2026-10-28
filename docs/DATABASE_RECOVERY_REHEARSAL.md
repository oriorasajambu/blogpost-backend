# Disposable database recovery rehearsal

Run the populated PostgreSQL upgrade and logical backup/restore rehearsal from a Development work branch:

```powershell
npm run test:recovery -- --build
```

Omit `--build` only when the shared Development image already matches the captured source/input metadata, for example immediately after `test:identity -- --build --compiled-operations`. Source is never overlaid onto an older image. The command accepts no database destination, saved stack, credentials, external archive or output override. The three CI workflows run it after the disposable SDK/SQL check; manual Cloud Build recovery also requires its source-bound result before building publication images. None of these local checks opens the normal delivery gate.

## What executes

The runner creates an internal Docker network, two independent PostgreSQL 17 clusters and one worker with invocation-specific names/labels. SQL, archives, worker state and media use bounded tmpfs storage. No named volume or published port is created. Before mutation, it verifies container ownership, per-run database markers and distinct PostgreSQL system identifiers. The worker requires the fixed disposable credentials and starts with empty application schemas. The API/public-media checks receive application credentials only.

The fixture applies the actual first four checked-in migrations using locked Prisma `migrate deploy`, then populates all seventeen predecessor application tables. Data includes members, invitation/replay/audit/rate-limit records, immutable published and newer private revisions, taxonomy, search, historical slugs, a trashed draft and normalized retained media. This is an explicit **Development four-to-five migration boundary**, not a claimed previously supported release. No historical application source or released-client compatibility is invented.

The rehearsal then:

1. Inspects the pending migration without changing rows/schema/history and captures hashes of every predecessor column/row, schema definitions and migration history.
2. Creates a PostgreSQL custom-format logical dump of the application schema, including data, ownership and grants. It transfers bounded binary bytes through Docker exec stdin/stdout and checks the archive checksum at both ends. No dump file is written to the host.
3. Applies the fifth migration through the actual migration entrypoint, verifies the current schema/permission baseline and four denied runtime probes, reruns migration idempotently and checks that all predecessor data remains unchanged. Public reading, historical slug resolution, private-draft exclusion and all three normalized media variants are checked through loopback HTTP. Rolled-back SQL probes verify immutable revisions and the new permanent slug tombstone behavior.
4. Writes a synthetic member after the backup, restores the backup into the other disposable cluster and verifies the original data, schema and history. The later member must be absent, making the backup cutoff explicit.
5. Injects a restore-time CREATE TABLE failure after cleanup has begun. The failed `pg_restore --single-transaction --exit-on-error` must leave the previously restored schema/data/history unchanged. The injected public event trigger/function is removed before subsequent checks.
6. Upgrades the restored predecessor through the same real entrypoints and checks grants/invariants again. Missing filesystem media must produce a dependency failure; SQL backup alone cannot restore object bytes. Copying the retained normalized objects separately must recover their exact hashes and successful public media responses.

The fifteen named checks describe this fixed scenario. They are not a general migration safety classifier. Every supported released predecessor and its actual older code must receive its own populated compatibility rehearsal before that release can be approved. Drops, changed constraints, new nullable states or other behavior changes still need migration review; passing this fixture does not authorize automatic production mutation.

PostgreSQL documents that custom archives are restored with `pg_restore` and that dumps do not include cluster-global objects such as roles. The target roles/database settings here are established independently by the real bootstrap job. Restore uses a single transaction with errors stopping execution. See [PostgreSQL 17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) and [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html). Only the trusted archive created inside this invocation is restored; arbitrary external archives are never accepted.

## Evidence and cleanup

The nonsecret result is written to ignored `.local/conformance/database-recovery.json` and a run-specific JSON file. It records actual baked/captured source and input identity, migration/schema/data/history hashes, table row counts/column inventory, archive hash/size, media object count and named checks. It contains no row payloads, credential values or image bytes. Original source SHA/dirty state is retained; input equivalence does not rewrite artifact identity. Failures cannot count as successful recovery. Bounded failure diagnostics redact database URLs and disposable passwords.

Only this invocation's exact owned containers/network are removed. A cleanup failure exits nonzero and replaces the result with a failed status. The shared Development image remains available; normal bounded `npm run docker:cache` cleanup is a separate deliberate action. Saved stacks, named volumes and cloud resources are never selected by this rehearsal.

This proves local logical PostgreSQL restoration and filesystem media recovery for synthetic content. It does not prove Cloud SQL backup completion/retention, a GCS recovery strategy, previous-release/old-client compatibility, human recovery approval, measured 24-hour RPO/several-hour RTO, release publication or traffic rollback. Actual cloud recovery still follows the [deployment guide](plans/BACKEND_DEPLOYMENT_GUIDE.md) and [CI/CD backup/migration policy](plans/CI_CD_GUIDELINE.md#72-backend-backup-and-migration-sequence). Do not copy Production data into Staging.
