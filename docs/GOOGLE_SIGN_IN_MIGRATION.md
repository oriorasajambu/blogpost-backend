# Moving staff from Google sign-in to email and password

Existing members keep their account, handle and posts: a password is added to the same identity (same UID), so nothing is re-linked by address. The move has three stages, and the first two are safe to repeat.

## 1. Release with both ways enabled

Deploy the API and web releases that contain password sign-in. Google sign-in keeps working. Before the cutover, confirm with **one test member** that after choosing a password the account still signs in with Google if you want rollback to work for them (see Rollback).

## 2. Give every member a password

Choose either or both:

- **Administrator action.** Studio → Admin → **Email password setup links**. The API emails a one-time link (`/reset-password?code=…&set=1`) to every _active_ member who has no password yet, and reports `queued` and `skipped`. Members who already have a password, whose account is disabled, or who were emailed within the last minute are skipped. It handles up to 200 members per call and writes a `PASSWORD_SETUP_SENT` audit event. It needs the `email` and `accounts` profile blocks, like every account email.
- **Self-service.** A member opens the sign-in page, chooses **Forgot your password?**, and follows the emailed link. It works for accounts that only ever used Google.

Run the administrator action again after a few days: it only emails members who still lack a password. Links expire after about an hour (a provider limit); a new run issues new ones.

## 3. Cutover

Do this once every active member has a password.

1. Set `googleSignIn: false` in the profile's `accounts` block and deploy the API. From then on the API refuses Google credentials, **including sessions already issued through Google**, so those members sign in again with a password. For local runs the switch is `AUTH_GOOGLE_ENABLED=false`.
2. Set `WEB_GOOGLE_SIGN_IN_ENABLED=false` on the web service and deploy it. The Google button disappears.
3. In Identity Platform, disable the **Google** provider (Authentication → Sign-in method).

The first administrator can be created with either provider (`db:bootstrap-admin` looks the account up by email and accepts a verified Google or password account).

## Rollback

Set `googleSignIn: true` (or remove the key), `WEB_GOOGLE_SIGN_IN_ENABLED=true`, redeploy, and re-enable the Google provider. Members keep their passwords. Whether an account that gained a password stays linked to Google depends on the identity provider (the local emulator drops the Google link; check one real test account first): if it does not, those members can only sign in with their password after a rollback, and may re-link Google from a future release.
