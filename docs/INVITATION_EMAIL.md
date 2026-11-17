# Invitation email

Staff invitations can be emailed through [Resend](https://resend.com/docs/api-reference/emails/send-email). Email is optional per environment: without an `email` block in the environment profile, the API behaves exactly as before. Administrators copy and share the one-time link themselves, and every invitation reports `delivery.status = NOT_REQUESTED`.

## How it works

- Creating or reissuing an invitation writes an `EmailOutbox` row in the same transaction. The accept link is sealed with AES-256-GCM under `EMAIL_PAYLOAD_KEY`, with the row ID as associated data. The invitation table still stores only the token hash.
- After the write commits and its administrative lock is released, the API makes one send attempt with a 5-second timeout. The response reports the resulting `delivery` state.
- Cloud Scheduler calls `POST /internal/email-outbox/dispatch` every 2 minutes. It retries due rows with backoff of 1 minute, 5 minutes, 15 minutes, 1 hour and 6 hours, for at most 6 attempts in total. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so the request-time attempt and the sweep never send the same row twice.
  - A 429, a 5xx or a network error is retried.
  - Any other provider response is final.
  - Each send carries the row ID as its `Idempotency-Key`.
- When a row reaches a final state (sent, failed or cancelled), its ciphertext is wiped. Reissue, revoke and acceptance cancel pending rows. Rows are deleted with their invitation when the daily maintenance job removes expired invitations.
- A final failure writes `INVITATION_EMAIL_FAILED` to the staff audit log. The entry holds the error code and attempt count, never the link, and its actor is the issuing administrator.
- One email per recipient per 60 seconds. A faster create or reissue for the same address returns `429 RATE_LIMITED` with `Retry-After`.
- Resending an invitation is a reissue. The token rotates, so earlier links stop working.

## Enabling email in a cloud environment

1. **Verify a sending domain in Resend.** Add its SPF and DKIM records, then confirm **click tracking and open tracking are off** for the domain. Click tracking would rewrite the single-use accept link through a tracking host.
2. **Create two Secret Manager secrets** in the environment's project, then grant the API runtime service account (`serviceAccounts.api`) `roles/secretmanager.secretAccessor` on each:
   - a Resend API key with sending access only (`re_…`);
   - a separate random 64-character lowercase hex key for `EMAIL_PAYLOAD_KEY`, for example `openssl rand -hex 32`.
3. **Use the existing `blogpost-scheduler` service account** that triggers the maintenance job (deployment guide, section 11). It must be different from the four runtime identities. Also grant it **Cloud Run Invoker** on the API service.
4. **Add the `email` block** to the reviewed environment profile, using numeric secret versions:

   ```json
   "email": {
     "from": "Blogpost <no-reply@your-verified-domain>",
     "dispatchAudience": "https://API_SERVICE_URL",
     "dispatchInvoker": "blogpost-scheduler@PROJECT.iam.gserviceaccount.com",
     "secretVersions": {
       "RESEND_API_KEY": "projects/PROJECT/secrets/blogpost-resend-api-key/versions/1",
       "EMAIL_PAYLOAD_KEY": "projects/PROJECT/secrets/blogpost-email-payload-key/versions/1"
     }
   }
   ```

   The block is all-or-nothing: a partial block fails the build. For the API purpose only, it adds the literals `EMAIL_FROM`, `EMAIL_DISPATCH_AUDIENCE` and `EMAIL_DISPATCH_INVOKER`, and the secret mounts `RESEND_API_KEY` and `EMAIL_PAYLOAD_KEY` together with their `RESEND_SECRET_REF` and `EMAIL_PAYLOAD_SECRET_REF` declarations. The deployment verifier checks these like the existing bindings.

5. **Build and deploy the API** from the reviewed branch.
6. **Create a Cloud Scheduler job:**
   - Schedule `*/2 * * * *`, time zone Asia/Jakarta.
   - HTTP `POST` to `https://API_SERVICE_URL/internal/email-outbox/dispatch`.
   - Auth header: OIDC token, service account from step 3, audience equal to `dispatchAudience`.
   - The endpoint answers `404` to anything except a valid Google-signed token for that audience and account.
7. **Smoke test:**
   1. Invite an address you control. The receipt must say **Emailed to …** (the first send succeeded and Resend returned a message ID), and the email must arrive.
   2. Check that the link is not rewritten, and accept it.
   3. Resend the invitation and confirm the old link returns `410`.

## Local development

`EMAIL_DRIVER=log` (development only) writes the rendered email, including its link, to the API log instead of sending. It also needs `EMAIL_FROM` and `EMAIL_PAYLOAD_KEY`. `EMAIL_COOLDOWN_SECONDS` (0–60) may lower the cooldown in development only. The identity test suite uses the log driver with no cooldown.
