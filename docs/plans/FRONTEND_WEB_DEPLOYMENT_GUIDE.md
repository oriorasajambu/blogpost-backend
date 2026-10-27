# Manual Next.js deployment through Google Cloud Console

Prepared 25 October 2026 for [the web implementation plan](BLOGPOST_FRONTEND_WEB_PLAN.md). This deploys Next.js to Cloud Run in the same Google Cloud project as [the backend](BACKEND_DEPLOYMENT_GUIDE.md). It uses manually started image builds and deliberate image deployment through browser controls; no terminal or Cloud Shell is needed.

**Scope update:** normal releases now follow [VCS_GUIDELINE.md](VCS_GUIDELINE.md) and [CI_CD_GUIDELINE.md](CI_CD_GUIDELINE.md): reviewed marked main promotions publish artifacts and deploy automatically. Retain this browser-only procedure for bootstrap and deliberately recorded recovery; do not run competing normal deployment paths.

**Environment selection:** follow [BUILD_VARIANTS_PLAN.md](BUILD_VARIANTS_PLAN.md) and repeat these steps in the selected Staging or Production project, paired with that project's backend/provider/secrets. Staging builds from RC with `APP_ENV=staging`; Production builds from main with `APP_ENV=production`. Both optimized builds use `NODE_ENV=production`, but their public identity configuration is baked separately. Staging keeps minimum zero/maximum one Cloud Run instance; the size instructions below otherwise describe Production defaults. Do not point a Staging web bundle at a Production API or copy cookies/OAuth origins between them.

This is a guide for an implemented, tested application. These planning files do not contain the application, Docker image, or cloud resources. Console procedures were checked against official documentation; no live cloud deployment was performed.

Use [API_CONTRACT_V1.md](API_CONTRACT_V1.md) for wrapped responses, all five mandatory client metadata headers, trace IDs, `X-Expected-Version`/`X-Resource-Version`, and compatibility. The Web metadata factory must also operate before browser JavaScript, on SSR and media backend requests.

## 1. Prerequisites and handoff order

Required: selected environment's working backend `API_URL`, project/billing, Jakarta region, Docker repository `blogpost`, project-local `blogpost-build`/`blogpost-web` accounts, GitHub web access, matching Identity Platform provider, and public SDK configuration. The other environment has independent copies, not shared credentials.

Use this order to avoid guessing a Cloud Run hostname before creation:

| Order | Action                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------- |
| 1     | Backend guide sections 1–9: provision, migrate, verify, deploy API with web login disabled         |
| 2     | Backend guide section 10 provider setup: obtain Google/Identity Platform web configuration         |
| 3     | This guide sections 2–5: build and deploy web with public reading enabled and staff login disabled |
| 4     | This guide section 6: configure the actual origin/provider/backend, then enable web login          |
| 5     | Backend guide's first-admin job, followed by this guide's staff acceptance checks                  |
| 6     | Backend retention, successful daily backup, restore drill, and full cross-client release checks    |

Record the actual project ID, region, backend origin, source ref, resolved web source SHA, build ID, image digest, generated web URL, previous good revision, contract version, and secret version numbers. Keep passwords/tokens out of this worksheet.

Default hosting is the generated HTTPS Cloud Run URL. No custom domain, external load balancer, CDN, Firebase App Hosting, or static bucket site is required. A static export would not provide the selected server session/proxy/rendering behavior.

## 2. Prepare the repository before Console deployment

The developer must commit all of these in the **separate web repository**:

| Artifact                  | Required behavior                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked application        | Supported patched Next.js 16/React/TypeScript/Node 24 dependency set; pinned OpenAPI 1.0.0 copy/checksum and shared fixtures                                        |
| `Dockerfile`              | Linux amd64 multi-stage standalone build; includes `public` and `.next/static`; non-root runtime; listens on `0.0.0.0:$PORT`                                        |
| `next.config`             | Standalone output; build deployment identifier from source SHA; deliberate no-store behavior for published content; controlled image delivery                       |
| `cloudbuild.yaml`         | Locked install, type/lint/unit/proxy/contract checks, selected-environment optimized build/smoke test, image build/push with environment provenance; no deploy step |
| `/health/live`            | Lightweight process/build response; no SQL/bucket dependency and no credentials                                                                                     |
| `/api/public-config`      | Explicitly allowlisted public Identity Platform config and login-enabled flag, obtained from runtime env; no secrets or arbitrary env dumping                       |
| Session/CSRF routes       | HttpOnly cookie, signed CSRF, exact Origin checks, allowlisted proxy forwarding metadata/version/idempotency/trace fields and the common envelope                   |
| Media routes              | Access-aware `no-store` streaming; inject required visitor metadata on backend requests; no optimizer/storage redirects                                             |
| Startup config validation | Public-only first deployment works with login disabled and no `WEB_ORIGIN`; enabled login requires a valid exact origin                                             |

