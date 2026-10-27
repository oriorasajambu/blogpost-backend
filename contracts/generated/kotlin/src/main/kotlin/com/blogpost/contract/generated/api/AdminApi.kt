package com.blogpost.contract.generated.api

import com.blogpost.contract.generated.model.CreateInvitationEnvelope
import com.blogpost.contract.generated.model.CreateInvitationInput
import com.blogpost.contract.generated.model.ErrorEnvelope
import com.blogpost.contract.generated.model.GetInvitationEnvelope
import com.blogpost.contract.generated.model.GetMemberEnvelope
import com.blogpost.contract.generated.model.InvitationStatus
import com.blogpost.contract.generated.model.ListAuditEventsEnvelope
import com.blogpost.contract.generated.model.ListInvitationsEnvelope
import com.blogpost.contract.generated.model.ListMembersEnvelope
import com.blogpost.contract.generated.model.ReassignAuthorInput
import com.blogpost.contract.generated.model.ReassignPostAuthorEnvelope
import com.blogpost.contract.generated.model.ReissueInvitationEnvelope
import com.blogpost.contract.generated.model.RevokeInvitationEnvelope
import com.blogpost.contract.generated.model.Role
import com.blogpost.contract.generated.model.UpdateMemberEnvelope
import com.blogpost.contract.generated.model.UpdateMemberInput
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
interface AdminApi {

    /** POST v1/admin/invitations; decode through the validated wire boundary. */
    @WireOperation("createInvitation")

    @POST("v1/admin/invitations")
    suspend fun createInvitation(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body createInvitationInput: WireRequest<CreateInvitationInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<CreateInvitationEnvelope>>


    /** GET v1/admin/invitations/{invitationId}; decode through the validated wire boundary. */
    @WireOperation("getInvitation")

    @GET("v1/admin/invitations/{invitationId}")
    suspend fun getInvitation(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("invitationId") invitationId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetInvitationEnvelope>>


    /** GET v1/admin/members/{memberId}; decode through the validated wire boundary. */
    @WireOperation("getMember")

    @GET("v1/admin/members/{memberId}")
    suspend fun getMember(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("memberId") memberId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetMemberEnvelope>>


    /** GET v1/admin/audit-events; decode through the validated wire boundary. */
    @WireOperation("listAuditEvents")

    @GET("v1/admin/audit-events")
    suspend fun listAuditEvents(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("cursor") cursor: kotlin.String? = null
, @Query("pageSize") pageSize: kotlin.Int? = 20
, @Query("subjectType") subjectType: kotlin.String? = null
, @Query("subjectId") subjectId: kotlin.String? = null
, @Query("action") action: kotlin.String? = null
): Response<WirePayload<ListAuditEventsEnvelope>>


    /** GET v1/admin/invitations; decode through the validated wire boundary. */
    @WireOperation("listInvitations")

    @GET("v1/admin/invitations")
    suspend fun listInvitations(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("cursor") cursor: kotlin.String? = null
, @Query("pageSize") pageSize: kotlin.Int? = 20
, @Query("status") status: InvitationStatus? = null
): Response<WirePayload<ListInvitationsEnvelope>>


    /** GET v1/admin/members; decode through the validated wire boundary. */
    @WireOperation("listMembers")

    @GET("v1/admin/members")
    suspend fun listMembers(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("cursor") cursor: kotlin.String? = null
, @Query("pageSize") pageSize: kotlin.Int? = 20
, @Query("role") role: Role? = null
, @Query("active") active: kotlin.Boolean? = null
): Response<WirePayload<ListMembersEnvelope>>


    /** PATCH v1/admin/posts/{postId}/author; decode through the validated wire boundary. */
    @WireOperation("reassignPostAuthor")

    @PATCH("v1/admin/posts/{postId}/author")
    suspend fun reassignPostAuthor(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body reassignAuthorInput: WireRequest<ReassignAuthorInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<ReassignPostAuthorEnvelope>>


    /** POST v1/admin/invitations/{invitationId}/reissue; decode through the validated wire boundary. */
    @WireOperation("reissueInvitation")

    @POST("v1/admin/invitations/{invitationId}/reissue")
    suspend fun reissueInvitation(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("invitationId") invitationId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body body: WireRequest<kotlin.Any>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<ReissueInvitationEnvelope>>


    /** POST v1/admin/invitations/{invitationId}/revoke; decode through the validated wire boundary. */
    @WireOperation("revokeInvitation")

    @POST("v1/admin/invitations/{invitationId}/revoke")
    suspend fun revokeInvitation(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("invitationId") invitationId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body body: WireRequest<kotlin.Any>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<RevokeInvitationEnvelope>>


    /** PATCH v1/admin/members/{memberId}; decode through the validated wire boundary. */
    @WireOperation("updateMember")

    @PATCH("v1/admin/members/{memberId}")
    suspend fun updateMember(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("memberId") memberId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body updateMemberInput: WireRequest<UpdateMemberInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<UpdateMemberEnvelope>>

}
