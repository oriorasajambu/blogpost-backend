-- Schema ownership is established by the temporary-root bootstrap job.
-- The migrator intentionally has no database-wide CREATE privilege.
SET search_path = blogpost, public;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('AUTHOR', 'EDITOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "PublicationState" AS ENUM ('NEVER_PUBLISHED', 'PUBLISHED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "WorkflowState" AS ENUM ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'CLEAN');

-- CreateEnum
CREATE TYPE "MediaState" AS ENUM ('PROCESSING', 'READY', 'DELETING');

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "identityUid" VARCHAR(128) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "handle" VARCHAR(120) NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "issuerId" UUID NOT NULL,
    "acceptedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "clientDraftId" UUID NOT NULL,
    "canonicalSlug" VARCHAR(120),
    "publicationState" "PublicationState" NOT NULL DEFAULT 'NEVER_PUBLISHED',
    "workflowState" "WorkflowState" NOT NULL DEFAULT 'DRAFT',
    "workingRevisionId" UUID,
    "publishedRevisionId" UUID,
    "submittedRevisionId" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "firstPublishedAt" TIMESTAMPTZ(3),
    "lastPublishedAt" TIMESTAMPTZ(3),
    "trashedAt" TIMESTAMPTZ(3),
    "purgeAfter" TIMESTAMPTZ(3),
    "purgeStartedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Revision" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "markdownContractVersion" INTEGER NOT NULL DEFAULT 1,
    "plainBody" TEXT NOT NULL,
    "creditedAuthorId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "categoryId" UUID,
    "coverMediaId" UUID,
    "coverAltText" TEXT,
    "coverDecorative" BOOLEAN NOT NULL DEFAULT false,
    "restoredFromRevisionId" UUID,
    "checksum" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "normalizedName" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "normalizedName" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionTag" (
    "revisionId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "RevisionTag_pkey" PRIMARY KEY ("revisionId","tagId")
);

