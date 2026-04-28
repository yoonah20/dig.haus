import { Router } from 'express';
import { getDb, queryAll } from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { convertToKrwSync, getRates } from '../services/exchangeRates.js';

// Admin-curated 15-album home wall (5-5-5 to match mydig). Mirrors
// the mydig vinyl-wall data shape (album_id, position) minus the
// user_id — this is a global wall, not per-user.
//
// Multi-wall carousel: schema keys home_features rows by wall_id and
// stores per-wall meta (theme + description + tuner cols + ink /
// shadow / wall_color tokens) on home_walls. The endpoint returns
// the full walls array so the client carousel can render each track
// with its own backdrop + ink palette.

const router = Router();

router.get('/home/features', async (_req, res) => {
  // Pull every wall row + every feature row in two batched queries,
  // then group features by wall_id in memory. Cheaper than per-wall
  // round trips and lets the album / purchase-link enrichment below
  // run once across all featured albums regardless of how many walls
  // they're spread over.
  const wallRows = queryAll(
    `SELECT id, position, backdrop_file AS backdropFile,
            theme, description,
            ink_color AS inkColor,
            shadow_css AS shadowCss,
            wall_color AS wallColor,
            header_top_px AS headerTopPx,
            header_left_px AS headerLeftPx,
            header_rotation_deg AS headerRotationDeg,
            plastic_scale_pct AS plasticScalePct,
            plastic_offset_x_px AS plasticOffsetXPx,
            plastic_offset_y_px AS plasticOffsetYPx,
            plastic_blend_mode AS plasticBlendMode,
            lp_size AS lpSize,
            lp_gap AS lpGap,
            upper_lp_x_start AS upperLpXStart,
            lower_lp_x_start AS lowerLpXStart,
            upper_lp_y AS upperLpY,
            lower_lp_y AS lowerLpY,
            title_font_size AS titleFontSize,
            title_rotation_deg AS titleRotationDeg
     FROM home_walls ORDER BY position ASC`
  ) as Array<any>;

  const rows = queryAll(
    `SELECT hf.wall_id AS wallId, hf.position, hf.note,
            a.id AS albumId,
            a.mbid, a.slug, a.title,
            a.artist_name AS artist,
            a.cover_art_url AS coverArtUrl,
            a.cover_art_fallbacks AS coverArtFallbacks,
            a.cover_dominant_color AS coverDominantColor,
            a.spotify_url AS spotifyUrl,
            a.release_date AS releaseDate,
            (SELECT AVG(CASE
                          WHEN COALESCE(r.manual_score, r.score) IS NOT NULL AND r.score_max > 0
                          THEN (COALESCE(r.manual_score, r.score) * 1.0 / r.score_max) * 100
                        END)
             FROM reviews r WHERE r.album_mbid = a.mbid) AS avg_score,
            (SELECT COUNT(*) FROM reviews r
             WHERE r.album_mbid = a.mbid
               AND COALESCE(r.manual_score, r.score) IS NOT NULL
               AND r.score_max > 0) AS review_count
     FROM home_features hf
     JOIN albums a ON a.id = hf.album_id
     ORDER BY hf.wall_id, hf.position ASC`
  );

  // Batch-fetch purchase_links for the listed album IDs and pick the
  // top-1 sticker per album: soldout pushed behind in-stock, then
  // KRW-converted price ascending. Mirrors the home-grid sticker
  // logic in albums.ts so the home wall presents the same "what's
  // the cheapest available copy" answer it has historically.
  const topByAlbumId = new Map<number, any>();
  if (rows.length > 0) {
    const albumIds = rows.map((r: any) => r.albumId);
    const placeholders = albumIds.map(() => '?').join(',');
    const linkRows = queryAll(
      `SELECT album_id, id, url, store_name, store_favicon_url,
              price, currency, format, status
       FROM purchase_links WHERE album_id IN (${placeholders})`,
      albumIds
    );
    if (linkRows.length > 0) {
      const rates = await getRates();
      const allowedStatus = new Set(['upcoming', 'sale', 'soldout']);
      const enriched = linkRows.map((l: any) => ({
        albumId: l.album_id,
        id: l.id,
        url: l.url,
        storeName: l.store_name,
        storeFaviconUrl: l.store_favicon_url,
        price: l.price,
        currency: l.currency,
        priceKrw:
          l.price != null && l.currency
            ? convertToKrwSync(l.price, l.currency, rates)
            : null,
        format: l.format,
        status: allowedStatus.has(l.status) ? l.status : null,
      }));
      const grouped = new Map<number, any[]>();
      for (const link of enriched) {
        const bucket = grouped.get(link.albumId) || [];
        bucket.push(link);
        grouped.set(link.albumId, bucket);
      }
      for (const [aid, links] of grouped) {
        links.sort((a, b) => {
          const aSold = a.status === 'soldout';
          const bSold = b.status === 'soldout';
          if (aSold !== bSold) return aSold ? 1 : -1;
          return (
            (a.priceKrw ?? Number.POSITIVE_INFINITY) -
            (b.priceKrw ?? Number.POSITIVE_INFINITY)
          );
        });
        const top = links[0];
        if (top) {
          // Strip albumId before sending — the client looks up by
          // album.priceTagLinks[0], not by albumId.
          const { albumId: _drop, ...rest } = top;
          topByAlbumId.set(aid, rest);
        }
      }
    }
  }

  // Group features by wall_id. Each wall ends up with its own items[]
  // array (possibly empty for walls that haven't been curated yet).
  const itemsByWallId = new Map<number, any[]>();
  for (const row of rows as any[]) {
    const top = topByAlbumId.get(row.albumId);
    const item = {
      position: row.position,
      note: row.note,
      album: {
        mbid: row.mbid,
        slug: row.slug,
        title: row.title,
        artist: row.artist,
        coverArtUrl: row.coverArtUrl,
        coverArtFallbacks: row.coverArtFallbacks
          ? JSON.parse(row.coverArtFallbacks)
          : [],
        coverDominantColor: row.coverDominantColor ?? null,
        spotifyUrl: row.spotifyUrl ?? null,
        releaseDate: row.releaseDate ?? null,
        averageScore: row.avg_score != null ? Math.round(row.avg_score) : null,
        reviewCount: row.review_count || 0,
        priceTagLinks: top ? [top] : [],
      },
    };
    const bucket = itemsByWallId.get(row.wallId);
    if (bucket) bucket.push(item);
    else itemsByWallId.set(row.wallId, [item]);
  }

  const walls = wallRows.map((w: any) => ({
    id: w.id,
    position: w.position,
    backdropFile: w.backdropFile,
    theme: w.theme ?? null,
    description: w.description ?? null,
    inkColor: w.inkColor,
    shadowCss: w.shadowCss,
    wallColor: w.wallColor,
    headerTopPx: w.headerTopPx ?? 102,
    headerLeftPx: w.headerLeftPx ?? 305,
    headerRotationDeg: w.headerRotationDeg ?? -1,
    plasticScalePct: w.plasticScalePct ?? 15,
    plasticOffsetXPx: w.plasticOffsetXPx ?? 5,
    plasticOffsetYPx: w.plasticOffsetYPx ?? 0,
    plasticBlendMode: w.plasticBlendMode ?? 'normal',
    lpSize: w.lpSize ?? 357,
    lpGap: w.lpGap ?? 30,
    upperLpXStart: w.upperLpXStart ?? 531,
    lowerLpXStart: w.lowerLpXStart ?? 531,
    upperLpY: w.upperLpY ?? 279,
    lowerLpY: w.lowerLpY ?? 752,
    titleFontSize: w.titleFontSize ?? 67,
    titleRotationDeg: w.titleRotationDeg ?? -1,
    items: itemsByWallId.get(w.id) ?? [],
  }));

  res.json({ walls });
});

