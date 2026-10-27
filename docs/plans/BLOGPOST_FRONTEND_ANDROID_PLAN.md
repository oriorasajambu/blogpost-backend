# Blogpost native Android implementation plan

Interview decisions accepted on 25 October 2026. Build on the local scaffold at `D:\Project\AndroidScaffold`, supplied for the repository `https://github.com/Minion-Scaffold/AndroidScaffold.git`. The public/connected GitHub lookup was unavailable; this plan is based on inspected local files, with HEAD reported as `7a3900d5d9aca449632df20f66cb3583d9bf8efb`. No scaffold files were modified and no Android build was run during planning.

Delivery policy update: [VCS_GUIDELINE.md](VCS_GUIDELINE.md) and [CI_CD_GUIDELINE.md](CI_CD_GUIDELINE.md) govern reviewed changes and independent versions. Marked main releases publish signed APK/AAB assets using the preserved app-signing identity; Google Play upload remains manual.

[BUILD_VARIANTS_PLAN.md](BUILD_VARIANTS_PLAN.md) governs the complete `development/staging/production × debug/release` matrix. All six remain enabled with distinct package IDs. Development connects only to its local Docker stack; RC distributes stable-key-signed `stagingRelease`; main distributes `productionRelease`. `productionDebug` supports local anonymous diagnostics only, has no staff sign-in, and is never distributed or production-signed.

Shared domain rules: [backend plan](BLOGPOST_BACKEND_PLAN.md). Authoritative wire behavior: [API_CONTRACT_V1.md](API_CONTRACT_V1.md). Visual/web counterpart: [web plan](BLOGPOST_FRONTEND_WEB_PLAN.md). Cloud endpoints: [backend guide](BACKEND_DEPLOYMENT_GUIDE.md) and [web guide](FRONTEND_WEB_DEPLOYMENT_GUIDE.md).

## 1. Product scope and actual scaffold baseline

Deliver a native reading app plus full invited-staff authoring, review, approval/publication, unpublication, revisions, and trash recovery. Authors submit their own work; editors/admins can review/publish, including their own work because they hold an editor role. Account/role/invitation and category/tag administration remain on web. Android authors select existing taxonomy.

Anonymous reader features: feed, article, author/category/tag navigation, ranked search, local bookmarks, recently read article cache, adjustable reading text size, theme preference, and canonical web sharing. No reader account, push notifications, comments, analytics, or automatic draft background synchronization.

The inspected scaffold already supplies:

| Existing area            | Observed implementation                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module graph             | `:app`, `:core:common`, `:core:domain`, `:core:navigation`, `:core:designsystem`, `:core:ui`, `:core:network`, `:core:data`, `:core:testing`; no feature modules yet |
| UI/architecture          | Compose Material 3, Hilt, MVI `State / Intent / Effect`, typed `AppResult`/`DomainError`                                                                             |
| Network                  | Shared Retrofit 3/OkHttp/Gson, `@BaseUrl` supplied by app, `safeCall`, debug Chucker and HTTP logging                                                                |
| Navigation               | Pure Kotlin serializable route contracts and placeholder `HomeRoute`                                                                                                 |
| Design system            | Theme tokens, components, seven shells, Showkase previews                                                                                                            |
| Toolchain                | Gradle wrapper 9.6.1; catalog AGP 9.2.1/Kotlin 2.4.0/Compose BOM 2026.06.01; compile/target API 37 with compile minor 1; min API 29; Java source level 11            |
| Persistence dependencies | Room 2.8.4 and WorkManager entries exist in catalog, but no implemented database/auth stack                                                                          |
| Tests                    | JUnit, MockK, Turbine, `MainDispatcherRule`; `check` also compiles instrumented tests                                                                                |

Preserve this baseline initially. Java source level is not the Gradle runtime JDK requirement; select the JDK supported by the checked-in wrapper/AGP and validate a clean baseline build before adding dependencies. Do not mix an opportunistic Room 3/AGP/Kotlin migration into feature delivery.

Read and follow the local `CLAUDE.md` and README: pure Kotlin core modules remain free of Android imports; features do not depend on one another; feature implementation types stay `internal`; DI bindings live with implementations; raw colors/dimensions/fonts belong only in the design system; composables resolve error text.

