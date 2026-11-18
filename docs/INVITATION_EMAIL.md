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

## Enabling account sign-up in a cloud environment

Public registration, forgot password, password reset and email change use the same outbox as invitations, so the `email` block above must be in place first. They stay off in the cloud until the optional `accounts` block is added: without it the API answers `503 DEPENDENCY_UNAVAILABLE` ("not available yet") on those routes, and invitations and Google sign-in are unaffected.

1. **Turnstile.** In Cloudflare, create a Turnstile widget for the web origin (managed mode). Keep the **site key** (public) and the **secret key**.
2. **Secret.** Store the Turnstile secret key as a Secret Manager secret in the environment's project (for example `blogpost-turnstile-secret`) and grant `serviceAccounts.api` `roles/secretmanager.secretAccessor` on it. Use a secret of its own: it must differ from every other secret in the profile.
3. **Identity Platform.**
   - Copy the project's **web API key** (Firebase console → Project settings → Web API key). It is a public identifier, not a secret.
   - Enable the **Email/Password** provider and set the password policy to a minimum length of 12.
   - Turn on **email enumeration protection**.
   - Disable **user sign-up** for client SDKs (Authentication → Settings → User actions), so accounts can only be created through the API, which applies the captcha, the breach check and the rate limits.
4. **Profile.** Add the block inside `email`:

   ```json
   "email": {
     "...": "as above",
     "accounts": {
       "identityWebApiKey": "AIza…",
       "turnstileSecretVersion": "projects/PROJECT/secrets/blogpost-turnstile-secret/versions/1"
     }
   }
   ```

   The block is all-or-nothing. For the API purpose only it adds the literals `IDENTITY_WEB_API_KEY` and `TURNSTILE_SECRET_REF`, and the secret mount `TURNSTILE_SECRET_KEY`. Setting either value without the block fails startup.

5. **Web.** Set `TURNSTILE_SITE_KEY` to the site key in the web environment. Without it the forms render no challenge, and the API (which has a secret) will refuse every request: set both or neither.
6. **Build and deploy** the API and the web app from the reviewed branches, then smoke test:
   1. Register with an address you control and open the verification link.
   2. Sign in: you should be told the account is waiting for approval. Approve it under Studio → Admin and sign in again.
   3. Use **Forgot your password?**, choose a new password and sign in with it.
   4. From the profile, change the password and the email address.

Links in these emails point at the web origin (`/verify-email`, `/reset-password`, `/confirm-email-change`) and carry a one-time code. A reset link works once and expires in about an hour, which the identity provider fixes.
