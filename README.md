# Blogpost backend

First development milestone for the approved 25 October 2026 backend plan. The shared planning files live in the parent workspace; this is the separate `oriorasajambu/blogpost-backend` checkout.

License status: **UNLICENSED**. The owner has not selected an open-source license.

Implemented: NestJS transport, Prisma/PostgreSQL constraints and jobs, SDK identities/sessions, SQL membership/invitations/administration, immutable editorial workflows, public articles/feed/redirects/profiles, availability checks, English ranked search, taxonomy administration, staged media with private delivery and bounded retention/cleanup jobs. Local Auth Emulator/PostgreSQL checks cover all 52 application operations, actual filesystem storage and maintenance semantics. GCS has request-precondition/inventory tests; actual cloud storage/provider checks, daily scheduling/IAM/alerts, clients and release gates remain open.

## Run locally

Use Docker Desktop in Linux-container mode. Node.js 24.22.1 is needed only to run the stack helper; the backend itself runs in the pinned container. Native development also requires npm 11 and `npm ci`.

```powershell
node scripts/dev/stack.mjs create foundation
node scripts/dev/stack.mjs start foundation
node scripts/dev/stack.mjs status foundation
node scripts/dev/stack.mjs test foundation
node scripts/dev/stack.mjs stop foundation
```

Creation prints allocated loopback endpoints and stores generated credentials in ignored `.local/stacks/`. Each checkout/name gets separate Compose resources, SQL/media/auth volumes, ports and a demo identity project. Startup builds the images, starts PostgreSQL/auth, bootstraps SQL roles, applies migrations, verifies permissions and starts the API with reload. Stop preserves data. There is no global cleanup command; deleting a stack's volumes is a deliberate operator action after recovering needed drafts. Avoid moving generated stack configuration between checkouts.

The helper prepares baked source/environment metadata for the image. Native Development uses `npm run build:native` before startup. See [build provenance](docs/BUILD_PROVENANCE.md) for source guards, cloud profile examples and pending deployment verification.

Liveness is `GET /health/live`; readiness is `GET /health/ready` and checks the actual schema version. Application calls, including anonymous `GET /v1/meta`, need:

```http
X-Device-ID: 8d5ca46a-7f59-4f64-9d91-fedc41b59e7a
X-Device-OS: WINDOWS
X-Device-Version: unknown
X-App-Version: 0.0.0+local.1
X-App-Language: en
```

`GET /v1/meta` conservatively advertises an empty feature list while client and release gates remain open. The intended contract version is `1.0.0`; the [authored OpenAPI](contracts/openapi-v1.json) covers the full 52-operation catalog but remains an unreleased draft. See [contracts/README.md](contracts/README.md) for tooling, implementation coverage and outstanding release gates.

## Checks

The separate [stateful contract mock](mock/README.md) is available with `npm run mock` on the pinned Node runtime, or `node scripts/dev/stack.mjs mock foundation` in Docker. Its client endpoint is `http://localhost:4010`. It reuses the development image, has isolated synthetic state, and does not replace real PostgreSQL/identity integration checks.

```powershell
npm ci
npm run db:validate
npm run db:generate
npm run contract:build -- --check
npm run contract:typescript -- --check
npm run contract:kotlin -- --check
npm run contract:kotlin:test
npm run contract:compatibility:test
npm run format:check
npm run typecheck
npm test
npm run mock:smoke
npm run build
node scripts/contract-manifest.mjs --check
node scripts/dev/stack.mjs test foundation
```

The standalone [Kotlin contract consumer](contracts/consumers/kotlin/README.md) requires JDK 17 and verifies the approved Retrofit/Gson baseline with Gradle 9.6.1 and Java 11 bytecode. Its tools, caches and outputs stay in ignored `.local/`; it adds no Docker image. The consumer is not yet integrated into the Android application.

The independent [conformance harness](test/conformance/README.md) verifies mock and real HTTP responses. `npm run contract:conformance -- --base-url YOUR_API_ORIGIN --scope implemented` checks the registered current-backend scenarios; full scope remains incomplete until all 52 operations have real success evidence and scenario adapters. Reports distinguish the scoped result from overall operation coverage.

The foundation integration tests use real PostgreSQL and the runtime SQL role. They cover SQL constraints, cross-post references, concurrent offline-draft identity, public transport, CORS, body limits and safe errors. The separate isolated suites below verify publication, search, media processing/delivery and SDK authentication against the local emulator. Real Google authentication and cloud storage still require staging evidence.

The API receives only `SQL_APP_PASSWORD`. Bootstrap receives temporary root credentials; migration receives the migrator credential. `db:migrate` uses only Prisma 7 `migrate deploy`, keeps its encoded URL in the child process environment, and explicitly grants runtime privileges while excluding migration history and immutable updates. API startup performs no DDL. Runtime database grants are verified with real denied DDL. Password changes to existing roles require a separate operator rotation; rerunning bootstrap does not silently replace them.

