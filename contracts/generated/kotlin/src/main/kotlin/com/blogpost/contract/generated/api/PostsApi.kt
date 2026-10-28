package com.blogpost.contract.generated.api

import com.blogpost.contract.generated.model.ChangePostSlugEnvelope
import com.blogpost.contract.generated.model.ChangeSlugInput
import com.blogpost.contract.generated.model.CreatePostEnvelope
import com.blogpost.contract.generated.model.CreatePostInput
import com.blogpost.contract.generated.model.DraftContentInput
import com.blogpost.contract.generated.model.ErrorEnvelope
import com.blogpost.contract.generated.model.GetPostByClientDraftIdEnvelope
import com.blogpost.contract.generated.model.GetPostMediaMetadataEnvelope
import com.blogpost.contract.generated.model.GetPostRevisionEnvelope
import com.blogpost.contract.generated.model.GetWorkspacePostEnvelope
import com.blogpost.contract.generated.model.ListPostReviewEventsEnvelope
import com.blogpost.contract.generated.model.ListPostRevisionsEnvelope
import com.blogpost.contract.generated.model.ListWorkspacePostsEnvelope
import com.blogpost.contract.generated.model.PublicationState
import com.blogpost.contract.generated.model.PublishPostRevisionEnvelope
import com.blogpost.contract.generated.model.RejectPostRevisionEnvelope
import com.blogpost.contract.generated.model.RejectRevisionInput
import com.blogpost.contract.generated.model.RestorePostRevisionEnvelope
import com.blogpost.contract.generated.model.RestoreTrashedPostEnvelope
import com.blogpost.contract.generated.model.RevisionActionInput
import com.blogpost.contract.generated.model.SavePostDraftEnvelope
import com.blogpost.contract.generated.model.StagePostMediaEnvelope
import com.blogpost.contract.generated.model.SubmitPostForReviewEnvelope
import com.blogpost.contract.generated.model.TrashPostEnvelope
import com.blogpost.contract.generated.model.UnpublishPostEnvelope
import com.blogpost.contract.generated.model.VariantName
import com.blogpost.contract.generated.model.WithdrawPostReviewEnvelope
import com.blogpost.contract.generated.model.WorkflowState
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
interface PostsApi {

    /** PATCH v1/posts/{postId}/slug; decode through the validated wire boundary. */
    @WireOperation("changePostSlug")