Known scaffold adjustments required for this product:

- Generator name `Home` collides with existing `HomeRoute`; use `Feed` or replace the placeholder deliberately.
- `ErrorMapper.kt` currently collapses `401` and `403` and does not model conflicts/rate limits. Extend it before staff features.
- Debug HTTP logging uses BODY and Chucker captures traffic. Private drafts, credentials, invitation tokens, and media require stricter logging configuration.
- Existing URL selection is debug/release-based (`http://10.0.2.2:8080/` versus placeholder `https://example.com/`); replace it with environment-flavor inputs owned by `:app`.
- Backup XML files are placeholders and `allowBackup` is true. Private staff content/session state needs explicit exclusion.
- Emulator cleartext exception currently lives in main resources; isolate it to the Development flavor. Every Staging/Production combination, including debug, is HTTPS-only; `developmentRelease` intentionally remains local.

## 2. Modules and feature boundaries

Create a separate Blogpost Android repository from the scaffold. Choose the permanent owned base application ID before provider registration/distribution; `com.example.blogpost` is only a placeholder. Add `.dev`/`.staging` environment suffixes and `.debug` on debug types, yielding the six IDs in the variant plan. Keep environment constants in `:app`, inject them into existing network/auth adapters, and keep shared domain/library modules independent of application identity.

```text
:app                     Environment, app initialization, navigation/DI assembly
:core:common             AppResult, typed failures, dispatchers, MVI markers
:core:domain             Shared Article/Draft/Member/Taxonomy models and repository contracts
:core:navigation         Serializable routes, no Android/Compose imports
:core:network            Shared HTTP, credential attachment, problem parsing
:core:data               Shared repositories, mappers, auth SDK integration
:core:database       NEW Room DBs, entities/DAOs, migrations
:core:markdown       NEW Pure JVM parser adapter and platform-neutral render blocks
:core:designsystem       Existing theme/components/shells; extend tokens/components as needed
:core:ui                 Existing MVI/effect/error helpers; shared article renderer
:core:testing            Existing deterministic testing helpers and new fixtures/fakes
:feature:feed
:feature:article
:feature:search
:feature:library
:feature:auth
:feature:workspace
:feature:editor
:feature:review
:feature:profile
```

Only `:app` assembles feature navigation. Put shared article/draft contracts in `:core:domain`, shared implementation in `:core:data`, and Room details in `:core:database`; DTOs/entities never become cross-feature APIs. Bind repository interfaces near implementations. Use feature-local domain/data packages for logic used by only one feature. `:core:designsystem` must not import domain/Markdown content models.