// Allowed mix-blend-mode values for the plastic overlay. Trimmed to
// the ones that make sense for white-on-transparent shrink-wrap
// textures; anything else (multiply, color-burn, …) reads as a tone
// pass rather than plastic.
const ALLOWED_BLEND_MODES = new Set([
  'normal',
  'screen',
  'soft-light',
  'overlay',
  'lighten',
  'hard-light',
  'plus-lighter',
]);

// Resolve the wall id this admin request operates on. ?wallId=N picks
// a specific wall, defaulting to wall 1 (the original singleton) when
// omitted. Validates that the row actually exists so a typo'd id
// doesn't silently UPDATE / INSERT against nothing.
function resolveWallId(req: { query: { wallId?: unknown } }): number | null {
  const raw = req.query.wallId;
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : 1;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

router.patch('/home/meta', requireAdmin, (req, res) => {
  const wallId = resolveWallId(req);
  if (wallId == null) {
    return res.status(400).json({ error: 'wallId는 양의 정수여야 해요.' });
  }
  const exists = getDb()
    .prepare('SELECT 1 FROM home_walls WHERE id = ?')
    .get(wallId);
  if (!exists) {
    return res.status(404).json({ error: `wall id=${wallId} 없음.` });
  }
  const body = (req.body ?? {}) as {
    theme?: unknown;
    description?: unknown;
    headerTopPx?: unknown;
    headerLeftPx?: unknown;
    headerRotationDeg?: unknown;
    plasticScalePct?: unknown;
    plasticOffsetXPx?: unknown;
    plasticOffsetYPx?: unknown;
    plasticBlendMode?: unknown;
    lpSize?: unknown;
    lpGap?: unknown;
    upperLpXStart?: unknown;
    lowerLpXStart?: unknown;
    upperLpY?: unknown;
    lowerLpY?: unknown;
    titleFontSize?: unknown;
    titleRotationDeg?: unknown;
  };
  // Each field is treated as "don't touch" when missing rather than
  // "clear to null"; the editor only sends the fields that actually
  // changed (matches the mydig vinyl-wall/theme PATCH behaviour).
  const sets: string[] = [];
  const args: any[] = [];
  if ('theme' in body) {
    sets.push('theme = ?');
    args.push(
      typeof body.theme === 'string' ? body.theme.slice(0, 80) : null
    );
  }
  if ('description' in body) {
    sets.push('description = ?');
    args.push(
      typeof body.description === 'string'
        ? body.description.slice(0, 240)
        : null
    );
  }
  // Position knobs — clamped to a sensible range so a stray giant
  // value can't push the header into orbit, but wide enough that the
  // admin can move it freely within and around the wall area.
  const clampInt = (v: unknown, min: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return Math.max(min, Math.min(max, Math.round(v)));
  };
  if ('headerTopPx' in body) {
    const v = clampInt(body.headerTopPx, -800, 800);
    if (v === null) {
      return res.status(400).json({ error: 'headerTopPx는 정수여야 해요.' });
    }
    sets.push('header_top_px = ?');
    args.push(v);
  }
  if ('headerLeftPx' in body) {
    const v = clampInt(body.headerLeftPx, -800, 1200);
    if (v === null) {
      return res.status(400).json({ error: 'headerLeftPx는 정수여야 해요.' });
    }
    sets.push('header_left_px = ?');
    args.push(v);
  }
  if ('headerRotationDeg' in body) {
    const v = clampInt(body.headerRotationDeg, -45, 45);
    if (v === null) {
      return res.status(400).json({ error: 'headerRotationDeg는 정수(-45~45)여야 해요.' });
    }
    sets.push('header_rotation_deg = ?');
    args.push(v);
  }
  if ('plasticScalePct' in body) {
    const v = clampInt(body.plasticScalePct, 0, 50);
    if (v === null) {
      return res.status(400).json({ error: 'plasticScalePct는 0-50 정수여야 해요.' });
    }
    sets.push('plastic_scale_pct = ?');
    args.push(v);
  }
  if ('plasticOffsetXPx' in body) {
    const v = clampInt(body.plasticOffsetXPx, -50, 50);
    if (v === null) {
      return res.status(400).json({ error: 'plasticOffsetXPx는 -50~50 정수여야 해요.' });
    }
    sets.push('plastic_offset_x_px = ?');
    args.push(v);
  }
  if ('plasticOffsetYPx' in body) {
    const v = clampInt(body.plasticOffsetYPx, -50, 50);
    if (v === null) {
      return res.status(400).json({ error: 'plasticOffsetYPx는 -50~50 정수여야 해요.' });
    }
    sets.push('plastic_offset_y_px = ?');
    args.push(v);
  }
  if ('plasticBlendMode' in body) {
    const raw = body.plasticBlendMode;
    if (typeof raw !== 'string' || !ALLOWED_BLEND_MODES.has(raw)) {
      return res.status(400).json({
        error: `plasticBlendMode는 [${Array.from(ALLOWED_BLEND_MODES).join(', ')}] 중 하나여야 해요.`,
      });
    }
    sets.push('plastic_blend_mode = ?');
    args.push(raw);
  }
  // Hero LP / title tuner — accept the same shape the in-page
  // tuner panel posts. Each clamped to keep stray slider values
  // (or a malicious payload) inside reasonable image-coord bounds.
  const heroFields: Array<{
    key: keyof typeof body;
    column: string;
    min: number;
    max: number;
  }> = [
    { key: 'lpSize', column: 'lp_size', min: 50, max: 800 },
    { key: 'lpGap', column: 'lp_gap', min: 0, max: 200 },
    { key: 'upperLpXStart', column: 'upper_lp_x_start', min: 0, max: 4000 },
    { key: 'lowerLpXStart', column: 'lower_lp_x_start', min: 0, max: 4000 },
    { key: 'upperLpY', column: 'upper_lp_y', min: 0, max: 2000 },
    { key: 'lowerLpY', column: 'lower_lp_y', min: 0, max: 2000 },
    { key: 'titleFontSize', column: 'title_font_size', min: 12, max: 200 },
    { key: 'titleRotationDeg', column: 'title_rotation_deg', min: -45, max: 45 },
  ];
  for (const f of heroFields) {
    if (f.key in body) {
      const v = clampInt(body[f.key], f.min, f.max);
      if (v === null) {
        return res.status(400).json({ error: `${f.key}는 정수여야 해요.` });
      }
      sets.push(`${f.column} = ?`);
      args.push(v);
    }
  }
  if (sets.length === 0) {
    return res.json({ ok: true });
  }
  sets.push("updated_at = datetime('now')");
  const db = getDb();
  db.prepare(
    `UPDATE home_walls SET ${sets.join(', ')} WHERE id = ?`
  ).run(...args, wallId);
  res.json({ ok: true });
});

// Swap a wall's position with its left or right neighbour. Atomic
// via better-sqlite3's `transaction` helper so a UNIQUE-position
// collision can't surface a half-applied swap; the temp -1 step is
// what lets two walls trade positions without violating the
// composite UNIQUE constraint mid-update.
router.post('/home/walls/:id/move', requireAdmin, (req, res) => {
  const idRaw = req.params.id;
  const id = Number.parseInt(typeof idRaw === 'string' ? idRaw : '', 10);
  const dir = req.query.dir;
  if (!Number.isFinite(id) || (dir !== 'left' && dir !== 'right')) {
    return res
      .status(400)
      .json({ error: 'id 정수 + dir=left|right 가 필요해요.' });
  }
  const db = getDb();
  const wall = db
    .prepare('SELECT id, position FROM home_walls WHERE id = ?')
    .get(id) as { id: number; position: number } | undefined;
  if (!wall) {
    return res.status(404).json({ error: `wall id=${id} 없음.` });
  }
  const targetPos = dir === 'left' ? wall.position - 1 : wall.position + 1;
  const neighbor = db
    .prepare('SELECT id, position FROM home_walls WHERE position = ?')
    .get(targetPos) as { id: number; position: number } | undefined;
  if (!neighbor) {
    // At the boundary — nothing to swap with. Treat as a no-op so
    // a click on the disabled-but-still-reachable arrow doesn't
    // 4xx; the client should also gate the button on activeIdx.
    return res.json({ ok: true, moved: false });
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE home_walls SET position = -1 WHERE id = ?').run(wall.id);
    db.prepare('UPDATE home_walls SET position = ? WHERE id = ?').run(
      wall.position,
      neighbor.id
    );
    db.prepare('UPDATE home_walls SET position = ? WHERE id = ?').run(
      neighbor.position,
      wall.id
    );
  });
  tx();
  res.json({ ok: true, moved: true, newPosition: neighbor.position });
});

