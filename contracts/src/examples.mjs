import { limits } from './schemas.mjs';

export const at = '2026-10-25T08:20:30.123Z';
export const ids = {
  post: '10000000-0000-4000-8000-000000000001',
  draft: '10000000-0000-4000-8000-000000000002',
  revision: '20000000-0000-4000-8000-000000000001',
  savedRevision: '20000000-0000-4000-8000-000000000002',
  restoredRevision: '20000000-0000-4000-8000-000000000003',
  category: '30000000-0000-4000-8000-000000000001',
  tag: '30000000-0000-4000-8000-000000000002',
  author: '40000000-0000-4000-8000-000000000001',
  editor: '40000000-0000-4000-8000-000000000002',
  admin: '40000000-0000-4000-8000-000000000003',
  invited: '40000000-0000-4000-8000-000000000004',
  media: '50000000-0000-4000-8000-000000000001',
  invitation: '60000000-0000-4000-8000-000000000001',
  event: '70000000-0000-4000-8000-000000000001',
};
export const author = {
  id: ids.author,
  handle: 'synthetic-author',
  displayName: 'Synthetic author',
};
export const editor = {
  id: ids.editor,
  handle: 'synthetic-editor',
  displayName: 'Synthetic editor',
};
export const admin = {
  id: ids.admin,
  handle: 'synthetic-admin',
  displayName: 'Synthetic admin',
};
export const taxon = {
  id: ids.category,
  name: 'Engineering',
  slug: 'engineering',
  active: true,
};
export const tag = {
  id: ids.tag,
  name: 'Learning',
  slug: 'learning',
  active: true,
};
export const headers = {
  'X-Device-ID': '8d5ca46a-7f59-4f64-9d91-fedc41b59e7a',
  'X-Device-OS': 'ANDROID',
  'X-Device-Version': 'unknown',
  'X-App-Version': '0.0.0+fixture.1',
  'X-App-Language': 'en',
};
export const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==';
const privateVariants = ['w480', 'w960', 'w1600'].map((name) => ({
  name,
  apiPath: `/v1/posts/${ids.post}/media/${ids.media}/${name}`,
  width: 1,
  height: 1,
  mimeType: 'image/png',
  byteSize: Buffer.from(pngBase64, 'base64').length,
}));
export const media = {
  mediaId: ids.media,
  width: 1,
  height: 1,
  mimeType: 'image/png',
  variants: privateVariants,
};
export const publicMedia = {
  ...media,
  variants: privateVariants.map((variant) => ({
    ...variant,
    apiPath: variant.apiPath.replace('/v1/posts/', '/v1/public/posts/'),
  })),
};
export const initialDraft = {
  title: 'A first article',
  summary: 'A useful summary.',
  markdown: '# Hello\n\nBody text.',
  categoryId: ids.category,
  tagIds: [ids.tag],
  coverMediaId: null,
  markdownContractVersion: 1,
  coverAltText: null,
  coverDecorative: false,
};
export const savedDraft = {
  ...initialDraft,
  title: 'A reviewed article',
  markdown: `# Hello\n\nBody text.\n\n![A single test pixel](media://${ids.media})`,
  coverMediaId: ids.media,
  coverAltText: 'A single test pixel',
};
export const revision = {
  id: ids.revision,
  postId: ids.post,
  number: 1,
  createdBy: author,
  createdAt: at,
  creditedAuthor: author,
  content: initialDraft,
  media: [],
  restoredFromRevisionId: null,
};
export const savedRevision = {
  ...revision,
  id: ids.savedRevision,
  number: 2,
  content: savedDraft,
  media: [media],
};
export const workspace = {
  id: ids.post,
  clientDraftId: ids.draft,
  author,
  slug: null,
  publicationState: 'NEVER_PUBLISHED',
  workflowState: 'DRAFT',
  version: 1,
  workingRevisionId: revision.id,
  publishedRevisionId: null,
  createdAt: at,
  updatedAt: at,
  trashedAt: null,
  purgeAfter: null,
  allowedActions: ['EDIT_DRAFT', 'SUBMIT', 'TRASH'],
  workingRevision: revision,
  publishedRevision: null,
  review: { submittedRevisionId: null, submittedAt: null, lastFeedback: null },
};
export const saved = {
  ...workspace,
  version: 2,
  workingRevisionId: savedRevision.id,
  workingRevision: savedRevision,
};
export const submitted = {
  ...saved,
  version: 3,
  workflowState: 'IN_REVIEW',
  allowedActions: ['WITHDRAW_REVIEW'],
  review: {
    ...saved.review,
    submittedRevisionId: savedRevision.id,
    submittedAt: at,
  },
};
export const published = {
  ...saved,
  slug: 'a-reviewed-article',
  publicationState: 'PUBLISHED',
  workflowState: 'CLEAN',
  version: 4,
  publishedRevisionId: savedRevision.id,
  publishedRevision: savedRevision,
  allowedActions: [
    'EDIT_DRAFT',
    'UNPUBLISH',
    'TRASH',
    'CHANGE_SLUG',
    'REASSIGN_AUTHOR',
  ],
};
export const publicPost = {
  id: ids.post,
  slug: published.slug,
  title: savedDraft.title,
  summary: savedDraft.summary,
  author,
  category: taxon,
  tags: [tag],
  cover: { ...publicMedia, altText: 'A single test pixel', decorative: false },
  publishedRevisionId: savedRevision.id,
  firstPublishedAt: at,
  updatedAt: at,
  markdown: savedDraft.markdown,
  markdownContractVersion: 1,
  media: [publicMedia],
};
export const me = {
  ...author,
  bio: '',
  email: 'author@example.test',
  role: 'AUTHOR',
  active: true,
  version: 1,
};
export const invitation = {
  id: ids.invitation,
  email: 'invited@example.test',
  role: 'AUTHOR',
  status: 'PENDING',
  version: 1,
  issuedBy: admin,
  createdAt: at,
  expiresAt: '2026-11-01T08:20:30.123Z',
  acceptedAt: null,
  revokedAt: null,
};
export const invitationToken = 'A'.repeat(43);
export const meta = {
  apiMajor: 1,
  contractVersion: '1.0.0',
  markdownContractVersion: 1,
  buildSha: 'local',
  features: [],
  limits,
  clients: {
    web: { recommendedVersion: '0.0.0', minimumSupportedVersion: null },
    android: { recommendedVersion: '0.0.0', minimumSupportedVersion: null },
  },
  lifecycle: {
    status: 'ACTIVE',
    successorApiMajor: null,
    noticePublishedAt: null,
    deprecatedAt: null,
    sunsetAt: null,
    migrationGuidePath: null,
  },
  deployment: {
    environment: 'development',
    revision: null,
    runtimeInputDigest: '0'.repeat(64),
    configurationDigest: 'a'.repeat(64),
  },
};

