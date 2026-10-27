# Database deployment verification

The operations image emits migration, read-only history and runtime verification records. The [provider evidence reader](CLOUD_DATABASE_EVIDENCE.md) binds them to actual execution/task/configuration observations; live GCP validation and the trusted deployment writer remain unfinished. A successful local record does not establish a cloud execution, backup, compatible upgrade, staged rollout or release readiness.

## Migration history and bounded execution

`db:migrate` reads the fixed migration directory, checks its PostgreSQL provider and bounded ordinary files, and hashes the exact SQL bytes. Applied history must be a prefix of that inventory. Unknown, duplicate, unresolved or changed successful migrations fail before Prisma runs. After deployment every expected migration must be successfully applied with the matching checksum. Resolved rolled-back attempts remain in the history fingerprint; their original failed bytes can differ after deliberate repair. The job never resolves or rewrites those attempts itself.

This supplements Prisma's own deployment checks: modified migration files can produce a warning, so a zero CLI exit status alone is insufficient. See [Prisma v7 deployment behavior](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production).

The job holds a dedicated session's exclusive schema advisory lock through history inspection, Prisma execution and privilege updates. A competing controlled migration fails with `SCHEMA_OPERATION_BUSY`. Losing the supervising session aborts the CLI. Prisma's native advisory lock remains enabled. The CLI has a two-minute process bound; bootstrap configures the migrator's database-scoped defaults to four seconds for lock waits and sixty seconds per SQL statement. The guard connection retains its shorter five-second query bound. These defaults do not reset passwords or change another database's role settings.

The migration audit does not approve SQL safety. Expand compatibility, the expected predecessor, populated previous-release rehearsals and the pre-mutation backup remain separate gates. No automatic down migration or backup restoration is implemented here.

## Schema baseline

[The checked-in baseline](../config/database/schema-baseline.json) binds the SQL migration digest to PostgreSQL 17 catalog definitions. It covers schema ownership, relations, column types/defaults, constraints, index definitions/readiness, functions, user and internal foreign-key trigger state, enums/types, sequences and row-security policies. Internal trigger names are normalized without retaining database-specific OIDs. Function text and literal line endings remain exact. User rows, changing sequence values and migration diagnostic logs are excluded.

Runtime verification reads a bounded repeatable-read catalog snapshot and requires its fingerprint and effective-permission digest to match. Additional columns/functions, disabled triggers, changed owners/defaults and invalid indexes therefore require investigation. Catalog collections are capped at 2,000 entries and the complete encoded definition at 1 MiB. Another PostgreSQL major requires explicit review and a corresponding baseline change.

Regenerate only from the controlled empty fixture after an intentional migration change:

```powershell
node scripts/dev/database-baseline.mjs --write
npx --no-install prettier --write config/database/schema-baseline.json
npm run test:identity -- --build --compiled-operations
```

The generator captures current Development source, reuses the shared image, creates an internal network and tmpfs PostgreSQL with invocation-specific names, applies the actual jobs and writes the nonsecret baseline. It removes its containers/network afterward. It accepts no saved stack environment, database destination or arbitrary output path. Review the generated definitions with the SQL change; never regenerate from live drift to waive a failed production check. Operations images carry root-owned baseline and migration files that the non-root job user cannot rewrite.

## Runtime authority

Verification connects as `blogpost_app`, without migration/root credentials. It checks role identity, login and inheritance/membership/replication flags, object ownership, schema/database rights and the exact effective table, column and sequence privileges. Column-only grants cannot evade the checks. Bootstrap revokes database CREATE/TEMPORARY from PUBLIC and the two application roles; the application still has its required connection/schema usage and data privileges.

Four real denial probes attempt application-schema DDL, temporary DDL, private migration-history reads and schema-metadata updates. Every probe transaction is rolled back, including an unexpectedly permitted action, and unexpected permission makes verification fail. The record includes only hashes, probe counts and aggregate connection limits/usage. Deployment tooling must compare that budget with actual service scaling, revision overlap and job settings.

## Maintenance coordination

Maintenance takes the schema lock in shared mode before its own exclusive maintenance lock. It skips work when a migration holds the exclusive schema lock or when a surviving migrator session remains connected. The shared schema lock spans storage I/O while SQL transactions still end before I/O. Competing maintenance runs remain excluded by their separate lock. Sessions release locks explicitly and are destroyed on completion; PostgreSQL also releases session locks when their connection ends. See [PostgreSQL 17 advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS).

No saved-data retention run is part of verification. The [maintenance runbook](MAINTENANCE.md) still governs deliberate operator cleanup.

## Record trust and remaining delivery work

Each `database_verification` record contains the actual baked source SHA and input/configuration/contract identity. `kind:MIGRATIONS` includes exact migration IDs/checksums, applied/pending state and history fingerprint; `kind:HISTORY` inspects the same state in a read-only transaction without applying migrations or grants. A valid preflight history can contain pending work and cannot count as ready. `kind:RUNTIME` includes baseline/schema/permission fingerprints, denial probes and connection observations. Secrets, SQL URLs, diagnostic logs and row contents are not emitted.

Cloud jobs require one task, index zero, attempt zero and the platform job/execution identifiers before connecting. Development records use a null cloud execution. The platform's [job environment variables](https://docs.cloud.google.com/run/docs/container-contract#env-vars) identify an execution; their self-description does not authenticate it.

The trusted writer must use the provider reader to validate current history/runtime records against successful provider executions, fixed image digests, authorized source, purpose-specific accounts, SQL/configuration/secret-version bindings and current workflow attempt. The migration record additionally proves any apply phase. It must join the records to the same migration/schema state before issuing a staging receipt. Live provider validation, pre-migration backup, compatible upgrade approval, drift invalidation and rollout/recovery remain unfinished. Promotion and delivery stay closed until that path is implemented and exercised.

The disposable SDK/SQL harness requires the operator failure suite before application scenarios, including history inspection that leaves missing grants and pending SQL untouched. With `--compiled-operations`, it also builds a temporary production-dependency operations image and runs compiled bootstrap, migration rerun, inspection, verification and bounded maintenance against its own tmpfs database. The temporary tag is removed afterward. The seven application suites continue to establish 52-operation local conformance; they do not establish real Google/GCS/IAM or integrated client acceptance.
