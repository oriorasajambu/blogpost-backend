BEGIN;
SET LOCAL search_path = blogpost, public;
SET LOCAL lock_timeout = '4s';

-- Member lifecycle: self-registered accounts wait as PENDING until an administrator approves them.
-- "active" stays the single flag existing code reads; the CHECK keeps the two in agreement.
CREATE TYPE "MemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');
ALTER TABLE "Member" ADD COLUMN "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "Member" SET "status" = 'DISABLED' WHERE NOT "active";
ALTER TABLE "Member" ADD CONSTRAINT member_status_active CHECK ("active" = ("status" = 'ACTIVE'));
CREATE INDEX "Member_status_createdAt_idx" ON "Member" ("status", "createdAt");
-- Writers that only know "active" (operator SQL, older code) keep working: whichever column
-- changed on its own drives the other. A write that changes both inconsistently fails the CHECK.
CREATE FUNCTION sync_member_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" = 'ACTIVE' AND NOT NEW."active" THEN NEW."status" := 'DISABLED';
    ELSIF NEW."status" <> 'ACTIVE' AND NEW."active" THEN NEW."active" := false;
    END IF;
  ELSIF NEW."active" IS DISTINCT FROM OLD."active" AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    NEW."status" := CASE WHEN NEW."active" THEN 'ACTIVE'::"MemberStatus" ELSE 'DISABLED'::"MemberStatus" END;
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" AND NEW."active" IS NOT DISTINCT FROM OLD."active" THEN
    NEW."active" := NEW."status" = 'ACTIVE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER member_status_sync BEFORE INSERT OR UPDATE ON "Member" FOR EACH ROW EXECUTE FUNCTION sync_member_status();

-- Account email (verify, reset, change, notices) shares the outbox with invitations. A row belongs
-- to exactly one of an invitation or a member. Payload links stay encrypted and are wiped when final.
ALTER TABLE "EmailOutbox" ALTER COLUMN "invitationId" DROP NOT NULL;
ALTER TABLE "EmailOutbox" ADD COLUMN "memberId" uuid;
ALTER TABLE "EmailOutbox" ALTER COLUMN kind TYPE varchar(30);
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_memberId_fkey" FOREIGN KEY ("memberId")
  REFERENCES "Member" (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailOutbox" DROP CONSTRAINT email_outbox_kind;
-- The CHECKs and the partial index below list varchar values. Stated with text literals they deparse
-- identically after a dump and restore (an IN list over a varchar column does not), so a restored
-- database still matches the verified schema baseline. The earlier outbox objects are re-stated here.
ALTER TABLE "EmailOutbox" ADD CONSTRAINT email_outbox_kind CHECK (kind::text = ANY (ARRAY[
  'INVITATION'::text, 'VERIFY_EMAIL'::text, 'PASSWORD_RESET'::text, 'PASSWORD_SET'::text,
  'PASSWORD_CHANGED_NOTICE'::text, 'EMAIL_CHANGE_VERIFY'::text, 'EMAIL_CHANGE_NOTICE'::text,
  'ACCOUNT_EXISTS_NOTICE'::text]));
ALTER TABLE "EmailOutbox" DROP CONSTRAINT email_outbox_status, DROP CONSTRAINT email_outbox_payload;
ALTER TABLE "EmailOutbox"
  ADD CONSTRAINT email_outbox_status CHECK (status::text = ANY (ARRAY[
    'QUEUED'::text, 'SENDING'::text, 'SENT'::text, 'FAILED'::text, 'CANCELLED'::text])),
  ADD CONSTRAINT email_outbox_payload CHECK (
    (status::text = ANY (ARRAY['QUEUED'::text, 'SENDING'::text])) = ("payloadCiphertext" IS NOT NULL)
    AND ("payloadCiphertext" IS NULL OR octet_length("payloadCiphertext") BETWEEN 29 AND 8192));
DROP INDEX "EmailOutbox_due_idx";
CREATE INDEX "EmailOutbox_due_idx" ON "EmailOutbox" ("nextAttemptAt")
  WHERE status::text = ANY (ARRAY['QUEUED'::text, 'SENDING'::text]);
ALTER TABLE "EmailOutbox" ADD CONSTRAINT email_outbox_owner CHECK (
  (kind = 'INVITATION' AND "invitationId" IS NOT NULL AND "memberId" IS NULL)
  OR (kind <> 'INVITATION' AND "invitationId" IS NULL AND "memberId" IS NOT NULL));
CREATE INDEX "EmailOutbox_memberId_idx" ON "EmailOutbox" ("memberId");

-- Rate limits for callers who are not members yet. Subjects are SHA-256 hashes of an address or IP,
-- so no raw email or network address is stored.
CREATE TABLE "AnonymousRateLimit" (
  "subjectHash" char(64) NOT NULL,
  action varchar(40) NOT NULL,
  "windowStart" timestamptz(3) NOT NULL,
  count integer NOT NULL DEFAULT 0,
  "expiresAt" timestamptz(3) NOT NULL,
  CONSTRAINT "AnonymousRateLimit_pkey" PRIMARY KEY ("subjectHash", action, "windowStart"),
  CONSTRAINT anonymous_rate_limit_subject CHECK ("subjectHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT anonymous_rate_limit_count CHECK (count > 0)
);
CREATE INDEX "AnonymousRateLimit_expiresAt_idx" ON "AnonymousRateLimit" ("expiresAt");
COMMIT;
