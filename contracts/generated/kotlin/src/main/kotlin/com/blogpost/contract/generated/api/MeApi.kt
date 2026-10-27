package com.blogpost.contract.generated.api

import com.blogpost.contract.generated.model.ErrorEnvelope
import com.blogpost.contract.generated.model.GetMeEnvelope
import com.blogpost.contract.generated.model.UpdateMeEnvelope
import com.blogpost.contract.generated.model.UpdateMeInput
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
interface MeApi {

    /** GET v1/me; decode through the validated wire boundary. */
    @WireOperation("getMe")

    @GET("v1/me")
    suspend fun getMe(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetMeEnvelope>>


    /** PATCH v1/me; decode through the validated wire boundary. */
    @WireOperation("updateMe")

    @PATCH("v1/me")
    suspend fun updateMe(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body updateMeInput: WireRequest<UpdateMeInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<UpdateMeEnvelope>>

}
