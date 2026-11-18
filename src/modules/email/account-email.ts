import { escapeHtml, type RenderedEmail } from './invitation-email.js';

export const ACCOUNT_EMAIL_KINDS = [
  'VERIFY_EMAIL',
  'PASSWORD_RESET',
  'PASSWORD_SET',
  'PASSWORD_CHANGED_NOTICE',
  'EMAIL_CHANGE_VERIFY',
  'EMAIL_CHANGE_NOTICE',
  'ACCOUNT_EXISTS_NOTICE',
] as const;
export type AccountEmailKind = (typeof ACCOUNT_EMAIL_KINDS)[number];

/** Sealed into the outbox row; never logged. `actionUrl` carries the one-time code. */
export interface AccountEmailPayload {
  actionUrl: string | null;
  /** The other address for change notices; unused otherwise. */
  detail: string | null;
}
const PAYLOAD_KEYS = ['actionUrl', 'detail'];
/** Web page that completes each link kind, and whether the kind must carry a link at all. */
const ACTION_PATHS: Record<AccountEmailKind, string | null> = {
  VERIFY_EMAIL: '/verify-email',
  PASSWORD_RESET: '/reset-password',
  PASSWORD_SET: '/reset-password',
  EMAIL_CHANGE_VERIFY: '/confirm-email-change',
  PASSWORD_CHANGED_NOTICE: null,
  EMAIL_CHANGE_NOTICE: null,
  ACCOUNT_EXISTS_NOTICE: '/sign-in',
};
export function isAccountEmailKind(value: string): value is AccountEmailKind {
  return (ACCOUNT_EMAIL_KINDS as readonly string[]).includes(value);
}
/** Builds the link a recipient opens; the code is the only secret and is URL-safe. */
export function accountActionUrl(
  webOrigin: string,
  kind: AccountEmailKind,
  code: string | null,
): string | null {
  const path = ACTION_PATHS[kind];
  if (path === null) return null;
  if (kind === 'ACCOUNT_EXISTS_NOTICE') return `${webOrigin}${path}`;
  if (!code || !/^[A-Za-z0-9_-]{16,512}$/.test(code))
    throw new Error('Invalid action code');
  const mode = kind === 'PASSWORD_SET' ? '&set=1' : '';
  return `${webOrigin}${path}?code=${code}${mode}`;
}
export function accountPayload(
  kind: AccountEmailKind,
  value: unknown,
): AccountEmailPayload {
  const invalid = () => new Error('Invalid account email payload');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== PAYLOAD_KEYS.join()) throw invalid();
  const path = ACTION_PATHS[kind];
  if (path === null) {
    if (v.actionUrl !== null) throw invalid();
  } else if (
    typeof v.actionUrl !== 'string' ||
    !new RegExp(
      kind === 'ACCOUNT_EXISTS_NOTICE'
        ? `^https?://[^\\s/?#]+${path}$`
        : `^https?://[^\\s/?#]+${path}\\?code=[A-Za-z0-9_-]{16,512}(?:&set=1)?$`,
    ).test(v.actionUrl)
  )
    throw invalid();
  if (
    v.detail !== null &&
    (typeof v.detail !== 'string' || v.detail.length > 320)
  )
    throw invalid();
  return v as unknown as AccountEmailPayload;
}

/** Hides most of an address so a notice does not leak a full new address to an old inbox. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

interface Copy {
  subject: string;
  heading: string;
  lines: string[];
  button: string | null;
  footer: string;
}
function copy(
  kind: AccountEmailKind,
  payload: AccountEmailPayload,
  recipient: string,
): Copy {
  const ignore = "If you didn't request this, you can ignore this email.";
  switch (kind) {
    case 'VERIFY_EMAIL':
      return {
        subject: 'Verify your email for Blogpost',
        heading: 'Verify your email',
        lines: [
          `Confirm that ${recipient} is your address to finish creating your account.`,
        ],
        button: 'Verify email',
        footer: ignore,
      };
    case 'PASSWORD_RESET':
      return {
        subject: 'Reset your Blogpost password',
        heading: 'Reset your password',
        lines: [
          `Someone asked to reset the password for ${recipient}. The link works once and expires in about an hour.`,
        ],
        button: 'Choose a new password',
        footer: ignore + ' Your password will not change.',
      };
    case 'PASSWORD_SET':
      return {
        subject: 'Set a password for Blogpost',
        heading: 'Set your password',
        lines: [
          `Blogpost now signs in with email and a password instead of Google. Choose a password for ${recipient} to keep your account and posts.`,
          'The link works once and expires in about an hour; you can request a new one on the sign-in page.',
        ],
        button: 'Set password',
        footer: 'Your posts and settings are not affected.',
      };
    case 'PASSWORD_CHANGED_NOTICE':
      return {
        subject: 'Your Blogpost password was changed',
        heading: 'Your password was changed',
        lines: [
          `The password for ${recipient} was just changed and you were signed out everywhere.`,
        ],
        button: null,
        footer:
          "If this wasn't you, reset your password right away from the sign-in page.",
      };
    case 'EMAIL_CHANGE_VERIFY':
      return {
        subject: 'Confirm your new Blogpost email',
        heading: 'Confirm your new email',
        lines: [
          `Confirm that ${recipient} should replace ${payload.detail ? maskEmail(payload.detail) : 'your current address'} on your account. You will be signed out everywhere after confirming.`,
        ],
        button: 'Confirm new email',
        footer: ignore,
      };
    case 'EMAIL_CHANGE_NOTICE':
      return {
        subject: 'A change of your Blogpost email was requested',
        heading: 'Email change requested',
        lines: [
          `A request was made to change the email for this account to ${payload.detail ? maskEmail(payload.detail) : 'another address'}. Nothing changes until the new address is confirmed.`,
        ],
        button: null,
        footer:
          "If this wasn't you, change your password right away from the sign-in page.",
      };
    case 'ACCOUNT_EXISTS_NOTICE':
      return {
        subject: 'You already have a Blogpost account',
        heading: 'You already have an account',
        lines: [
          `Someone tried to register ${recipient}, which already has an account. Your account is unchanged.`,
        ],
        button: 'Sign in',
        footer:
          'Forgot your password? Use the reset link on the sign-in page. ' +
          ignore,
      };
  }
}

export function renderAccountEmail(
  kind: AccountEmailKind,
  payload: AccountEmailPayload,
  recipient: string,
): RenderedEmail {
  const c = copy(kind, payload, recipient);
  const url = payload.actionUrl;
  const text = [
    ...c.lines.flatMap((l) => [l, '']),
    ...(c.button && url ? [`${c.button}:`, url, ''] : []),
    c.footer,
  ].join('\n');
  const muted = 'margin:0 0 8px;font-size:13px;line-height:1.5;color:#555';
  const link =
    c.button && url
      ? `<p style="margin:0 0 24px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#5b4bdb;color:#ffffff;text-decoration:none;font-weight:bold">${escapeHtml(c.button)}</a></p>
<p style="${muted}">Or open this link:<br><a href="${escapeHtml(url)}" style="color:#5b4bdb;word-break:break-all">${escapeHtml(url)}</a></p>`
      : '';
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f6f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d1d23">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<p style="margin:0 0 16px;font-size:20px;font-weight:bold">${escapeHtml(c.heading)}</p>
${c.lines.map((l) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(l)}</p>`).join('\n')}
${link}
<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#777">${escapeHtml(c.footer)}</p>
</td></tr></table>
</td></tr></table>
</body>
</html>`;
  return { subject: c.subject, text, html };
}