The build must not call the live API, database, or identity provider. Use committed fixtures/test adapters for build-time tests; real Google sign-in is a later smoke check. Server-rendered dynamic content is fetched at request time. Pin base images/packages; do not download an unreviewed CLI at runtime.

The public-config route is a conscious runtime configuration choice: use ordinary `IDENTITY_*` runtime variables and expose only selected non-secret fields. Do not assume changing runtime values can rewrite compiled `NEXT_PUBLIC_*` variables. The web server's backend origin and CSRF secret must never enter the browser configuration response.

Use Next's standalone packaging correctly, including traced runtime files and static/public assets. [Official Next Docker example](https://github.com/vercel/next.js/tree/canary/examples/with-docker).

**Checkpoint:** Local production image tests pass, public rendering does not run during image build, contract checksum is pinned, and secret scanning finds no credentials.

## 3. Prepare runtime configuration and CSRF secret

Open **Secret Manager → Create secret** and create `blogpost-web-csrf-secret` with a cryptographically generated random 64-character value from a password manager. Use automatic replication and note numeric version 1. Grant **Secret Manager Secret Accessor** on this secret only to `blogpost-web`.

`blogpost-web` needs no SQL Client, database password, Storage Object Admin, Identity Platform admin/session role, or service-account key. Backend validates/mints sessions; web transports them through its server proxy. Normal Cloud Run stdout capture does not require broad application logging permissions.

Collect these **non-secret** values from Identity Platform's application setup/provider configuration:

- Identity Platform web API key.
- Auth domain, for example the exact project-provided auth host.
- Project ID and web app ID.
- Web OAuth client ID, recorded for Android/provider setup; it is not a client secret.

An OAuth client secret belongs in provider configuration only. API keys/client IDs are public identifiers; authorization still depends on verified identity plus backend membership. Preserve the provider's required redirect URI and API-key restrictions, and verify sign-in after any restriction change.

## 4. Build the web image with a manual trigger

Select matching Staging/Production build inputs before compilation; public SDK values cannot be changed afterward by runtime variables. Normal builds use GitHub Actions. Staging bootstrap can use reviewed RC source; first Production service creation/recovery uses the main-published Production digest as specified by the variant plan, without building a Production variant from RC.

If the backend connection already exists, reuse its Cloud Build **2nd gen** host connection:

1. Open **Cloud Build → Repositories → 2nd gen**, select Jakarta, and click **Link repositories**. Link the web repository through the existing GitHub connection. If the App installation currently includes only the backend repo, authorize the web repo in the browser flow.
2. Open **Triggers → Create trigger**, name `blogpost-web-manual`, region Jakarta, event **Manual invocation**, source the web's linked 2nd-gen repository, configuration file `cloudbuild.yaml`, service account `blogpost-build`.
3. Confirm the build configuration uses `CLOUD_LOGGING_ONLY`, publishes to the shared Docker repository under image `web`, and cannot deploy. The build service account already has registry Writer and Logs Writer from the backend guide; it needs no web runtime secret.
4. Save, then **Run** the trigger for an existing reviewed release ref. Watch checks, production build, image packaging, smoke check, and push succeed.
5. Record the resolved source SHA/build ID and copy the digest URI from Artifact Registry, such as `asia-southeast2-docker.pkg.dev/PROJECT_ID/blogpost/web@sha256:...`. Use the actual URI, never the illustrative placeholder or a mutable `latest` tag.

