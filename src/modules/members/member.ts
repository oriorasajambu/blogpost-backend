export type MemberRole = 'AUTHOR' | 'EDITOR' | 'ADMIN';
export interface MemberRow {
  id: string;
  identityUid: string;
  email: string;
  displayName: string;
  handle: string;
  bio: string;
  role: MemberRole;
  active: boolean;
  version: number;
}
export interface Me {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  bio: string;
  role: MemberRole;
  active: boolean;
  version: number;
}
export interface AdminMember extends Me {
  createdAt: string;
  updatedAt: string;
}
export function toAdminMember(
  member: MemberRow & { createdAt: Date; updatedAt: Date },
): AdminMember {
  return {
    ...toMe(member),
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
}
export function toMe(member: MemberRow): Me {
  return {
    id: member.id,
    handle: member.handle,
    displayName: member.displayName,
    bio: member.bio,
    email: member.email,
    role: member.role,
    active: member.active,
    version: member.version,
  };
}
