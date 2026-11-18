package com.blogpost.contract.generated.api

import com.blogpost.contract.generated.model.ChangePasswordEnvelope
import com.blogpost.contract.generated.model.ChangePasswordInput
import com.blogpost.contract.generated.model.ErrorEnvelope
import com.blogpost.contract.generated.model.GetMeEnvelope
import com.blogpost.contract.generated.model.RequestEmailChangeEnvelope
import com.blogpost.contract.generated.model.RequestEmailChangeInput
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

    /** POST v1/me/password; decode through the validated wire boundary. */
    @WireOperation("changePassword")

    @POST("v1/me/password")
    suspend fun changePassword(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Body changePasswordInput: WireRequest<ChangePasswordInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<ChangePasswordEnvelope>>


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


    /** POST v1/me/email-change; decode through the validated wire boundary. */
    @WireOperation("requestEmailChange")

    @POST("v1/me/email-change")
    suspend fun requestEmailChange(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Body requestEmailChangeInput: WireRequest<RequestEmailChangeInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<RequestEmailChangeEnvelope>>


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
