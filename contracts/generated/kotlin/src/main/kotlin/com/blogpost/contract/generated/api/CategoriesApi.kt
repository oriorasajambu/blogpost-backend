package com.blogpost.contract.generated.api

import com.blogpost.contract.generated.model.CreateCategoryEnvelope
import com.blogpost.contract.generated.model.CreateTaxonInput
import com.blogpost.contract.generated.model.ErrorEnvelope
import com.blogpost.contract.generated.model.GetManagedCategoryEnvelope
import com.blogpost.contract.generated.model.ListManagedCategoriesEnvelope
import com.blogpost.contract.generated.model.UpdateCategoryEnvelope
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
interface CategoriesApi {

    /** POST v1/categories; decode through the validated wire boundary. */
    @WireOperation("createCategory")

    @POST("v1/categories")
    suspend fun createCategory(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body createTaxonInput: WireRequest<CreateTaxonInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<CreateCategoryEnvelope>>


    /** GET v1/categories/{categoryId}; decode through the validated wire boundary. */
    @WireOperation("getManagedCategory")

    @GET("v1/categories/{categoryId}")
    suspend fun getManagedCategory(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("categoryId") categoryId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetManagedCategoryEnvelope>>


    /** GET v1/categories; decode through the validated wire boundary. */
    @WireOperation("listManagedCategories")

    @GET("v1/categories")
    suspend fun listManagedCategories(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("page") page: kotlin.Int? = 1
, @Query("pageSize") pageSize: kotlin.Int? = 50
, @Query("active") active: kotlin.Boolean? = null
): Response<WirePayload<ListManagedCategoriesEnvelope>>


    /** PATCH v1/categories/{categoryId}; decode through the validated wire boundary. */
    @WireOperation("updateCategory")

    @PATCH("v1/categories/{categoryId}")
    suspend fun updateCategory(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("categoryId") categoryId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body updateTaxonInput: WireRequest<UpdateTaxonInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<UpdateCategoryEnvelope>>

}
