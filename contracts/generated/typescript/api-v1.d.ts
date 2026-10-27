export interface paths {
  readonly '/health/live': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getLiveness'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/health/ready': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getReadiness'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/admin/audit-events': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listAuditEvents'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/admin/invitations': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listInvitations'];
    readonly put?: never;
    readonly post: operations['createInvitation'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/admin/invitations/{invitationId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getInvitation'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/admin/invitations/{invitationId}/reissue': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['reissueInvitation'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/admin/invitations/{invitationId}/revoke': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['revokeInvitation'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/admin/members': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listMembers'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/admin/members/{memberId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getMember'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch: operations['updateMember'];
    readonly trace?: never;
  };
  readonly '/v1/admin/posts/{postId}/author': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch: operations['reassignPostAuthor'];
    readonly trace?: never;
  };
  readonly '/v1/auth/web-session': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['createWebSession'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/categories': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listManagedCategories'];
    readonly put?: never;
    readonly post: operations['createCategory'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/categories/{categoryId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getManagedCategory'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch: operations['updateCategory'];
    readonly trace?: never;
  };
  readonly '/v1/invitations/accept': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['acceptInvitation'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/me': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getMe'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch: operations['updateMe'];
    readonly trace?: never;
  };
  readonly '/v1/meta': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getApiMeta'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listWorkspacePosts'];
    readonly put?: never;
    readonly post: operations['createPost'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getWorkspacePost'];
    readonly put?: never;
    readonly post?: never;
    readonly delete: operations['trashPost'];
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/draft': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put: operations['savePostDraft'];
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/media': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['stagePostMedia'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/media/{mediaId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getPostMediaMetadata'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/media/{mediaId}/{variant}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getPrivatePostMedia'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/publish': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['publishPostRevision'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/reject': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['rejectPostRevision'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/restore': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['restoreTrashedPost'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/restore-revision': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['restorePostRevision'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/review-events': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listPostReviewEvents'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/revisions': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listPostRevisions'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/revisions/{revisionId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getPostRevision'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/slug': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch: operations['changePostSlug'];
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/submit': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['submitPostForReview'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/unpublish': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['unpublishPost'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/{postId}/withdraw-review': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['withdrawPostReview'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/posts/by-client-draft-id/{clientDraftId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getPostByClientDraftId'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/public/authors/{handle}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getPublicAuthor'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/public/categories': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listPublicCategories'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/public/posts': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listPublicPosts'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/public/posts/{postId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getPublicPost'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/public/posts/{postId}/media/{mediaId}/{variant}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getPublicPostMedia'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/public/posts/availability': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post: operations['checkPublicPostAvailability'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/public/posts/by-slug/{slug}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['resolvePublicPostSlug'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/public/search': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['searchPublicPosts'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/public/tags': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listPublicTags'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/tags': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['listManagedTags'];
    readonly put?: never;
    readonly post: operations['createTag'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/v1/tags/{tagId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get: operations['getManagedTag'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch: operations['updateTag'];
    readonly trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    readonly AcceptInvitationEnvelope: {
      readonly data: components['schemas']['Me'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly AcceptInvitationInput: {
      /** @description Base64url encoding of a random 256-bit secret. */
      readonly token: string;
    };
    readonly AdminMember: {
      readonly active: boolean;
      readonly bio: string;
      /** Format: date-time */
      readonly createdAt: string;
      readonly displayName: string;
      /** Format: email */
      readonly email: string;
      readonly handle: string;
      /** Format: uuid */
      readonly id: string;
      readonly role: components['schemas']['Role'];
      /** Format: date-time */
      readonly updatedAt: string;
      readonly version: number;
    };
    readonly ApiError: {
      readonly code: string;
      readonly context: Record<string, never> | null;
      readonly fieldErrors: readonly components['schemas']['FieldIssue'][];
    };
    readonly ApiLimits: {
      /** @constant */
      readonly defaultPageSize: 20;
      /** @constant */
      readonly defaultTaxonomyPageSize: 50;
      /** @constant */
      readonly idempotencyTtlSeconds: 86400;
      /** @constant */
      readonly invitationTtlSeconds: 604800;
      /** @constant */
      readonly maxActivePostsPerMember: 100;
      /** @constant */
      readonly maxAvailabilityIds: 50;
      /** @constant */
      readonly maxImagePixels: 12000000;
      /** @constant */
      readonly maxJsonBodyBytes: 1048576;
      /** @constant */
      readonly maxMarkdownBytes: 131072;
      /** @constant */
      readonly maxMultipartBodyBytes: 6291456;
      /** @constant */
      readonly maxPageSize: 50;
      /** @constant */
      readonly maxPendingUploadBytesPerMember: 104857600;
      /** @constant */
      readonly maxSearchResults: 1000;
      /** @constant */
      readonly maxTagsPerPost: 5;
      /** @constant */
      readonly maxUploadFileBytes: 5242880;
      /** @constant */
      readonly unattachedMediaTtlSeconds: 86400;
    };
    readonly ApiMeta: {
      /** @constant */
      readonly apiMajor: 1;
      readonly buildSha: string;
      readonly clients: {
        readonly android: {
          readonly minimumSupportedVersion: string | null;
          readonly recommendedVersion: string;
        };
        readonly web: {
          readonly minimumSupportedVersion: string | null;
          readonly recommendedVersion: string;
        };
      };
      readonly contractVersion: string;
      readonly deployment?: {
        readonly configurationDigest: string;
        readonly environment: string;
        readonly revision: string | null;
        readonly runtimeInputDigest: string;
      };
      readonly features: readonly string[];
      readonly lifecycle: {
        readonly deprecatedAt: string | null;
        readonly migrationGuidePath: string | null;
        readonly noticePublishedAt: string | null;
        /** @enum {string} */
        readonly status: 'ACTIVE' | 'DEPRECATED' | 'RETIRED';
        readonly successorApiMajor: number | null;
        readonly sunsetAt: string | null;
      };
      readonly limits: components['schemas']['ApiLimits'];
      /** @constant */
      readonly markdownContractVersion: 1;
    };
    readonly AuditEvent: {
      readonly action: string;
      readonly actor: components['schemas']['AuthorSummary'];
      readonly changes: Record<string, never>;
      /** Format: date-time */
      readonly createdAt: string;
      /** Format: uuid */
      readonly id: string;
      /** Format: uuid */
      readonly subjectId: string;
      readonly subjectType: string;
    };
    readonly AuthorSummary: {
      readonly displayName: string;
      readonly handle: string;
      /** Format: uuid */
      readonly id: string;
    };
    readonly AvailabilityInput: {
      readonly postIds: readonly string[];
    };
    readonly AvailabilityItem: {
      readonly available: boolean;
      /** Format: uuid */
      readonly postId: string;
      readonly publishedRevisionId: string | null;
    } & unknown;
    readonly ChangePostSlugEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ChangeSlugInput: {
      readonly slug: string;
    };
    readonly CheckPublicPostAvailabilityEnvelope: {
      readonly data: readonly components['schemas']['AvailabilityItem'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly CreateCategoryEnvelope: {
      readonly data: components['schemas']['ManagedTaxon'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 201;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly CreateInvitationEnvelope: {
      readonly data: components['schemas']['InvitationIssueResult'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 201;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly CreateInvitationInput: {
      /** Format: email */
      readonly email: string;
      readonly role: components['schemas']['Role'];
    };
    readonly CreatePostEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 201;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly CreatePostInput: {
      /** Format: uuid */
      readonly clientDraftId: string;
      readonly draft: components['schemas']['DraftContentInput'];
    };
    readonly CreateTagEnvelope: {
      readonly data: components['schemas']['ManagedTaxon'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 201;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly CreateTaxonInput: {
      readonly name: string;
      readonly slug: string;
    };
    readonly CreateWebSessionEnvelope: {
      readonly data: components['schemas']['WebSession'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly CursorPagination: {
      readonly hasMore: boolean;
      /** @constant */
      readonly kind: 'CURSOR';
      readonly nextCursor: string | null;
      readonly pageSize: number;
    };
    /** Format: date-time */
    readonly DateTime: string;
    readonly DraftContent: {
      readonly categoryId: string | null;
      /** @default null */
      readonly coverAltText: string | null;
      /** @default false */
      readonly coverDecorative: boolean;
      readonly coverMediaId: string | null;
      /** @description Maximum 131072 UTF-8 bytes. Markdown contract 1. Images use media://UUID, never external URLs. */
      readonly markdown: string;
      /**
       * @default 1
       * @constant
       */
      readonly markdownContractVersion: 1;
      readonly summary: string;
      readonly tagIds: readonly string[];
      readonly title: string;
    };
    readonly DraftContentInput: {
      readonly categoryId: string | null;
      /** @default null */
      readonly coverAltText?: string | null;
      /** @default false */
      readonly coverDecorative?: boolean;
      readonly coverMediaId: string | null;
      /** @description Maximum 131072 UTF-8 bytes. Markdown contract 1. Images use media://UUID, never external URLs. */
      readonly markdown: string;
      /**
       * @default 1
       * @constant
       */
      readonly markdownContractVersion?: 1;
      readonly summary: string;
      readonly tagIds: readonly string[];
      readonly title: string;
    };
    readonly EmptyInput: Record<string, never>;
    readonly ErrorEnvelope: {
      readonly data: null;
      readonly error: components['schemas']['ApiError'];
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'] | null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'ERROR';
      readonly statusCode: number;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly FieldIssue: {
      readonly code: string;
      readonly field: string;
      /** @enum {string} */
      readonly location: 'header' | 'path' | 'query' | 'body';
      readonly params: Record<string, never>;
    };
    readonly GetInvitationEnvelope: {
      readonly data: components['schemas']['Invitation'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly GetManagedCategoryEnvelope: {
      readonly data: components['schemas']['ManagedTaxon'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly GetManagedTagEnvelope: {
      readonly data: components['schemas']['ManagedTaxon'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly GetMeEnvelope: {
      readonly data: components['schemas']['Me'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly GetMemberEnvelope: {
      readonly data: components['schemas']['AdminMember'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly GetPostByClientDraftIdEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly GetPostMediaMetadataEnvelope: {
      readonly data: components['schemas']['MediaAsset'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly GetPostRevisionEnvelope: {
      readonly data: components['schemas']['Revision'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly GetPublicAuthorEnvelope: {
      readonly data: components['schemas']['PublicAuthor'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly GetPublicPostEnvelope: {
      readonly data: components['schemas']['PublicPost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly GetWorkspacePostEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly Health: {
      /** @enum {string} */
      readonly status: 'ok' | 'unavailable';
    };
    readonly IdempotencyMeta: {
      /** Format: date-time */
      readonly expiresAt: string;
      readonly replayed: boolean;
    };
    readonly ImageReference: {
      readonly altText: string;
      readonly decorative: boolean;
      readonly height: number;
      /** Format: uuid */
      readonly mediaId: string;
      /** @enum {string} */
      readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      readonly variants: readonly components['schemas']['MediaVariant'][] &
        (unknown & unknown & unknown);
      readonly width: number;
    } & unknown;
    readonly Invitation: {
      readonly acceptedAt: string | null;
      /** Format: date-time */
      readonly createdAt: string;
      /** Format: email */
      readonly email: string;
      /** Format: date-time */
      readonly expiresAt: string;
      /** Format: uuid */
      readonly id: string;
      readonly issuedBy: components['schemas']['AuthorSummary'];
      readonly revokedAt: string | null;
      readonly role: components['schemas']['Role'];
      readonly status: components['schemas']['InvitationStatus'];
      readonly version: number;
    };
    readonly InvitationIssueResult: {
      readonly invitation: components['schemas']['Invitation'];
      readonly inviteUrl: string | null;
      readonly linkAvailable: boolean;
    };
    /** @enum {string} */
    readonly InvitationStatus: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
    readonly ListAuditEventsEnvelope: {
      readonly data: readonly components['schemas']['AuditEvent'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['CursorPagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ListInvitationsEnvelope: {
      readonly data: readonly components['schemas']['Invitation'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['CursorPagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ListManagedCategoriesEnvelope: {
      readonly data: readonly components['schemas']['ManagedTaxon'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['PagePagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ListManagedTagsEnvelope: {
      readonly data: readonly components['schemas']['ManagedTaxon'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['PagePagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ListMembersEnvelope: {
      readonly data: readonly components['schemas']['AdminMember'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['CursorPagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ListPostReviewEventsEnvelope: {
      readonly data: readonly components['schemas']['ReviewEvent'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['CursorPagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ListPostRevisionsEnvelope: {
      readonly data: readonly components['schemas']['RevisionSummary'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['CursorPagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ListPublicCategoriesEnvelope: {
      readonly data: readonly components['schemas']['Taxon'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['PagePagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ListPublicPostsEnvelope: {
      readonly data: readonly components['schemas']['PublicPostSummary'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['CursorPagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ListPublicTagsEnvelope: {
      readonly data: readonly components['schemas']['Taxon'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['PagePagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ListWorkspacePostsEnvelope: {
      readonly data: readonly components['schemas']['WorkspacePostSummary'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['CursorPagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ManagedTaxon: {
      readonly active: boolean;
      /** Format: date-time */
      readonly createdAt: string;
      /** Format: uuid */
      readonly id: string;
      readonly name: string;
      readonly slug: string;
      /** Format: date-time */
      readonly updatedAt: string;
      readonly usage: {
        readonly draftCount: number;
        readonly publishedCount: number;
      };
      readonly version: number;
    };
    readonly Me: {
      readonly active: boolean;
      readonly bio: string;
      readonly displayName: string;
      /** Format: email */
      readonly email: string;
      readonly handle: string;
      /** Format: uuid */
      readonly id: string;
      readonly role: components['schemas']['Role'];
      readonly version: number;
    };
    readonly MediaAsset: {
      /** Format: date-time */
      readonly createdAt: string;
      readonly height: number;
      /** Format: uuid */
      readonly id: string;
      /** @enum {string} */
      readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      /** Format: uuid */
      readonly postId: string;
      /** @constant */
      readonly ready: true;
      readonly unattachedExpiresAt: string | null;
      readonly variants: readonly components['schemas']['MediaVariant'][] &
        (unknown & unknown & unknown);
      readonly width: number;
    };
    readonly MediaDescriptor: {
      readonly height: number;
      /** Format: uuid */
      readonly mediaId: string;
      /** @enum {string} */
      readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      readonly variants: readonly components['schemas']['MediaVariant'][] &
        (unknown & unknown & unknown);
      readonly width: number;
    };
    readonly MediaVariant: {
      readonly apiPath: string;
      readonly byteSize: number;
      readonly height: number;
      /** @enum {string} */
      readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      readonly name: components['schemas']['VariantName'];
      readonly width: number;
    };
    readonly MetaEnvelope: {
      readonly data: components['schemas']['ApiMeta'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly PagePagination: {
      readonly hasMore: boolean;
      /** @constant */
      readonly kind: 'PAGE';
      readonly page: number;
      readonly pageSize: number;
      readonly totalItems: number;
      readonly totalPages: number;
      readonly truncated: boolean;
    };
    /** @enum {string} */
    readonly PublicationState: 'NEVER_PUBLISHED' | 'PUBLISHED' | 'WITHDRAWN';
    readonly PublicAuthor: {
      readonly bio: string;
      readonly displayName: string;
      readonly handle: string;
      /** Format: uuid */
      readonly id: string;
    };
    readonly PublicPost: {
      readonly author: components['schemas']['AuthorSummary'];
      readonly category: components['schemas']['Taxon'];
      readonly cover: components['schemas']['ImageReference'] | null;
      /** Format: date-time */
      readonly firstPublishedAt: string;
      /** Format: uuid */
      readonly id: string;
      /** @description Maximum 131072 UTF-8 bytes. Markdown contract 1. Images use media://UUID, never external URLs. */
      readonly markdown: string;
      /** @constant */
      readonly markdownContractVersion: 1;
      readonly media: readonly components['schemas']['MediaDescriptor'][];
      /** Format: uuid */
      readonly publishedRevisionId: string;
      readonly slug: string;
      readonly summary: string;
      readonly tags: readonly components['schemas']['Taxon'][];
      readonly title: string;
      /** Format: date-time */
      readonly updatedAt: string;
    };
    readonly PublicPostSummary: {
      readonly author: components['schemas']['AuthorSummary'];
      readonly category: components['schemas']['Taxon'];
      readonly cover: components['schemas']['ImageReference'] | null;
      /** Format: date-time */
      readonly firstPublishedAt: string;
      /** Format: uuid */
      readonly id: string;
      /** Format: uuid */
      readonly publishedRevisionId: string;
      readonly slug: string;
      readonly summary: string;
      readonly tags: readonly components['schemas']['Taxon'][];
      readonly title: string;
      /** Format: date-time */
      readonly updatedAt: string;
    };
    readonly PublishPostRevisionEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ReassignAuthorInput: {
      /** Format: uuid */
      readonly authorId: string;
    };
    readonly ReassignPostAuthorEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ReissueInvitationEnvelope: {
      readonly data: components['schemas']['InvitationIssueResult'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 201;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly RejectPostRevisionEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly RejectRevisionInput: {
      readonly feedback: string;
      /** Format: uuid */
      readonly revisionId: string;
    };
    readonly ResolvePublicPostSlugEnvelope: {
      readonly data: components['schemas']['SlugResolution'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ResponseMeta: {
      readonly contractVersion: string;
      readonly idempotency: components['schemas']['IdempotencyMeta'] | null;
      readonly pagination:
        | (
            | components['schemas']['CursorPagination']
            | components['schemas']['PagePagination']
          )
        | null;
    };
    readonly RestorePostRevisionEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly RestoreTrashedPostEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly ReviewEvent: {
      readonly action: string;
      readonly actor: components['schemas']['AuthorSummary'];
      /** Format: date-time */
      readonly createdAt: string;
      readonly feedback: string | null;
      /** Format: uuid */
      readonly id: string;
      /** Format: uuid */
      readonly postId: string;
      /** Format: uuid */
      readonly revisionId: string;
    };
    readonly ReviewFeedback: {
      readonly actor: components['schemas']['AuthorSummary'];
      /** Format: date-time */
      readonly createdAt: string;
      /** Format: uuid */
      readonly revisionId: string;
      readonly text: string;
    };
    readonly ReviewState: {
      readonly lastFeedback: components['schemas']['ReviewFeedback'] | null;
      readonly submittedAt: string | null;
      readonly submittedRevisionId: string | null;
    };
    readonly Revision: {
      readonly content: components['schemas']['DraftContent'];
      /** Format: date-time */
      readonly createdAt: string;
      readonly createdBy: components['schemas']['AuthorSummary'];
      readonly creditedAuthor: components['schemas']['AuthorSummary'];
      /** Format: uuid */
      readonly id: string;
      readonly media: readonly components['schemas']['MediaDescriptor'][];
      readonly number: number;
      /** Format: uuid */
      readonly postId: string;
      readonly restoredFromRevisionId: string | null;
    };
    readonly RevisionActionInput: {
      /** Format: uuid */
      readonly revisionId: string;
    };
    readonly RevisionSummary: {
      /** Format: date-time */
      readonly createdAt: string;
      readonly createdBy: components['schemas']['AuthorSummary'];
      /** Format: uuid */
      readonly id: string;
      readonly number: number;
      /** Format: uuid */
      readonly postId: string;
      readonly title: string;
    };
    readonly RevokeInvitationEnvelope: {
      readonly data: components['schemas']['Invitation'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    /** @enum {string} */
    readonly Role: 'AUTHOR' | 'EDITOR' | 'ADMIN';
    readonly SavePostDraftEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly SearchPublicPostsEnvelope: {
      readonly data: readonly components['schemas']['PublicPostSummary'][];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: null;
        readonly pagination: components['schemas']['PagePagination'];
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly SlugResolution: {
      readonly canonicalPath: string;
      readonly canonicalSlug: string;
      readonly post: components['schemas']['PublicPost'] | null;
      /** @enum {string} */
      readonly resolution: 'CANONICAL' | 'REDIRECT';
    } & unknown;
    readonly StageMediaInput: {
      /**
       * Format: binary
       * @description One JPEG, PNG or WebP file; encoded file <= 5242880 bytes, complete multipart <= 6291456 bytes; decoded <= 12000000 pixels, single frame.
       */
      readonly file: string;
    };
    readonly StagePostMediaEnvelope: {
      readonly data: components['schemas']['MediaAsset'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 201;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly SubmitPostForReviewEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly Taxon: {
      readonly active: boolean;
      /** Format: uuid */
      readonly id: string;
      readonly name: string;
      readonly slug: string;
    };
    readonly TrashPostEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly UnpublishPostEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly UpdateCategoryEnvelope: {
      readonly data: components['schemas']['ManagedTaxon'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly UpdateMeEnvelope: {
      readonly data: components['schemas']['Me'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly UpdateMeInput: {
      readonly bio?: string | null;
      readonly displayName?: string;
    };
    readonly UpdateMemberEnvelope: {
      readonly data: components['schemas']['AdminMember'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly UpdateMemberInput: {
      readonly active?: boolean;
      readonly role?: components['schemas']['Role'];
    };
    readonly UpdateTagEnvelope: {
      readonly data: components['schemas']['ManagedTaxon'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    readonly UpdateTaxonInput: {
      readonly active?: boolean;
      readonly name?: string;
    };
    /** Format: uuid */
    readonly UUID: string;
    /** @enum {string} */
    readonly VariantName: 'w480' | 'w960' | 'w1600';
    readonly Version: number;
    readonly WebSession: {
      /** Format: date-time */
      readonly expiresAt: string;
      readonly member: components['schemas']['Me'];
      /** @description Credential for the server proxy only; never forward this JSON to a browser or log it. */
      readonly sessionCookie: string;
    };
    readonly WebSessionInput: {
      readonly idToken: string;
    };
    readonly WithdrawPostReviewEnvelope: {
      readonly data: components['schemas']['WorkspacePost'];
      readonly error: null;
      readonly message: {
        readonly descriptions: string;
        readonly title: string;
      };
      readonly meta: {
        /** @constant */
        readonly contractVersion: '1.0.0';
        readonly idempotency: components['schemas']['IdempotencyMeta'];
        readonly pagination: null;
      };
      /** @constant */
      readonly responseKey: 'SUCCESS';
      /** @constant */
      readonly statusCode: 200;
      /** Format: date-time */
      readonly timestamp: string;
      readonly traceId: string;
    };
    /** @enum {string} */
    readonly WorkflowState:
      'DRAFT' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'CLEAN';
    readonly WorkspacePost: {
      readonly allowedActions: readonly string[];
      readonly author: components['schemas']['AuthorSummary'];
      /** Format: uuid */
      readonly clientDraftId: string;
      /** Format: date-time */
      readonly createdAt: string;
      /** Format: uuid */
      readonly id: string;
      readonly publicationState: components['schemas']['PublicationState'];
      readonly publishedRevision: components['schemas']['Revision'] | null;
      readonly publishedRevisionId: string | null;
      readonly purgeAfter: string | null;
      readonly review: components['schemas']['ReviewState'];
      readonly slug: string | null;
      readonly trashedAt: string | null;
      /** Format: date-time */
      readonly updatedAt: string;
      readonly version: number;
      readonly workflowState: components['schemas']['WorkflowState'];
      readonly workingRevision: components['schemas']['Revision'] | null;
      readonly workingRevisionId: string | null;
    };
    readonly WorkspacePostSummary: {
      readonly allowedActions: readonly string[];
      readonly author: components['schemas']['AuthorSummary'];
      /** Format: uuid */
      readonly clientDraftId: string;
      /** Format: date-time */
      readonly createdAt: string;
      /** Format: uuid */
      readonly id: string;
      readonly publicationState: components['schemas']['PublicationState'];
      readonly publishedRevisionId: string | null;
      readonly purgeAfter: string | null;
      readonly slug: string | null;
      readonly trashedAt: string | null;
      /** Format: date-time */
      readonly updatedAt: string;
      readonly version: number;
      readonly workflowState: components['schemas']['WorkflowState'];
      readonly workingRevisionId: string | null;
    };
  };
  responses: {
    /** @description INVALID_CLIENT_METADATA, MALFORMED_JSON, INVALID_CURSOR, INVALID_IDEMPOTENCY_KEY, INVALID_EXPECTED_VERSION, AMBIGUOUS_CREDENTIALS */
    readonly Error400: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description AUTHENTICATION_REQUIRED, INVALID_CREDENTIAL, AUTHENTICATION_EXPIRED */
    readonly Error401: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description INSUFFICIENT_PERMISSION, ACCESS_REVOKED, INVITATION_ACCOUNT_MISMATCH, CSRF_VALIDATION_FAILED */
    readonly Error403: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description RESOURCE_NOT_FOUND, INVITATION_INVALID */
    readonly Error404: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description METHOD_NOT_ALLOWED */
    readonly Error405: {
      headers: {
        readonly Allow?: string;
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description WORKFLOW_CONFLICT, SLUG_CONFLICT, LAST_ADMIN_REQUIRED, MEMBER_ALREADY_EXISTS, CLIENT_DRAFT_ALREADY_EXISTS, IDEMPOTENCY_KEY_REUSED, IDEMPOTENCY_IN_PROGRESS, RESOURCE_QUOTA_EXCEEDED */
    readonly Error409: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        /** @description Delay in seconds when retry is appropriate; in-progress writes preserve key/input. */
        readonly 'Retry-After'?: string;
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description API_VERSION_RETIRED */
    readonly Error410: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description INVITATION_EXPIRED, INVITATION_USED, INVITATION_REVOKED, API_VERSION_RETIRED */
    readonly Error410Invitation: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description VERSION_CONFLICT */
    readonly Error412: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description PAYLOAD_TOO_LARGE, UPLOAD_TOO_LARGE */
    readonly Error413: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description UNSUPPORTED_MEDIA_TYPE */
    readonly Error415: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description VALIDATION_FAILED, MARKDOWN_UNSUPPORTED, SEARCH_QUERY_NOT_SEARCHABLE */
    readonly Error422: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description EXPECTED_VERSION_REQUIRED */
    readonly Error428: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description RATE_LIMITED */
    readonly Error429: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        /** @description Delay in seconds when retry is appropriate; in-progress writes preserve key/input. */
        readonly 'Retry-After'?: string;
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description INTERNAL_ERROR */
    readonly Error500: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description DEPENDENCY_UNAVAILABLE */
    readonly Error503: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        /** @description Delay in seconds when retry is appropriate; in-progress writes preserve key/input. */
        readonly 'Retry-After'?: string;
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
    /** @description UPSTREAM_TIMEOUT */
    readonly Error504: {
      headers: {
        readonly 'Cache-Control'?: 'no-store';
        readonly 'X-API-Contract-Version'?: '1.0.0';
        readonly 'X-Content-Type-Options'?: 'nosniff';
        /** @description Matches the envelope traceId. */
        readonly 'X-Trace-ID'?: string;
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/json': components['schemas']['ErrorEnvelope'];
      };
    };
  };
  parameters: {
    /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
    readonly ExpectedVersion: string;
    /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
    readonly IdempotencyKey: string;
    /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
    readonly Traceparent: string;
    /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
    readonly 'X-App-Language': string;
    /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
    readonly 'X-App-Version': string;
    /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
    readonly 'X-Device-ID': string;
    /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
    readonly 'X-Device-OS': string;
    /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
    readonly 'X-Device-Version': string & unknown;
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  readonly getLiveness: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Healthy */
      readonly 200: {
        headers: {
          readonly [name: string]: unknown;
        };
        content: {
          /**
           * @example {
           *       "status": "ok"
           *     }
           */
          readonly 'application/json': components['schemas']['Health'];
        };
      };
    };
  };
  readonly getReadiness: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Healthy */
      readonly 200: {
        headers: {
          readonly [name: string]: unknown;
        };
        content: {
          /**
           * @example {
           *       "status": "ok"
           *     }
           */
          readonly 'application/json': components['schemas']['Health'];
        };
      };
      /** @description SQL unavailable or incompatible schema */
      readonly 503: {
        headers: {
          readonly [name: string]: unknown;
        };
        content: {
          /**
           * @example {
           *       "status": "unavailable"
           *     }
           */
          readonly 'application/json': components['schemas']['Health'];
        };
      };
    };
  };
  readonly listAuditEvents: {
    readonly parameters: {
      readonly query?: {
        readonly action?: string;
        readonly cursor?: string;
        readonly pageSize?: number;
        readonly subjectId?: string;
        readonly subjectType?: string;
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of AuditEvent */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListAuditEventsEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly listInvitations: {
    readonly parameters: {
      readonly query?: {
        readonly cursor?: string;
        readonly pageSize?: number;
        readonly status?: components['schemas']['InvitationStatus'];
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of Invitation */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListInvitationsEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly createInvitation: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['CreateInvitationInput'];
      };
    };
    readonly responses: {
      /** @description InvitationIssueResult */
      readonly 201: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          /** @description Backend-relative path of the created resource. */
          readonly Location?: string;
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CreateInvitationEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getInvitation: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly invitationId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Invitation */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetInvitationEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly reissueInvitation: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly invitationId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['EmptyInput'];
      };
    };
    readonly responses: {
      /** @description InvitationIssueResult */
      readonly 201: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          /** @description Backend-relative path of the created resource. */
          readonly Location?: string;
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ReissueInvitationEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410Invitation'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly revokeInvitation: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly invitationId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['EmptyInput'];
      };
    };
    readonly responses: {
      /** @description Invitation */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['RevokeInvitationEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410Invitation'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly listMembers: {
    readonly parameters: {
      readonly query?: {
        readonly active?: boolean;
        readonly cursor?: string;
        readonly pageSize?: number;
        readonly role?: components['schemas']['Role'];
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of AdminMember */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListMembersEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getMember: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly memberId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description AdminMember */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetMemberEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly updateMember: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly memberId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['UpdateMemberInput'];
      };
    };
    readonly responses: {
      /** @description AdminMember */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['UpdateMemberEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly reassignPostAuthor: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ReassignAuthorInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ReassignPostAuthorEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly createWebSession: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['WebSessionInput'];
      };
    };
    readonly responses: {
      /** @description WebSession */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CreateWebSessionEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly listManagedCategories: {
    readonly parameters: {
      readonly query?: {
        readonly active?: boolean;
        readonly page?: number;
        readonly pageSize?: number;
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of ManagedTaxon */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListManagedCategoriesEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly createCategory: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['CreateTaxonInput'];
      };
    };
    readonly responses: {
      /** @description ManagedTaxon */
      readonly 201: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          /** @description Backend-relative path of the created resource. */
          readonly Location?: string;
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CreateCategoryEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getManagedCategory: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly categoryId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description ManagedTaxon */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetManagedCategoryEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly updateCategory: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly categoryId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['UpdateTaxonInput'];
      };
    };
    readonly responses: {
      /** @description ManagedTaxon */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['UpdateCategoryEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly acceptInvitation: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['AcceptInvitationInput'];
      };
    };
    readonly responses: {
      /** @description Me */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AcceptInvitationEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410Invitation'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getMe: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Me */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetMeEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly updateMe: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['UpdateMeInput'];
      };
    };
    readonly responses: {
      /** @description Me */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['UpdateMeEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getApiMeta: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description ApiMeta */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['MetaEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly listWorkspacePosts: {
    readonly parameters: {
      readonly query?: {
        readonly cursor?: string;
        readonly pageSize?: number;
        readonly publicationState?: components['schemas']['PublicationState'];
        readonly scope?: 'OWN' | 'ALL';
        readonly trashed?: boolean;
        readonly workflowState?: components['schemas']['WorkflowState'];
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of WorkspacePostSummary */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListWorkspacePostsEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly createPost: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['CreatePostInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 201: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          /** @description Backend-relative path of the created resource. */
          readonly Location?: string;
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CreatePostEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getWorkspacePost: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetWorkspacePostEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly trashPost: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['TrashPostEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly savePostDraft: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['DraftContentInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['SavePostDraftEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly stagePostMedia: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'multipart/form-data': components['schemas']['StageMediaInput'];
      };
    };
    readonly responses: {
      /** @description MediaAsset */
      readonly 201: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          /** @description Backend-relative path of the created resource. */
          readonly Location?: string;
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['StagePostMediaEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getPostMediaMetadata: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly mediaId: string;
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description MediaAsset */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetPostMediaMetadataEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getPrivatePostMedia: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly mediaId: string;
        readonly postId: string;
        readonly variant: components['schemas']['VariantName'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Validated image bytes; access checked on every request. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'image/jpeg': string;
          readonly 'image/png': string;
          readonly 'image/webp': string;
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly publishPostRevision: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['RevisionActionInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PublishPostRevisionEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly rejectPostRevision: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['RejectRevisionInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['RejectPostRevisionEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly restoreTrashedPost: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['EmptyInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['RestoreTrashedPostEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly restorePostRevision: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['RevisionActionInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['RestorePostRevisionEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly listPostReviewEvents: {
    readonly parameters: {
      readonly query?: {
        readonly cursor?: string;
        readonly pageSize?: number;
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of ReviewEvent */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListPostReviewEventsEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly listPostRevisions: {
    readonly parameters: {
      readonly query?: {
        readonly cursor?: string;
        readonly pageSize?: number;
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of RevisionSummary */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListPostRevisionsEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getPostRevision: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly postId: string;
        readonly revisionId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Revision */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetPostRevisionEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly changePostSlug: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ChangeSlugInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ChangePostSlugEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly submitPostForReview: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['RevisionActionInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['SubmitPostForReviewEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly unpublishPost: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['EmptyInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['UnpublishPostEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly withdrawPostReview: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['EmptyInput'];
      };
    };
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['WithdrawPostReviewEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getPostByClientDraftId: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly clientDraftId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description WorkspacePost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetPostByClientDraftIdEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getPublicAuthor: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly handle: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description PublicAuthor */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetPublicAuthorEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly listPublicCategories: {
    readonly parameters: {
      readonly query?: {
        readonly page?: number;
        readonly pageSize?: number;
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of Taxon */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListPublicCategoriesEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly listPublicPosts: {
    readonly parameters: {
      readonly query?: {
        readonly authorId?: string;
        readonly categoryId?: string;
        readonly cursor?: string;
        readonly pageSize?: number;
        /** @description Repeated tagIds values use AND semantics. */
        readonly tagIds?: readonly string[];
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of PublicPostSummary */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListPublicPostsEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getPublicPost: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly postId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description PublicPost */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetPublicPostEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getPublicPostMedia: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly mediaId: string;
        readonly postId: string;
        readonly variant: components['schemas']['VariantName'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Validated image bytes; access checked on every request. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'image/jpeg': string;
          readonly 'image/png': string;
          readonly 'image/webp': string;
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly checkPublicPostAvailability: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['AvailabilityInput'];
      };
    };
    readonly responses: {
      /** @description Array of AvailabilityItem */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CheckPublicPostAvailabilityEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly resolvePublicPostSlug: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly slug: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description SlugResolution */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ResolvePublicPostSlugEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly searchPublicPosts: {
    readonly parameters: {
      readonly query: {
        readonly authorId?: string;
        readonly categoryId?: string;
        readonly page?: number;
        readonly pageSize?: number;
        readonly q: string;
        /** @description Repeated tagIds values use AND semantics. */
        readonly tagIds?: readonly string[];
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of PublicPostSummary */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['SearchPublicPostsEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly listPublicTags: {
    readonly parameters: {
      readonly query?: {
        readonly page?: number;
        readonly pageSize?: number;
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of Taxon */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListPublicTagsEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly listManagedTags: {
    readonly parameters: {
      readonly query?: {
        readonly active?: boolean;
        readonly page?: number;
        readonly pageSize?: number;
      };
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Array of ManagedTaxon */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ListManagedTagsEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly createTag: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['CreateTaxonInput'];
      };
    };
    readonly responses: {
      /** @description ManagedTaxon */
      readonly 201: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          /** @description Backend-relative path of the created resource. */
          readonly Location?: string;
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CreateTagEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly getManagedTag: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
      };
      readonly path: {
        readonly tagId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description ManagedTaxon */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['GetManagedTagEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
  readonly updateTag: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /** @description UUID v4. Scope: identity UID + method + path + key. Semantic input includes expected version, excludes credentials/device/trace. Successful results replay for 24 hours. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKey'];
        /** @description W3C trace context. Invalid/all-zero context is replaced, never used for authorization. */
        readonly traceparent?: components['parameters']['Traceparent'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. One well-formed BCP 47 language tag, including valid unsupported languages. */
        readonly 'X-App-Language': components['parameters']['X-App-Language'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. Strict SemVer with optional build metadata. */
        readonly 'X-App-Version': components['parameters']['X-App-Version'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-ID': components['parameters']['X-Device-ID'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-OS': components['parameters']['X-Device-OS'];
        /** @description Required exactly once, including anonymous/media requests. No blank/control/comma-joined values. Probe and CORS preflight are exempt. */
        readonly 'X-Device-Version': components['parameters']['X-Device-Version'];
        /** @description Committed resource version. Missing 428; malformed 400; stale 412. Replay follows current authorization and precedes current-version checks. */
        readonly 'X-Expected-Version': components['parameters']['ExpectedVersion'];
      };
      readonly path: {
        readonly tagId: string;
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['UpdateTaxonInput'];
      };
    };
    readonly responses: {
      /** @description ManagedTaxon */
      readonly 200: {
        headers: {
          readonly 'Cache-Control'?: 'no-store';
          readonly 'X-API-Contract-Version'?: '1.0.0';
          readonly 'X-Content-Type-Options'?: 'nosniff';
          /** @description Committed version, including the original version on replay. No workspace version on public snapshots. */
          readonly 'X-Resource-Version'?: string;
          /** @description Matches the envelope traceId. */
          readonly 'X-Trace-ID'?: string;
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['UpdateTagEnvelope'];
        };
      };
      readonly 400: components['responses']['Error400'];
      readonly 401: components['responses']['Error401'];
      readonly 403: components['responses']['Error403'];
      readonly 404: components['responses']['Error404'];
      readonly 405: components['responses']['Error405'];
      readonly 409: components['responses']['Error409'];
      readonly 410: components['responses']['Error410'];
      readonly 412: components['responses']['Error412'];
      readonly 413: components['responses']['Error413'];
      readonly 415: components['responses']['Error415'];
      readonly 422: components['responses']['Error422'];
      readonly 428: components['responses']['Error428'];
      readonly 429: components['responses']['Error429'];
      readonly 500: components['responses']['Error500'];
      readonly 503: components['responses']['Error503'];
      readonly 504: components['responses']['Error504'];
    };
  };
}
