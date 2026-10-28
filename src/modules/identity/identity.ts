export const IDENTITY_GATEWAY = Symbol('IDENTITY_GATEWAY');
export interface IdentityUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  disabled: boolean;
  tenantId?: string;
  googleProviders: { uid: string; email?: string }[];
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
}
export interface VerifiedIdentity {
  uid: string;
  email: string;
  authTime: number;
  expiresAt: number;
  kind: 'id-token' | 'session';
}
