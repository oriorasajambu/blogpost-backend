import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../platform/config/config.js';
import type { RenderedEmail } from './invitation-email.js';

export const EMAIL_GATEWAY = Symbol('EMAIL_GATEWAY');
export interface OutgoingEmail extends RenderedEmail {
  to: string;
  replyTo: string | null;
  /** Stable per outbox row so a retry after a lost response cannot send twice. */
  idempotencyKey: string;
}
export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; code: string };
export interface EmailGateway {
  send(email: OutgoingEmail, timeoutMs: number): Promise<SendResult>;
}

const RESEND_URL = 'https://api.resend.com/emails';

/** Classifies a provider HTTP failure: 429 and 5xx retry; other statuses are final. */
export function classifyStatus(status: number): SendResult {
  return {
    ok: false,
    retryable: status === 429 || status >= 500,
    code: `PROVIDER_${status}`,
  };
}

@Injectable()
export class ConfiguredEmailGateway implements EmailGateway {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  async send(email: OutgoingEmail, timeoutMs: number): Promise<SendResult> {
    const settings = this.config.email;
    if (!settings)
      return { ok: false, retryable: false, code: 'EMAIL_DISABLED' };
    if (settings.driver === 'log') {
      // Development only (config rejects it in the cloud): the email, link included, goes to
      // stdout. Nest's logger is disabled in createApp, so write to the stream directly.
      process.stdout.write(
        `${JSON.stringify({
          severity: 'INFO',
          event: 'development_invitation_email',
          to: email.to,
          subject: email.subject,
          text: email.text,
        })}\n`,
      );
      return { ok: true, providerMessageId: `log-${email.idempotencyKey}` };
    }
    let response: Response;
    try {
      response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.resendApiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': email.idempotencyKey,
        },
        body: JSON.stringify({
          from: settings.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
          ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch {
      return { ok: false, retryable: true, code: 'PROVIDER_UNREACHABLE' };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return classifyStatus(response.status);
    }
    try {
      const body = (await response.json()) as { id?: unknown };
      if (typeof body.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(body.id))
        return { ok: true, providerMessageId: body.id };
    } catch {}
    // Accepted but unreadable: treat as sent, because a retry could duplicate the email.
    return { ok: true, providerMessageId: 'unknown' };
  }
}
