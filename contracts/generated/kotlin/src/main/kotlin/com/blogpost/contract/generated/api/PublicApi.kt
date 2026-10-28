package com.blogpost.contract.generated.api

import com.blogpost.contract.generated.model.AvailabilityInput
import com.blogpost.contract.generated.model.CheckPublicPostAvailabilityEnvelope
import com.blogpost.contract.generated.model.ErrorEnvelope
import com.blogpost.contract.generated.model.GetPublicAuthorEnvelope
import com.blogpost.contract.generated.model.GetPublicPostEnvelope
import com.blogpost.contract.generated.model.ListPublicCategoriesEnvelope
import com.blogpost.contract.generated.model.ListPublicPostsEnvelope
import com.blogpost.contract.generated.model.ListPublicTagsEnvelope
import com.blogpost.contract.generated.model.ResolvePublicPostSlugEnvelope
import com.blogpost.contract.generated.model.SearchPublicPostsEnvelope
import com.blogpost.contract.generated.model.VariantName
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
interface PublicApi {

    /** POST v1/public/posts/availability; decode through the validated wire boundary. */
    @WireOperation("checkPublicPostAvailability")

    @POST("v1/public/posts/availability")
    suspend fun checkPublicPostAvailability(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Body availabilityInput: WireRequest<AvailabilityInput>
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<CheckPublicPostAvailabilityEnvelope>>


    /** GET v1/public/authors/{handle}; decode through the validated wire boundary. */
    @WireOperation("getPublicAuthor")

    @GET("v1/public/authors/{handle}")
    suspend fun getPublicAuthor(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("handle") handle: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetPublicAuthorEnvelope>>


    /** GET v1/public/posts/{postId}; decode through the validated wire boundary. */
    @WireOperation("getPublicPost")

    @GET("v1/public/posts/{postId}")
    suspend fun getPublicPost(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<GetPublicPostEnvelope>>


    /** GET v1/public/posts/{postId}/media/{mediaId}/{variant}; decode through the validated wire boundary. */
    @WireOperation("getPublicPostMedia")
    @Streaming

    @GET("v1/public/posts/{postId}/media/{mediaId}/{variant}")
    suspend fun getPublicPostMedia(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("postId") postId: kotlin.String
, @Path("mediaId") mediaId: kotlin.String
, @Path("variant") variant: VariantName
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<ResponseBody>


    /** GET v1/public/categories; decode through the validated wire boundary. */
    @WireOperation("listPublicCategories")

    @GET("v1/public/categories")
    suspend fun listPublicCategories(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("page") page: kotlin.Int? = 1
, @Query("pageSize") pageSize: kotlin.Int? = 50
): Response<WirePayload<ListPublicCategoriesEnvelope>>


    /** GET v1/public/posts; decode through the validated wire boundary. */
    @WireOperation("listPublicPosts")

    @GET("v1/public/posts")
    suspend fun listPublicPosts(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("cursor") cursor: kotlin.String? = null
, @Query("pageSize") pageSize: kotlin.Int? = 20
, @Query("categoryId") categoryId: kotlin.String? = null
, @Query("authorId") authorId: kotlin.String? = null
, @Query("tagIds") tagIds: @JvmSuppressWildcards kotlin.collections.Set<kotlin.String>? = null
): Response<WirePayload<ListPublicPostsEnvelope>>


    /** GET v1/public/tags; decode through the validated wire boundary. */
    @WireOperation("listPublicTags")

    @GET("v1/public/tags")
    suspend fun listPublicTags(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("page") page: kotlin.Int? = 1
, @Query("pageSize") pageSize: kotlin.Int? = 50
): Response<WirePayload<ListPublicTagsEnvelope>>


    /** GET v1/public/posts/by-slug/{slug}; decode through the validated wire boundary. */
    @WireOperation("resolvePublicPostSlug")

    @GET("v1/public/posts/by-slug/{slug}")
    suspend fun resolvePublicPostSlug(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Path("slug") slug: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
): Response<WirePayload<ResolvePublicPostSlugEnvelope>>


    /** GET v1/public/search; decode through the validated wire boundary. */
    @WireOperation("searchPublicPosts")

    @GET("v1/public/search")
    suspend fun searchPublicPosts(@Header("X-Device-ID") xDeviceID: kotlin.String
, @Header("X-Device-OS") xDeviceOS: kotlin.String
, @Header("X-Device-Version") xDeviceVersion: kotlin.String
, @Header("X-App-Version") xAppVersion: kotlin.String
, @Header("X-App-Language") xAppLanguage: kotlin.String
, @Query("q") q: kotlin.String
, @Header("traceparent") traceparent: kotlin.String? = null
, @Query("page") page: kotlin.Int? = 1
, @Query("pageSize") pageSize: kotlin.Int? = 20
, @Query("categoryId") categoryId: kotlin.String? = null
, @Query("authorId") authorId: kotlin.String? = null
, @Query("tagIds") tagIds: @JvmSuppressWildcards kotlin.collections.Set<kotlin.String>? = null
): Response<WirePayload<SearchPublicPostsEnvelope>>

}