-- CreateTable
CREATE TABLE "SlugHistory" (
    "slug" VARCHAR(120) NOT NULL,
    "postId" UUID NOT NULL,
    "canonical" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlugHistory_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "uploaderId" UUID NOT NULL,
    "state" "MediaState" NOT NULL DEFAULT 'PROCESSING',
    "mimeType" VARCHAR(32),
    "byteSize" BIGINT NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "unattachedExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionMedia" (
    "postId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,

    CONSTRAINT "RevisionMedia_pkey" PRIMARY KEY ("revisionId","mediaId")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "feedback" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishedSearch" (
    "postId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "document" tsvector NOT NULL,

    CONSTRAINT "PublishedSearch_pkey" PRIMARY KEY ("postId")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(80) NOT NULL,
    "subjectType" VARCHAR(40) NOT NULL,
    "subjectId" UUID NOT NULL,
    "changes" JSONB NOT NULL,
    "traceId" CHAR(32) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "identityUid" VARCHAR(128) NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "route" VARCHAR(300) NOT NULL,
    "key" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "result" JSONB,
    "statusCode" INTEGER,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemaMeta" (
    "id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchemaMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "memberId" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("memberId","action","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_identityUid_key" ON "Member"("identityUid");

-- CreateIndex
CREATE UNIQUE INDEX "Member_handle_key" ON "Member"("handle");

-- CreateIndex
CREATE INDEX "Member_active_role_idx" ON "Member"("active", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_email_expiresAt_idx" ON "Invitation"("email", "expiresAt");

-- CreateIndex
CREATE INDEX "Invitation_issuerId_idx" ON "Invitation"("issuerId");

-- CreateIndex
CREATE INDEX "Invitation_acceptedById_idx" ON "Invitation"("acceptedById");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_canonicalSlug_key" ON "Post"("canonicalSlug");

-- CreateIndex
CREATE INDEX "Post_authorId_trashedAt_idx" ON "Post"("authorId", "trashedAt");

-- CreateIndex
CREATE INDEX "Post_publicationState_firstPublishedAt_id_idx" ON "Post"("publicationState", "firstPublishedAt", "id");

-- CreateIndex
CREATE INDEX "Post_workflowState_updatedAt_id_idx" ON "Post"("workflowState", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "Post_purgeAfter_idx" ON "Post"("purgeAfter");

-- CreateIndex
CREATE UNIQUE INDEX "Post_creatorId_clientDraftId_key" ON "Post"("creatorId", "clientDraftId");

-- CreateIndex
CREATE INDEX "Revision_categoryId_idx" ON "Revision"("categoryId");

-- CreateIndex
CREATE INDEX "Revision_creatorId_idx" ON "Revision"("creatorId");

-- CreateIndex
CREATE INDEX "Revision_creditedAuthorId_idx" ON "Revision"("creditedAuthorId");

-- CreateIndex
CREATE INDEX "Revision_postId_coverMediaId_idx" ON "Revision"("postId", "coverMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "Revision_postId_number_key" ON "Revision"("postId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Revision_postId_id_key" ON "Revision"("postId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Category_normalizedName_key" ON "Category"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_normalizedName_key" ON "Tag"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "RevisionTag_tagId_idx" ON "RevisionTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionTag_revisionId_position_key" ON "RevisionTag"("revisionId", "position");

-- CreateIndex
CREATE INDEX "SlugHistory_postId_idx" ON "SlugHistory"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "SlugHistory_postId_slug_key" ON "SlugHistory"("postId", "slug");

-- CreateIndex
CREATE INDEX "MediaAsset_uploaderId_state_idx" ON "MediaAsset"("uploaderId", "state");

-- CreateIndex
CREATE INDEX "MediaAsset_unattachedExpiresAt_idx" ON "MediaAsset"("unattachedExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_postId_id_key" ON "MediaAsset"("postId", "id");

-- CreateIndex
CREATE INDEX "RevisionMedia_postId_mediaId_idx" ON "RevisionMedia"("postId", "mediaId");

-- CreateIndex
CREATE INDEX "ReviewEvent_postId_createdAt_id_idx" ON "ReviewEvent"("postId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ReviewEvent_actorId_idx" ON "ReviewEvent"("actorId");

-- CreateIndex
CREATE INDEX "PublishedSearch_document_idx" ON "PublishedSearch" USING GIN ("document");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_id_idx" ON "AuditEvent"("createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectType_subjectId_idx" ON "AuditEvent"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_identityUid_method_route_key_key" ON "IdempotencyRecord"("identityUid", "method", "route", "key");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_id_workingRevisionId_fkey" FOREIGN KEY ("id", "workingRevisionId") REFERENCES "Revision"("postId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_id_publishedRevisionId_fkey" FOREIGN KEY ("id", "publishedRevisionId") REFERENCES "Revision"("postId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_id_submittedRevisionId_fkey" FOREIGN KEY ("id", "submittedRevisionId") REFERENCES "Revision"("postId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_creditedAuthorId_fkey" FOREIGN KEY ("creditedAuthorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_postId_coverMediaId_fkey" FOREIGN KEY ("postId", "coverMediaId") REFERENCES "MediaAsset"("postId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_postId_restoredFromRevisionId_fkey" FOREIGN KEY ("postId", "restoredFromRevisionId") REFERENCES "Revision"("postId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RevisionTag" ADD CONSTRAINT "RevisionTag_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionTag" ADD CONSTRAINT "RevisionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlugHistory" ADD CONSTRAINT "SlugHistory_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionMedia" ADD CONSTRAINT "RevisionMedia_postId_revisionId_fkey" FOREIGN KEY ("postId", "revisionId") REFERENCES "Revision"("postId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionMedia" ADD CONSTRAINT "RevisionMedia_postId_mediaId_fkey" FOREIGN KEY ("postId", "mediaId") REFERENCES "MediaAsset"("postId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_postId_revisionId_fkey" FOREIGN KEY ("postId", "revisionId") REFERENCES "Revision"("postId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedSearch" ADD CONSTRAINT "PublishedSearch_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedSearch" ADD CONSTRAINT "PublishedSearch_postId_revisionId_fkey" FOREIGN KEY ("postId", "revisionId") REFERENCES "Revision"("postId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
