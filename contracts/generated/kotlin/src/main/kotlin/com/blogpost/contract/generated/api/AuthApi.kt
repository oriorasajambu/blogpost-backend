package com.blogpost.contract.generated.api

import com.blogpost.contract.generated.model.CreateWebSessionEnvelope
import com.blogpost.contract.generated.model.ErrorEnvelope
import com.blogpost.contract.generated.model.RegisterAccountEnvelope
import com.blogpost.contract.generated.model.RegisterAccountInput
import com.blogpost.contract.generated.model.ResendVerificationEmailEnvelope
import com.blogpost.contract.generated.model.ResendVerificationInput
import com.blogpost.contract.generated.model.WebSessionInput
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
interface AuthApi {

    /** POST v1/auth/web-session; decode through the validated wire boundary. */
    @WireOperation("createWebSession")

    @POST("v1/auth/web-session")
    suspend fun createWebSession(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Body webSessionInput: WireRequest<WebSessionInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<CreateWebSessionEnvelope>>


    /** POST v1/auth/register; decode through the validated wire boundary. */
    @WireOperation("registerAccount")

    @POST("v1/auth/register")
    suspend fun registerAccount(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Body registerAccountInput: WireRequest<RegisterAccountInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<RegisterAccountEnvelope>>


    /** POST v1/auth/verify-email/resend; decode through the validated wire boundary. */
    @WireOperation("resendVerificationEmail")

    @POST("v1/auth/verify-email/resend")
    suspend fun resendVerificationEmail(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Body resendVerificationInput: WireRequest<ResendVerificationInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<ResendVerificationEmailEnvelope>>

}
