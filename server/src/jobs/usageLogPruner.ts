import cron from 'node-cron';
import { execute, queryGet } from '../db/index.js';

// claude_usage_log is append-only: every LLM call (Claude + DeepSeek,
// the name is historical) inserts a row. The /admin/api-console live
// view reads recent rows; the monthly usage rollup on the dashboard
// reads a 30-day window. Rows older than the 90-day horizon are
// never surfaced, so they just slow down the 30d aggregation and eat
// disk with no upside. Daily prune trims everything older than 90
// days. Runs at 04:00 KST — after the label-feed poller (03:00) so
// the maintenance windows don't overlap on first-of-month days when
// both jobs might run long.
const RETENTION_DAYS = 90;

export function runUsageLogPrune(): void {
  try {
    const before = queryGet('SELECT COUNT(*) AS n FROM claude_usage_log') as { n: number } | null;
    const result = execute(
      `DELETE FROM claude_usage_log WHERE created_at < datetime('now', ?)`,
      [`-${RETENTION_DAYS} days`]
    );
    const deleted = (result.changes as number) ?? 0;
    const remaining = before ? before.n - deleted : null;
    if (deleted > 0) {
      console.log(
        `[usage-prune] deleted ${deleted} rows older than ${RETENTION_DAYS}d (remaining ${remaining ?? '?'})`
      );
    }
  } catch (err) {
    console.error('[usage-prune] failed:', err);
  }
}

export function startUsageLogPruneScheduler(): void {
  cron.schedule('0 4 * * *', runUsageLogPrune, { timezone: 'Asia/Seoul' });
  // No initial-kick run here: unlike rankScheduler which needs scores
  // immediately on a fresh deploy, usage prune's value accrues over
  // weeks. Let the first scheduled tick do the work so startup logs
  // stay clean.
  console.log(
    `[usage-prune] Scheduler started (04:00 KST daily, retention ${RETENTION_DAYS}d)`
  );
}
