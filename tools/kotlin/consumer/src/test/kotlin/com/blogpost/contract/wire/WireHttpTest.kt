package com.blogpost.contract.wire

import com.blogpost.contract.generated.api.MeApi
import com.blogpost.contract.generated.api.PostsApi
import com.blogpost.contract.generated.api.PublicApi
import com.blogpost.contract.generated.model.*
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/** Uses real loopback HTTP, Retrofit coroutines, and the approved Gson/OkHttp versions. */
class WireHttpTest {
    private val root = File(System.getProperty("blogpost.root"))
    private data class Reply(val status: Int, val bytes: ByteArray, val headers: Map<String, String>)
    private data class Captured(val method: String, val path: String,
        val headers: Map<String, List<String>>, val body: String)
    private val replies = LinkedBlockingQueue<Reply>()
    private val requests = LinkedBlockingQueue<Captured>()
    private val token = AtomicReference("original-token")
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { exchange ->
            val body = exchange.requestBody.use { String(it.readBytes(), Charsets.UTF_8) }
            requests.add(Captured(exchange.requestMethod, exchange.requestURI.toString(),
                exchange.requestHeaders.toMap(), body))
            val reply = replies.poll(5, TimeUnit.SECONDS) ?: error("Missing fixture reply")
            try {
                if (reply.status != 0) {
                    reply.headers.forEach { (name, value) -> exchange.responseHeaders.set(name, value) }
                    exchange.sendResponseHeaders(reply.status, reply.bytes.size.toLong())
                    exchange.responseBody.write(reply.bytes)
                }
            } finally { exchange.close() }
        }
        start()
    }
    private val existingClient = OkHttpClient.Builder().retryOnConnectionFailure(false)
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder()
            .header("Authorization", "Bearer ${token.get()}").build()) }.build()
    private val gson = GsonBuilder().withBlogpostWireAdapters().create()
    private val retrofit = Retrofit.Builder().baseUrl("http://127.0.0.1:${server.address.port}/")
        .client(existingClient).addConverterFactory(WireConverterFactory(gson))
        .addConverterFactory(GsonConverterFactory.create(gson)).build()
    private val posts = retrofit.create(PostsApi::class.java)
    private val me = retrofit.create(MeApi::class.java)
    private val public = retrofit.create(PublicApi::class.java)
    private val deviceId = "8d5ca46a-7f59-4f64-9d91-fedc41b59e7a"
    private val key = "83c9a1ca-6d20-48c5-8476-bb6a60677377"
    private val postId = "10000000-0000-4000-8000-000000000001"
    private val mediaId = "50000000-0000-4000-8000-000000000001"
    private val draft = WireRequest.of(CreatePostInput(
        "10000000-0000-4000-8000-000000000002", DraftContentInput("", "", "", null, emptySet(), null)))

    @After fun closeFixture() {
        server.stop(0)
        existingClient.connectionPool.evictAll()
        existingClient.dispatcher.executorService.shutdownNow()
    }
    private fun fixture(id: String) = JsonParser.parseString(File(root,
        "contracts/fixtures/operations/$id.response.json").readText()).asJsonObject
    private fun error(status: Int, code: String): JsonObject = JsonParser.parseString(File(root,
        "contracts/fixtures/errors/version-conflict.json").readText()).asJsonObject.apply {
            addProperty("statusCode", status)
            getAsJsonObject("error").addProperty("code", code)
            getAsJsonObject("error").add("context", com.google.gson.JsonNull.INSTANCE)
        }
    private fun enqueue(json: JsonObject, changes: Map<String, String> = emptyMap()) {
        val data = json["data"].takeIf { it.isJsonObject }?.asJsonObject
        val version = data?.get("version")?.asInt
            ?: data?.getAsJsonObject("invitation")?.get("version")?.asInt
        val headers = mutableMapOf("Content-Type" to "application/json", "Cache-Control" to "no-store",
            "X-Content-Type-Options" to "nosniff", "X-Trace-ID" to json["traceId"].asString,
            "X-API-Contract-Version" to json.getAsJsonObject("meta")["contractVersion"].asString)
        if (version != null) headers["X-Resource-Version"] = version.toString()
        headers.putAll(changes)
        replies.add(Reply(json["statusCode"].asInt, json.toString().toByteArray(), headers))
    }
    private fun received(): Captured = requests.poll(5, TimeUnit.SECONDS) ?: error("No HTTP request")
    private fun Captured.header(name: String) = headers.entries.single { it.key.equals(name, true) }.value.single()
    private suspend fun create() = posts.createPost(deviceId, "ANDROID", "unknown", "0.0.0+test.1", "en", key, draft)

    @Test fun generatedCallsUseTheExistingClientAndPreserveRequestPresence() = runBlocking {
        assertSame(existingClient, retrofit.callFactory())
        enqueue(fixture("createPost"))
        val created = WireCalls.call("createPost") { create() }
        assertTrue(created is WireResult.Success)
        val sent = received()
        assertEquals("POST", sent.method)
        assertEquals("/v1/posts", sent.path)
        assertEquals(key, sent.header("Idempotency-Key"))
        assertEquals(deviceId, sent.header("X-Device-ID"))
        assertEquals("Bearer original-token", sent.header("Authorization"))
        val content = JsonParser.parseString(sent.body).asJsonObject.getAsJsonObject("draft")
        assertTrue(content["categoryId"].isJsonNull)
        assertTrue(content["coverMediaId"].isJsonNull)
        assertFalse(content.has("coverDecorative"))

        enqueue(fixture("updateMe"))
        val profile = WireCalls.call("updateMe") {
            me.updateMe(deviceId, "ANDROID", "unknown", "0.0.0+test.1", "en", "1", key,
                WireRequest.of(UpdateMeInput(), "/bio"))
        }
        assertTrue(profile is WireResult.Success)
        val updated = received()
        assertEquals("PATCH", updated.method)
        assertEquals("1", updated.header("X-Expected-Version"))
        assertEquals("{\"bio\":null}", updated.body)
    }

    @Test fun actual401RefreshReusesTheExactMutationAndNeverLoopsOn412() = runBlocking {
        enqueue(error(401, "AUTHENTICATION_EXPIRED"))
        enqueue(fixture("createPost"))
        var refreshes = 0
        val result = WireCalls.call("createPost", { refreshes++; token.set("refreshed-token"); true }) { create() }
        assertTrue(result is WireResult.Success)
        assertEquals(1, refreshes)
        val first = received()
        val second = received()
        assertEquals(first.body, second.body)
        assertEquals(first.header("Idempotency-Key"), second.header("Idempotency-Key"))
        assertEquals("Bearer original-token", first.header("Authorization"))
        assertEquals("Bearer refreshed-token", second.header("Authorization"))
        enqueue(error(412, "VERSION_CONFLICT"))
        val conflict = WireCalls.call("createPost", { refreshes++; true }) { create() } as WireResult.Failure
        assertEquals("VERSION_CONFLICT", conflict.problem?.code)
        assertEquals(WireWriteOutcome.REJECTED, conflict.writeOutcome)
        assertEquals(1, refreshes)
        received()
        assertTrue(requests.isEmpty())
    }

    @Test fun tagFiltersUseRepeatedQueryValuesAndCursorDefaults() = runBlocking {
        enqueue(fixture("listPublicPosts"))
        val tagIds = linkedSetOf("30000000-0000-4000-8000-000000000002",
            "30000000-0000-4000-8000-000000000003")
        val result = WireCalls.call("listPublicPosts") {
            public.listPublicPosts(deviceId, "ANDROID", "unknown", "0.0.0+test.1", "en", tagIds = tagIds)
        }
        assertTrue(result is WireResult.Success)
        val request = received()
        val query = request.path.substringAfter('?').split('&')
        assertEquals(tagIds.map { "tagIds=$it" }.toSet(), query.filter { it.startsWith("tagIds=") }.toSet())
        assertTrue(query.contains("pageSize=20"))
        assertFalse(query.any { it.startsWith("cursor=") })
    }

    @Test fun malformedSuccessAndLostResponseKeepUncertainWritesRecoverable() = runBlocking {
        replies.add(Reply(201, "<html>private failure</html>".toByteArray(), mapOf("Content-Type" to "text/html")))
        val malformed = WireCalls.call("createPost") { create() } as WireResult.Failure
        assertEquals(WireFailureKind.PROTOCOL, malformed.kind)
        assertEquals(WireWriteOutcome.UNKNOWN, malformed.writeOutcome)
        received()
        replies.add(Reply(0, byteArrayOf(), emptyMap()))
        val lost = WireCalls.call("createPost") { create() } as WireResult.Failure
        assertEquals(WireFailureKind.NETWORK, lost.kind)
        assertEquals(WireWriteOutcome.UNKNOWN, lost.writeOutcome)
        received()
        assertTrue(requests.isEmpty())
    }

    @Test fun binarySuccessStreamsAndBinaryErrorsDecodeCanonicalJson() = runBlocking<Unit> {
        val png = File(root, "contracts/fixtures/media/pixel.png").readBytes()
        replies.add(Reply(200, png, mapOf("Content-Type" to "image/png", "Cache-Control" to "no-store",
            "X-Content-Type-Options" to "nosniff", "X-Trace-ID" to "4bf92f3577b34da6a3ce929d0e0e4736",
            "X-API-Contract-Version" to "1.0.0")))
        val success = WireCalls.media("getPublicPostMedia") {
            public.getPublicPostMedia(deviceId, "ANDROID", "unknown", "0.0.0+test.1", "en",
                postId, mediaId, VariantName.W480)
        } as WireMediaResult.Success
        success.body.use { assertArrayEquals(png, it.bytes()) }
        received()
        enqueue(error(404, "RESOURCE_NOT_FOUND"))
        val denied = WireCalls.media("getPublicPostMedia") {
            public.getPublicPostMedia(deviceId, "ANDROID", "unknown", "0.0.0+test.1", "en",
                postId, mediaId, VariantName.W480)
        } as WireMediaResult.Failure
        assertEquals("RESOURCE_NOT_FOUND", denied.failure.problem?.code)
        assertEquals(404, denied.failure.httpStatus)
        received()
    }

    @Test fun multipartUsesTheGeneratedSignatureAndInvalidInputNeverDispatches() = runBlocking {
        enqueue(fixture("stagePostMedia"))
        val bytes = File(root, "contracts/fixtures/media/pixel.png").readBytes()
        val part = MultipartBody.Part.createFormData("file", "image.png", bytes.toRequestBody("image/png".toMediaType()))
        val result = WireCalls.call("stagePostMedia") {
            posts.stagePostMedia(deviceId, "ANDROID", "unknown", "0.0.0+test.1", "en", postId, key, part)
        }
        assertTrue(result is WireResult.Success)
        val request = received()
        assertTrue(request.header("Content-Type").startsWith("multipart/form-data; boundary="))
        assertTrue(request.body.contains("name=\"file\"; filename=\"image.png\""))
        val invalid = WireCalls.call("updateMe") {
            me.updateMe(deviceId, "ANDROID", "unknown", "0.0.0+test.1", "en", "1", key,
                WireRequest.of(UpdateMeInput()))
        } as WireResult.Failure
        assertEquals(WireFailureKind.LOCAL_INPUT, invalid.kind)
        assertEquals(WireWriteOutcome.NOT_SENT, invalid.writeOutcome)
        assertTrue(requests.isEmpty())
    }
}
