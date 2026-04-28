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

// Notify the site owner that an un-invited Google user has hit the
// signup gate and is waiting for approval. Recipient defaults to
// fpp@dig.haus; override via ADMIN_NOTIFY_TO env if the operator
// inbox moves. Body is plain text — Resend handles HTML wrapping for
// us if we ever want it, but text is enough to act on.
export async function sendPendingSignupNotice(params: {
  email: string;
  name: string;
  avatarUrl: string;
}): Promise<boolean> {
  const to = process.env.ADMIN_NOTIFY_TO || 'fpp@dig.haus';
  const adminBase = process.env.CLIENT_URL || 'http://localhost:3000';
  const lines = [
    `새 가입 신청이 접수됐어요.`,
    ``,
    `이름: ${params.name || '(없음)'}`,
    `이메일: ${params.email}`,
    params.avatarUrl ? `아바타: ${params.avatarUrl}` : null,
    ``,
    `승인하려면 ${adminBase}/admin 에서 "가입 신청" 패널을 확인하거나,`,
    `다음 명령으로 invited_emails 테이블에 직접 추가할 수 있어요:`,
    `  INSERT INTO invited_emails (email, note) VALUES ('${params.email}', 'manual approval');`,
  ]
    .filter(Boolean)
    .join('\n');

  return sendEmail({
    to,
    subject: `[dig.haus] 가입 신청 — ${params.email}`,
    text: lines,
  });
}
