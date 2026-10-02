// Configurable email adapter. Truthfulness contract:
// - RESEND_API_KEY present -> real Resend API attempt; ok/error recorded exactly.
// - else SMTP_HOST present  -> real nodemailer attempt; ok/error recorded exactly.
// - else                     -> simulated local delivery (never labeled "sent").
import nodemailer from 'nodemailer';

export interface MailAttempt {
  at: string;
  channel: 'simulated' | 'smtp' | 'resend';
  ok: boolean;
  error?: string;
  /** Provider-accepted message id (Resend id / SMTP messageId). Absent when not accepted. */
  messageId?: string;
}

export interface MailPayload {
  to: string;
  subject: string;
  text: string;
}

export function resendConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim());
}

export function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_HOST.trim());
}

function senderAddress(): string {
  return process.env.RESEND_FROM ?? process.env.SMTP_FROM ?? 'mealguard@localhost';
}

async function sendViaResend(p: MailPayload, at: string): Promise<MailAttempt> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY as string}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: senderAddress(), to: p.to, subject: p.subject, text: p.text }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let detail = `Resend API rejected the send (HTTP ${res.status}).`;
      try {
        const data = (await res.json()) as { message?: string; name?: string };
        if (data?.message) detail = `Resend: ${data.message}`;
      } catch { /* keep generic detail */ }
      return { at, channel: 'resend', ok: false, error: detail };
    }
    let messageId: string | undefined;
    try {
      const data = (await res.json()) as { id?: string };
      if (typeof data?.id === 'string') messageId = data.id;
    } catch { /* accepted without a parsable id */ }
    return { at, channel: 'resend', ok: true, ...(messageId ? { messageId } : {}) };
  } catch (err) {
    return { at, channel: 'resend', ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function liveSendingAllowed(): boolean {
  // Automated tests must never bill real providers or deliver real mail.
  if (process.env.NODE_ENV === 'test' && process.env.MAIL_LIVE_TEST !== '1') return false;
  return true;
}

export async function sendMail(p: MailPayload): Promise<MailAttempt> {
  const at = new Date().toISOString();
  if (!liveSendingAllowed()) {
    return { at, channel: 'simulated', ok: true };
  }
  if (resendConfigured()) {
    return sendViaResend(p, at);
  }
  if (!smtpConfigured()) {
    return { at, channel: 'simulated', ok: true };
  }
  try {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: String(process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM ?? 'mealguard@localhost',
      to: p.to,
      subject: p.subject,
      text: p.text,
    });
    const messageId = typeof info?.messageId === 'string' ? info.messageId : undefined;
    return { at, channel: 'smtp', ok: true, ...(messageId ? { messageId } : {}) };
  } catch (err) {
    return { at, channel: 'smtp', ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default { smtpConfigured, resendConfigured, sendMail };
