package com.blogpost.contract.wire

import com.blogpost.contract.generated.api.*
import com.blogpost.contract.generated.model.*
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.reflect.TypeToken
import java.io.File
import java.io.IOException
import java.util.concurrent.CancellationException
import kotlinx.coroutines.runBlocking
import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import retrofit2.Converter
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/** Exercises canonical fixtures through the actual generated models and defensive boundary. */
class WireConsumerTest {
    private val root = File(System.getProperty("blogpost.root"))
    private val gson = GsonBuilder().withBlogpostWireAdapters().create()
    private val factory = WireConverterFactory(gson)
    private val retrofit = Retrofit.Builder().baseUrl("http://127.0.0.1/")
        .addConverterFactory(factory).addConverterFactory(GsonConverterFactory.create(gson))
        .validateEagerly(true).build()
    private val rules = JsonParser.parseString(File(root,
        "contracts/generated/kotlin/src/main/resources/blogpost-wire-v1.json").readText())
        .asJsonObject.getAsJsonObject("operations")

    private fun fixture(id: String): JsonObject = JsonParser.parseString(File(root,
        "contracts/fixtures/operations/$id.response.json").readText()).asJsonObject
    private fun problem(): JsonObject = JsonParser.parseString(File(root,
        "contracts/fixtures/errors/version-conflict.json").readText()).asJsonObject
    @Suppress("UNCHECKED_CAST")
    private fun payload(id: String, json: String): WirePayload<Any> {
        val model = rules[id].asJsonObject["response"].asJsonObject["\$ref"]
            .asString.substringAfterLast('/')
        val type = TypeToken.getParameterized(WirePayload::class.java,
            Class.forName("com.blogpost.contract.generated.model.$model")).type
        val converter = factory.responseBodyConverter(type, arrayOf(WireOperation(id)), retrofit)
            as Converter<ResponseBody, WirePayload<Any>>
        return converter.convert(json.toResponseBody("application/json".toMediaType()))!!
    }
    private fun headers(json: JsonObject, version: Int? = null): Headers {
        val result = Headers.Builder().add("X-Trace-ID", json["traceId"].asString)
            .add("X-API-Contract-Version", json.getAsJsonObject("meta")["contractVersion"].asString)
            .add("Cache-Control", "no-store").add("X-Content-Type-Options", "nosniff")
        version?.let { result.add("X-Resource-Version", it.toString()) }
        return result.build()
    }
    private fun raw(status: Int, headers: Headers) = okhttp3.Response.Builder()
        .request(Request.Builder().url("http://127.0.0.1/fixture").build())
        .protocol(Protocol.HTTP_1_1).code(status).message("fixture").headers(headers).build()
    private fun successful(id: String, json: JsonObject = fixture(id),
        status: Int = rules[id].asJsonObject["status"].asInt, responseHeaders: Headers? = null): Response<WirePayload<Any>> =
        Response.success(payload(id, json.toString()), raw(status, responseHeaders ?: headers(json,
            WireContract.resourceVersion(id, json))))
    private fun rejected(json: JsonObject = problem(), status: Int = json["statusCode"].asInt,
        responseHeaders: Headers = headers(json)): Response<WirePayload<Any>> = Response.error(
        json.toString().toResponseBody("application/json".toMediaType()), raw(status, responseHeaders))
    private fun failure(value: WireResult<*>): WireResult.Failure = value as WireResult.Failure

    @Test fun converterRejectsAnUnconfiguredGsonAtStartup() {
        assertThrows(IllegalArgumentException::class.java) { WireConverterFactory(GsonBuilder().create()) }
        assertThrows(IllegalArgumentException::class.java) { WireConverterFactory(GsonBuilder().serializeNulls().create()) }
    }

    @Test fun invitationEmailsUseTheSameFullFormatAsTheBackendValidator() {
        for (address in listOf("a..b@example.test", "a@-example.test", "a@example..test"))
            assertThrows(address, WireInputException::class.java) {
                requestJson("createInvitation", WireRequest.of(mapOf("email" to address, "role" to Role.AUTHOR)))
            }
        assertEquals("a+b@example.test", requestJson("createInvitation",
            WireRequest.of(mapOf("email" to "a+b@example.test", "role" to Role.AUTHOR)))["email"].asString)
    }

