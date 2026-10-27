BEGIN;
SET LOCAL search_path = blogpost, public;
SET LOCAL lock_timeout = '4s';
ALTER TABLE "SlugHistory" DROP CONSTRAINT "SlugHistory_postId_fkey";
ALTER TABLE "SlugHistory" ALTER COLUMN "postId" DROP NOT NULL;
ALTER TABLE "SlugHistory" ADD CONSTRAINT "SlugHistory_postId_fkey" FOREIGN KEY ("postId")
  REFERENCES "Post" (id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE FUNCTION preserve_slug_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug OR
    (NEW."postId" IS DISTINCT FROM OLD."postId" AND
      (NEW."postId" IS NOT NULL OR EXISTS(SELECT 1 FROM blogpost."Post" WHERE id=OLD."postId"))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Slug reservations are permanent';
  END IF;
  IF NEW."postId" IS NULL THEN NEW.canonical := false; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_slug_reservation BEFORE UPDATE ON "SlugHistory" FOR EACH ROW EXECUTE FUNCTION preserve_slug_reservation();
ALTER TABLE "MediaAsset" ADD COLUMN "deletionAfter" timestamptz(3), ADD COLUMN "objectsDeletedAt" timestamptz(3);
CREATE INDEX "MediaAsset_state_deletionAfter_objectsDeletedAt_idx" ON "MediaAsset" (state, "deletionAfter", "objectsDeletedAt");
CREATE TABLE "MaintenanceCheckpoint" (
  key varchar(100) PRIMARY KEY,
  cursor varchar(2048),
  "updatedAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMIT;