    @PATCH("v1/posts/{postId}/slug")
    suspend fun changePostSlug(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body changeSlugInput: WireRequest<ChangeSlugInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<ChangePostSlugEnvelope>>


    /** POST v1/posts; decode through the validated wire boundary. */
    @WireOperation("createPost")

    @POST("v1/posts")
    suspend fun createPost(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body createPostInput: WireRequest<CreatePostInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<CreatePostEnvelope>>


    /** GET v1/posts/by-client-draft-id/{clientDraftId}; decode through the validated wire boundary. */
    @WireOperation("getPostByClientDraftId")

    @GET("v1/posts/by-client-draft-id/{clientDraftId}")
    suspend fun getPostByClientDraftId(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("clientDraftId") clientDraftId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetPostByClientDraftIdEnvelope>>


    /** GET v1/posts/{postId}/media/{mediaId}; decode through the validated wire boundary. */
    @WireOperation("getPostMediaMetadata")

    @GET("v1/posts/{postId}/media/{mediaId}")
    suspend fun getPostMediaMetadata(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Path("mediaId") mediaId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetPostMediaMetadataEnvelope>>


    /** GET v1/posts/{postId}/revisions/{revisionId}; decode through the validated wire boundary. */
    @WireOperation("getPostRevision")

    @GET("v1/posts/{postId}/revisions/{revisionId}")
    suspend fun getPostRevision(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Path("revisionId") revisionId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetPostRevisionEnvelope>>


    /** GET v1/posts/{postId}/media/{mediaId}/{variant}; decode through the validated wire boundary. */
    @WireOperation("getPrivatePostMedia")
    @Streaming

    @GET("v1/posts/{postId}/media/{mediaId}/{variant}")
    suspend fun getPrivatePostMedia(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Path("mediaId") mediaId: kotlin.String
, @Path("variant") variant: VariantName
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<ResponseBody>


    /** GET v1/posts/{postId}; decode through the validated wire boundary. */
    @WireOperation("getWorkspacePost")

    @GET("v1/posts/{postId}")
    suspend fun getWorkspacePost(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetWorkspacePostEnvelope>>


    /** GET v1/posts/{postId}/review-events; decode through the validated wire boundary. */
    @WireOperation("listPostReviewEvents")

    @GET("v1/posts/{postId}/review-events")
    suspend fun listPostReviewEvents(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("cursor") cursor: kotlin.String? = null
, @Query("pageSize") pageSize: kotlin.Int? = 20
): Response<WirePayload<ListPostReviewEventsEnvelope>>


    /** GET v1/posts/{postId}/revisions; decode through the validated wire boundary. */
    @WireOperation("listPostRevisions")

    @GET("v1/posts/{postId}/revisions")
    suspend fun listPostRevisions(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("cursor") cursor: kotlin.String? = null
, @Query("pageSize") pageSize: kotlin.Int? = 20
): Response<WirePayload<ListPostRevisionsEnvelope>>


    /** Supported values for scope. Unknown values are never selected for a write. */
    enum class ScopeListWorkspacePosts(val value: kotlin.String) {

        @SerializedName(value = "OWN") OWN("OWN"),

        @SerializedName(value = "ALL") ALL("ALL"),

        @SerializedName(value = "unknown_default_open_api") UNKNOWN_DEFAULT_OPEN_API("unknown_default_open_api");

        override fun toString(): String = value.toString()
    }

    /** GET v1/posts; decode through the validated wire boundary. */
    @WireOperation("listWorkspacePosts")

    @GET("v1/posts")
    suspend fun listWorkspacePosts(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("cursor") cursor: kotlin.String? = null
, @Query("pageSize") pageSize: kotlin.Int? = 20
, @Query("scope") scope: ScopeListWorkspacePosts? = ScopeListWorkspacePosts.OWN
, @Query("publicationState") publicationState: PublicationState? = null
, @Query("workflowState") workflowState: WorkflowState? = null
, @Query("trashed") trashed: kotlin.Boolean? = false
): Response<WirePayload<ListWorkspacePostsEnvelope>>


    /** POST v1/posts/{postId}/publish; decode through the validated wire boundary. */
    @WireOperation("publishPostRevision")

    @POST("v1/posts/{postId}/publish")
    suspend fun publishPostRevision(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body revisionActionInput: WireRequest<RevisionActionInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<PublishPostRevisionEnvelope>>


    /** POST v1/posts/{postId}/reject; decode through the validated wire boundary. */
    @WireOperation("rejectPostRevision")

    @POST("v1/posts/{postId}/reject")
    suspend fun rejectPostRevision(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body rejectRevisionInput: WireRequest<RejectRevisionInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<RejectPostRevisionEnvelope>>


    /** POST v1/posts/{postId}/restore-revision; decode through the validated wire boundary. */
    @WireOperation("restorePostRevision")

    @POST("v1/posts/{postId}/restore-revision")
    suspend fun restorePostRevision(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body revisionActionInput: WireRequest<RevisionActionInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<RestorePostRevisionEnvelope>>


    /** POST v1/posts/{postId}/restore; decode through the validated wire boundary. */
    @WireOperation("restoreTrashedPost")

    @POST("v1/posts/{postId}/restore")
    suspend fun restoreTrashedPost(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body body: WireRequest<kotlin.Any>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<RestoreTrashedPostEnvelope>>


    /** PUT v1/posts/{postId}/draft; decode through the validated wire boundary. */
    @WireOperation("savePostDraft")

    @PUT("v1/posts/{postId}/draft")
    suspend fun savePostDraft(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body draftContentInput: WireRequest<DraftContentInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<SavePostDraftEnvelope>>


    /** POST v1/posts/{postId}/media; decode through the validated wire boundary. */
    @WireOperation("stagePostMedia")
    @Multipart

    @POST("v1/posts/{postId}/media")
    suspend fun stagePostMedia(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, 
@Part file: MultipartBody.Part, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<StagePostMediaEnvelope>>


    /** POST v1/posts/{postId}/submit; decode through the validated wire boundary. */
    @WireOperation("submitPostForReview")

    @POST("v1/posts/{postId}/submit")
    suspend fun submitPostForReview(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body revisionActionInput: WireRequest<RevisionActionInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<SubmitPostForReviewEnvelope>>


    /** DELETE v1/posts/{postId}; decode through the validated wire boundary. */
    @WireOperation("trashPost")

    @DELETE("v1/posts/{postId}")
    suspend fun trashPost(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<TrashPostEnvelope>>


    /** POST v1/posts/{postId}/unpublish; decode through the validated wire boundary. */
    @WireOperation("unpublishPost")

    @POST("v1/posts/{postId}/unpublish")
    suspend fun unpublishPost(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body body: WireRequest<kotlin.Any>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<UnpublishPostEnvelope>>


    /** POST v1/posts/{postId}/withdraw-review; decode through the validated wire boundary. */
    @WireOperation("withdrawPostReview")

    @POST("v1/posts/{postId}/withdraw-review")
    suspend fun withdrawPostReview(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("X-Expected-Version") xExpectedVersion: kotlin.String
, @Header("Idempotency-Key") idempotencyKey: kotlin.String
, @Body body: WireRequest<kotlin.Any>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<WithdrawPostReviewEnvelope>>

}
