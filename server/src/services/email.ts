import { Resend } from 'resend';

// Lazy-init so a missing RESEND_API_KEY doesn't crash the server at
// import time — the notifier job logs a warning and skips instead.
let client: Resend | null = null;

function getClient(): Resend | null {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client = new Resend(key);
  return client;
}

export interface EmailParams {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(params: EmailParams): Promise<boolean> {
  const c = getClient();
  if (!c) {
    console.warn('[email] RESEND_API_KEY not set — skipping send:', params.subject);
    return false;
  }
  const from = process.env.ADMIN_NOTIFY_FROM || 'notifications@dig.haus';
  try {
    const { error } = await c.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
    if (error) {
      console.error('[email] send failed:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] send threw:', err);
    return false;
  }
}
