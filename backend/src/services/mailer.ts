import nodemailer, { type Transporter } from 'nodemailer';
import { emailEnabled, env } from '../config/env.js';

// Sends e-mail through the SMTP account in backend/.env (for Gmail: the Gmail address plus an App Password).
// Nothing is sent when it is not set up; callers check emailEnabled first.

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  return transporter;
}

export function emailSender(): string | null {
  return emailEnabled ? (env.SMTP_USER ?? null) : null;
}

export async function sendMail(message: {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
  attachment?: { fileName: string; data: Buffer };
}): Promise<void> {
  await getTransporter().sendMail({
    from: env.SMTP_FROM_NAME ? { name: env.SMTP_FROM_NAME, address: env.SMTP_USER! } : env.SMTP_USER,
    to: message.to,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
    attachments: message.attachment ? [{ filename: message.attachment.fileName, content: message.attachment.data }] : [],
  });
}

// A short, readable reason for a failed send. The SMTP password is never part of these messages.
export function mailErrorMessage(error: unknown): string {
  const e = error as { code?: string; responseCode?: number };
  if (e.code === 'EAUTH' || e.responseCode === 535) {
    return 'Gmail refused the sign-in. Check SMTP_USER and the App Password in backend/.env (a normal Gmail password does not work).';
  }
  if (e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT' || e.code === 'ESOCKET' || e.code === 'EDNS') {
    return 'The server could not reach the mail server. Check the internet connection.';
  }
  if (e.responseCode === 552) return 'The mail server refused the message because the file is too large.';
  return 'The e-mail could not be sent. Please try again.';
}
