// Configurable email adapter. Truthfulness contract:
// - SMTP_HOST absent  -> simulated local delivery (never labeled "sent").
// - SMTP_HOST present -> real nodemailer attempt; ok/error recorded exactly.
import nodemailer from 'nodemailer';

export interface MailAttempt {
  at: string;
  channel: 'simulated' | 'smtp';
  ok: boolean;
  error?: string;
}

export interface MailPayload {
  to: string;
  subject: string;
  text: string;
}

export function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_HOST.trim());
}

export async function sendMail(p: MailPayload): Promise<MailAttempt> {
  const at = new Date().toISOString();
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
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? 'mealguard@localhost',
      to: p.to,
      subject: p.subject,
      text: p.text,
    });
    return { at, channel: 'smtp', ok: true };
  } catch (err) {
    return { at, channel: 'smtp', ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