The local authentication emulator persists synthetic accounts on graceful shutdown. It does not establish that real Google Identity Platform sign-in works. Development media uses the stack's private media volume; uploads normalize synchronously and do not change the post version. Committing a referencing revision attaches them. Cloud media uses the private GCS adapter and exact object generations. Optional web orchestration and deterministic staff seeding will be added with those clients/features.

## Identity integration and first administrator

The real identity/profile suite creates a new internal Docker network and disposable PostgreSQL/Auth Emulator containers with their data on tmpfs. Each job also has a bounded tmpfs media directory. It publishes no ports, uses no saved stack environment or volumes, and removes its containers/network afterward. It reuses the shared images by default:

```powershell
npm run test:identity
npm run test:identity -- --build
```

Use `--build` on a clean checkout or after dependency/schema changes. The runner executes seven suites: identity, administration/invitations, editorial, public/taxonomy, media, maintenance and foundation. Its ignored `.local/conformance/backend-identity.json` receipt passes only after all seven succeed and report all 52 application operations at the current contract hash. Maintenance receives a fresh schema on that invocation's verified tmpfs database, so earlier projection-only synthetic storage descriptors cannot be mistaken for real deletion fixtures. Actual GCS/provider staging, scheduled job operations, client journeys and release readiness remain unfinished.

Editorial writes lock current membership/post state and atomically commit revisions, versions, audit and original replay results. No-op saves retain their version; retries and creator recovery recheck current access. Restoration never republishes; attribution transfer requires an administrator. Public readers select only the published snapshot and credited author. Private edits preserve public content, timestamps and search. Media streams recheck current staff access or current publication membership and return private no-store bytes.

Search uses weighted English title/summary/body vectors and PostgreSQL's [web-search syntax](https://www.postgresql.org/docs/17/textsearch-controls.html). It rejects queries with no positive indexable terms, ranks only current publications, applies category/credited-author/AND-tag filters and exposes at most 1,000 results with full-count/truncation metadata. Feed cursors bind publication order and normalized filters. Availability preserves request order and fails the entire request on dependency errors. Public taxonomy includes active entries and archived entries referenced by current publications; editor/admin writes preserve taxonomy slugs and enforce normalized-name uniqueness, versions and retry rules.

