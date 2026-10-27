# Retention and private media cleanup

The operator entrypoint is `dist/ops/maintenance.js` in the operations image. It uses the application SQL role and validated environment/storage configuration; it needs no root/migrator SQL credential, cursor key or identity token. Cloud authentication uses ADC. A daily Cloud Run Job schedule, IAM, alerting and actual GCS/staging evidence remain release gates; this document does not claim they are configured.

For a named local stack, after applying migrations and rebuilding its shared development image:

```powershell
npm run dev:stack -- maintenance foundation
```

This explicitly purges eligible trash and expired uploads. Recover needed drafts/media before invoking it on saved data. Stack startup does not run maintenance automatically. The job reuses the backend image and media volume and its container removes itself afterward; it does not delete Docker volumes. The isolated test runner uses disposable tmpfs SQL/auth/media instead.

## Deletion and retention rules

- Trash becomes eligible after 30 days. The first transaction sets `purgeStartedAt`, denying restoration and reads while object cleanup proceeds. The post and its immutable revision graph are deleted only after every media tombstone records successful object deletion. Slug rows survive with a null post and cannot be deleted/reassigned through the application role. Old URLs remain unavailable and cannot become another article's URL.
- An asset referenced by any retained revision or cover stays retained. Current publication is not the only reference that matters. Unattached media expires after 24 hours; expiry denies access but does not itself prove storage deletion. Expired ready uploads and unfinished deletion tombstones continue using the pending-byte allowance until cleanup succeeds. Superseded attempt plans count separately, with the current attempt reservation counted once.
- Expired processing attempts lose their pending operation before deletion. Their immutable attempt namespace and a lease/grace cutoff fence old workers. Plans and generations remain journaled across partial failures. A retry deletes the same exact generations and records completion only after all those deletes succeed.
- Expired invitations, completed/abandoned idempotency receipts, rate buckets and audit metadata older than 90 days are removed in bounded batches. Receipt cleanup tries the same operation advisory lock used by API writes; it skips an active writer rather than reversing its lock order.
- Managed-prefix reconciliation catches orphan files from late uncertain writes or a worker that disappeared after SQL cleanup. It considers only owned object keys/metadata older than 24 hours, rechecks current asset/journal references, and deletes exact generations. Recent objects, active plans, unrelated files and unrelated bucket objects are preserved. Listing resumes from a SQL checkpoint; deleting the previous local page anchor does not reset pagination.

A session advisory lock admits one maintenance owner per database. The job uses one SQL connection. Each transaction commits before filesystem or GCS I/O; losing a connection releases the session lock, and repeated deletion remains generation-specific and idempotent. Current defaults bound a run to 500 primary row changes, 500 object-delete calls, ten inventory pages and four minutes, with per-statement/storage deadlines. Cascaded child rows are not included in the primary-row count. Large backlogs require further bounded runs and operational capacity review; the job never silently declares a partly deleted post complete.

The filesystem inventory keeps one page in memory and has a scan deadline. GCS inventory disables automatic pagination and includes object versions. Cloud listing requires `storage.objects.list` in addition to the object read/write/delete permissions; see Google's [object listing reference](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/list). Bucket IAM, generation behavior and workload identity must still be checked against the actual staging bucket.

## Results and recovery

The job emits a bounded `maintenance_result` JSON record containing counts, lock acquisition, failures and budget exhaustion, followed by `job_completed` on success. It emits no article bodies, storage names, tokens or credentials. A storage deletion failure retains its SQL tombstone, reports a failure and causes the operator entrypoint to exit nonzero. A competing job reports that it did not acquire the lock. Budget exhaustion leaves resumable work; alert on repeated exhaustion or failures and rerun after the dependency/capacity issue is corrected.

Do not clear tombstones or set deletion-completion timestamps manually to make a failing job green. Restore storage/SQL access and retry. Keep database backups and run the planned restore drill; storage soft deletion, object versions and backups may retain bytes beyond application trash/access deadlines. This job does not promise immediate physical erasure from those systems.
