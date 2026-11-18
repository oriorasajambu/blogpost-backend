export const IDENTITY_GATEWAY = Symbol('IDENTITY_GATEWAY');
export interface IdentityUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  disabled: boolean;
  tenantId?: string;
  googleProviders: { uid: string; email?: string }[];
  passwordProviders: { uid: string; email?: string }[];
}
export interface IdentityEvidence {
  uid: string;
  subject: string;
  audience: unknown;
  issuer: unknown;
  email: unknown;
  emailVerified: unknown;
  provider: unknown;
  googleIdentities: unknown;
  /** Email addresses Firebase lists for the password provider on this token. */
  passwordIdentities: unknown;
  tenant: unknown;
  authTime: unknown;
  issuedAt: unknown;
  expiresAt: unknown;
  user: IdentityUser;
}
export interface IdentityGateway {
  verify(
    token: string,
    kind: 'id-token' | 'session',
  ): Promise<IdentityEvidence>;
  createSession(
    token: string,
  ): Promise<{ cookie: string; evidence: IdentityEvidence }>;
  userByEmail(email: string): Promise<IdentityUser>;
  /** Null when no account uses this address; used by flows that must not reveal existence. */
  findByEmail(email: string): Promise<IdentityUser | null>;
  /** Creates an unverified password account, or reports that the address is taken. */
  createPasswordUser(
    email: string,
    password: string,
  ): Promise<{ uid: string } | 'EXISTS'>;
  /** Issues a one-time code for a verification, reset or change-email link. */
  actionCode(
    kind: ActionCodeKind,
    email: string,
    newEmail?: string,
  ): Promise<string>;
  /** Completes a reset with its one-time code and returns the account's email address. */
  resetPassword(code: string, password: string): Promise<string>;
  /** Sets a password directly; callers must have proven recent possession of the old one. */
  setPassword(uid: string, password: string): Promise<void>;
  /** Removes an account; used only to undo a registration that could not be completed. */
  deleteUser(uid: string): Promise<void>;
  /** Invalidates every refresh token and session cookie issued before now. */
  revokeSessions(uid: string): Promise<void>;
}
export type ActionCodeKind = 'VERIFY_EMAIL' | 'PASSWORD_RESET' | 'EMAIL_CHANGE';
export interface VerifiedIdentity {
  uid: string;
  email: string;
  authTime: number;
  expiresAt: number;
  kind: 'id-token' | 'session';
}
