# Blogpost Next.js web implementation plan

Interview decisions accepted on 25 October 2026. This plan implements domain rules in [the backend plan](BLOGPOST_BACKEND_PLAN.md) and authoritative wire rules in [API_CONTRACT_V1.md](API_CONTRACT_V1.md). Follow [the web deployment guide](FRONTEND_WEB_DEPLOYMENT_GUIDE.md) after implementation; provision shared infrastructure with [the backend guide](BACKEND_DEPLOYMENT_GUIDE.md).

Delivery policy update: [VCS_GUIDELINE.md](VCS_GUIDELINE.md) and [CI_CD_GUIDELINE.md](CI_CD_GUIDELINE.md) govern reviews, versions, and automatic GCP deployment after a marked main release. The Console guides remain bootstrap/recovery instructions.

[BUILD_VARIANTS_PLAN.md](BUILD_VARIANTS_PLAN.md) governs Docker Development on feature/work branches, automatic isolated RC Staging, and independently built main Production. Staging/Production use `NODE_ENV=production`, distinct `APP_ENV`, paired API/identity origins, and environment-specific public build inputs. A staging browser bundle cannot be repointed by changing runtime `NEXT_PUBLIC_*` values.

## 1. Outcome and boundaries

Create a responsive, reading-first publication with strong typography, restrained navigation, English copy, light/dark themes, accessible articles, and a complete staff workspace. Public visitors need no account. Invited authors write and submit; editors/admins review, publish, withdraw, and manage taxonomy; admins additionally manage invitations and staff access.

Use a separate web repository. Pin Next.js **16.x** at a supported security-patched version, compatible React, TypeScript, and Node.js 24 LTS. Use App Router, Server Components for public content, Client Components for editing/interactive controls, accessible headless UI primitives, and CSS variables/Tailwind for tokens. Record exact versions and lockfile at kickoff. Next's support policy identifies supported release lines; recheck before shipping. [Next.js support policy](https://nextjs.org/support-policy).