function summary(post) {
  const { workingRevision, publishedRevision, review, ...result } = post;
  return result;
}
export function exampleData(operation) {
  const id = operation.operationId;
  const managedTaxon = {
    ...(id.toLowerCase().includes('tag') ? tag : taxon),
    ...(id.startsWith('update') ? { name: 'Updated taxonomy label' } : {}),
    version: id.startsWith('update') ? 2 : 1,
    usage: { publishedCount: 1, draftCount: 1 },
    createdAt: at,
    updatedAt: at,
  };
  const values = {
    ApiMeta: meta,
    PublicPostSummary: (({
      markdown,
      markdownContractVersion,
      media,
      ...summary
    }) => summary)(publicPost),
    PublicPost: publicPost,
    PublicAuthor: { ...author, bio: '' },
    Taxon: id.toLowerCase().includes('tag') ? tag : taxon,
    SlugResolution: {
      resolution: 'CANONICAL',
      canonicalSlug: publicPost.slug,
      canonicalPath: `/posts/${publicPost.slug}`,
      post: publicPost,
    },
    AvailabilityItem: {
      postId: ids.post,
      available: true,
      publishedRevisionId: ids.savedRevision,
    },
    Me:
      id === 'acceptInvitation'
        ? {
            ...me,
            id: ids.invited,
            handle: 'invited-author',
            displayName: 'Invited author',
            email: invitation.email,
          }
        : id === 'updateMe'
          ? { ...me, displayName: 'Updated author', version: 2 }
          : me,
    AdminMember: {
      ...me,
      ...(id === 'updateMember' ? { role: 'EDITOR', version: 2 } : {}),
      createdAt: at,
      updatedAt: at,
    },
    WorkspacePostSummary: summary(published),
    WorkspacePost: published,
    RevisionSummary: {
      id: savedRevision.id,
      postId: ids.post,
      number: 2,
      title: savedDraft.title,
      createdBy: author,
      createdAt: at,
    },
    Revision: savedRevision,
    ReviewEvent: {
      id: ids.event,
      postId: ids.post,
      revisionId: ids.savedRevision,
      action: 'PUBLISHED',
      actor: editor,
      createdAt: at,
      feedback: null,
    },
    MediaAsset: {
      id: ids.media,
      postId: ids.post,
      ready: true,
      width: 1,
      height: 1,
      mimeType: 'image/png',
      variants: privateVariants,
      createdAt: at,
      unattachedExpiresAt: '2026-10-26T08:20:30.123Z',
    },
    ManagedTaxon: managedTaxon,
    Invitation:
      id === 'revokeInvitation'
        ? { ...invitation, status: 'REVOKED', revokedAt: at, version: 2 }
        : invitation,
    InvitationIssueResult: {
      invitation:
        id === 'reissueInvitation'
          ? { ...invitation, id: '60000000-0000-4000-8000-000000000002' }
          : invitation,
      inviteUrl: `https://web.example.test/invitations/accept?token=${invitationToken}`,
      linkAvailable: true,
    },
    AuditEvent: {
      id: ids.event,
      actor: admin,
      action: 'MEMBER_UPDATED',
      subjectType: 'MEMBER',
      subjectId: ids.author,
      createdAt: at,
      changes: { role: { from: 'AUTHOR', to: 'EDITOR' } },
    },
    WebSession: {
      sessionCookie: 'SYNTHETIC_FIXTURE_NOT_A_CREDENTIAL',
      expiresAt: '2026-10-30T08:20:30.123Z',
      member: me,
    },
  };
  if (id === 'createPost') values.WorkspacePost = workspace;
  if (id === 'savePostDraft') values.WorkspacePost = saved;
  if (id === 'submitPostForReview') values.WorkspacePost = submitted;
  if (id === 'withdrawPostReview')
    values.WorkspacePost = { ...saved, version: 4 };
  if (id === 'rejectPostRevision')
    values.WorkspacePost = {
      ...saved,
      version: 4,
      workflowState: 'CHANGES_REQUESTED',
      review: {
        ...saved.review,
        lastFeedback: {
          revisionId: savedRevision.id,
          actor: editor,
          text: 'Please clarify the conclusion.',
          createdAt: at,
        },
      },
    };
  if (id === 'unpublishPost')
    values.WorkspacePost = {
      ...published,
      publicationState: 'WITHDRAWN',
      version: 5,
    };
  if (id === 'trashPost')
    values.WorkspacePost = {
      ...published,
      publicationState: 'WITHDRAWN',
      version: 5,
      trashedAt: at,
      purgeAfter: '2026-11-24T08:20:30.123Z',
      allowedActions: ['RESTORE'],
    };
  if (id === 'restoreTrashedPost')
    values.WorkspacePost = {
      ...published,
      publicationState: 'WITHDRAWN',
      workflowState: 'DRAFT',
      version: 6,
      allowedActions: ['EDIT_DRAFT', 'SUBMIT', 'TRASH'],
    };
  if (id === 'restorePostRevision')
    values.WorkspacePost = {
      ...published,
      workflowState: 'DRAFT',
      version: 5,
      workingRevisionId: ids.restoredRevision,
      workingRevision: {
        ...revision,
        id: ids.restoredRevision,
        number: 3,
        restoredFromRevisionId: revision.id,
      },
      allowedActions: ['EDIT_DRAFT', 'SUBMIT', 'UNPUBLISH', 'TRASH'],
    };
  if (id === 'changePostSlug')
    values.WorkspacePost = {
      ...published,
      slug: 'a-stable-article',
      version: 5,
    };
  if (id === 'reassignPostAuthor')
    values.WorkspacePost = {
      ...published,
      author: editor,
      workflowState: 'DRAFT',
      version: 5,
      workingRevisionId: ids.restoredRevision,
      workingRevision: {
        ...savedRevision,
        id: ids.restoredRevision,
        number: 3,
        creditedAuthor: editor,
        createdBy: admin,
      },
    };
  const result = values[operation.data];
  if (result === undefined)
    throw new Error(`Missing response example for ${id}`);
  return structuredClone(
    operation.collection || operation.array ? [result] : result,
  );
}

