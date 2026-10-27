BEGIN;
SET LOCAL search_path = blogpost, public;
SET LOCAL lock_timeout = '4s';
ALTER TABLE "MediaAsset" ADD COLUMN "uploadOperationId" uuid, ADD COLUMN "uploadAttemptId" uuid;
CREATE UNIQUE INDEX "MediaAsset_uploadOperationId_key" ON "MediaAsset" ("uploadOperationId");
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadOperationId_fkey" FOREIGN KEY ("uploadOperationId")
  REFERENCES "IdempotencyRecord" (id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "MediaUploadAttempt" (
  id uuid PRIMARY KEY,
  "mediaId" uuid NOT NULL REFERENCES "MediaAsset" (id) ON DELETE CASCADE ON UPDATE CASCADE,
  objects jsonb NOT NULL DEFAULT '[]',
  "leaseExpiresAt" timestamptz(3) NOT NULL,
  "abandonedAt" timestamptz(3),
  "completedAt" timestamptz(3),
  "cleanupAfter" timestamptz(3) NOT NULL,
  "cleanedAt" timestamptz(3),
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT media_attempt_objects CHECK (jsonb_typeof(objects) = 'array' AND jsonb_array_length(objects) <= 3),
  CONSTRAINT media_attempt_lease CHECK ("cleanupAfter" >= "leaseExpiresAt")
);
CREATE INDEX "MediaUploadAttempt_mediaId_idx" ON "MediaUploadAttempt" ("mediaId");
CREATE INDEX "MediaUploadAttempt_cleanupAfter_cleanedAt_idx" ON "MediaUploadAttempt" ("cleanupAfter", "cleanedAt");
COMMIT;