All editorial, ownership, revision, publication, taxonomy, media, and membership rules live in Node. No Prisma, SQL client, bucket access, or duplicate publication logic in the web app. The thin Next.js server proxy handles browser-session transport and CSRF, then calls the REST API. Server Components fetch the backend directly rather than taking an extra trip through local Route Handlers. [Next.js BFF guidance](https://nextjs.org/docs/app/guides/backend-for-frontend).

No service worker/offline public web app, reader accounts, comments, analytics, advertising, scheduled publication, or notifications in this release. Durable **editor** drafts work offline after the editor has been loaded; that does not imply the entire web site can cold-start offline.

## 2. Application structure and pinned API contract

```text
src/app/(public)/{page.tsx,posts/[slug],categories/[slug],tags/[slug],authors/[handle],search}/
src/app/(staff)/studio/{posts,review,trash,profile,taxonomy,admin}/
src/app/{sign-in,invite/[token],api/session,api/csrf,api/editorial/[...path]}/
src/app/media/[postId]/[mediaId]/[variant]/route.ts
src/app/{robots.ts,sitemap.ts,health/live/route.ts}
src/features/{reading,editor,review,taxonomy,members,invitations}/
src/lib/{api-server,api-client,session,csrf,drafts,markdown,config}/
src/components/{ui,article,layout}/
contracts/{openapi-v1.0.0.json,manifest.json,markdown-fixtures}/
test/{integration,e2e}/
Dockerfile
cloudbuild.yaml
```

Generate TypeScript request/response types with `openapi-typescript` from the pinned design-first OpenAPI 3.1.2 contract release, not from a live service at build time. Validate required envelope/DTO boundaries at runtime. Keep server-only modules out of browser bundles. API adapters use the common success/error envelope, map stable `error.code` to client-owned copy, and preserve `traceId`/`X-Trace-ID` for diagnostics. Lists remain arrays in `data`, with pagination in `meta.pagination`.

Use the shared versioned stateful mock while backend implementation proceeds. Development-only fixture identity permits independent work; production cannot enable it. Pin schemas, fixtures/checksum, and mock behavior together. Treat unknown optional response fields/codes/actions safely; critical v1 role/workflow enums remain fixed and unexpected values disable unsafe editing.

Backend-owned Compose runs the real local API/auth emulator/media adapter or a separate pinned mock recipe. Per-feature stacks get separate host ports, volumes, session/CSRF cookie names, and local-recovery namespaces; localhost ports alone do not isolate cookies. No local/cloud runtime environment switcher is shipped. Staging also rejects all fixture/emulator controls. Development/Staging always show accessible environment banners; staging is public/synthetic with noindex, and production retains normal indexability.

Every backend request includes `X-Device-ID`, `X-Device-OS`, `X-Device-Version`, `X-App-Version`, and `X-App-Language`, including anonymous SSR, metadata, uploads, and media. A request-scoped factory resolves a first-party random installation/profile cookie before rendering, forwards visitor context rather than server OS, uses `unknown` for unavailable OS releases, and preserves valid browser-bundle versions. Header values are diagnostics, never authorization. Browser image requests acquire backend headers through the existing media proxy.

Use runtime `BACKEND_ORIGIN` on the server, plus `WEB_ORIGIN`, `WEB_LOGIN_ENABLED`, and secret `WEB_CSRF_SECRET`. A whitelisted `/api/public-config` exposes only ordinary `IDENTITY_WEB_API_KEY`, `IDENTITY_AUTH_DOMAIN`, `IDENTITY_PROJECT_ID`, and `IDENTITY_WEB_APP_ID` values to the browser. Public-reading startup supports disabled login before the final web origin is known; enabled login requires the exact origin. Do not rely on runtime edits changing build-inlined public variables.

During the first public-only deployment with no configured origin, omit canonical/social absolute URLs and disable invitation-link generation; do not derive security-sensitive URLs from an arbitrary incoming Host header. Enable complete metadata once the actual origin is configured.

Backend contract changes arrive as an explicit dependency PR with checksum and fixture changes. CI rejects undocumented breaking changes and runs against the previous supported contract as appropriate. All dates use ISO timestamps on the wire, readable local dates in the UI, and an explicit timezone in staff audit/review details.

## 3. Routes, navigation, and permissions

| Route                                     | UI and behavior                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/`                                       | Latest published posts, summary cards, category navigation, search; bounded page loading |
| `/posts/[slug]`                           | Title, summary, author, first-published/updated dates, readable body, tags, share link   |
| `/categories/[slug]`, `/tags/[slug]`      | Filtered public articles; empty states and durable URLs                                  |
| `/authors/[handle]`                       | Public display name/bio and published posts; no private email                            |
| `/search?q=...`                           | Ranked title/summary/body results and author/category/tag filters                        |
| `/sign-in`                                | Google sign-in, invitation/access guidance, recoverable error states                     |
| `/invite/[token]`                         | Single-use invitation acceptance with the matching verified account                      |
| `/studio/posts`                           | Own drafts/work for authors; broader post filters for editors/admins                     |
| `/studio/posts/new`, `/studio/posts/[id]` | Markdown editor, metadata, preview, local-save/sync state, workflow actions              |
| `/studio/posts/[id]/history`              | Immutable revisions and restore-to-draft action                                          |
| `/studio/review`                          | Submitted revisions, comparisons, feedback, reject or review-and-publish                 |
| `/studio/trash`                           | Recoverable items and purge date; restore remains unpublished                            |
| `/studio/profile`                         | Display name/bio; private identity information clearly separated                         |
| `/studio/taxonomy`                        | Editor/admin category/tag creation, edit/archive, reassignment requirements              |
| `/studio/admin`                           | Admin invitations, role/active changes, author reassignment, audit metadata              |

Navigation exposes actions appropriate to `GET /v1/me`, but every action handles authoritative `403` responses. Page/load authorization happens in server data functions and Route Handlers; a route proxy/middleware redirect alone is insufficient. Inaccessible drafts render a generic unavailable view rather than leaking titles.

Authors can save, submit, and withdraw review on their own posts. Editors/admins can review/publish on both platforms, including their own articles because of their role. All users see the working-versus-published distinction explicitly. Web-only admin screens do not imply backend permission can be bypassed from Android.

## 4. Reading design and accessibility

Use a 65–75-character article measure, comfortable line height, responsive type, subtle borders, and a quiet background. Create shared named tokens for colors, spacing, typography, radii, and focus states. Adapt the Android scaffold's primary/selection/error roles to a related web palette; exact platform geometry need not match. Respect system theme initially and persist an explicit override without a hydration flash.

Phone: single column, accessible menu, horizontal code/table containers. Desktop: restrained content navigation and optional article table of contents without crowding the text. Cards show title, short summary, author/date, category, and optional cover image; do not make several nested links compete for one click target.

Target WCAG 2.2 AA-oriented behavior: semantic landmarks/headings, skip link, visible focus, full keyboard operation, sufficient contrast in both themes, reduced motion, zoom/reflow checks, labelled controls, descriptive links, and accessible dialogs/focus restoration. Code blocks have language labels and a keyboard-accessible copy button. Tables use actual header cells and accessible overflow, not clipped columns. Informative images require alt text; decorative images have empty alt text.

Public page states: loading skeleton, no posts, no matching search, unavailable/withdrawn article, API unavailable with retry, and media unavailable. On a network failure, do not invent an empty result or return a false article `404`. Avoid a short-lived outage being indexed as permanent removal: serve an explicit temporary error status through the server boundary and test the emitted HTTP response.

## 5. Public rendering, SEO, and withdrawal

Server-render published data on request. Use explicit `cache: 'no-store'`, dynamic article/metadata routes, and `Cache-Control: no-store` for article HTML, metadata-dependent responses, public media, and public data requests. Do not enable ISR, persistent Data Cache, a shared article CDN, or stale-on-error content for this release. Immutable hashed JS/CSS can retain the framework's immutable caching.

A page request and metadata generation should share a request-scoped fetch/result to avoid conflicting revision reads within one render. Keep response caches disabled across requests. Client query caches may exist only as short-lived UI state; refetch availability when returning to a visible article, and never persist public body/media in browser storage.

Emit unique title/description, canonical URL, Article structured data, Open Graph metadata, sitemap, and robots rules. Do not use draft content in social previews. Use a static brand social image initially, avoiding a third-party social crawler retaining private article images. Exclude studio, invitations, sign-in, search results, and previews from indexing. Paginated category/tag routes may be indexed when they have meaningful unique content; filter combinations should avoid duplicate indexable URLs.

Backend slug-history descriptors become a single `308` redirect to the current published canonical URL. If the target is withdrawn, return the same unavailable `404` as a direct article request; never redirect into an unpublished working revision. Publication dates retain the first-published date; corrections update `dateModified`.

Withdrawal affects subsequent server requests. Already open tabs may show old content until refocused/refreshed; offline screenshots and social/search-engine copies cannot be erased. Public API failures must not trigger a redirect to an old cached article.

## 6. Web session and proxy design

Implement the exact backend session contract:

1. Obtain a signed CSRF token from `/api/csrf`; use an exact configured `WEB_ORIGIN` and a `__Host-blogpost_csrf` secure, same-origin cookie. Sign tokens with `WEB_CSRF_SECRET`; bind authenticated tokens to the current session fingerprint and include expiry. Validate signature, header/cookie match, Origin, and content type for mutations.
2. Sign in with the Identity Platform web SDK using in-memory persistence and Google. Check OAuth cancellation, popup blocking, account mismatch, and access denial distinctly. Provide redirect flow fallback only with validated return paths and CSRF/state continuity.
3. POST the Identity Platform ID token to `/api/session`. The server calls `/v1/auth/web-session`, then sets `__Host-blogpost_session` as specified in the backend plan. Never return a session/refresh token in browser JSON or local storage.
4. Clear the web SDK sign-in state after exchange. Five-day session expiry requires fresh Google sign-in; preserve durable local work while the user reauthenticates.
5. The allowlisted `/api/editorial/...` handlers read the HttpOnly cookie, set `X-Blogpost-Web-Session` themselves, and forward permitted REST paths only. Strip browser-supplied credentials/identity assertions; construct all five metadata headers through the validated factory, forward `X-Expected-Version`, `Idempotency-Key`, content type and W3C trace context, and pass through `X-Resource-Version`, `X-Trace-ID`, contract version, Location and Retry-After where applicable. Preserve correctly wrapped backend JSON; normalize only errors the BFF owns, without double wrapping.
6. Log out through a CSRF-protected POST. Warn about unsynced drafts, allow export or cancellation, then clear app-owned staff storage, session/CSRF cookies, and in-memory query state. Signing out locally does not claim to revoke a stolen cookie on other devices; admin disablement and Identity Platform revocation remain authoritative server controls.

Before invitation acceptance there may be no membership and therefore no web session. Accept the invitation with the short-lived in-memory Identity Platform ID token through a dedicated protected proxy route, then create the regular session. If the chosen Google account mismatches the invitation, provide an account-switch path without consuming the invitation. Remove invitation tokens from visible navigation/history as early as possible; no third-party assets on that screen.

Implement strict CSP with required Google auth endpoints explicitly permitted, `frame-ancestors`, `nosniff`, and a suitable Referrer Policy. Use nonces where required; do not add broad `unsafe-eval` to production. Route handlers enforce body limits/timeouts before forwarding. The backend origin comes from server configuration, never a user-supplied URL. Test open redirects, arbitrary proxy paths, login/logout CSRF, session fixation, and accidental secret serialization.

## 7. Editor, local durability, and conflict UX

Use a Markdown source editor with toolbar and preview. A plain accessible textarea is a viable first version; add an accessible editor library only after testing keyboard/mobile behavior. Toolbar inserts supported headings, emphasis, lists, quotes, links, images, fenced code, and simple tables. Desktop may show a split preview; mobile uses clear Write/Preview tabs. Preview is never a public share link.

Show title, summary, category, up to five tags, cover image, Markdown validation, and a status strip with these separate facts:

```text
Saved on this device at …
Last synced to server at … / Unsynced changes
Working revision … / Published revision …
Draft / In review / Changes requested / Published with unpublished changes
```

Use IndexedDB, keyed by UID and stable post ID or a client-generated temporary draft ID. Store Markdown/metadata, base revision and version, complete base snapshot, local edit generation, image blobs pending upload, and last successful sync. Debounce local transactions, flush on controlled editor exit, and make local-save failure visible. Do not rely on `beforeunload`, a last-second request, or React state for durability.

At first editor use, explain that local drafts remain on this browser profile. Handle storage quota errors, browser eviction/private mode, database migration failure, and unavailable storage. Offer Markdown export when durable persistence cannot be established; do not claim saved status until a transaction commits. Browser persistence requests improve durability but cannot guarantee it.

Explicit **Sync** captures an immutable local edit generation, independently stages necessary images, then saves the snapshot with `X-Expected-Version` and a stable `Idempotency-Key`. Staged uploads have their own operation keys, require no post-version precondition, and do not advance the post version. New typing during sync remains dirty. Only acknowledge the captured generation after success. Keep source image blobs until the referencing revision commits; reupload expired staging.

A create request sends the persistent temporary UUID as `clientDraftId` with its initial draft and operation key. Retry uncertain outcomes with the same input/key. After success, map to the server ID while retaining both IDs. After the 24-hour replay window, use authorized client-draft lookup or explicit recovery rather than silently creating another post. Replayed results are marked in metadata and retain their original version; refetch before adopting current state. Never retry version conflicts automatically against a newer version.

Use BroadcastChannel or an equivalent local lease to warn when the same draft is open in multiple tabs. It is a usability measure, not a replacement for SQL version checks. On `412`, keep three snapshots: original base, current server, local. Show a side-by-side/text diff and let the author adopt server, manually combine, or save local text as a separate new draft. No silent last-write-wins or background publishing. Resolved content is submitted against the newly fetched version.

If a session expires, preserve local work and offer reauthentication. On confirmed account disablement/permission loss, stop sync and offer the unsynced-work warning/export before clearing app-owned staff storage; do not continue showing another author's cached draft. Logout/switch-account completes only after storage clearance succeeds, or presents a clear failure state. Exported files are user-controlled copies.

## 8. Markdown and image delivery

Use a CommonMark-compatible parser plus only the agreed simple-table/fenced-code extensions; disable raw HTML. Use shared fixtures for nested lists, escaping, links, code, tables, missing images, Unicode, and malicious source. Treat backend validation as authoritative; client validation improves feedback.

Recognize only `media://UUID` image references and map them to same-origin web media routes. For public requests, the route fetches `/v1/public/posts/{id}/media/...`; for a staff preview it uses an explicitly authenticated staff route. Never infer public access merely from possession of a session or an object name.

Stream with backpressure and `no-store`; do not buffer an entire large asset unnecessarily. Use normal responsive `<img>`/`picture` with explicit dimensions and approved variants. Do not use the default Next image optimizer for these protected/withdrawable assets because it introduces another image cache. Permit only canonical asset IDs/variant values; no arbitrary remote URLs, storage redirects, signed URLs, or client-controlled request headers.

The web upload route limits a complete request to 6 MiB and enforces the backend's 5 MiB file limit before proxying. Browser image previews use revocable blob URLs, released on replacement/unmount. Show upload, validation, retry, alt-text, and partial-failure states. Referenced assets cannot be permanently deleted independently of retained revisions.

## 9. Staff workflows and edge cases

Review view compares submitted content with the current published revision, shows category/tags/alt text, and names the exact revision being reviewed. **Review and publish** is one explicit editor action; disable while pending, retain its idempotency key, and refresh the authoritative result. Reject requires clear feedback. Editing in-review work first withdraws review.

Unpublish, trash, restore, slug changes, role changes, disablement, and author reassignment require clear consequences and confirmation. Restore goes to draft. Slug UI previews the redirect and rejects reserved/colliding history names. Last-admin rejection explains why the operation cannot proceed without exposing server internals.

Taxonomy UI includes usage counts, archive/reassignment rules, normalized duplicate errors, and `X-Expected-Version` checks. Invitation UI displays expiry, accepted/revoked state, revoke/reissue, and copy-link success; it does not promise email delivery. If create/reissue is replayed after a lost response, its receipt has no secret link (`linkAvailable:false`); offer explicit reissue and explain revocation of the prior link. Public profiles use staff-approved display fields rather than private Google data.

## 10. Delivery, validation, and completion

Implement in vertical stages:

1. Tokens/layout/public article fixture; validate phone/desktop, both themes, keyboard and screen reader structure.
2. Generated REST adapter/public routes/search/SEO/error statuses; validate against live local backend and PostgreSQL.
3. Google login, invitation acceptance, session/CSRF proxy, role-aware staff layout; test with author/editor/admin/uninvited identities.
4. Local-first editor, upload/preview, explicit sync, recovery and conflicts; test interrupted requests, storage failures, two tabs, and typing during sync.
5. Review/history/trash/taxonomy/admin; complete the shared cross-client publishing journey.
6. Fixed-digest Docker release readiness, no-store verification, security/accessibility checks, and automatic deployment/rollback rehearsal under the CI/CD guideline.

Use focused unit tests for draft-state reconciliation, error mapping, CSRF validation, Markdown transforms, and URL policy. Use integration tests for proxy credential stripping, headers, body limits, and backend error forwarding. Use Playwright for Google-auth test adapters/local emulation plus one real configured-provider smoke check, review/publish/withdraw, two-tab conflicts, restoration, invitation mismatch/expiry, and logout cleanup. Test production cookie flags over HTTPS; localhost HTTP uses an explicitly isolated development cookie configuration that cannot activate in production.

Run axe checks and manual keyboard/zoom/screen-reader checks; automated scans alone do not establish WCAG conformance. Test emitted HTTP status, canonical metadata, no draft in initial HTML/RSC payloads, withdrawal of article/media, and absence of secrets in `.next/static` and source maps. Unit mocks do not replace at least one end-to-end run against the real local API.

The multi-stage Docker image uses Next standalone output and copies required public/static assets, runs non-root, honors `PORT=8080`/`HOSTNAME=0.0.0.0`, and starts without contacting a live backend during build. Set a build deployment identifier from the source commit and preserve local drafts across version-skew reloads. Read capabilities/deprecation from `/v1/meta`; application version is normally diagnostic, and critical update restrictions retain local recovery. Follow the contract's 12-month major-overlap/90-day notice policy. Per-instance caches require deliberate coordination if later introduced. [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [official Docker example](https://github.com/vercel/next.js/tree/canary/examples/with-docker).

Release is complete when anonymous reading/search/SEO works, all role journeys succeed, unpublished changes stay private, storage/sync conflicts preserve work, logout clears staff data, public withdrawal is visible on the next request, and the prepared image can be built and deliberately released through the Console guide. Indicative solo effort: 3–4 weeks after the backend contract stabilizes; track assumptions and adjust after the editor durability spike.
