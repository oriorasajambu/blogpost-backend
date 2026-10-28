export const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
export const text = (maxLength, minLength = 0) => ({
  type: 'string',
  'x-unicodeScalarText': true,
  ...(maxLength === undefined ? {} : { maxLength }),
  ...(minLength ? { minLength } : {}),
});
export const integer = (minimum = 0, maximum) => ({
  type: 'integer',
  minimum,
  ...(maximum === undefined ? {} : { maximum }),
});
export const uuid = { type: 'string', format: 'uuid' };
export const dateTime = {
  type: 'string',
  format: 'date-time',
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
};
export const bool = { type: 'boolean' };
export const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
export const array = (items, maxItems) => ({
  type: 'array',
  items,
  ...(maxItems === undefined ? {} : { maxItems }),
});
export const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
});
export const input = (properties, required = Object.keys(properties)) => ({
  ...object(properties, required),
  additionalProperties: false,
});
export const enumeration = (...values) => ({ type: 'string', enum: values });
export const slug = { ...text(120, 1), pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' };
const nonblank = (max) => ({ ...text(max, 1), pattern: '\\S' });
const version = integer(1, 2147483647);
const mediaMime = enumeration('image/jpeg', 'image/png', 'image/webp');
const publicAuthorFields = {
  id: uuid,
  handle: slug,
  displayName: nonblank(80),
};
const taxonFields = { id: uuid, name: nonblank(80), slug, active: bool };
const dimensions = {
  width: integer(1),
  height: integer(1),
  mimeType: mediaMime,
};
const variants = {
  ...array(ref('MediaVariant'), 3),
  minItems: 3,
  allOf: ['w480', 'w960', 'w1600'].map((name) => ({
    contains: {
      type: 'object',
      properties: { name: { const: name } },
      required: ['name'],
    },
    minContains: 1,
    maxContains: 1,
  })),
};
const draftFields = {
  title: text(160),
  summary: text(320),
  markdown: {
    ...text(),
    'x-maxUtf8Bytes': 131072,
    description:
      'Maximum 131072 UTF-8 bytes. Markdown contract 1. Images use media://UUID, never external URLs.',
  },
  categoryId: nullable(uuid),
  tagIds: { ...array(uuid, 5), uniqueItems: true },
  coverMediaId: nullable(uuid),
  markdownContractVersion: { type: 'integer', const: 1, default: 1 },
  coverAltText: { ...nullable(text(300)), default: null },
  coverDecorative: { type: 'boolean', default: false },
};
const publicPostFields = {
  id: uuid,
  slug,
  title: nonblank(160),
  summary: nonblank(320),
  author: ref('AuthorSummary'),
  category: ref('Taxon'),
  tags: array(ref('Taxon'), 5),
  cover: nullable(ref('ImageReference')),
  publishedRevisionId: uuid,
  firstPublishedAt: dateTime,
  updatedAt: dateTime,
};
const workspaceFields = {
  id: uuid,
  clientDraftId: uuid,
  author: ref('AuthorSummary'),
  slug: nullable(slug),
  publicationState: ref('PublicationState'),
  workflowState: ref('WorkflowState'),
  version,
  workingRevisionId: nullable(uuid),
  publishedRevisionId: nullable(uuid),
  createdAt: dateTime,
  updatedAt: dateTime,
  trashedAt: nullable(dateTime),
  purgeAfter: nullable(dateTime),
  allowedActions: array(text(80, 1)),
};
const profileFields = {
  ...publicAuthorFields,
  bio: text(500),
  email: { type: 'string', format: 'email' },
  role: ref('Role'),
  active: bool,
  version,
};
export const limits = {
  defaultPageSize: 20,
  maxPageSize: 50,
  defaultTaxonomyPageSize: 50,
  maxSearchResults: 1000,
  maxMarkdownBytes: 131072,
  maxJsonBodyBytes: 1048576,
  maxUploadFileBytes: 5242880,
  maxMultipartBodyBytes: 6291456,
  maxImagePixels: 12000000,
  maxTagsPerPost: 5,
  maxAvailabilityIds: 50,
  maxActivePostsPerMember: 100,
  maxPendingUploadBytesPerMember: 104857600,
  idempotencyTtlSeconds: 86400,
  unattachedMediaTtlSeconds: 86400,
  invitationTtlSeconds: 604800,
};
export const schemas = {
  UUID: uuid,
  DateTime: dateTime,
  Version: version,
  Role: enumeration('AUTHOR', 'EDITOR', 'ADMIN'),
  PublicationState: enumeration('NEVER_PUBLISHED', 'PUBLISHED', 'WITHDRAWN'),
  WorkflowState: enumeration(
    'DRAFT',
    'IN_REVIEW',
    'CHANGES_REQUESTED',
    'CLEAN',
  ),
  VariantName: enumeration('w480', 'w960', 'w1600'),
  InvitationStatus: enumeration('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'),
  AuthorSummary: object(publicAuthorFields),
  PublicAuthor: object({ ...publicAuthorFields, bio: text(500) }),
  Taxon: object(taxonFields),
  MediaVariant: object({
    name: ref('VariantName'),
    apiPath: { type: 'string', pattern: '^/v1/' },
    ...dimensions,
    byteSize: integer(1),
  }),
  MediaDescriptor: object({ mediaId: uuid, ...dimensions, variants }),
  ImageReference: {
    ...object({
      mediaId: uuid,
      ...dimensions,
      variants,
      altText: text(300),
      decorative: bool,
    }),
    allOf: [
      {
        if: { properties: { decorative: { const: true } } },
        then: { properties: { altText: { const: '' } } },
        else: { properties: { altText: nonblank(300) } },
      },
    ],
  },
  PublicPostSummary: object(publicPostFields),
  PublicPost: object({
    ...publicPostFields,
    markdown: draftFields.markdown,
    markdownContractVersion: { type: 'integer', const: 1 },
    media: array(ref('MediaDescriptor')),
  }),
  DraftContentInput: input(draftFields, [
    'title',
    'summary',
    'markdown',
    'categoryId',
    'tagIds',
    'coverMediaId',
  ]),
  DraftContent: object(draftFields),
  RevisionSummary: object({
    id: uuid,
    postId: uuid,
    number: integer(1),
    title: text(160),
    createdBy: ref('AuthorSummary'),
    createdAt: dateTime,
  }),
  Revision: object({
    id: uuid,
    postId: uuid,
    number: integer(1),
    createdBy: ref('AuthorSummary'),
    createdAt: dateTime,
    creditedAuthor: ref('AuthorSummary'),
    content: ref('DraftContent'),
    media: array(ref('MediaDescriptor')),
    restoredFromRevisionId: nullable(uuid),
  }),
  ReviewFeedback: object({
    revisionId: uuid,
    actor: ref('AuthorSummary'),
    text: text(2000, 1),
    createdAt: dateTime,
  }),
  ReviewState: object({
    submittedRevisionId: nullable(uuid),
    submittedAt: nullable(dateTime),
    lastFeedback: nullable(ref('ReviewFeedback')),
  }),
  WorkspacePostSummary: object(workspaceFields),
  WorkspacePost: object({
    ...workspaceFields,
    workingRevision: nullable(ref('Revision')),
    publishedRevision: nullable(ref('Revision')),
    review: ref('ReviewState'),
  }),
  ReviewEvent: object({
    id: uuid,
    postId: uuid,
    revisionId: uuid,
    action: text(40, 1),
    actor: ref('AuthorSummary'),
    createdAt: dateTime,
    feedback: nullable(text(2000, 1)),
  }),
  Me: object(profileFields),
  AdminMember: object({
    ...profileFields,
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  ManagedTaxon: object({
    ...taxonFields,
    version,
    usage: object({ publishedCount: integer(), draftCount: integer() }),
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  Invitation: object({
    id: uuid,
    email: { type: 'string', format: 'email' },
    role: ref('Role'),
    status: ref('InvitationStatus'),
    version,
    issuedBy: ref('AuthorSummary'),
    createdAt: dateTime,
    expiresAt: dateTime,
    acceptedAt: nullable(dateTime),
    revokedAt: nullable(dateTime),
  }),
  InvitationIssueResult: object({
    invitation: ref('Invitation'),
    inviteUrl: nullable({ type: 'string', format: 'uri' }),
    linkAvailable: bool,
  }),
  MediaAsset: object({
    id: uuid,
    postId: uuid,
    ready: { type: 'boolean', const: true },
    ...dimensions,
    variants,
    createdAt: dateTime,
    unattachedExpiresAt: nullable(dateTime),
  }),
  AvailabilityItem: {
    ...object({
      postId: uuid,
      available: bool,
      publishedRevisionId: nullable(uuid),
    }),
    allOf: [
      {
        if: { properties: { available: { const: true } } },
        then: { properties: { publishedRevisionId: uuid } },
        else: { properties: { publishedRevisionId: { type: 'null' } } },
      },
    ],
  },
  SlugResolution: {
    ...object({
      resolution: enumeration('CANONICAL', 'REDIRECT'),
      canonicalSlug: slug,
      canonicalPath: { type: 'string', pattern: '^/posts/' },
      post: nullable(ref('PublicPost')),
    }),
    allOf: [
      {
        if: { properties: { resolution: { const: 'CANONICAL' } } },
        then: { properties: { post: ref('PublicPost') } },
        else: { properties: { post: { type: 'null' } } },
      },
    ],
  },
  AuditEvent: object({
    id: uuid,
    actor: ref('AuthorSummary'),
    action: text(80, 1),
    subjectType: text(40, 1),
    subjectId: uuid,
    createdAt: dateTime,
    changes: { type: 'object' },
  }),
  WebSession: {
    ...object({
      sessionCookie: {
        ...text(16384, 1),
        writeOnly: false,
        description:
          'Credential for the server proxy only; never forward this JSON to a browser or log it.',
      },
      expiresAt: dateTime,
      member: ref('Me'),
    }),
    'x-server-proxy-only': true,
  },
  ApiLimits: object(
    Object.fromEntries(
      Object.entries(limits).map(([key, value]) => [
        key,
        { type: 'integer', const: value },
      ]),
    ),
  ),
  ApiMeta: object(
    {
      apiMajor: { type: 'integer', const: 1 },
      contractVersion: text(64, 1),
      markdownContractVersion: { type: 'integer', const: 1 },
      buildSha: text(80, 1),
      features: array(text(80, 1)),
      limits: ref('ApiLimits'),
      clients: object(
        Object.fromEntries(
          ['web', 'android'].map((client) => [
            client,
            object({
              recommendedVersion: text(64, 1),
              minimumSupportedVersion: nullable(text(64, 1)),
            }),
          ]),
        ),
      ),
      lifecycle: object({
        status: enumeration('ACTIVE', 'DEPRECATED', 'RETIRED'),
        successorApiMajor: nullable(integer(2)),
        noticePublishedAt: nullable(dateTime),
        deprecatedAt: nullable(dateTime),
        sunsetAt: nullable(dateTime),
        migrationGuidePath: nullable(text(500, 1)),
      }),
      deployment: object({
        environment: text(64, 1),
        revision: nullable(text(200, 1)),
        runtimeInputDigest: { ...text(64, 64), pattern: '^[a-f0-9]{64}$' },
        configurationDigest: { ...text(64, 64), pattern: '^[a-f0-9]{64}$' },
      }),
    },
    [
      'apiMajor',
      'contractVersion',
      'markdownContractVersion',
      'buildSha',
      'features',
      'limits',
      'clients',
      'lifecycle',
    ],
  ),
  FieldIssue: object({
    location: enumeration('header', 'path', 'query', 'body'),
    field: text(2048),
    code: text(80, 1),
    params: { type: 'object' },
  }),
  ApiError: object({
    code: text(80, 1),
    fieldErrors: array(ref('FieldIssue'), 50),
    context: { type: ['object', 'null'] },
  }),
  CursorPagination: object({
    kind: { type: 'string', const: 'CURSOR' },
    pageSize: integer(1, 50),
    hasMore: bool,
    nextCursor: nullable(text(2048, 1)),
  }),
  PagePagination: object({
    kind: { type: 'string', const: 'PAGE' },
    page: integer(1),
    pageSize: integer(1, 50),
    totalItems: integer(),
    totalPages: integer(),
    hasMore: bool,
    truncated: bool,
  }),
  IdempotencyMeta: object({ replayed: bool, expiresAt: dateTime }),
  ResponseMeta: object({
    contractVersion: text(64, 1),
    pagination: nullable({
      oneOf: [ref('CursorPagination'), ref('PagePagination')],
    }),
    idempotency: nullable(ref('IdempotencyMeta')),
  }),
  Health: object({ status: enumeration('ok', 'unavailable') }),
  EmptyInput: input({}),
  WebSessionInput: input({ idToken: text(65536, 1) }),
  UpdateMeInput: {
    ...input({ displayName: nonblank(80), bio: nullable(text(500)) }, []),
    minProperties: 1,
  },
  AcceptInvitationInput: input({
    token: {
      ...text(43, 43),
      pattern: '^[A-Za-z0-9_-]{43}$',
      description: 'Base64url encoding of a random 256-bit secret.',
    },
  }),
  AvailabilityInput: input({
    postIds: { ...array(uuid, 50), minItems: 1, uniqueItems: true },
  }),
  CreatePostInput: input({
    clientDraftId: uuid,
    draft: ref('DraftContentInput'),
  }),
  RevisionActionInput: input({ revisionId: uuid }),
  RejectRevisionInput: input({ revisionId: uuid, feedback: nonblank(2000) }),
  ChangeSlugInput: input({ slug }),
  CreateTaxonInput: input({ name: nonblank(80), slug }),
  UpdateTaxonInput: {
    ...input({ name: nonblank(80), active: bool }, []),
    minProperties: 1,
  },
  UpdateMemberInput: {
    ...input({ role: ref('Role'), active: bool }, []),
    minProperties: 1,
  },
  ReassignAuthorInput: input({ authorId: uuid }),
  CreateInvitationInput: input({
    email: { ...text(320, 3), format: 'email' },
    role: ref('Role'),
  }),
  StageMediaInput: input({
    file: {
      type: 'string',
      format: 'binary',
      description:
        'One JPEG, PNG or WebP file; encoded file <= 5242880 bytes, complete multipart <= 6291456 bytes; decoded <= 12000000 pixels, single frame.',
    },
  }),
};

export function responseEnvelope(
  data,
  status = 200,
  pagination = null,
  idempotent = false,
) {
  return object({
    timestamp: dateTime,
    responseKey: { type: 'string', const: 'SUCCESS' },
    statusCode: { type: 'integer', const: status },
    traceId: { ...text(32, 32), pattern: '^[a-f0-9]{32}$' },
    message: object({ title: text(), descriptions: text() }),
    data,
    error: { type: 'null' },
    meta: object({
      contractVersion: { type: 'string', const: '1.0.0' },
      pagination: pagination
        ? ref(pagination === 'cursor' ? 'CursorPagination' : 'PagePagination')
        : { type: 'null' },
      idempotency: idempotent ? ref('IdempotencyMeta') : { type: 'null' },
    }),
  });
}
schemas.MetaEnvelope = responseEnvelope(ref('ApiMeta'));
schemas.ErrorEnvelope = object({
  timestamp: dateTime,
  responseKey: { type: 'string', const: 'ERROR' },
  statusCode: integer(400, 599),
  traceId: { ...text(32, 32), pattern: '^[a-f0-9]{32}$' },
  message: object({ title: text(), descriptions: text() }),
  data: { type: 'null' },
  error: ref('ApiError'),
  meta: object({
    contractVersion: { type: 'string', const: '1.0.0' },
    pagination: { type: 'null' },
    idempotency: nullable(ref('IdempotencyMeta')),
  }),
});