    @Test fun generationProvenanceMatchesTheCanonicalContractAndPinnedGenerator() {
        fun sha256(file: File) = java.security.MessageDigest.getInstance("SHA-256")
            .digest(file.readBytes()).joinToString("") { "%02x".format(it) }
        val generation = JsonParser.parseString(File(root,
            "contracts/generated/kotlin/generation.json").readText()).asJsonObject
        val toolchain = JsonParser.parseString(File(root, "tools/kotlin/toolchain.json").readText()).asJsonObject
        assertEquals(sha256(File(root, "contracts/openapi-v1.json")), generation["sourceOpenApiSha256"].asString)
        assertEquals(sha256(File(root, "contracts/generated/kotlin/src/main/resources/blogpost-wire-v1.json")),
            generation["validationRulesSha256"].asString)
        assertEquals(toolchain.getAsJsonObject("generator")["sha256"].asString, generation["generatorSha256"].asString)
    }

    @Test fun allCompiledModelsAndAdaptersUseJava11Bytecode() {
        val classes = File(root, ".local/kotlin-consumer-build/classes/kotlin/main")
            .walkTopDown().filter { it.extension == "class" }.toList()
        assertTrue(classes.size > 127)
        for (file in classes) {
            val header = file.inputStream().use { it.readNBytes(8) }
            assertEquals(file.name, 55, (header[6].toInt() and 255) * 256 + (header[7].toInt() and 255))
        }
    }

    @Test fun everyJsonOperationDecodesIntoItsActualGeneratedEnvelope() = runBlocking {
        var count = 0
        for ((id, rule) in rules.entrySet()) {
            if (rule.asJsonObject["binary"].asBoolean) continue
            val result = WireCalls.call(id) { successful(id) }
            assertTrue("$id: $result", result is WireResult.Success)
            val success = result as WireResult.Success
            assertTrue("$id unexpectedly required fallback", success.safety.editingAllowed)
            count++
        }
        assertEquals(50, count)
    }

    @Test fun cursorAndPagePaginationRetainTheirDistinctGeneratedTypes() = runBlocking {
        val cursor = (WireCalls.call("listPublicPosts") { successful("listPublicPosts") }
            as WireResult.Success).value as ListPublicPostsEnvelope
        assertEquals("CURSOR", cursor.meta.pagination!!.kind)
        assertNull(cursor.meta.pagination!!.nextCursor)
        val page = (WireCalls.call("searchPublicPosts") { successful("searchPublicPosts") }
            as WireResult.Success).value as SearchPublicPostsEnvelope
        assertEquals("PAGE", page.meta.pagination!!.kind)
        assertEquals(1, page.meta.pagination!!.page)
        assertEquals(fixture("searchPublicPosts").getAsJsonObject("meta")
            .getAsJsonObject("pagination")["totalItems"].asInt, page.meta.pagination!!.totalItems)
    }

    @Test fun allGeneratedServicesExposeExactlyTheApprovedOperations() {
        val apis = listOf(AdminApi::class.java, AuthApi::class.java, CategoriesApi::class.java,
            InvitationsApi::class.java, MeApi::class.java, MetaApi::class.java, PostsApi::class.java,
            PublicApi::class.java, TagsApi::class.java)
        val ids = mutableListOf<String>()
        for (api in apis) {
            retrofit.create(api)
            api.declaredMethods.filter { !it.isSynthetic }.forEach { method ->
                ids += method.getAnnotation(WireOperation::class.java).id
            }
        }
        assertEquals(52, ids.size)
        assertEquals(rules.keySet(), ids.toSet())
    }

    @Test fun everyErrorFixtureIsDecodedFromTheNon2xxBody() = runBlocking {
        val fixtures = File(root, "contracts/fixtures/errors").listFiles()!!.filter { it.extension == "json" }
        assertTrue(fixtures.size >= 10)
        for (file in fixtures) {
            val json = JsonParser.parseString(file.readText()).asJsonObject
            val result = failure(WireCalls.call("savePostDraft") { rejected(json) })
            assertEquals(file.name, WireFailureKind.REMOTE, result.kind)
            assertEquals(file.name, json.getAsJsonObject("error")["code"].asString, result.problem?.code)
        }
    }

    @Test fun unknownEnumsDecodeToSentinelsAndDisableEditing() = runBlocking {
        assertNull(GsonBuilder().create().fromJson("\"FUTURE_ROLE\"", Role::class.java))
        assertEquals(Role.UNKNOWN_DEFAULT_OPEN_API, gson.fromJson("\"FUTURE_ROLE\"", Role::class.java))
        val json = fixture("createPost")
        json.getAsJsonObject("data").addProperty("workflowState", "FUTURE_WORKFLOW")
        val result = WireCalls.call("createPost") { successful("createPost", json) } as WireResult.Success
        assertFalse(result.safety.editingAllowed)
        assertTrue(result.safety.allowedActions.isEmpty())
        assertEquals(setOf("/data/workflowState"), result.safety.unsupportedPaths)
        val envelope = result.value as CreatePostEnvelope
        assertEquals(WorkflowState.UNKNOWN_DEFAULT_OPEN_API, envelope.data.workflowState)
    }

