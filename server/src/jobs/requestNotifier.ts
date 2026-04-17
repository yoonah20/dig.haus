import cron from 'node-cron';
import { execute, queryAll } from '../db/index.js';
import { sendEmail } from '../services/email.js';

interface PendingRequestRow {
  id: number;
  mbid: string;
  title: string;
  artist_name: string;
  release_year: number | null;
  notes: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

function formatDigestBody(rows: PendingRequestRow[], dashboardUrl: string): string {
  const header =
    rows.length === 1
      ? '새 앨범 등록 요청 1건이 들어왔습니다.'
      : `새 앨범 등록 요청 ${rows.length}건이 들어왔습니다.`;

  const items = rows
    .map((r) => {
      const year = r.release_year ? ` (${r.release_year})` : '';
      const who = r.user_name || r.user_email || '익명';
      const when = r.created_at;
      const notes = r.notes ? `\n   메모: ${r.notes}` : '';
      return `• ${r.title} — ${r.artist_name}${year}\n   요청자: ${who}\n   시각: ${when}${notes}`;
    })
    .join('\n\n');

  return `${header}\n\n${items}\n\n관리자 대시보드: ${dashboardUrl}`;
}

// Collects every album_requests row whose admin_notified_at is still
// NULL, emails them to the admin as one digest, and marks them notified
// in a single UPDATE. Runs every 5 minutes — so a spike of requests
// gets bundled into one email instead of flooding the inbox.
async function flushPendingRequests(): Promise<void> {
  const rows = queryAll(
    `SELECT ar.id, ar.mbid, ar.title, ar.artist_name, ar.release_year,
            ar.notes, ar.created_at,
            COALESCE(u.display_name, u.name) AS user_name,
            u.email AS user_email
     FROM album_requests ar
     LEFT JOIN users u ON u.id = ar.user_id
     WHERE ar.admin_notified_at IS NULL
       AND ar.status = 'pending'
     ORDER BY ar.created_at ASC`
  ) as PendingRequestRow[];

  if (rows.length === 0) return;

  const to = process.env.ADMIN_NOTIFY_EMAIL;
  if (!to) {
    console.warn(
      '[notify] ADMIN_NOTIFY_EMAIL not set — skipping digest for',
      rows.length,
      'pending requests'
    );
    return;
  }

  const clientBase = process.env.CLIENT_URL || 'https://dig.haus';
  const dashboardUrl = `${clientBase}/admin`;

  const subject =
    rows.length === 1
      ? `[dig.haus] 새 등록 요청 — ${rows[0].title}`
      : `[dig.haus] 새 등록 요청 ${rows.length}건`;

  const sent = await sendEmail({
    to,
    subject,
    text: formatDigestBody(rows, dashboardUrl),
  });

  if (!sent) {
    // Leave admin_notified_at NULL so the next tick retries. The
    // sendEmail wrapper already logged whatever went wrong.
    return;
  }

  // Flip the flag only for the exact set we just emailed. A concurrent
  // request created between the SELECT and this UPDATE stays unnotified
  // and rolls into the next 5-minute batch.
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  execute(
    `UPDATE album_requests
     SET admin_notified_at = datetime('now')
     WHERE id IN (${placeholders})`,
    ids
  );

  console.log(`[notify] emailed ${rows.length} pending request(s) to ${to}`);
}

export function startRequestNotifier(): void {
  // Fire every 5 minutes. node-cron's '*/5 * * * *' evaluates against
  // wall-clock minutes, so actual tick intervals are 0/5/10/…/55.
  cron.schedule('*/5 * * * *', () => {
    flushPendingRequests().catch((err) => {
      console.error('[notify] tick failed:', err);
    });
  });
  console.log('[notify] request-digest scheduler started (every 5 minutes)');
}
