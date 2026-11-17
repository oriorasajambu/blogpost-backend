import type { MemberRole } from '../members/member.js';

/** Sealed into the outbox row; never logged. */
export interface InvitationEmailPayload {
  inviteUrl: string;
  role: MemberRole;
  inviterName: string;
  inviterEmail: string;
  expiresAt: string;
}
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const PAYLOAD_KEYS = [
  'expiresAt',
  'inviteUrl',
  'inviterEmail',
  'inviterName',
  'role',
];
export function invitationPayload(value: unknown): InvitationEmailPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid invitation email payload');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== PAYLOAD_KEYS.join())
    throw new Error('Invalid invitation email payload');
  if (
    typeof v.inviteUrl !== 'string' ||
    !/^https?:\/\/[^\s/?#]+\/invitations\/accept\?token=[A-Za-z0-9_-]{43}$/.test(
      v.inviteUrl,
    ) ||
    !['AUTHOR', 'EDITOR', 'ADMIN'].includes(String(v.role)) ||
    typeof v.inviterName !== 'string' ||
    v.inviterName.length > 200 ||
    typeof v.inviterEmail !== 'string' ||
    v.inviterEmail.length > 320 ||
    typeof v.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(v.expiresAt))
  )
    throw new Error('Invalid invitation email payload');
  return v as unknown as InvitationEmailPayload;
}

const ROLE_NAMES: Record<MemberRole, string> = {
  AUTHOR: 'an author',
  EDITOR: 'an editor',
  ADMIN: 'an administrator',
};
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
/** A single line without control characters, bounded in length. */
function line(value: string, max: number): string {
  return (
    value
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .trim()
      .slice(0, max) || 'A Blogpost administrator'
  );
}

export function renderInvitationEmail(
  payload: InvitationEmailPayload,
  recipient: string,
): RenderedEmail {
  const inviter = line(payload.inviterName, 120);
  const role = ROLE_NAMES[payload.role];
  const expires = new Intl.DateTimeFormat('en', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(payload.expiresAt));
  const subject = `You're invited to join Blogpost as ${role}`;
  const text = [
    `${inviter} invited you to join the Blogpost Studio as ${role}.`,
    '',
    'Accept the invitation:',
    payload.inviteUrl,
    '',
    `Sign in with the Google account for ${recipient}. Other accounts cannot use this invitation.`,
    `The link works once and expires on ${expires} (Asia/Jakarta).`,
    '',
    "If you weren't expecting this invitation, you can ignore this email.",
  ].join('\n');
  const url = escapeHtml(payload.inviteUrl);
  const muted = 'margin:0 0 8px;font-size:13px;line-height:1.5;color:#555';
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f6f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d1d23">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<p style="margin:0 0 16px;font-size:20px;font-weight:bold">You're invited to Blogpost</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(inviter)} invited you to join the Blogpost Studio as ${role}.</p>
<p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#5b4bdb;color:#ffffff;text-decoration:none;font-weight:bold">Accept invitation</a></p>
<p style="${muted}">Or open this link:<br><a href="${url}" style="color:#5b4bdb;word-break:break-all">${url}</a></p>
<p style="${muted}">Sign in with the Google account for <strong>${escapeHtml(recipient)}</strong>. Other accounts cannot use this invitation.</p>
<p style="${muted}">The link works once and expires on ${escapeHtml(expires)} (Asia/Jakarta).</p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#777">If you weren't expecting this invitation, you can ignore this email.</p>
</td></tr></table>
</td></tr></table>
</body>
</html>`;
  return { subject, text, html };
}
