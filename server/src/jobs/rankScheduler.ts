import cron from 'node-cron';
import { execute, queryAll } from '../db/index.js';

const TOP_N = 20;

export function runRankUpdate(): void {
  try {
    const rows = queryAll(`
      SELECT a.id,
        COALESCE(SUM(CASE WHEN v.vote='up' THEN 1 ELSE 0 END), 0) AS up,
        COALESCE(SUM(CASE WHEN v.vote='down' THEN 1 ELSE 0 END), 0) AS down
      FROM albums a
      LEFT JOIN album_votes v ON v.album_id = a.id
      GROUP BY a.id
    `);

    const now = new Date().toISOString();
    const scored = rows.map((r: any) => ({ id: r.id, score: r.up - r.down }));
    scored.sort((a, b) => b.score - a.score);

    const topIds = new Set(scored.slice(0, TOP_N).filter((r) => r.score > 0).map((r) => r.id));

    for (const r of scored) {
      execute(
        `UPDATE albums SET rank_score = ?, is_vinyl_wall = ?, rank_updated_at = ? WHERE id = ?`,
        [r.score, topIds.has(r.id) ? 1 : 0, now, r.id]
      );
    }

    console.log(`[rank] Updated ${scored.length} albums; vinyl wall: ${topIds.size}`);
  } catch (err) {
    console.error('[rank] update failed:', err);
  }
}

export function startRankScheduler(): void {
  // Midnight KST = 15:00 UTC the day before.
  // node-cron accepts a timezone option.
  cron.schedule(
    '0 0 * * *',
    runRankUpdate,
    { timezone: 'Asia/Seoul' }
  );

  // Kick off once at startup so fresh deploys have scores immediately.
  runRankUpdate();
  console.log('[rank] Scheduler started (midnight KST, initial run triggered)');
}
