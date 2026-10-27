package com.blogpost.contract.wire

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import com.google.gson.Strictness
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import okhttp3.ResponseBody
import okio.Buffer
import java.io.StringReader
import java.math.BigDecimal
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Reads bounded, strict UTF-8 JSON without silently coercing duplicate keys or invalid numbers. */
internal object WireJson {
    private const val MAX_JSON_BYTES = 16 * 1024 * 1024
    private const val MAX_DEPTH = 64
    private const val MAX_NODES = 1_000_000

    /** Closes the response body after reading; raw HTML and malformed UTF-8 never reach UI state. */
    fun read(body: ResponseBody): JsonElement = body.use {
        val type = body.contentType()
        if (type?.type != "application" || type.subtype != "json") throw WireProtocolException()
        val buffer = Buffer()
        val source = body.source()
        while (buffer.size <= MAX_JSON_BYTES) {
            if (source.read(buffer, minOf(8192L, MAX_JSON_BYTES + 1L - buffer.size)) == -1L) break
        }
        val bytes = buffer.readByteArray()
        if (bytes.size > MAX_JSON_BYTES) throw WireProtocolException()
        val text = try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
        } catch (_: Exception) { throw WireProtocolException() }
        parse(text)
    }

    /** Parses shared fixtures and already bounded responses under the same strict JSON rules. */
    fun parse(text: String): JsonElement {
        val reader = JsonReader(StringReader(text)).apply { strictness = Strictness.STRICT }
        var nodes = 0
        fun value(depth: Int): JsonElement {
            if (depth > MAX_DEPTH || ++nodes > MAX_NODES) throw WireProtocolException()
            return when (reader.peek()) {
                JsonToken.BEGIN_OBJECT -> JsonObject().apply {
                    reader.beginObject()
                    while (reader.hasNext()) {
                        val name = reader.nextName()
                        if (has(name)) throw WireProtocolException()
                        add(name, value(depth + 1))
                    }
                    reader.endObject()
                }
                JsonToken.BEGIN_ARRAY -> JsonArray().apply {
                    reader.beginArray()
                    while (reader.hasNext()) add(value(depth + 1))
                    reader.endArray()
                }
                JsonToken.STRING -> JsonPrimitive(reader.nextString())
                JsonToken.NUMBER -> {
                    val number = reader.nextString()
                    if (number.length > 128) throw WireProtocolException()
                    JsonPrimitive(BigDecimal(number))
                }
                JsonToken.BOOLEAN -> JsonPrimitive(reader.nextBoolean())
                JsonToken.NULL -> { reader.nextNull(); JsonNull.INSTANCE }
                else -> throw WireProtocolException()
            }
        }
        return try {
            val result = value(0)
            if (reader.peek() != JsonToken.END_DOCUMENT) throw WireProtocolException()
            result
        } catch (_: Exception) { throw WireProtocolException() }
        finally { reader.close() }
    }
}
