BEGIN;
SET LOCAL search_path = blogpost, public;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '5s';

-- Wait for existing editorial row locks and block new ones while rebuilding derived data.
-- Plain public SELECTs remain available. Taking this before search-row locks avoids inversion with publication.
LOCK TABLE "Post" IN EXCLUSIVE MODE;

-- Derived data only: preserve posts/revisions and rebuild using the approved English search configuration.
DELETE FROM "PublishedSearch" s WHERE NOT EXISTS (
  SELECT 1 FROM "Post" p WHERE p.id = s."postId" AND p."publicationState" = 'PUBLISHED'
    AND p."trashedAt" IS NULL AND p."purgeStartedAt" IS NULL
);
INSERT INTO "PublishedSearch" ("postId", "revisionId", document)
SELECT p.id, r.id, setweight(to_tsvector('english', r.title), 'A') ||
  setweight(to_tsvector('english', r.summary), 'B') || setweight(to_tsvector('english', r."plainBody"), 'C')
FROM "Post" p JOIN "Revision" r ON r.id = p."publishedRevisionId" AND r."postId" = p.id
WHERE p."publicationState" = 'PUBLISHED' AND p."trashedAt" IS NULL AND p."purgeStartedAt" IS NULL
ON CONFLICT ("postId") DO UPDATE SET "revisionId" = EXCLUDED."revisionId", document = EXCLUDED.document;
COMMIT;
