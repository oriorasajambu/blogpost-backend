package com.blogpost.contract.wire

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.TypeAdapter
import com.google.gson.TypeAdapterFactory
import com.google.gson.annotations.SerializedName
import com.google.gson.reflect.TypeToken
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import com.google.gson.stream.JsonWriter

/**
 * Adds explicit generated-enum fallback and required-null serialization to the shared Gson builder.
 *
 * Register before creating the application's existing Gson/Retrofit instances. This factory applies
 * only to generated Blogpost enums; it does not alter other application enum adapters.
 *
 * @return This builder for the existing application's remaining Gson configuration.
 */
fun GsonBuilder.withBlogpostWireAdapters(): GsonBuilder =
    serializeNulls().registerTypeAdapterFactory(BlogpostEnumFactory)

/** Finds the generated sentinel by its wire annotation, which remains stable under obfuscation. */
private object BlogpostEnumFactory : TypeAdapterFactory {
    override fun <T : Any?> create(gson: Gson, type: TypeToken<T>): TypeAdapter<T>? {
        val raw = type.rawType
        if (!raw.isEnum || !raw.name.startsWith("com.blogpost.contract.generated.")) return null
        val readValues = linkedMapOf<String, T>()
        val writeValues = linkedMapOf<T, String>()
        var fallback: T? = null
        for (constant in raw.enumConstants) {
            @Suppress("UNCHECKED_CAST") val value = constant as T
            val annotation = raw.getField((constant as Enum<*>).name)
                .getAnnotation(SerializedName::class.java) ?: throw WireProtocolException()
            readValues[annotation.value] = value
            annotation.alternate.forEach { readValues[it] = value }
            writeValues[value] = annotation.value
            if (annotation.value == "unknown_default_open_api") fallback = value
        }
        val unknown = fallback ?: throw WireProtocolException()
        return object : TypeAdapter<T>() {
            override fun read(reader: JsonReader): T? {
                if (reader.peek() == JsonToken.NULL) { reader.nextNull(); return null }
                if (reader.peek() != JsonToken.STRING) throw WireProtocolException()
                return readValues[reader.nextString()] ?: unknown
            }
            override fun write(writer: JsonWriter, value: T?) {
                if (value == null) { writer.nullValue(); return }
                if (value == unknown) throw WireInputException()
                writer.value(writeValues[value] ?: throw WireInputException())
            }
        }
    }
}
