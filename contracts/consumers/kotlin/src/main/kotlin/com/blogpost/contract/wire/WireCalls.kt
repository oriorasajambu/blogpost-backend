package com.blogpost.contract.wire

import java.io.IOException
import java.util.concurrent.CancellationException
import okhttp3.Headers
import okhttp3.ResponseBody
import retrofit2.Response

/** Runs generated calls without creating another HTTP stack or automatically retrying mutations. */
object WireCalls {
    /**
     * Validates HTTP/body/header agreement, then exposes the generated envelope for domain mapping.
     *
     * Only a verified AUTHENTICATION_EXPIRED 401 may refresh once. The block must capture the same
     * idempotency key, expected version and request for that retry. Replays require a current-resource
     * refetch before adopting their original version. Network/protocol failures preserve uncertain
     * write outcomes; callers retain unsynced content and decide recovery explicitly.
     *
     * @param T Generated JSON success-envelope DTO type.
     * @param operationId Stable ID matching the generated Retrofit method.
     * @param refreshCredentials Refreshes the existing identity session once; false stops retrying.
     * @param block Calls the generated method on the existing Retrofit service.
     * @return Verified success or safe failure without raw diagnostic text.
     * @throws CancellationException Propagates coroutine cancellation unchanged.
     */
    suspend fun <T : Any> call(operationId: String,
        refreshCredentials: suspend () -> Boolean = { false },
        block: suspend () -> Response<WirePayload<T>>): WireResult<T> {
        val rule = WireContract.operation(operationId)
        require(!rule["binary"].asBoolean) { "Use media for binary operations" }
        val write = mutates(rule["method"].asString, operationId)
        return when (val result = run(write, refreshCredentials, block) { response ->
            val body = response.body() ?: throw WireProtocolException()
            if (body.operationId != operationId) throw WireProtocolException()
            checkHeaders(response.headers(), body.metadata, response.code())
            if (response.code() != rule["status"].asInt) throw WireProtocolException()
            val version = resourceVersion(response.headers())
            if (version != body.expectedResourceVersion) throw WireProtocolException()
            WireResult.Success(body.value, body.metadata, body.safety, version, body.metadata.replayed)
        }) {
            is Outcome.Value -> result.value
            is Outcome.Error -> result.failure
        }
    }

    /**
     * Returns successful media as a stream and decodes non-2xx bodies as canonical JSON errors.
     *
     * @param operationId Stable ID of the public or private media operation.
     * @param refreshCredentials Refreshes expired private-media authentication at most once.
     * @param block Calls the generated streaming method on the existing Retrofit service.
     * @return Owned image stream on success or the normal safe error classification.
     * @throws CancellationException Propagates coroutine cancellation unchanged.
     */
    suspend fun media(operationId: String, refreshCredentials: suspend () -> Boolean = { false },
        block: suspend () -> Response<ResponseBody>): WireMediaResult {
        require(WireContract.operation(operationId)["binary"].asBoolean)
        val result = run(false, refreshCredentials, block) { response ->
            val body = response.body() ?: throw WireProtocolException()
            try {
                val trace = single(response.headers(), "X-Trace-ID")
                val version = single(response.headers(), "X-API-Contract-Version")
                if (response.code() != WireContract.operation(operationId)["status"].asInt ||
                    !Regex("^[a-f0-9]{32}$").matches(trace) || !WireContract.compatible(version) ||
                    single(response.headers(), "Cache-Control") != "no-store" ||
                    single(response.headers(), "X-Content-Type-Options") != "nosniff" ||
                    response.headers()["X-Resource-Version"] != null ||
                    body.contentType()?.toString()?.substringBefore(';') !in
                        setOf("image/jpeg", "image/png", "image/webp")) throw WireProtocolException()
                WireMediaResult.Success(body, trace, version)
            } catch (failure: Exception) { body.close(); throw failure }
        }
        return when (result) {
            is Outcome.Error -> WireMediaResult.Failure(result.failure)
            is Outcome.Value -> result.value
        }
    }

    private fun mutates(method: String, id: String): Boolean =
        method !in setOf("GET", "HEAD") && id != "checkPublicPostAvailability"

    private sealed interface Outcome<out T> {
        data class Value<T>(val value: T) : Outcome<T>
        data class Error(val failure: WireResult.Failure) : Outcome<Nothing>
    }

    private suspend fun <B, R> run(write: Boolean, refresh: suspend () -> Boolean,
        block: suspend () -> Response<B>, success: (Response<B>) -> R): Outcome<R> {
        var refreshed = false
        var httpStatus: Int? = null
        try {
            while (true) {
                httpStatus = null
                val response = block()
                httpStatus = response.code()
                if (response.isSuccessful) return Outcome.Value(success(response))
                val failure = error(response, write)
                if (!refreshed && response.code() == 401 &&
                    failure.problem?.code == "AUTHENTICATION_EXPIRED") {
                    refreshed = true
                    val recovered = try { refresh() }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: Exception) { false }
                    if (recovered) continue
                }
                return Outcome.Error(failure)
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            // Retrofit can wrap a request-converter failure before dispatch in IllegalArgumentException.
            val local = generateSequence<Throwable>(failure) { it.cause }.take(8)
                .any { it is WireInputException }
            val kind = when {
                local -> WireFailureKind.LOCAL_INPUT
                failure is WireProtocolException -> WireFailureKind.PROTOCOL
                failure is IOException -> WireFailureKind.NETWORK
                else -> WireFailureKind.PROTOCOL
            }
            return Outcome.Error(WireResult.Failure(kind, if (!write) WireWriteOutcome.NOT_APPLICABLE
                else if (local) WireWriteOutcome.NOT_SENT else WireWriteOutcome.UNKNOWN, httpStatus))
        }
    }

    private fun error(response: Response<*>, write: Boolean): WireResult.Failure {
        val (metadata, problem) = WireContract.error(WireJson.read(response.errorBody()
            ?: throw WireProtocolException()))
        checkHeaders(response.headers(), metadata, response.code())
        val outcome = if (!write) WireWriteOutcome.NOT_APPLICABLE
            else if (response.code() >= 500 || problem.code == "IDEMPOTENCY_IN_PROGRESS")
                WireWriteOutcome.UNKNOWN else WireWriteOutcome.REJECTED
        val retry = response.headers()["Retry-After"]?.takeIf { Regex("^[0-9]{1,6}$").matches(it) }
            ?.toLongOrNull()?.takeIf { it <= 86_400 }
        return WireResult.Failure(WireFailureKind.REMOTE, outcome, response.code(), problem, retry)
    }

    private fun checkHeaders(headers: Headers, metadata: WireMetadata, status: Int) {
        if (status != metadata.statusCode || single(headers, "X-Trace-ID") != metadata.traceId ||
            single(headers, "X-API-Contract-Version") != metadata.contractVersion ||
            single(headers, "Cache-Control") != "no-store" ||
            single(headers, "X-Content-Type-Options") != "nosniff") throw WireProtocolException()
    }
    private fun single(headers: Headers, name: String): String =
        headers.values(name).singleOrNull() ?: throw WireProtocolException()
    private fun resourceVersion(headers: Headers): Int? {
        val values = headers.values("X-Resource-Version")
        if (values.isEmpty()) return null
        val value = values.singleOrNull() ?: throw WireProtocolException()
        if (!Regex("^[1-9][0-9]{0,9}$").matches(value)) throw WireProtocolException()
        return value.toIntOrNull()?.takeIf { it > 0 } ?: throw WireProtocolException()
    }
}