`:core:markdown` uses a pinned stable CommonMark JVM parser with only the simple-table extension. Translate its AST to app-owned immutable block models; do not expose parser-library node types throughout the UI. Render those blocks with native Compose text/layout/image components. Prototype code/table rendering and TalkBack early. [CommonMark JVM parser](https://github.com/commonmark/commonmark-java).

Add dependencies through the existing version catalog/conventions. Do not replace Retrofit/Gson with another network stack or introduce a second OkHttp connection pool. Add Room compiler/runtime/testing, Identity Platform/Firebase Auth client SDK, Credential Manager/Google ID support, and parser dependencies only in appropriate modules.

## 3. MVI and screen design

For each feature define an internal contract with a flat state plus nested mutually exclusive content phases, a sealed intent set, and a sealed effect set. Extend the existing `MviViewModel`; use its `reduce`, `currentState`, and `emitEffect`. Connected routes collect `state` with `collectAsStateWithLifecycle`; stateless content receives state and callbacks. Use existing `ObserveAsEvents` for lifecycle-aware effects.

Use effects for navigation/snackbars and state for pending confirmation/status. Buffered effects are not durable across process death. Persist critical operation IDs/results in the draft store and re-read server state on recovery; do not treat a navigation effect as proof that publication succeeded.

| Feature               | Shell/destination and important states                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Feed                  | `AppListScreen`; load, empty, refresh failure with existing rows, next-page failure                                      |
| Article               | `AppDetailScreen` or a design-system lazy-detail extension; online/current, saved offline copy, withdrawn, media failure |
| Search                | `AppSearchScreen`; debounce, filters, no query, no results, request cancellation, stale-result protection                |
| Library               | Bookmarks and recent articles; unavailable bookmarked item retained                                                      |
| Auth                  | `AppCenteredScreen`; Google picker cancellation, missing account, access denied, invitation account mismatch             |
| Workspace             | `AppTabbedScreen`; own drafts/review states and role-appropriate post list                                               |
| Editor                | `AppFormScreen`; Write/Preview tabs, toolbar, metadata, local-save/sync/conflict status                                  |
| Review                | Submitted snapshot plus published comparison; reject feedback and review-and-publish confirmation                        |
| Profile/history/trash | Form/list/detail shells; recovery and unpublished restore behavior                                                       |

Use a reader-oriented top-level navigation such as Home, Search, Library, and Account; authenticated Account exposes Workspace and Review. Large screens can use a navigation rail and editor split preview. Screens use existing shells rather than hand-building Scaffold/insets/snackbar/loading behavior. If article virtualization requires a new shell slot, add it in the design system with named dimensions and previews.

Reuse scaffold token roles and typography; light/dark themes, no wallpaper dynamic color initially. Reader text size is independent from editor text and respects system font scaling. Test large fonts, landscape, keyboard/IME insets, contrast, TalkBack ordering, link/button labels, touch targets, code copying, table headers, reduced animation, and Switch Access. Every feature has loading/empty/error/content previews visible in Showkase.

## 4. API, identity, and transport behavior

Commit design-first OpenAPI contract release `1.0.0` (description format 3.1.2), its backend source commit/checksum, and shared Markdown/error/workflow fixtures. Generate Kotlin Retrofit coroutine signatures/DTOs using Gson and `Response<T>`; integrate with the existing Retrofit instance rather than generating a second stack. Test required-field/nullability handling. The generator's unknown-enum option alone does not decode unknown values with Gson: supply explicit adapters and safe fallback. Domain models stay pure Kotlin; unexpected workflow/Markdown versions disable unsafe editing.

Decode the eight-field success/error envelope and use stable `error.code`, not message wording, for UI behavior. Non-2xx Retrofit bodies need the same explicit error decoding. Validate HTTP/body status agreement; classify malformed or non-JSON responses as transport/protocol failures. Keep lists in `data`, pagination in `meta.pagination`, and `traceId`/`X-Trace-ID` for diagnostics.

Every allowlisted backend request, including public reading and media, includes `X-Device-ID`, `X-Device-OS`, `X-Device-Version`, `X-App-Version`, and `X-App-Language`. Generate a UUID v4 per installation and retain across sign-ins; exclude it from backup/device transfer. Report underlying Android OS/release, semantic app version/build, and selected UI language. Attach metadata only to the backend host. These values never authenticate or authorize. Identity remains a separate protected-route concern.

Use the shared versioned stateful mock and development-only fixture identity while backend work proceeds. Production builds cannot enable mock identity. Capabilities/deprecation come from `/v1/meta`; retain the contract's 12-month previous-major overlap and 90-day notice. Critical update restrictions preserve local export/recovery.

Here Production means the environment, not every Gradle `release` type: Development Release may use local emulation; neither Staging type nor Production type can. All cloud configurations reject emulator variables/fixture controls. Ordinary compilation/tests use nonsecret inputs, with signing in separate RC/main jobs.

Use Credential Manager for native Google sign-in, then exchange the Google credential through the Identity Platform/Firebase Auth SDK. Fetch the resulting **Identity Platform ID token** for the Blogpost API; never send a raw Google ID token as though it were the backend credential. Use the web OAuth client ID as the server audience where required by Google's SDK configuration, plus Android OAuth clients for the actual package/signing certificates. [Native Google sign-in](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation).

Register each real-auth package/certificate pair in its matching Staging or Production identity project. Staging Debug uses the developer fingerprint; Staging Release uses the dedicated stable staging certificate; Production Release uses the preserved production certificate. Development uses a per-stack demo emulator project, while Production Debug has no staff OAuth flow. No SDK configuration fallback crosses environments. Firebase's console may supply Android public configuration; hosting remains on GCP. [Android SDK registration](https://firebase.google.com/docs/android/setup).

SDK owns credential persistence/refresh. Do not copy refresh tokens into Room/DataStore. Add bearer credentials only to the exact configured API host and protected API routes. Do not attach credentials to arbitrary links, redirected images, Google APIs, or public article requests. Serialize refresh with a mutex; on a definitive `401`, refresh once and retry once, then require sign-in. Never refresh endlessly on `403`, validation failure, or a version conflict. Preserve write idempotency/precondition headers on authorized retries.

Never block OkHttp threads indefinitely to obtain a token: obtain tokens through the suspending repository/network boundary before executing protected Retrofit calls, with a bounded cached token provider if needed. Cancellation must propagate through `safeCall`; keep its explicit `CancellationException` rethrow.

Extend `DomainError` in `:core:common` and resource mapping in `:core:ui`:

| Transport meaning   | Domain/UI behavior                                                               |
| ------------------- | -------------------------------------------------------------------------------- |
| `401`               | AuthenticationExpired; reauthenticate while preserving work                      |
| `403`               | Forbidden/AccessRevoked; stop protected work, do not force an endless login loop |
| `404` public        | Unavailable; purge a known cached article after successful response              |
| `409`               | WorkflowConflict/SlugConflict/IdempotencyConflict, distinguished by problem code |
| `412`               | VersionConflict with current version; open conflict resolution                   |
| `428`               | Client contract/precondition error; retain work and surface actionable recovery  |
| `422`               | Typed field error paths/codes for title, body, summary, taxonomy, alt text       |
| `413`               | UploadTooLarge                                                                   |
| `429`               | RateLimited with retry time                                                      |
| Offline/timeout/5xx | Distinguish unknown request outcome from definitely rejected write               |

Sealed direct subclasses belong in the permitted core module/package; do not attempt to subclass a sealed error interface from arbitrary feature modules. Resolve user messages in composables, not repositories/ViewModels. Display the safe `traceId` in an optional diagnostics action.

## 5. Local data and draft durability

Separate public reader data from per-UID private staff work:

| Store             | Data and policy                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reader Room DB    | Recent published article snapshots/revision IDs, bookmark IDs/labels, availability state, last-check times                                             |
| Private Room DB   | Draft content/metadata, base snapshot/version, local generation, temporary/server ID mapping, pending operation/idempotency state, local asset mapping |
| App-private files | Pending source images and explicitly cached reader image bytes; no shared external-storage directory                                                   |
| DataStore         | Theme, reader text size, bounded cache preference; no auth tokens                                                                                      |
| SDK storage       | Identity Platform auth lifecycle, excluded from backup                                                                                                 |

The server is authoritative for shared editorial/publication state; local storage is authoritative for unsynced edits and local bookmarks. Avoid the scaffold catalog comment's generic “server is a replica” interpretation for publication permissions.

Room snapshots persist complete drafts independently of Activity/ViewModel lifetime. Use `SavedStateHandle` for IDs, selected tab, cursor position, and lightweight UI state; do not place the article body or image bytes in a Bundle. [Android state persistence](https://developer.android.com/topic/libraries/architecture/saving-states).

Autosave locally after a short debounce and on controlled editor exit. Surface saving, saved timestamp, dirty, disk-full, and failed-persistence states. If local persistence fails, keep in-memory text, stop claiming durability, and offer a Storage Access Framework Markdown export. Export is a deliberate user action with a private-content warning.

Explicit sync captures a local generation, independently stages images, and sends the snapshot with `X-Expected-Version` and its `Idempotency-Key`. Uploads have their own keys, need no post-version precondition, and do not advance the post version until draft attachment. Keep newer typing dirty. Creation sends persistent `clientDraftId`; retain it when mapping the server ID. After 24-hour replay expiry, reconcile via authorized lookup rather than silently recreate. Replayed results retain their original version: refetch current state before adopting it. Persist retry context across process death; show “outcome unknown—check status/retry” on recovery. Review/publication remain foreground online actions.

On conflict, retain base/server/local versions. A native comparison view offers adopt server, manually combine, or save local as a separate new draft. Refetch and use the new version after resolution. Never silently overwrite, automatically resubmit, or auto-publish a merged result.

Room schemas are exported/versioned; migrations preserve drafts. No destructive fallback for the private DB. Test all supported upgrade paths, interrupted writes, disk exhaustion, orphan-file cleanup, and SQL-to-file reconciliation. Use the pinned Room 2 APIs; current documentation may illustrate newer artifact generations, so do not paste incompatible dependencies into this scaffold. [Room migration guidance](https://developer.android.com/training/data-storage/room/migrating-db-versions).

Logout/account switching warns about unsynced work, offers export/cancel, then clears private DB/files and protected previews, signs out of SDK/Credential Manager, and empties in-memory staff state. Show clearance failure explicitly. Confirmed access revocation follows the same warning/clearance path; offline revocation cannot be detected immediately. Public reader bookmarks/theme may remain because they are not staff drafts. Exclude staff DB/files, SDK preferences, and protected previews from both cloud backup and device transfer; verify backup behavior on the supported OS range rather than relying only on `allowBackup`.

## 6. Offline reading and withdrawal

Cache recently read articles opportunistically, initially at most 50 articles and 100 MiB of article/image data with LRU eviction. A bookmark does not permanently pin a full offline download. Cached pages display “Saved copy” and last successfully checked time when offline; never label an unvalidated copy current.

On article open/resume while online, check availability/current public revision; batch-check up to 50 cached/bookmarked IDs during foreground refresh. A successful unavailable result deletes body/media and keeps the bookmark as “No longer available.” A newer revision replaces the old article/media reference set. A timeout, `429`, or server failure preserves the saved copy with an honest warning.

Backend media is `no-store`. Do not let generic OkHttp/Coil disk caches retain it implicitly. Implement the interview-approved offline copy as a separate explicit app-managed store, with bounded size, revision IDs, and deletion hooks. Load cached bytes through a controlled image loader. Draft previews never enter that public offline cache. Clear orphaned image files after revision replacement and avoid one asset being addressable through another post.

No continuously polling background worker is required. Foreground revalidation is enough for release 1; optional WorkManager cleanup must not sync or publish drafts. Already downloaded/offline material cannot be remotely recalled until the device reconnects; screenshots and exports remain outside application control.

## 7. Native Markdown editor and renderer

Use a Compose source text editor, selection-aware formatting toolbar, metadata fields, and Write/Preview tabs. Preserve cursor/scroll when switching tabs. A dedicated native renderer supports the exact version-1 subset: headings, paragraphs/emphasis, lists/quotes, HTTPS links, controlled images, fenced code, and simple header tables.

Parse off the main thread and cache parsed blocks by revision/content hash in memory. Do not execute raw HTML, JavaScript, embedded pages, or arbitrary external image URLs. Render `media://UUID` through post-scoped API routes, or a local pending-image mapping while editing. Only the data layer adds staff credentials for private previews. Use Coil 3 from the scaffold for decoded images with the controlled cache policy.

Code blocks support text selection/copy and horizontal overflow; syntax coloring is optional after correctness. Tables use horizontal scrolling with header semantics and predictable reading order. Bound parsing/rendering to the backend's 128 KiB limit and benchmark a worst-case supported document; lazily compose large block lists. A parser failure produces a safe text fallback for reading, and a validation warning before publication.

Image insertion uses Android Photo Picker without a blanket storage permission. Copy selected content into app-private pending storage so temporary URI grants/process death do not lose the attachment. Check the 5 MiB/12 MP limits locally for feedback and let server decoding be authoritative. Require alt text or a decorative choice. Keep local source until a synced revision references the processed server asset; reupload after unattached-upload expiry. MIME spoofing and invalid content remain server-rejected cases.

## 8. Navigation, sharing, and release configuration

Define routes such as `FeedRoute`, `ArticleRoute(postId, slug?)`, `SearchRoute`, `EditorRoute(draftId)`, `ReviewRoute(postId, revisionId)`, `HistoryRoute(postId)`, `LibraryRoute`, and `ProfileRoute`. IDs are the only durable references; never put article text, tokens, or serialized DTOs into routes. `:app` owns cross-feature callbacks.

Share canonical HTTPS web URLs through the Android Sharesheet. Configure verified App Links for `/posts/...` on the actual web host with a valid `/.well-known/assetlinks.json` and release signing SHA-256. Until domain association is verified, links should open safely in the browser. Invitations can remain a web acceptance workflow; Android handles the resulting membership on next sign-in. External links open in a trusted browser/custom tab with scheme validation; OAuth never runs in an embedded WebView.

Keep `@BaseUrl` injection from `:app`. Both Development types use paired local API/emulator settings: `10.0.2.2` with allocated host ports for the emulator, or localhost plus USB `adb reverse`. Staging types use the actual Staging HTTPS API/identity; Production types use Production, with Production Debug anonymous-only. Retrofit base URLs end in `/` and paths include `v1/`. No runtime environment switcher or production credential belongs in an APK.

Remove private payload logging: production logging remains off; debug uses sanitized metadata only, redacts auth/session/invitation headers, and disables Chucker body capture for real staff traffic. Do not upload private payloads to crash tools; none is required initially. Review release manifest/backup/network-security rules and enable R8 only after Retrofit/Gson/reflection release tests pass. Keep signing keys outside source control.

Staging Release matches the verified Production Release optimization policy. All six installations have distinct badges/names; nonproduction banners stay visible, and Production Debug is explicitly read-only. Namespace Development local recovery by stack/API/member so rebuilding for another feature stack cannot silently sync its drafts elsewhere. RC staging key and main production key stay separate; verify version-code/certificate continuity and never publish debug combinations in CI.

## 9. Implementation stages and acceptance

1. **Baseline/fork:** clean scaffold build, identity/package changes, contract pin, design tokens, error taxonomy, safe logging/backup/network configuration. Gate: clean debug and release builds with existing checks; no scaffold migration bundled in.
2. **Native reader:** feed/article/search/profile, Markdown fixture renderer, bookmarks/recent cache, offline/withdrawn states. Gate: native accessibility checks and correct cache purge on revalidation.
3. **Staff identity/workspace:** Credential Manager + Identity Platform, membership/role screens, auth retry limits and account switching. Gate: uninvited/disabled/mismatched identities cannot access drafts.
4. **Durable editor:** Room/files, source toolbar/preview, explicit sync, version conflicts, images, recovery/export. Gate: process death, rotation, navigation, request loss, disk failure, and typing-during-sync preserve the right local generation.
5. **Editorial parity:** submit/withdraw/reject/review-and-publish, unpublish, history/trash restore. Gate: web-created draft reviewed on Android and Android-created draft reviewed on web; exact revision is published.
6. **Hardening/release readiness:** contract backward compatibility, longest documents, slow/cold API, release auth fingerprints/App Links, accessibility, security, and local migration checks.

Tests: use case rules; repository remote/local mapping with MockWebServer and real Room tests; every meaningful ViewModel intent/state/effect with MockK/Turbine; instrumented Compose journeys for editor/review/dialogs; shared parser fixtures; real-provider auth smoke check; Room migration tests; process-recreation tests; deliberate process kill/relaunch recovery; release variant network/auth/rendering checks. Do not confuse Activity recreation with a full process-death test.

Developer validation commands, run from the Android repository, may include `gradlew.bat build`, `gradlew.bat :app:assembleDebug`, relevant connected instrumented tests, and `scripts/imports.py`/`scripts/kdoc.py` checks. These are implementation checks; the GCP deployment guides require no terminal. Record actual output rather than relying on the scaffold README's buildability claim.

Completion means all role journeys follow the shared backend rules, unsupported actions are explained, private work survives expected interruptions, cached content is honestly labelled and purged when withdrawn, no confidential data reaches logs/backups, and the pinned API works with the deployed backend. Indicative solo effort: 5–7 weeks after the shared contract stabilizes, with native Markdown tables and draft recovery proven early.
