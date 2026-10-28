# Kotlin wire consumer (draft)

The generated DTOs and Retrofit coroutine interfaces in `../../generated/kotlin/` cover all 52 application operations. The handwritten boundary in this directory validates JSON before Gson creates Kotlin objects, then checks the envelope against HTTP status and response headers. This is a standalone JVM contract consumer, not an integrated Android feature or a released SDK.

The fixture project uses the approved Android scaffold baseline: Kotlin 2.4.0, Gradle 9.6.1, Retrofit 3.0.0, OkHttp 5.4.0, Gson 2.14.0 and coroutines 1.11.0. A JDK 17 runs the build; generated and handwritten classes target Java 11. JUnit tests inspect the actual class-file versions. No Android classes or SDK are required for this fixture.

The approved pairing is retained rather than silently upgrading the scaffold. Kotlin's current compatibility table lists Gradle 9.5 as the maximum fully supported version for Kotlin 2.4.0, while permitting later versions with possible limitations. The successful JVM fixture is evidence for this consumer only; Android/AGP compatibility still needs its own integration check. See [Kotlin's compatibility table](https://kotlinlang.org/docs/gradle-configure-project.html).

From the backend repository:

```powershell
npm run contract:kotlin -- --check
npm run contract:kotlin:test
```

Generation uses the checksum-pinned OpenAPI Generator CLI 7.26.0 in `tools/kotlin/toolchain.json`. Omit `--check` to regenerate after an intentional draft change. The script rejects external references and unsupported validation keywords. `generation.json` records the canonical OpenAPI hash, runtime-rule hash and configuration. The generator uses a consumer projection to preserve nullable UUIDs, omit optional request defaults and represent both pagination modes. Runtime validation retains the canonical constraints, including nullable required keys, conditional cover rules and unique required image variants.

Set `BLOGPOST_JAVA_HOME` to a JDK 17 installation when discovery is insufficient. `BLOGPOST_GRADLE_HOME` can reuse an existing Gradle 9.6.1 distribution; otherwise the runner downloads and verifies the pinned archive. Downloaded tools, Gradle user/project caches and compiled outputs stay under ignored `.local/`. Do not copy another checkout's build directories or caches. No Docker image is added by these checks.

The normal test command requires checked-in dependency locks and runs Gradle with strict SHA-256 dependency verification. Missing, changed or unchecked artifacts fail the check. An intentional dependency update uses `npm run contract:kotlin:test -- --update-locks`; review the resulting lockfile and verification metadata before accepting the new baseline. Bootstrap-generated checksums establish a pinned download baseline, not an independent security audit. See [Gradle dependency verification](https://docs.gradle.org/current/userguide/dependency_verification.html).

## Integrating into the existing client

Modify the existing network module once. Configure its shared `GsonBuilder` with `withBlogpostWireAdapters()` and register `WireConverterFactory(sharedGson)` before its `GsonConverterFactory`. Continue creating services from the existing Retrofit/OkHttp instance. The generated output deliberately contains no `ApiClient` or HTTP-client constructor.

Package the generated sources, this directory's sources, and the generated `src/main/resources/blogpost-wire-v1.json` together. Include `consumer-rules.pro` in the Android module's shrinking configuration. Gson/Retrofit annotation and generic-signature retention must also remain enabled. Actual Android packaging, minified release decoding and the scaffold's repository/domain mapping are separate integration gates; this JVM result does not prove them.

Wrap generated JSON calls in `WireCalls.call(operationId, refreshCredentials) { existingService.method(...) }`. A successful result exposes the generated envelope only after schema, status, trace, contract-version, no-store/nosniff and resource-version checks pass. Map that transport data into pure Kotlin domain models before exposing application state. Never branch on response message wording.

Pass generated input DTOs inside `WireRequest.of(dto)`. Required nullable fields always serialize. Optional nulls remain omitted, preserving older draft saves; explicitly clearing an optional field requires its JSON pointer, for example `WireRequest.of(UpdateMeInput(), "/bio")`. `WireRequest.empty()` supplies actions requiring `{}`. Optional booleans/defaults are not silently sent by constructing a draft DTO. The shared Gson configuration uses `serializeNulls`; the request converter subsequently applies the operation's required/optional rules.

`WireSafety.editingAllowed` becomes false for an unknown domain enum or unsupported Markdown version. Keep the resource readable and disable unsafe editing. `allowedActions` contains known actions for a single resource; for collections, filter each item's own action list with `safety.actionsFor(item.allowedActions)`. Never combine actions from different resources. Unknown actions are ignored. The explicit Gson factory is necessary: the generator's fallback constant alone does not decode unknown values with Gson. See [the Kotlin generator options](https://openapi-generator.tech/docs/generators/kotlin/).

Only a valid `401 AUTHENTICATION_EXPIRED` invokes the refresh callback, at most once. Capture the original body, idempotency key and expected version in the call block. `403`, `412`, unknown codes, server errors and network/protocol failures do not trigger a mutation retry here. Keep the existing OkHttp configuration free of semantic status-based mutation retry/authentication loops. Cancellation propagates unchanged. A write with `UNKNOWN` outcome retains local content and its original retry context; reconcile or explicitly retry the identical request. Replayed success sets `requiresRefetch`, so its original committed version is not mistaken for current resource state.

Use `WireCalls.media` for generated streaming media methods. A successful result owns its `ResponseBody`, which the caller must close. Non-2xx media responses use the same JSON-error decoder. The boundary reads JSON as strict UTF-8, rejects duplicate keys/trailing data, caps JSON at 16 MiB and limits nesting; successful image bytes remain streamed. It does not replace the client's image decoder or backend media validation.

## Evidence and limits

The JVM suite compiles 127 generated Kotlin files, eagerly constructs all nine Retrofit services, decodes all 50 JSON success fixtures and shared error fixtures, and rejects missing required fields across the DTO catalog. It also exercises actual loopback HTTP for request/null semantics, multipart, media, refresh, conflicts and lost responses. This proves contract-consumer behavior on the pinned JVM baseline. It does not prove real Google identity, SQL editorial transactions, GCS storage, Android UI behavior or the cross-client release journey. The contract remains an unreleased draft.
