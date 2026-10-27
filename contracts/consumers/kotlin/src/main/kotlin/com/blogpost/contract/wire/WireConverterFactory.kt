package com.blogpost.contract.wire

import com.blogpost.contract.generated.model.Role
import com.google.gson.Gson
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody
import retrofit2.Converter
import retrofit2.Retrofit

/**
 * Validates Blogpost JSON before Gson constructs generated Kotlin DTOs.
 *
 * Add this factory before GsonConverterFactory on the application's existing Retrofit builder.
 * Binary bodies keep Retrofit's streaming converter. Bodies remain opaque until [WireCalls.call]
 * checks HTTP status and headers, so a converted body alone cannot establish a valid response.
 *
 * @property gson The application's Gson configured with [withBlogpostWireAdapters].
 * @throws IllegalArgumentException If required-null serialization or enum fallback is missing.
 */
class WireConverterFactory(private val gson: Gson) : Converter.Factory() {
    init {
        require(gson.toJsonTree(mapOf("nullable" to null)).asJsonObject.has("nullable") &&
            gson.fromJson("\"FUTURE_CONFIGURATION_PROBE\"", Role::class.java) == Role.UNKNOWN_DEFAULT_OPEN_API) {
            "Configure the shared Gson builder with withBlogpostWireAdapters()"
        }
    }
    override fun responseBodyConverter(type: Type, annotations: Array<Annotation>,
        retrofit: Retrofit): Converter<ResponseBody, *>? {
        if (getRawType(type) != WirePayload::class.java) return null
        val id = annotations.filterIsInstance<WireOperation>().singleOrNull()?.id
            ?: throw IllegalArgumentException("Missing Blogpost operation annotation")
        WireContract.operation(id)
        val bodyType = (type as ParameterizedType).actualTypeArguments.single()
        return Converter<ResponseBody, WirePayload<Any>> { body ->
            val json = WireJson.read(body)
            val (metadata, safety) = WireContract.success(id, json)
            val value = try { gson.fromJson<Any>(json, bodyType) }
                catch (_: RuntimeException) { throw WireProtocolException() }
            if (value == null) throw WireProtocolException()
            WirePayload(value, id, metadata, safety, WireContract.resourceVersion(id, json))
        }
    }

    override fun requestBodyConverter(type: Type, parameterAnnotations: Array<Annotation>,
        methodAnnotations: Array<Annotation>, retrofit: Retrofit): Converter<*, RequestBody>? {
        if (getRawType(type) != WireRequest::class.java) return null
        val id = methodAnnotations.filterIsInstance<WireOperation>().singleOrNull()?.id
            ?: throw IllegalArgumentException("Missing Blogpost operation annotation")
        WireContract.operation(id)
        return Converter<WireRequest<*>, RequestBody> { request ->
            val json = try { gson.toJsonTree(request.value) }
                catch (_: RuntimeException) { throw WireInputException() }
            val prepared = WireContract.request(id, json, request.explicitNullFields)
            prepared.toString().toRequestBody("application/json; charset=UTF-8".toMediaType())
        }
    }
}
