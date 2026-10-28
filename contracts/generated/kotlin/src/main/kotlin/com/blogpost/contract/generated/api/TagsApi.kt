package com.blogpost.contract.generated.api

import com.blogpost.contract.generated.model.CreateTagEnvelope
import com.blogpost.contract.generated.model.CreateTaxonInput
import com.blogpost.contract.generated.model.ErrorEnvelope
import com.blogpost.contract.generated.model.GetManagedTagEnvelope
import com.blogpost.contract.generated.model.ListManagedTagsEnvelope
import com.blogpost.contract.generated.model.UpdateTagEnvelope
import com.blogpost.contract.generated.model.UpdateTaxonInput
import com.google.gson.annotations.SerializedName
import com.blogpost.contract.wire.WireOperation
import com.blogpost.contract.wire.WirePayload
import com.blogpost.contract.wire.WireRequest
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

/** Generated v1 signatures. Create this interface from the application's existing Retrofit. */
interface TagsApi {

    /** POST v1/tags; decode through the validated wire boundary. */
    @WireOperation("createTag")

    @POST("v1/tags")
    suspend fun createTag(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body createTaxonInput: WireRequest<CreateTaxonInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<CreateTagEnvelope>>


    /** GET v1/tags/{tagId}; decode through the validated wire boundary. */
    @WireOperation("getManagedTag")

    @GET("v1/tags/{tagId}")
    suspend fun getManagedTag(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("tagId") tagId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetManagedTagEnvelope>>


    /** GET v1/tags; decode through the validated wire boundary. */
    @WireOperation("listManagedTags")

    @GET("v1/tags")
    suspend fun listManagedTags(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("page") page: kotlin.Int? = 1
, @Query("pageSize") pageSize: kotlin.Int? = 50
, @Query("active") active: kotlin.Boolean? = null
): Response<WirePayload<ListManagedTagsEnvelope>>


    /** PATCH v1/tags/{tagId}; decode through the validated wire boundary. */
    @WireOperation("updateTag")

    @PATCH("v1/tags/{tagId}")
    suspend fun updateTag(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("tagId") tagId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body updateTaxonInput: WireRequest<UpdateTaxonInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<UpdateTagEnvelope>>

}