export function requestExample(operation) {
  const bodyBySchema = {
    DraftContentInput: savedDraft,
    WebSessionInput: { idToken: 'SYNTHETIC_FIXTURE_NOT_A_CREDENTIAL' },
    UpdateMeInput: { displayName: 'Updated author' },
    AcceptInvitationInput: { token: invitationToken },
    AvailabilityInput: { postIds: [ids.post] },
    CreatePostInput: { clientDraftId: ids.draft, draft: initialDraft },
    RevisionActionInput: {
      revisionId:
        operation.operationId === 'restorePostRevision'
          ? ids.revision
          : ids.savedRevision,
    },
    RejectRevisionInput: {
      revisionId: ids.savedRevision,
      feedback: 'Please clarify the conclusion.',
    },
    EmptyInput: {},
    ChangeSlugInput: { slug: 'a-stable-article' },
    StageMediaInput: { file: '@contracts/fixtures/media/pixel.png' },
    CreateTaxonInput:
      operation.operationId === 'createTag'
        ? { name: tag.name, slug: tag.slug }
        : { name: taxon.name, slug: taxon.slug },
    UpdateTaxonInput: { name: 'Updated taxonomy label' },
    UpdateMemberInput: { role: 'EDITOR' },
    ReassignAuthorInput: { authorId: ids.editor },
    CreateInvitationInput: { email: invitation.email, role: 'AUTHOR' },
  };
  const pathParameters = {
    postId: ids.post,
    clientDraftId: ids.draft,
    revisionId: ids.savedRevision,
    categoryId: ids.category,
    tagId: ids.tag,
    memberId: ids.author,
    invitationId: ids.invitation,
    mediaId: ids.media,
    variant: 'w480',
    slug: publicPost.slug,
    handle: author.handle,
  };
  const requestHeaders = { ...headers };
  if (!['ANONYMOUS', 'RECENT_IDENTITY'].includes(operation.access))
    requestHeaders.Authorization = 'Bearer SYNTHETIC_FIXTURE_NOT_A_CREDENTIAL';
  if (operation.expectedVersion)
    requestHeaders['X-Expected-Version'] =
      operation.operationId === 'savePostDraft'
        ? '1'
        : operation.operationId === 'submitPostForReview'
          ? '2'
          : [
                'publishPostRevision',
                'rejectPostRevision',
                'withdrawPostReview',
              ].includes(operation.operationId)
            ? '3'
            : operation.data === 'WorkspacePost'
              ? '4'
              : '1';
  if (operation.idempotent)
    requestHeaders['Idempotency-Key'] = '83c9a1ca-6d20-48c5-8476-bb6a60677377';
  const query = operation.search
    ? { q: 'reviewed article', page: 1, pageSize: 20 }
    : operation.collection === 'cursor'
      ? { pageSize: 20 }
      : operation.collection === 'page'
        ? { page: 1, pageSize: operation.taxonomy ? 50 : 20 }
        : {};
  return {
    method: operation.method.toUpperCase(),
    path: operation.path.replace(
      /\{([^}]+)\}/g,
      (_, name) => pathParameters[name],
    ),
    headers: requestHeaders,
    query,
    ...(operation.body
      ? { body: structuredClone(bodyBySchema[operation.body]) }
      : {}),
  };
}