    @Test fun unknownActionsAreIgnoredWhileAdditiveFieldsAndMinorVersionsWork() = runBlocking {
        val json = fixture("createPost")
        json.addProperty("futureEnvelopeField", true)
        json.getAsJsonObject("data").addProperty("futurePostField", "ignored")
        json.getAsJsonObject("data").getAsJsonArray("allowedActions").add("FUTURE_ACTION")
        json.getAsJsonObject("meta").addProperty("contractVersion", "1.1.0")
        val result = WireCalls.call("createPost") { successful("createPost", json) } as WireResult.Success
        assertTrue(result.safety.editingAllowed)
        assertEquals(setOf("EDIT_DRAFT", "SUBMIT", "TRASH"), result.safety.allowedActions)
        assertEquals("1.1.0", result.metadata.contractVersion)
        json.getAsJsonObject("meta").addProperty("contractVersion", "2.0.0")
        assertEquals(WireFailureKind.PROTOCOL,
            failure(WireCalls.call("createPost") { successful("createPost", json) }).kind)
    }

    @Test fun unknownMarkdownVersionRequiresReadOnlyFallback() = runBlocking {
        val json = fixture("createPost")
        json.getAsJsonObject("data").getAsJsonObject("workingRevision")
            .getAsJsonObject("content").addProperty("markdownContractVersion", 2)
        val result = WireCalls.call("createPost") { successful("createPost", json) } as WireResult.Success
        assertFalse(result.safety.editingAllowed)
        assertTrue(result.safety.allowedActions.isEmpty())
    }

    @Test fun duplicateMediaVariantNamesFailTheCanonicalContainsRules() = runBlocking {
        val json = fixture("stagePostMedia")
        val variants = json.getAsJsonObject("data").getAsJsonArray("variants")
        assertEquals(3, variants.size())
        variants[1].asJsonObject.addProperty("name", variants[0].asJsonObject["name"].asString)
        assertEquals(WireFailureKind.PROTOCOL,
            failure(WireCalls.call("stagePostMedia") { successful("stagePostMedia", json) }).kind)
    }

    @Test fun requiredEnvelopeAndCriticalFieldsAreRejectedBeforeMapping() = runBlocking {
        for (key in fixture("createPost").keySet()) {
            val json = fixture("createPost").apply { remove(key) }
            val result = failure(WireCalls.call("createPost") { successful("createPost", json) })
            assertEquals(key, WireFailureKind.PROTOCOL, result.kind)
            assertEquals(key, WireWriteOutcome.UNKNOWN, result.writeOutcome)
        }
        for (key in listOf("id", "version", "workflowState", "workingRevisionId", "author")) {
            val json = fixture("createPost")
            json.getAsJsonObject("data").remove(key)
            assertEquals(key, WireFailureKind.PROTOCOL,
                failure(WireCalls.call("createPost") { successful("createPost", json) }).kind)
        }
        for (key in listOf("version", "workflowState", "author")) {
            val json = fixture("createPost")
            json.getAsJsonObject("data").add(key, com.google.gson.JsonNull.INSTANCE)
            assertEquals(key, WireFailureKind.PROTOCOL,
                failure(WireCalls.call("createPost") { successful("createPost", json) }).kind)
        }
    }

