BEGIN;
SET LOCAL search_path = blogpost, public;
SET LOCAL lock_timeout = '4s';
-- Transactional outbox for invitation email. The accept link is stored only as
-- AES-256-GCM ciphertext while delivery is pending and is wiped on any final state.
CREATE TABLE "EmailOutbox" (
  id uuid PRIMARY KEY,
  "invitationId" uuid NOT NULL,
  kind varchar(20) NOT NULL,
  "toEmail" varchar(320) NOT NULL,
  "payloadCiphertext" bytea,
  "payloadKeyVersion" smallint NOT NULL DEFAULT 1,
  status varchar(10) NOT NULL DEFAULT 'QUEUED',
  attempts smallint NOT NULL DEFAULT 0,
  "nextAttemptAt" timestamptz(3) NOT NULL,
  "lockedUntil" timestamptz(3),
  "lastAttemptAt" timestamptz(3),
  "providerMessageId" varchar(100),
  "lastErrorCode" varchar(80),
  "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" timestamptz(3),
  CONSTRAINT "EmailOutbox_invitationId_fkey" FOREIGN KEY ("invitationId")
    REFERENCES "Invitation" (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT email_outbox_kind CHECK (kind = 'INVITATION'),
  CONSTRAINT email_outbox_status CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
  CONSTRAINT email_outbox_attempts CHECK (attempts BETWEEN 0 AND 6),
  CONSTRAINT email_outbox_key_version CHECK ("payloadKeyVersion" > 0),
  CONSTRAINT email_outbox_payload CHECK (
    (status IN ('QUEUED', 'SENDING')) = ("payloadCiphertext" IS NOT NULL)
    AND ("payloadCiphertext" IS NULL OR octet_length("payloadCiphertext") BETWEEN 29 AND 8192)
  ),
  CONSTRAINT email_outbox_sent CHECK ((status = 'SENT') = ("sentAt" IS NOT NULL)),
  CONSTRAINT email_outbox_lock CHECK (status = 'SENDING' OR "lockedUntil" IS NULL),
  CONSTRAINT email_outbox_email CHECK ("toEmail" = lower("toEmail") AND position('@' in "toEmail") > 1)
);
CREATE INDEX "EmailOutbox_invitationId_idx" ON "EmailOutbox" ("invitationId");
CREATE INDEX "EmailOutbox_toEmail_createdAt_idx" ON "EmailOutbox" ("toEmail", "createdAt");
CREATE INDEX "EmailOutbox_due_idx" ON "EmailOutbox" ("nextAttemptAt") WHERE status IN ('QUEUED', 'SENDING');
COMMIT;
