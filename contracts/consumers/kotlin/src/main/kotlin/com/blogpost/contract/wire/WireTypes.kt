package com.blogpost.contract.wire

import com.google.gson.JsonElement

/**
 * Associates a generated Retrofit method with the immutable contract's stable operation ID.
 *
 * @property id Stable application operation ID; never an authorization claim.
 */
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class WireOperation(val id: String)

/**
 * Carries a generated request DTO and explicit-null intent without a global side channel.
 *
 * Required nullable properties always serialize. Optional null properties are omitted unless
 * their JSON pointers occur in [explicitNullFields]. This preserves older draft-save behavior.
 *
 * @param T Generated request DTO type.
 */
class WireRequest<T : Any> private constructor(
    internal val value: T,
    internal val explicitNullFields: Set<String>,
) {
    /** Builds requests without constructing another HTTP client or retaining retry state. */
    companion object {
        /**
         * Wraps a DTO, retaining explicit nulls only at the named JSON pointers.
         *
         * For example, use `/bio` with `UpdateMeInput(bio = null)` to clear a profile bio.
         *
         * @param value Generated request value; keep the same value/key for uncertain retries.
         * @param explicitNullFields Absolute JSON pointers for intentional nulls, including nested ones.
         * @return Request value accepted by generated JSON-body parameters.
         * @throws IllegalArgumentException if a pointer is malformed.
         */
        fun <T : Any> of(value: T, vararg explicitNullFields: String): WireRequest<T> {
            require(explicitNullFields.all { it.startsWith('/') && it.length <= 512 })
            return WireRequest(value, explicitNullFields.toSet())
        }

        /** Returns the explicit empty JSON body required by actions such as unpublish. */
        fun empty(): WireRequest<Any> = WireRequest(emptyMap<String, Any?>(), emptySet())
    }
}

/**
 * Holds a schema-checked body until HTTP status and response headers are checked too.
 *
 * Unwrap only through [WireCalls.call]; a parsed body alone cannot establish HTTP/body agreement.
 *
 * @param T Generated success-envelope DTO type.
 */
class WirePayload<T : Any> internal constructor(
    internal val value: T,
    internal val operationId: String,
    internal val metadata: WireMetadata,
    internal val safety: WireSafety,
    internal val expectedResourceVersion: Int?,
)

/**
 * Contains verified response metadata without exposing diagnostic message wording to the UI.
 *
 * @property timestamp RFC 3339 UTC response-generation time.
 * @property statusCode Envelope status, subsequently checked against HTTP status.
 * @property traceId Diagnostic trace identifier, subsequently checked against X-Trace-ID.
 * @property contractVersion Compatible v1 contract version, including future additive minor versions.
 * @property replayed Whether this is an original completed operation's replay.
 * @property idempotencyExpiresAt Replay expiry, or null when no operation record applies.
 * @property pagination Validated collection pagination, or null for a non-collection response.
 */
data class WireMetadata(
    val timestamp: String,
    val statusCode: Int,
    val traceId: String,
    val contractVersion: String,
    val replayed: Boolean,
    val idempotencyExpiresAt: String?,
    val pagination: JsonElement?,
)

/**
 * Describes conservative fallback for unsupported response values.
 *
 * @property unsupportedPaths Paths of unknown enums or unsupported Markdown versions.
 * @property allowedActions Known actions only; empty whenever editing is unsafe.
 */
data class WireSafety(val unsupportedPaths: Set<String>, val allowedActions: Set<String>) {
    /** True only when no response value requires the read-only fallback. */
    val editingAllowed: Boolean get() = unsupportedPaths.isEmpty()

    /**
     * Filters an individual resource's action list, including items in collection responses.
     *
     * @param actions That resource's current allowedActions, never a union across resources.
     * @return Known actions only, or an empty set under the read-only fallback.
     */
    fun actionsFor(actions: Iterable<String>): Set<String> =
        if (editingAllowed) actions.filter { it in knownActions }.toSet() else emptySet()

    private companion object {
        val knownActions = setOf("EDIT_DRAFT", "SUBMIT", "WITHDRAW_REVIEW", "REJECT", "PUBLISH",
            "UNPUBLISH", "TRASH", "RESTORE", "RESTORE_REVISION", "CHANGE_SLUG", "REASSIGN_AUTHOR")
    }
}