    @Test fun requiredFieldsAcrossAllOperationDtosAreValidatedBeforeGson() {
        val document = JsonParser.parseString(File(root,
            "contracts/generated/kotlin/src/main/resources/blogpost-wire-v1.json").readText()).asJsonObject
        val schemas = document.getAsJsonObject("schemas")
        var rejectedFields = 0
        for ((id, rule) in rules.entrySet()) {
            if (rule.asJsonObject["binary"].asBoolean) continue
            val original = fixture(id)
            fun walk(schema: JsonObject, value: com.google.gson.JsonElement, path: List<String>) {
                if (schema.has("\$ref")) {
                    walk(schemas[schema["\$ref"].asString.substringAfterLast('/')].asJsonObject, value, path)
                    return
                }
                if (value.isJsonObject) {
                    schema.getAsJsonArray("required")?.forEach { field ->
                        if (value.asJsonObject.has(field.asString)) {
                            val malformed = original.deepCopy()
                            var parent: com.google.gson.JsonElement = malformed
                            for (part in path) parent = if (parent.isJsonArray) parent.asJsonArray[part.toInt()]
                                else parent.asJsonObject[part]
                            parent.asJsonObject.remove(field.asString)
                            assertThrows("$id /${path.joinToString("/")}/${field.asString}",
                                WireProtocolException::class.java) { payload(id, malformed.toString()) }
                            rejectedFields++
                        }
                    }
                    schema.getAsJsonObject("properties")?.entrySet()?.forEach { (key, child) ->
                        if (value.asJsonObject.has(key)) walk(child.asJsonObject, value.asJsonObject[key], path + key)
                    }
                } else if (value.isJsonArray && value.asJsonArray.size() > 0 && schema.has("items"))
                    walk(schema["items"].asJsonObject, value.asJsonArray[0], path + "0")
                for (kind in listOf("allOf", "anyOf", "oneOf")) schema.getAsJsonArray(kind)?.forEach {
                    walk(it.asJsonObject, value, path)
                }
            }
            walk(rule.asJsonObject["response"].asJsonObject, original, emptyList())
        }
        assertTrue("Insufficient fixture coverage: $rejectedFields", rejectedFields > 500)
        println("Rejected $rejectedFields missing required fields across the operation DTO fixtures.")
    }

    @Test fun gsonCoercionsAndInvalidIntegersCannotCrossTheBoundary() = runBlocking {
        val values = listOf("\"1\"", "1.5", "2147483648", "true", "{}")
        for (encoded in values) {
            val json = fixture("createPost")
            json.getAsJsonObject("data").add("version", JsonParser.parseString(encoded))
            assertEquals(encoded, WireFailureKind.PROTOCOL,
                failure(WireCalls.call("createPost") { successful("createPost", json) }).kind)
        }
        val json = fixture("createPost").apply { addProperty("statusCode", "201") }
        assertEquals(WireFailureKind.PROTOCOL,
            failure(WireCalls.call("createPost") { successful("createPost", json) }).kind)
    }

    @Test fun httpStatusTraceVersionAndDuplicateHeadersMustAgree() = runBlocking {
        val json = fixture("createPost")
        val valid = headers(json, 1)
        val cases = listOf(
            200 to valid,
            201 to valid.newBuilder().set("X-Trace-ID", "a".repeat(32)).build(),
            201 to valid.newBuilder().add("X-Trace-ID", json["traceId"].asString).build(),
            201 to valid.newBuilder().set("X-API-Contract-Version", "1.0.1").build(),
            201 to valid.newBuilder().set("X-Resource-Version", "2").build(),
            201 to valid.newBuilder().removeAll("X-Resource-Version").build(),
            201 to valid.newBuilder().removeAll("Cache-Control").build(),
        )
        for ((status, fields) in cases) assertEquals(WireFailureKind.PROTOCOL,
            failure(WireCalls.call("createPost") { successful("createPost", json, status, fields) }).kind)
        assertEquals(WireFailureKind.PROTOCOL,
            failure(WireCalls.call("savePostDraft") { rejected(status = 409) }).kind)
    }

    @Test fun malformedHtmlDuplicateKeysAndInvalidUtf8AreProtocolFailures() = runBlocking {
        val input = listOf(
            "text/html" to "<html>private diagnostic</html>".toByteArray(),
            "application/json" to "{".toByteArray(),
            "application/json" to (fixture("createPost").toString() + " false").toByteArray(),
            "application/json" to "{\"a\":1,\"a\":2}".toByteArray(),
            "application/json" to byteArrayOf(0xc3.toByte(), 0x28),
        )
        for ((mime, bytes) in input) {
            val result = failure(WireCalls.call("savePostDraft") {
                Response.error<WirePayload<Any>>(bytes.toResponseBody(mime.toMediaType()), raw(502, headers(problem())))
            })
            assertEquals(mime, WireFailureKind.PROTOCOL, result.kind)
            assertNull(result.problem)
            assertEquals(WireWriteOutcome.UNKNOWN, result.writeOutcome)
        }
    }

