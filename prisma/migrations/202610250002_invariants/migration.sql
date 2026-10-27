SET search_path = blogpost, public;

ALTER TABLE "Member" ADD CONSTRAINT member_version CHECK (version > 0),
  ADD CONSTRAINT member_profile CHECK (char_length("displayName") BETWEEN 1 AND 80 AND char_length(bio) <= 500),
  ADD CONSTRAINT member_handle CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "Invitation" ADD CONSTRAINT invitation_version CHECK (version > 0),
  ADD CONSTRAINT invitation_hash CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT invitation_consumption CHECK (("acceptedAt" IS NULL) = ("acceptedById" IS NULL)),
  ADD CONSTRAINT invitation_terminal_state CHECK (NOT ("acceptedAt" IS NOT NULL AND "revokedAt" IS NOT NULL));
CREATE UNIQUE INDEX invitation_pending_email ON "Invitation" (email) WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
ALTER TABLE "Post" ADD CONSTRAINT post_version CHECK ("lockVersion" > 0),
  ADD CONSTRAINT post_publication CHECK (
    ("publicationState" = 'NEVER_PUBLISHED' AND "publishedRevisionId" IS NULL AND "firstPublishedAt" IS NULL AND "lastPublishedAt" IS NULL)
    OR ("publicationState" <> 'NEVER_PUBLISHED' AND "publishedRevisionId" IS NOT NULL AND "canonicalSlug" IS NOT NULL AND "firstPublishedAt" IS NOT NULL AND "lastPublishedAt" IS NOT NULL)),
  ADD CONSTRAINT post_review CHECK (("workflowState" = 'IN_REVIEW' AND "submittedRevisionId" IS NOT NULL
    AND "submittedRevisionId" = "workingRevisionId" AND "submittedAt" IS NOT NULL)
    OR ("workflowState" <> 'IN_REVIEW' AND "submittedRevisionId" IS NULL AND "submittedAt" IS NULL)),
  ADD CONSTRAINT post_trash CHECK (("trashedAt" IS NULL AND "purgeAfter" IS NULL)
    OR ("trashedAt" IS NOT NULL AND "purgeAfter" IS NOT NULL AND "purgeAfter" >= "trashedAt" + interval '30 days' AND "publicationState" <> 'PUBLISHED')),
  ADD CONSTRAINT post_slug CHECK ("canonicalSlug" IS NULL OR "canonicalSlug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "Revision" ADD CONSTRAINT revision_bounds CHECK (number > 0 AND char_length(title) <= 160
  AND char_length(summary) <= 320 AND octet_length(markdown) <= 131072 AND "markdownContractVersion" = 1
  AND ("coverAltText" IS NULL OR char_length("coverAltText") <= 300)),
  ADD CONSTRAINT revision_checksum CHECK (checksum ~ '^[a-f0-9]{64}$');
ALTER TABLE "RevisionTag" ADD CONSTRAINT revision_tag_position CHECK (position BETWEEN 0 AND 4);
ALTER TABLE "Category" ADD CONSTRAINT category_version CHECK (version > 0),
  ADD CONSTRAINT category_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "Tag" ADD CONSTRAINT tag_version CHECK (version > 0),
  ADD CONSTRAINT tag_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "SlugHistory" ADD CONSTRAINT history_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
CREATE UNIQUE INDEX slug_one_canonical_per_post ON "SlugHistory" ("postId") WHERE canonical;
ALTER TABLE "Post" ADD CONSTRAINT post_reserved_slug FOREIGN KEY (id, "canonicalSlug")
  REFERENCES "SlugHistory" ("postId", slug) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MediaAsset" ADD CONSTRAINT media_bounds CHECK ("byteSize" >= 0
  AND (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
  AND (width IS NULL OR height IS NULL OR width::bigint * height <= 12000000)),
  ADD CONSTRAINT media_ready CHECK (state <> 'READY' OR (width IS NOT NULL AND height IS NOT NULL
    AND "mimeType" IS NOT NULL AND "mimeType" IN ('image/jpeg', 'image/png', 'image/webp') AND jsonb_array_length(variants) = 3));
ALTER TABLE "ReviewEvent" ADD CONSTRAINT review_feedback CHECK (feedback IS NULL OR char_length(feedback) BETWEEN 1 AND 2000);
ALTER TABLE "AuditEvent" ADD CONSTRAINT audit_trace CHECK ("traceId" ~ '^[a-f0-9]{32}$');
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT idempotency_hash CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT idempotency_completion CHECK ((result IS NULL AND "statusCode" IS NULL)
    OR (result IS NOT NULL AND "statusCode" BETWEEN 200 AND 299));
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT rate_limit_count CHECK (count >= 0);
ALTER TABLE "SchemaMeta" ADD CONSTRAINT schema_singleton CHECK (id = 1 AND version > 0);

CREATE FUNCTION reject_immutable_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable snapshot cannot be updated' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER revision_immutable BEFORE UPDATE ON "Revision" FOR EACH ROW EXECUTE FUNCTION reject_immutable_update();
CREATE TRIGGER revision_media_immutable BEFORE UPDATE ON "RevisionMedia" FOR EACH ROW EXECUTE FUNCTION reject_immutable_update();
CREATE TRIGGER revision_tag_immutable BEFORE UPDATE ON "RevisionTag" FOR EACH ROW EXECUTE FUNCTION reject_immutable_update();
REVOKE ALL ON FUNCTION reject_immutable_update() FROM PUBLIC;

INSERT INTO "SchemaMeta" (id, version) VALUES (1, 1);
