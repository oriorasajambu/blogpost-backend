package com.blogpost.contract.generated.api

import com.blogpost.contract.generated.model.AcceptInvitationEnvelope
import com.blogpost.contract.generated.model.AcceptInvitationInput
import com.blogpost.contract.generated.model.ErrorEnvelope
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
interface InvitationsApi {

    /** POST v1/invitations/accept; decode through the validated wire boundary. */
    @WireOperation("acceptInvitation")

    @POST("v1/invitations/accept")
    suspend fun acceptInvitation(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body acceptInvitationInput: WireRequest<AcceptInvitationInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<AcceptInvitationEnvelope>>

}