    @Test fun requestsPreserveRequiredNullsOmitOldOptionalFieldsAndSupportExplicitClears() {
        val draft = DraftContentInput("", "", "", null, emptySet(), null)
        val request = WireRequest.of(CreatePostInput("10000000-0000-4000-8000-000000000002", draft))
        val json = requestJson("createPost", request)
        val content = json.getAsJsonObject("draft")
        assertTrue(content["categoryId"].isJsonNull)
        assertTrue(content["coverMediaId"].isJsonNull)
        assertFalse(content.has("coverAltText"))
        assertFalse(content.has("coverDecorative"))
        assertFalse(content.has("markdownContractVersion"))
        val clear = requestJson("updateMe", WireRequest.of(UpdateMeInput(), "/bio"))
        assertEquals(setOf("bio"), clear.keySet())
        assertTrue(clear["bio"].isJsonNull)
        assertThrows(WireInputException::class.java) { requestJson("updateMe", WireRequest.of(UpdateMeInput())) }
        assertThrows(WireInputException::class.java) { requestJson("updateMe", WireRequest.of(UpdateMeInput(), "/unknown")) }
        assertThrows(WireInputException::class.java) { requestJson("createPost", WireRequest.of(mapOf("injected" to true))) }
        assertThrows(WireInputException::class.java) {
            requestJson("createInvitation", WireRequest.of(mapOf("email" to "synthetic@example.test",
                "role" to Role.UNKNOWN_DEFAULT_OPEN_API)))
        }
    }

    private fun requestJson(id: String, request: WireRequest<*>): JsonObject {
        val type = TypeToken.getParameterized(WireRequest::class.java, request.value.javaClass).type
        @Suppress("UNCHECKED_CAST")
        val converter = factory.requestBodyConverter(type, emptyArray(), arrayOf(WireOperation(id)), retrofit)
            as Converter<WireRequest<*>, okhttp3.RequestBody>
        val buffer = okio.Buffer()
        converter.convert(request)!!.writeTo(buffer)
        return JsonParser.parseString(buffer.readUtf8()).asJsonObject
    }

    @Test fun expiredAuthenticationRefreshesOnlyOnceAndKeepsRequestContext() = runBlocking {
        var requests = 0
        var refreshes = 0
        val expired = problem().apply {
            addProperty("statusCode", 401)
            getAsJsonObject("error").addProperty("code", "AUTHENTICATION_EXPIRED")
            getAsJsonObject("error").add("context", com.google.gson.JsonNull.INSTANCE)
        }
        val result = WireCalls.call("createPost", { refreshes++; true }) {
            requests++
            if (requests == 1) rejected(expired) else successful("createPost")
        }
        assertTrue(result is WireResult.Success)
        assertEquals(2, requests)
        assertEquals(1, refreshes)
        requests = 0; refreshes = 0
        val twice = failure(WireCalls.call("createPost", { refreshes++; true }) {
            requests++; rejected(expired)
        })
        assertEquals(WireFailureKind.REMOTE, twice.kind)
        assertEquals(2, requests)
        assertEquals(1, refreshes)
        for ((status, code) in listOf(403 to "ACCESS_DENIED", 412 to "VERSION_CONFLICT", 500 to "FUTURE_WRITE_ERROR")) {
            requests = 0; refreshes = 0
            val json = problem().apply { addProperty("statusCode", status); getAsJsonObject("error").addProperty("code", code) }
            val failure = failure(WireCalls.call("createPost", { refreshes++; true }) { requests++; rejected(json) })
            assertEquals(code, failure.problem?.code)
            assertEquals(1, requests)
            assertEquals(0, refreshes)
        }
    }

    @Test fun cancellationPropagatesAndUncertainWritesAreNeverRetried() = runBlocking {
        val cancelled = CancellationException("synthetic private message")
        try { WireCalls.call<Any>("createPost") { throw cancelled }; fail("Cancellation was swallowed") }
        catch (actual: CancellationException) { assertSame(cancelled, actual) }
        var attempts = 0
        val result = failure(WireCalls.call<Any>("savePostDraft") {
            attempts++; throw IOException("must not enter state")
        })
        assertEquals(1, attempts)
        assertEquals(WireFailureKind.NETWORK, result.kind)
        assertEquals(WireWriteOutcome.UNKNOWN, result.writeOutcome)
        assertFalse(result.toString().contains("must not enter state"))
        assertEquals(WireWriteOutcome.NOT_SENT, failure(WireCalls.call<Any>("createPost") {
            throw IllegalArgumentException("Retrofit wrapper", WireInputException())
        }).writeOutcome)
    }

    @Test fun replayRetainsOriginalVersionAndRequiresCurrentResourceRefetch() = runBlocking {
        val json = fixture("createPost")
        json.getAsJsonObject("meta").getAsJsonObject("idempotency").addProperty("replayed", true)
        val result = WireCalls.call("createPost") { successful("createPost", json) } as WireResult.Success
        assertTrue(result.requiresRefetch)
        assertEquals(1, result.resourceVersion)
    }
}
