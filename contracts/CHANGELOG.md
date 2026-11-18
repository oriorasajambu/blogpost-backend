# Contract changelog

## Unreleased — intended 1.0.0

- Authored the complete 52-operation v1 catalog and canonical DTOs, headers, access rules, version/idempotency requirements, pagination and binary/health exceptions.
- Added valid success/request examples, empty collections, replay examples including secret-free invitation replay, shared machine-error examples and Markdown contract 1 fixtures.
- Added deterministic JSON/YAML authoring, generated TypeScript DTOs and a compiling consumer, checksum manifests and structural compatibility tooling.

- Added the complete stateful mock, defensive compiling Kotlin consumer, isolated full conformance evidence, legacy save/retry semantics and stricter default/text/counting compatibility rules.
- Added reproducible versioned handoff archives with source/toolchain inputs, per-file SHA-256 manifests and archive checksums. Extracted-package validation is separate from an approved release.

- Added `Invitation.delivery` (`InvitationDelivery`): invitation email status (`NOT_REQUESTED`, `QUEUED`, `SENT`, `FAILED`, `CANCELLED`), attempt count and timestamps. Email is optional per deployment; without it every invitation reports `NOT_REQUESTED` and the copy-link flow is unchanged.

- Added email/password registration: `registerAccount` and `resendVerificationEmail` (anonymous, server proxy only, `202 AccountRequestAccepted`, identical for existing and new addresses), `AdminMember.status` (`MemberStatus`: `PENDING`, `ACTIVE`, `DISABLED`) with a `memberStatus` filter on `listMembers`, and the `ACCOUNT_PENDING` (403) and `CAPTCHA_FAILED` (422) error codes. The catalog now has 54 operations.

- Added password recovery and credential changes: `forgotPassword` and `resetPassword` (anonymous, server proxy only), and `changePassword` and `requestEmailChange` (active member, each proving recent authentication with a fresh identity token). All answer `202 AccountRequestAccepted`. The catalog now has 58 operations.

This remains draft authoring history. Owner review, explicit immutable publication and actual provider/client application-release gates remain open. No previously published contract exists for a historical baseline comparison.