export function successExample(operation, data = exampleData(operation)) {
  return {
    timestamp: at,
    responseKey: 'SUCCESS',
    statusCode: operation.status ?? 200,
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    message: {
      title: 'Request completed',
      descriptions: 'The request completed successfully.',
    },
    data,
    error: null,
    meta: {
      contractVersion: '1.0.0',
      pagination:
        operation.collection === 'cursor'
          ? { kind: 'CURSOR', pageSize: 20, hasMore: false, nextCursor: null }
          : operation.collection === 'page'
            ? {
                kind: 'PAGE',
                page: 1,
                pageSize: operation.taxonomy ? 50 : 20,
                totalItems: data.length,
                totalPages: data.length ? 1 : 0,
                hasMore: false,
                truncated: false,
              }
            : null,
      idempotency: operation.idempotent
        ? { replayed: false, expiresAt: '2026-10-26T08:20:30.123Z' }
        : null,
    },
  };
}

export const errorCodes = {
  400: [
    'INVALID_CLIENT_METADATA',
    'MALFORMED_JSON',
    'INVALID_CURSOR',
    'INVALID_IDEMPOTENCY_KEY',
    'INVALID_EXPECTED_VERSION',
    'AMBIGUOUS_CREDENTIALS',
  ],
  401: [
    'AUTHENTICATION_REQUIRED',
    'INVALID_CREDENTIAL',
    'AUTHENTICATION_EXPIRED',
  ],
  403: [
    'INSUFFICIENT_PERMISSION',
    'ACCESS_REVOKED',
    'INVITATION_ACCOUNT_MISMATCH',
    'CSRF_VALIDATION_FAILED',
  ],
  404: ['RESOURCE_NOT_FOUND', 'INVITATION_INVALID'],
  405: ['METHOD_NOT_ALLOWED'],
  409: [
    'WORKFLOW_CONFLICT',
    'SLUG_CONFLICT',
    'LAST_ADMIN_REQUIRED',
    'MEMBER_ALREADY_EXISTS',
    'CLIENT_DRAFT_ALREADY_EXISTS',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'RESOURCE_QUOTA_EXCEEDED',
  ],
  410: [
    'INVITATION_EXPIRED',
    'INVITATION_USED',
    'INVITATION_REVOKED',
    'API_VERSION_RETIRED',
  ],
  412: ['VERSION_CONFLICT'],
  413: ['PAYLOAD_TOO_LARGE', 'UPLOAD_TOO_LARGE'],
  415: ['UNSUPPORTED_MEDIA_TYPE'],
  422: [
    'VALIDATION_FAILED',
    'MARKDOWN_UNSUPPORTED',
    'SEARCH_QUERY_NOT_SEARCHABLE',
  ],
  428: ['EXPECTED_VERSION_REQUIRED'],
  429: ['RATE_LIMITED'],
  500: ['INTERNAL_ERROR'],
  503: ['DEPENDENCY_UNAVAILABLE'],
  504: ['UPSTREAM_TIMEOUT'],
};
export function errorExample(status, code) {
  return {
    timestamp: at,
    responseKey: 'ERROR',
    statusCode: Number(status),
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    message: {
      title: 'Request rejected',
      descriptions: 'Use the stable error code to handle this response.',
    },
    data: null,
    error: {
      code,
      fieldErrors:
        code === 'INVALID_CLIENT_METADATA'
          ? [
              {
                location: 'header',
                field: '/x-device-id',
                code: 'REQUIRED',
                params: {},
              },
            ]
          : [],
      context:
        code === 'VERSION_CONFLICT'
          ? {
              resourceType: 'POST',
              resourceId: ids.post,
              expectedVersion: 1,
              currentVersion: 2,
              currentRevisionId: ids.savedRevision,
              resourcePath: `/v1/posts/${ids.post}`,
            }
          : null,
    },
    meta: { contractVersion: '1.0.0', pagination: null, idempotency: null },
  };
}