router.put('/home/features/items', requireAdmin, (req, res) => {
  const wallId = resolveWallId(req);
  if (wallId == null) {
    return res.status(400).json({ error: 'wallId는 양의 정수여야 해요.' });
  }
  const exists = getDb()
    .prepare('SELECT 1 FROM home_walls WHERE id = ?')
    .get(wallId);
  if (!exists) {
    return res.status(404).json({ error: `wall id=${wallId} 없음.` });
  }
  const body = (req.body ?? {}) as { items?: unknown };
  if (!Array.isArray(body.items)) {
    return res.status(400).json({ error: 'items array 필요' });
  }

  // Accepts mbid OR slug as the album identifier, matching the
  // slug-or-mbid convention used by resolveAlbumId / album-page
  // routing. /api/albums/search collapses both into a single field
  // (slug || mbid) so the admin picker can pass that straight
  // through; we resolve to album_id before the transaction starts.
  type Raw = { position: number; mbid: string; note: string | null };
  const normalised: Raw[] = [];
  const seenPositions = new Set<number>();
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object') continue;
    const position = (raw as any).position;
    const mbid = (raw as any).mbid;
    const noteRaw = (raw as any).note;
    if (!Number.isInteger(position) || position < 0 || position >= 15) {
      return res.status(400).json({ error: `position은 0-14 정수여야 해요 (${position})` });
    }
    if (typeof mbid !== 'string' || mbid.trim().length === 0) {
      return res.status(400).json({ error: 'mbid가 잘못되었어요.' });
    }
    if (seenPositions.has(position)) {
      return res.status(400).json({ error: `중복된 position ${position}` });
    }
    const note =
      typeof noteRaw === 'string' && noteRaw.trim().length > 0
        ? noteRaw.trim().slice(0, 200)
        : null;
    seenPositions.add(position);
    normalised.push({ position, mbid: mbid.trim(), note });
  }

  const db = getDb();
  const findId = db.prepare(
    'SELECT id FROM albums WHERE mbid = ? OR slug = ?'
  );
  const resolved: Array<{ position: number; albumId: number; note: string | null }> = [];
  for (const it of normalised) {
    const row = findId.get(it.mbid, it.mbid) as { id: number } | undefined;
    if (!row) {
      return res.status(400).json({ error: `알 수 없는 앨범: ${it.mbid}` });
    }
    resolved.push({ position: it.position, albumId: row.id, note: it.note });
  }

  const tx = db.transaction((items: typeof resolved) => {
    db.prepare('DELETE FROM home_features WHERE wall_id = ?').run(wallId);
    const insert = db.prepare(
      `INSERT INTO home_features (wall_id, album_id, position, note)
       VALUES (?, ?, ?, ?)`
    );
    for (const it of items) insert.run(wallId, it.albumId, it.position, it.note);
  });

  try {
    tx(resolved);
    res.json({ ok: true, count: resolved.length });
  } catch (err) {
    console.error('[home/features] replace failed:', err);
    res.status(500).json({ error: 'Feature Records 저장 실패' });
  }
});

export default router;