/**
 * Carries safe machine-readable failure details; response messages and raw bodies are excluded.
 *
 * @property code Extensible backend machine code; never infer behavior from message wording.
 * @property traceId Validated diagnostic trace, if a valid envelope was received.
 * @property fieldIssues Safe location/path/code details for localized input feedback.
 * @property currentVersion Current version for conflict recovery, if present and valid.
 * @property resourceId Conflict resource identifier, if present and valid.
 */
data class WireProblem(
    val code: String,
    val traceId: String,
    val fieldIssues: List<WireFieldIssue>,
    val currentVersion: Int?,
    val resourceId: String?,
)

/**
 * Carries a backend field issue without retaining rejected input or diagnostic prose.
 *
 * @property location Header, path, query or body location.
 * @property field JSON pointer identifying the field.
 * @property code Extensible issue code for localized feedback.
 * @property params Validation parameters from the schema-checked envelope.
 */
data class WireFieldIssue(
    val location: String,
    val field: String,
    val code: String,
    val params: Map<String, JsonElement>,
)

/** Classifies failures without putting exception messages into application state. */
enum class WireFailureKind {
    /** A schema-checked backend error envelope was received. */ REMOTE,
    /** The HTTP/body/header or JSON contract was violated. */ PROTOCOL,
    /** The request failed without a usable response. */ NETWORK,
    /** Request validation failed before dispatch. */ LOCAL_INPUT,
}

/** Distinguishes safe rejection from an uncertain write that must retain its retry context. */
enum class WireWriteOutcome {
    /** This operation does not mutate a resource. */ NOT_APPLICABLE,
    /** Local validation failed before network dispatch. */ NOT_SENT,
    /** A valid 4xx error rejected this request, apart from in-progress operations. */ REJECTED,
    /** Commit cannot be ruled out; reconcile or retry the identical request explicitly. */ UNKNOWN,
}

/**
 * Returns a verified success or a safe recovery classification, preserving coroutine cancellation.
 *
 * @param T Generated success-envelope DTO type.
 */
sealed interface WireResult<out T> {
    /**
     * Holds a response that passed both schema and HTTP validation.
     *
     * @property value Generated envelope; map its data to domain models at the repository boundary.
     * @property metadata Verified timestamp, trace and replay metadata.
     * @property safety Unsupported-value fallback and known allowed actions.
     * @property resourceVersion Resource header, when returned.
     * @property requiresRefetch True for replay: fetch current state before adopting the old version.
     */
    data class Success<T>(
        val value: T,
        val metadata: WireMetadata,
        val safety: WireSafety,
        val resourceVersion: Int?,
        val requiresRefetch: Boolean,
    ) : WireResult<T>

    /**
     * Holds a failure suitable for mapping to the application's localized domain errors.
     *
     * @property kind Protocol, network, local-input or verified remote failure.
     * @property writeOutcome Whether a mutation may have committed.
     * @property httpStatus Actual HTTP status, when available.
     * @property problem Verified machine details, absent for untrusted/non-JSON failures.
     * @property retryAfterSeconds Bounded server retry hint; never an automatic write retry.
     */
    data class Failure(
        val kind: WireFailureKind,
        val writeOutcome: WireWriteOutcome,
        val httpStatus: Int? = null,
        val problem: WireProblem? = null,
        val retryAfterSeconds: Long? = null,
    ) : WireResult<Nothing>
}

/** Internal protocol failures contain no response text, tokens or private payloads. */
internal class WireProtocolException : java.io.IOException("Invalid Blogpost wire response")

/** Identifies schema-invalid input before Retrofit dispatches a request. */
internal class WireInputException : IllegalArgumentException("Invalid Blogpost wire request")

/** Result of a media call, whose successful bytes have no JSON envelope. */
sealed interface WireMediaResult {
    /**
     * Owns a validated image stream; callers must close [body] after use.
     *
     * @property body Streaming body; this boundary does not buffer image bytes.
     * @property traceId Verified diagnostic trace.
     * @property contractVersion Verified compatible contract version.
     */
    data class Success(val body: okhttp3.ResponseBody, val traceId: String,
        val contractVersion: String) : WireMediaResult

    /**
     * Carries the same safe failure used by JSON operations, including decoded non-2xx envelopes.
     *
     * @property failure Verified failure classification without a raw response body.
     */
    data class Failure(val failure: WireResult.Failure) : WireMediaResult
}
