import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// cover-cache/ is a pure passthrough store for resized upstream covers
// (Cover Art Archive, Spotify CDN, Discogs, Last.fm). Files are written
// in routes/cover.ts and never deleted. At dig.haus scale a single album
// adds ~65KB and the directory grows roughly 1:1 with the catalog, so
// without bounds it would eventually pressure the Railway volume. This
// job is a backstop, not active gardening — under normal use the
// directory stays well below CAP_BYTES and pruning is a no-op.
//
// Eviction policy: when total size exceeds CAP_BYTES, delete oldest-mtime
// files until under EVICT_TO_BYTES. Cold misses re-fetch from upstream;
// browser side already has `Cache-Control: immutable, max-age=1yr` so
// the warm path is unaffected.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '..', '..', 'data', 'cover-cache');
const CAP_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
const EVICT_TO_BYTES = Math.floor(CAP_BYTES * 0.8); // 1.6 GiB

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function runCoverCachePrune(): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;

    const entries = fs.readdirSync(CACHE_DIR);
    let totalSize = 0;
    const files: { name: string; size: number; mtimeMs: number }[] = [];
    for (const name of entries) {
      const full = path.join(CACHE_DIR, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue; // file vanished between readdir and stat — race with writes
      }
      if (!stat.isFile()) continue;
      totalSize += stat.size;
      files.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
    }

    if (totalSize <= CAP_BYTES) return;

    files.sort((a, b) => a.mtimeMs - b.mtimeMs);

    let deleted = 0;
    let freed = 0;
    let remaining = totalSize;
    for (const file of files) {
      if (remaining <= EVICT_TO_BYTES) break;
      try {
        fs.unlinkSync(path.join(CACHE_DIR, file.name));
        deleted += 1;
        freed += file.size;
        remaining -= file.size;
      } catch {
        // already gone, or busy — skip and continue
      }
    }
    console.log(
      `[cover-cache-prune] deleted ${deleted} files, freed ${formatMB(freed)} ` +
        `(was ${formatMB(totalSize)}, now ${formatMB(remaining)}, cap ${formatMB(CAP_BYTES)})`
    );
  } catch (err) {
    console.error('[cover-cache-prune] failed:', err);
  }
}

export function startCoverCachePruneScheduler(): void {
  // 04:30 KST — after usageLogPruner (04:00) so the two maintenance
  // jobs don't fight over disk/CPU on the same wake.
  cron.schedule('30 4 * * *', runCoverCachePrune, { timezone: 'Asia/Seoul' });
  console.log(
    `[cover-cache-prune] Scheduler started (04:30 KST daily, cap ${formatMB(CAP_BYTES)})`
  );
}