The third migration rebuilds derived search data using English without editing articles or revisions. Its bounded transaction takes a Post-table lock before touching search rows, preventing concurrent publication from being overwritten while allowing plain public reads; see [PostgreSQL lock modes](https://www.postgresql.org/docs/17/explicit-locking.html). Schema compatibility remains version 1. Apply migrations with the existing private migration job before serving the new build; normal API startup performs none.

The fourth migration adds fenced upload-attempt journals. The fifth adds cleanup completion/checkpoints and permanent slug reservations after post deletion. The application role cannot delete slug reservations or reassign/rename existing reservation rows. API readiness requires the media/maintenance schema capabilities. [Maintenance operations](docs/MAINTENANCE.md) run explicitly with `npm run dev:stack -- maintenance foundation`; they permanently purge eligible trash/expired uploads and are never part of stack startup. Failed storage deletion retains its tombstone for retry. Referenced historical media stays retained, and expired/deleting upload bytes remain quota-bound until successful cleanup.

The API requires a separate random 32-byte cursor key encoded as 64 lowercase hexadecimal characters in `CURSOR_SIGNING_KEY`. The stack helper generates and preserves it in ignored local configuration, including when upgrading existing stack files. Cloud API instances must receive the same environment-specific key from Secret Manager; SQL and bootstrap-admin jobs do not need this key. Private cursors bind the authenticated UID, collection, normalized filters, order and page size; public feed cursors use a public namespace and contain publication times only. Cursors expire after 24 hours and work across replicas with the same key. Rotation invalidates outstanding cursors, so clients restart the collection. The key and its hash are excluded from metadata/configuration digests.

Administrators can create/reissue/revoke invitations and change member role/active status. Existing members use these controls rather than another invitation. Invitation create/reissue returns a link once; matching retries return its original receipt with `inviteUrl:null` and `linkAvailable:false`. A lost link requires explicit reissue, which atomically revokes the old invitation. Duplicate pending invitations return a workflow conflict. Acceptance requires the exact verified email and atomically binds one UID; it cannot reactivate or escalate an existing member. Both credential schemes use current SQL roles before administrative replay. Concurrent last-admin demotion/disablement is serialized. Administrative list/audit endpoints use signed keyset pagination.

Login/invite exchange attempts have approximate process-local limits of 30 per socket address and 200 total per endpoint/minute, independent of caller-supplied forwarding headers. SQL identity/invite operations are limited to five per member/minute, alongside the 30-write limit. Completed replays do not consume another SQL write/identity allowance. Anonymous limits reset with the process and are approximate across replicas; no IP bucket is persisted or logged.

After the intended first administrator has signed in with Google, run the private job with that account's exact Identity Platform UID and verified email. These inputs belong only to the operator process/job, not the API's saved environment:

```powershell
$env:INITIAL_ADMIN_UID = '<identity-platform-uid>'
$env:INITIAL_ADMIN_EMAIL = '<verified-google-email>'
$env:INITIAL_ADMIN_DISPLAY_NAME = '<display-name>'
$env:INITIAL_ADMIN_HANDLE = '<stable-lowercase-handle>'
try {
  node scripts/dev/stack.mjs bootstrap-admin foundation
} finally {
  foreach ($key in @('INITIAL_ADMIN_UID', 'INITIAL_ADMIN_EMAIL', 'INITIAL_ADMIN_DISPLAY_NAME', 'INITIAL_ADMIN_HANDLE')) {
    Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue
  }
}
```

The job independently verifies UID/email/provider and serializes initial creation. A repeat for the same active administrator is idempotent; an existing/prior bootstrap blocks creating a replacement or reactivating/escalating an existing member. Its output contains only the member UUID and job event. There is no bootstrap HTTP route. The compiled job entry point is `dist/ops/bootstrap-admin.js`.

## Docker disk usage

The API `runtime` target installs production dependencies and removes the Prisma CLI tree and optional TypeScript compiler that npm otherwise retains. Native optional packages remain installed for image processing and other runtime dependencies. Database jobs use the `operations` target, which adds the separately locked Prisma CLI. Build through the helper so both targets receive their baked build metadata:

```powershell
npm run build:image -- --environment development --target runtime --tag blogpost-api:check
npm run build:image -- --environment development --target operations --tag blogpost-operations:check
```

These commands build local verification artifacts. A development artifact requires `APP_ENV=development` and `NODE_ENV=development` when running the compiled API. Cloud configuration and release validation remain pending. Run `dist/ops/*.js` from the operations image; API startup still performs no migrations. Remove the temporary tags after their verification containers exit:

```powershell
docker image rm blogpost-api:check blogpost-operations:check
```

Local stacks in one checkout retain three shared images: backend development, auth emulator and PostgreSQL. They keep separate containers, networks, ports and data volumes. The helper adds the shared image names to existing generated stack configuration. Source/schema changes reload through mounts; documentation changes do not invalidate dependency or compilation layers. Image builds generate the Prisma client before copying application source, so source-only edits also reuse the generated-client layer. npm's package cache and Prisma's engine download cache use shared BuildKit mounts and are excluded from image layers, following [Docker's cache-mount guidance](https://docs.docker.com/build/cache/optimize/). Gradle/Kotlin caches and build directories are excluded from the Docker context as well; the source directory `scripts/build/` is explicitly retained.

Startup builds only the API and auth images; bootstrap, migration, verification and test jobs reuse the API development image. All services explicitly use compressed, rotating local logs with three 10 MB files per container, following [Docker's local logging guidance](https://docs.docker.com/engine/logging/drivers/local/). This replaces the local driver's larger default log allowance when containers are recreated.

```powershell
npm run docker:space
npm run docker:cache
```

`docker:cache` explicitly reclaims unused build cache from the current Docker builder toward a 256 MB budget (with 64 MB reserved). It excludes `exec.cachemount` records, preserving npm and Prisma download caches. Build cache is shared across projects, so a later build may rebuild removed layers. Docker keeps layers still required by images; shared layers and protected download caches can keep the reported cache total above the budget. The command does not delete images, containers or data volumes. Run it after a batch of verification builds when disk space is limited. Never use volume pruning or `down -v` for routine cleanup.

The sizes beside individual images include shared layers; use `docker system df` rather than adding those rows together. On Windows, Docker also stores data in a managed WSL virtual disk. Its file length can exceed the live Docker objects' usage; this cleanup does not establish how many bytes Windows reclaimed. Docker Desktop supports [automatic space reclamation for managed WSL disks](https://docs.docker.com/desktop/release-notes/#4340). Avoid deleting or manually replacing the disk to reclaim build cache.

## Implementation and release status

See [implementation status](docs/IMPLEMENTATION_STATUS.md) for completed work and the remaining sequence, [CI validation](docs/CI_VALIDATION.md) for checks and closed delivery gates, and [repository setup](docs/REPOSITORY_SETUP.md) for the published policy-only main/RC root. Cloud delivery and release remain unavailable. Application version is `0.1.0` with `publish:true` on the integration branch, pending Staging validation and promotion; the owner chose to keep the public source unlicensed.

CI runs only on push/PR, with read-only permissions and no cloud credentials. Work PRs target `rc`; production promotion currently fails closed because staging receipts and owner validation do not exist yet. The minimal policy-only main/RC bootstrap is published; application work follows `chore/repository-foundation` → `rc`. Owner inspection and merge remain required by the shared VCS guideline.

Runtime dependencies are exact-pinned. Overrides select the patched Multer 2.5.0 dependency and patched local-emulator OpenTelemetry/UUID dependencies; remove them only after upstream lockfiles resolve patched versions and the tests still pass.