Do not use Cloud Run **Connect repository** for this setup/recovery workflow. Normal reviewed main releases use the GitHub Actions pipeline; this manual image path is an explicitly invoked alternative. [Manual builds](https://docs.cloud.google.com/build/docs/manually-build-code-source-repos).

**Checkpoint:** Successful build and immutable digest recorded; no existing web revision changed.

## 5. Deploy the first web revision in public-reading mode

1. Open **Cloud Run → Services → Deploy container**. Select the web digest, service name `blogpost-web`, and Jakarta.
2. Choose request-based billing, autoscaling minimum 0 and service maximum 2 instances. Select 1 vCPU, 1 GiB memory, concurrency 20, timeout 60 seconds, port 8080, and the image's default entrypoint. Use second-generation execution environment where offered.
3. Set service account `blogpost-web`, all ingress, and **Allow public access**. Anonymous visitors need access to the site; Next/backend still protect staff operations. Do not require Cloud Run IAM login for the whole publication. [Public Cloud Run access](https://docs.cloud.google.com/run/docs/securing/managing-access).
4. Configure the following ordinary variables and one secret reference:

| Variable               | Value                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- |
| `NODE_ENV`             | `production`                                                                     |
| `APP_ENV`              | Selected `staging` or `production`; matches built public configuration           |
| `BACKEND_ORIGIN`       | Actual `API_URL` origin, e.g. the complete generated HTTPS host, no `/v1` suffix |
| `WEB_LOGIN_ENABLED`    | `false` for first deployment                                                     |
| `IDENTITY_WEB_API_KEY` | Public web SDK API key                                                           |
| `IDENTITY_AUTH_DOMAIN` | Exact public SDK auth domain                                                     |
| `IDENTITY_PROJECT_ID`  | Selected environment's identity project ID                                       |
| `IDENTITY_WEB_APP_ID`  | Public web app ID from application setup                                         |
| `WEB_CSRF_SECRET`      | Secret reference `blogpost-web-csrf-secret`, numeric version 1                   |

Leave `WEB_ORIGIN` unset while login is disabled. Do not set `PORT` manually; the port control supplies it. Ensure the image honors Cloud Run's bind/port contract. No Cloud SQL connection or bucket volume is configured on web. [Container controls](https://docs.cloud.google.com/run/docs/configuring/services/containers).

5. Add an HTTP startup/liveness probe for `/health/live` if offered. Its success means the process is alive, not that backend dependencies are healthy.
6. Create, wait for Ready, and copy the generated URL as `WEB_ORIGIN`. Open `/health/live`, `/`, a category/search page, and `/sign-in`. Public reading should work; sign-in should clearly say it is awaiting configuration instead of attempting insecure fallback behavior.
7. Inspect web logs for configuration/startup failures and confirm no API credentials, session cookies, invitation tokens, or private article content appear. Open `/api/public-config` and confirm it contains only approved public identifiers/flags.

**Checkpoint:** Site publicly readable on generated HTTPS URL, staff login deliberately disabled, correct backend origin, and no database/storage credentials on web.

## 6. Connect the actual origin and enable staff login

1. Open Identity Platform **Settings/Authorized domains** and add the exact generated web hostname. In **Google Auth Platform → Clients**, check authorized JavaScript origins for this HTTPS web origin and the provider-specified auth-handler redirect URI. Update the test-user audience if needed. Never guess an auth callback or use a wildcard origin.
2. In API **Edit & deploy new revision**, preserve the current backend image and all SQL/secret settings. Set `WEB_ORIGIN` to the copied web origin and `WEB_LOGIN_ENABLED=true`, then deploy. API CORS/session rules must match the exact origin; an `Origin` header is not a substitute for verified identity.
3. In web **Edit & deploy new revision**, preserve its image and existing settings. Set `WEB_ORIGIN` to the exact same value and `WEB_LOGIN_ENABLED=true`. Keep CSRF secret version 1. Deploy deliberately.
4. Open an incognito browser, start Google sign-in, and verify the provider completes to the same site. Before membership exists, a clear uninvited/access-denied screen is expected. Wrong accounts must not accidentally obtain another person's invitation/membership.
5. Complete the **first-admin job** in backend guide section 10. This creates the initial membership using a verified UID/email without a public bootstrap endpoint. Delete/restrict the bootstrap job/account afterward as instructed there.
6. Sign in again. Verify the session cookie in browser developer tools: `__Host-blogpost_session`, Secure, HttpOnly, Path `/`, SameSite Lax, no Domain. Confirm no long-lived session/refresh token in local storage or the public-config response. These browser checks do not require terminal commands.

The web session lasts five days, while fresh login is required to mint it. CSRF token renewal should not destroy local drafts. Replacing/rotating a CSRF secret requires issuing fresh CSRF tokens; account-role changes remain authoritative in SQL and do not wait for cookie expiry.

## 7. Verify the real publication journey

Use the running web UI and test accounts. Do not publish confidential samples.

1. As admin, create an editor invitation and an author invitation. Copy/share links manually; verify the UI does not claim email delivery. Test one wrong account, one expired/revoked invitation, and single-use acceptance.
2. As author, create an article with title/summary/category/tags, Markdown code/table, and an informative image with alt text. Confirm local saved time differs from last cloud sync time. Sync deliberately.
3. Open the same post on another browser/device, edit/sync there, then sync older local changes. Expect a version conflict and preserved local text, not a silent overwrite.

The adapter sends `X-Expected-Version`; a stale write returns wrapped 412 `VERSION_CONFLICT` with a current-version/revision reference. Ensure image staging does not advance the post version. Replay tests retain the original outcome/version with `meta.idempotency.replayed=true`; refetch before adopting current state. A lost invitation-link response replays only a receipt and offers explicit reissue. 4. Submit the chosen draft. As editor, compare the exact submitted revision with the published version, reject with feedback, then repeat submission and **Review and publish**. Confirm the author cannot invoke the editor-only action. 5. Open the public URL in incognito. Check rendered article, canonical URL/metadata, search/filter results, public author profile, code/table layout, and responsive images. 6. Edit/sync a new working revision. The public article must keep the previously published content. Publish the correction and confirm the next page/media request observes the new revision. 7. Withdraw the article. New page/media requests should be unavailable; search must omit it. Reload any old image URL through the API and confirm access is denied. Never fix this test by granting public storage access. 8. Restore a historical/trash item to draft, and verify it is not silently republished. Test logout with unsynced work: warn, permit export/cancel, then clear staff storage on completed logout. 9. Test reader keyboard navigation, theme/contrast, zoom, reduced motion, form errors, and a screen reader. Native Android integration should complete the corresponding cross-client journey before the overall project is considered ready.

Inspect browser Network responses: article/data/media responses are `no-store`; no protected body appears in a shared cache; media is served through the access-aware routes; Next's image optimizer/CDN is not caching it. Hashed JS/CSS may remain immutable. Confirm API failure produces an honest temporary-error state/status rather than a false `404`/empty article. Test initial HTML/RSC payloads for draft leakage and verify staff/invitation routes are excluded from indexing.

Validate required metadata on first-visit SSR and media calls through conformance tests and successful app flows; backend server-to-server headers do not appear in the browser's Network panel. Direct backend URLs without metadata must fail with wrapped 400. Preserve `traceId`/`X-Trace-ID` in diagnostics rather than logging payloads.

## 8. Later releases, configuration changes, and rollback

### Release a new web image

1. Confirm the backend supports the web's pinned OpenAPI contract and record the current good web revision/image plus secret versions.
2. Run `blogpost-web-manual` for the reviewed ref. Check tests and copy the new immutable image digest. Build source SHA is also the Next deployment identifier.
3. In web **Edit & deploy new revision**, choose that digest, preserve runtime variables/secret references/scaling/security, and disable immediate traffic routing if offered. Assign a temporary candidate tag.
4. Test the candidate URL for public rendering/health. Its origin differs from canonical `WEB_ORIGIN`: do not loosen CSRF/OAuth restrictions to log into a temporary candidate host. Real authenticated pre-release validation uses the stable Staging origin and its own project; automated shared-cloud probes remain read-only. Production candidate probes do not use staging credentials.
5. Switch traffic through **Manage traffic** after those checks, then test real-origin Google sign-in/CSRF, editor recovery, and publication on the stable service URL. Keep local drafts safe across any version-skew reload and avoid releasing while a critical editorial action is pending.
6. Record success and remove the temporary tag. Keep current and previous known-good digests available.

On regression, open **Revisions → Manage traffic** and send 100% to the recorded good revision; verify the stable URL. Backend data is unaffected by a web traffic rollback, but old web code still needs compatibility with the current API. Do not assume an old revision automatically uses newly rotated secrets/configuration: inspect its pinned values and create a compatible revision if necessary. [Traffic management](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration).

### Change URLs or rotate CSRF configuration

Runtime settings changes create a revision. To change a domain, coordinate DNS/TLS/ownership, Identity Platform domains/OAuth origins, web `WEB_ORIGIN`, API `WEB_ORIGIN`, canonical URLs, and Android App Links. Use generated Cloud Run hosting until a domain is deliberately configured; this guide does not require buying a domain.

For CSRF rotation create a new secret version, deploy web referencing that numeric version, and issue new CSRF tokens. Keep backend session verification independent. Record the compatible rollback version; do not re-enable a compromised secret solely to restore an old revision.

When Android signing identity is ready, add `/.well-known/assetlinks.json` for the actual application ID and release SHA-256 certificate fingerprint. It contains public association data, not a private signing key. Until verified, shared links open the web site normally.

## 9. Monitoring, costs, and troubleshooting

Use Cloud Run metrics and Cloud Logging for status/latency, instance count, memory, startup failures, backend timeouts, and failed session/proxy operations. Create alerts for sustained web 5xx and backend dependency failure using the existing verified notification channel. Logs use route templates and trace IDs, not full invitation URLs or request bodies.

Include web in the selected project's estimate/budget and review Staging plus Production together; the old US$30 assumption is retired. Minimum zero reduces idle compute, but SSR/proxying, builds, registry storage, logs, SQL, media egress, and backups contribute. Review costs before adding warm instances, shared caches, or a load balancer. Next's ephemeral per-instance cache is not shared storage; the no-store article policy avoids relying on it. [Self-hosting cache considerations](https://nextjs.org/docs/app/guides/self-hosting).

| Problem                                 | What to inspect                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Build unexpectedly contacts live API    | Public routes/metadata are dynamically fetched; build tests use fixtures; no static generation requiring production              |
| Container is not ready                  | Standalone assets/entrypoint, non-root permissions, bind host, port, runtime env validation                                      |
| Site shows empty content                | Correct `BACKEND_ORIGIN`, API readiness, proper error propagation; do not treat backend failure as an empty feed                 |
| Google popup/redirect fails             | Real web/auth-handler domains, OAuth origins/client, provider configuration/test audience, popup fallback                        |
| Login works but staff requests fail     | Correct project token/session scheme; active SQL membership; proxy forwards verified session credential                          |
| CSRF rejects all writes                 | Exact `WEB_ORIGIN`, secure host-only cookie, signed token/session binding, reverse-proxy header handling, correct secret version |
| Images break or remain after withdrawal | Correct public/staff route, post-scoped asset ID, no default image optimizer/Coil-style web persistence/CDN                      |
| Private work reappears after logout     | IndexedDB namespaces/cleanup, in-memory queries/blob URLs, account-switch handling; show cleanup failure                         |
| Old assets/actions fail during release  | Correct source-based deployment ID, compatible stable assets, graceful reload with durable drafts                                |
| Candidate cannot sign in                | Expected until origin is explicitly authorized; do not disable security checks on the production service                         |

## 10. Completion checklist

- [ ] Web and backend origins copied from actual deployments; exact provider/session configuration agrees.
- [ ] This setup/recovery build is manually invoked, source/digest recorded, and build account has no deploy authority; normal releases follow the CI/CD guideline.
- [ ] Web runtime has only its own CSRF-secret access, no SQL/bucket/backend administrator credentials.
- [ ] Public reading/search/metadata work; staff login/roles/invitations are verified.
- [ ] Local draft persistence, sync conflicts, interrupted requests, account switching, and logout cleanup pass.
- [ ] Published/working revisions are separated; withdrawal denies new article/media requests.
- [ ] No raw HTML/scripts, arbitrary URL proxy, secret leakage, or accidental private-content cache.
- [ ] Responsive/accessibility/error-state checks pass and no analytics/ads are introduced.
- [ ] Monitoring/budget recipients and previous-good revision are recorded.
- [ ] Backend backup/maintenance/restore drill and Android integration checks are complete before the overall launch.
- [ ] Selected environment/project/API/provider/cookie configuration agrees; Staging has persistent banners/noindex and synthetic content, while Production remains normally indexable.
- [ ] `/health/build` and the staging receipt report truthful source/revision/input metadata; manual changes have been reverified before promotion.
