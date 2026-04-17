import { Router } from 'express';
import { queryGet, queryAll, execute } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveAlbumPk } from '../utils/slug.js';
import { convertToKrw, getRates, convertToKrwSync } from '../services/exchangeRates.js';

const router = Router();

const ALLOWED_CURRENCIES = new Set(['USD', 'JPY', 'GBP', 'EUR', 'KRW']);
const ALLOWED_FORMATS = new Set(['Vinyl', 'CD', 'Cassette', 'Box', 'Other']);
const ALLOWED_STATUSES = new Set(['upcoming', 'sale', 'soldout']);
const ALLOWED_REPORT_REASONS = new Set(['soldout', 'price', 'expired']);

// Per-user cap on purchase-link submissions, scoped to a single album.
// Keeps one user from flooding one album's listings while still letting
// them seed other albums they care about. Admin bypasses this cap.
const MAX_LINKS_PER_USER_PER_ALBUM = 3;

function normalizeStatus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return ALLOWED_STATUSES.has(v) ? v : null;
}

const STORE_RULES: Array<{ match: RegExp; name: string }> = [
  { match: /discogs\.com/i, name: 'Discogs' },
  { match: /bandcamp\.com/i, name: 'Bandcamp' },
  { match: /amazon\.co\.jp/i, name: 'Amazon Japan' },
  { match: /amazon\./i, name: 'Amazon' },
  { match: /hmv\.co\.jp/i, name: 'HMV Japan' },
  { match: /hmv\./i, name: 'HMV' },
  { match: /towerrecords\.(com|co\.jp)/i, name: 'Tower Records' },
];

function detectStore(url: string): { name: string; faviconUrl: string } {
  let hostname = '';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    hostname = '';
  }

  let name = hostname || 'Other';
  for (const rule of STORE_RULES) {
    if (rule.match.test(url)) {
      name = rule.name;
      break;
    }
  }

  const faviconUrl = hostname
    ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`
    : '';

  return { name, faviconUrl };
}

// GET /api/albums/:id/purchase-links (public)
router.get('/albums/:id/purchase-links', async (req, res) => {
  const albumPk = resolveAlbumPk((req.params.id as string));
  if (!albumPk) return res.status(404).json({ error: 'Album not found' });

  const rows = queryAll(
    `SELECT pl.id, pl.url, pl.store_name, pl.store_favicon_url, pl.price, pl.currency,
            pl.format, pl.note, pl.status, pl.user_id, pl.created_at,
            u.name AS user_name, u.avatar_url AS user_avatar
     FROM purchase_links pl
     LEFT JOIN users u ON u.id = pl.user_id
     WHERE pl.album_id = ?
     ORDER BY pl.created_at DESC`,
    [albumPk]
  );

  const rates = await getRates();
  const enriched = rows.map((r: any) => ({
    id: r.id,
    url: r.url,
    storeName: r.store_name,
    storeFaviconUrl: r.store_favicon_url,
    price: r.price,
    currency: r.currency,
    priceKrw:
      r.price != null && r.currency
        ? convertToKrwSync(r.price, r.currency, rates)
        : null,
    format: r.format,
    note: r.note,
    status: normalizeStatus(r.status),
    userId: r.user_id,
    userName: r.user_name,
    userAvatar: r.user_avatar,
    createdAt: r.created_at,
  }));

  res.json({ purchaseLinks: enriched });
});

// POST /api/albums/:id/purchase-links (logged-in users; non-admins
// capped at MAX_LINKS_PER_USER_PER_ALBUM on this album).
router.post('/albums/:id/purchase-links', requireAuth, async (req, res) => {
  const user = req.user!;
  const albumPk = resolveAlbumPk((req.params.id as string));
  if (!albumPk) return res.status(404).json({ error: 'Album not found' });

  // Per-album spam cap. Admin bypass — they seed most canonical
  // listings so the cap would get in the way of routine curation.
  if (!user.is_admin) {
    const count = queryGet(
      `SELECT COUNT(*) AS n FROM purchase_links
       WHERE album_id = ? AND user_id = ?`,
      [albumPk, user.id]
    ) as { n: number };
    if (count.n >= MAX_LINKS_PER_USER_PER_ALBUM) {
      return res.status(409).json({
        error: `이 앨범에는 이미 ${MAX_LINKS_PER_USER_PER_ALBUM}개의 구매처를 등록하셨어요.`,
      });
    }
  }

  const { url, price, currency, format, note, status } = req.body as {
    url?: string;
    price?: number;
    currency?: string;
    format?: string;
    note?: string;
    status?: string;
  };

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'URL must be http(s)' });
  }

  const priceNum = typeof price === 'number' && isFinite(price) && price >= 0 ? price : null;
  const currencyNorm = currency && ALLOWED_CURRENCIES.has(currency) ? currency : 'USD';
  const formatNorm = format && ALLOWED_FORMATS.has(format) ? format : null;
  const noteNorm =
    typeof note === 'string' && note.trim().length > 0
      ? note.trim().slice(0, 200)
      : null;

  const { name: storeName, faviconUrl } = detectStore(url);
  const statusNorm = normalizeStatus(status);

  try {
    execute(
      `INSERT INTO purchase_links
       (album_id, user_id, url, store_name, store_favicon_url, price, currency, format, note, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [albumPk, user.id, url, storeName, faviconUrl, priceNum, currencyNorm, formatNorm, noteNorm, statusNorm]
    );
    const row = queryGet(
      `SELECT * FROM purchase_links WHERE rowid = last_insert_rowid()`
    );
    const priceKrw =
      row.price != null && row.currency
        ? await convertToKrw(row.price, row.currency)
        : null;
    res.json({
      purchaseLink: {
        id: row.id,
        url: row.url,
        storeName: row.store_name,
        storeFaviconUrl: row.store_favicon_url,
        price: row.price,
        currency: row.currency,
        priceKrw,
        format: row.format,
        note: row.note,
        status: normalizeStatus(row.status),
        userId: row.user_id,
        userName: user.name,
        userAvatar: user.avatar_url,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    console.error('[purchase-links] insert failed:', err);
    res.status(500).json({ error: 'Failed to save purchase link' });
  }
});

// PATCH /api/purchase-links/:id (owner or admin) — partial update
router.patch('/purchase-links/:id', requireAuth, async (req, res) => {
  const user = req.user!;
  const linkId = parseInt((req.params.id as string), 10);
  if (isNaN(linkId)) return res.status(400).json({ error: 'Invalid id' });

  const existing = queryGet(`SELECT * FROM purchase_links WHERE id = ?`, [linkId]);
  if (!existing) return res.status(404).json({ error: 'Link not found' });
  if (existing.user_id !== user.id && !user.is_admin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const body = req.body as Record<string, unknown>;
  const sets: string[] = [];
  const values: any[] = [];

  if (typeof body.url === 'string') {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(body.url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return res.status(400).json({ error: 'URL must be http(s)' });
    }
    const { name: storeName, faviconUrl } = detectStore(body.url);
    sets.push('url = ?', 'store_name = ?', 'store_favicon_url = ?');
    values.push(body.url, storeName, faviconUrl);
  }

  if ('price' in body) {
    const p = body.price;
    const priceNum = typeof p === 'number' && isFinite(p) && p >= 0 ? p : null;
    sets.push('price = ?');
    values.push(priceNum);
  }

  if ('currency' in body) {
    const c = body.currency;
    const norm = typeof c === 'string' && ALLOWED_CURRENCIES.has(c) ? c : 'USD';
    sets.push('currency = ?');
    values.push(norm);
  }

  if ('format' in body) {
    const f = body.format;
    const norm = typeof f === 'string' && ALLOWED_FORMATS.has(f) ? f : null;
    sets.push('format = ?');
    values.push(norm);
  }

  if ('note' in body) {
    const n = body.note;
    const norm =
      typeof n === 'string' && n.trim().length > 0 ? n.trim().slice(0, 200) : null;
    sets.push('note = ?');
    values.push(norm);
  }

  if ('status' in body) {
    sets.push('status = ?');
    values.push(normalizeStatus(body.status));
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  try {
    values.push(linkId);
    execute(`UPDATE purchase_links SET ${sets.join(', ')} WHERE id = ?`, values);
    const row = queryGet(
      `SELECT pl.*, u.name AS user_name, u.avatar_url AS user_avatar
       FROM purchase_links pl LEFT JOIN users u ON u.id = pl.user_id
       WHERE pl.id = ?`,
      [linkId]
    );
    const priceKrw =
      row.price != null && row.currency
        ? await convertToKrw(row.price, row.currency)
        : null;
    res.json({
      purchaseLink: {
        id: row.id,
        url: row.url,
        storeName: row.store_name,
        storeFaviconUrl: row.store_favicon_url,
        price: row.price,
        currency: row.currency,
        priceKrw,
        format: row.format,
        note: row.note,
        status: normalizeStatus(row.status),
        userId: row.user_id,
        userName: row.user_name,
        userAvatar: row.user_avatar,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    console.error('[purchase-links] update failed:', err);
    res.status(500).json({ error: 'Failed to update purchase link' });
  }
});

// DELETE /api/purchase-links/:id (owner or admin)
router.delete('/purchase-links/:id', requireAuth, (req, res) => {
  const user = req.user!;
  const linkId = parseInt((req.params.id as string), 10);
  if (isNaN(linkId)) return res.status(400).json({ error: 'Invalid id' });

  const link = queryGet(`SELECT user_id FROM purchase_links WHERE id = ?`, [linkId]);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  if (link.user_id !== user.id && !user.is_admin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  execute(`DELETE FROM purchase_links WHERE id = ?`, [linkId]);
  res.json({ ok: true });
});

// POST /api/purchase-links/:id/report (logged-in users)
//
// Flags a link with one of the three fixed reasons (soldout / price /
// expired). A user can't report their own link, and the UNIQUE
// (link_id, user_id) constraint stops repeat reports from the same
// person — they'd need to dismiss+re-report if they want a different
// reason. Admin polls these via /api/admin/purchase-link-reports.
router.post('/purchase-links/:id/report', requireAuth, (req, res) => {
  const user = req.user!;
  const linkId = parseInt((req.params.id as string), 10);
  if (isNaN(linkId)) return res.status(400).json({ error: 'Invalid id' });

  const link = queryGet(
    `SELECT user_id FROM purchase_links WHERE id = ?`,
    [linkId]
  ) as { user_id: number | null } | null;
  if (!link) return res.status(404).json({ error: 'Link not found' });
  if (link.user_id === user.id) {
    return res.status(400).json({ error: '본인이 등록한 링크는 신고할 수 없습니다.' });
  }

  const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
  if (!ALLOWED_REPORT_REASONS.has(reason)) {
    return res.status(400).json({ error: 'Invalid reason' });
  }

  try {
    execute(
      `INSERT INTO purchase_link_reports (link_id, user_id, reason)
       VALUES (?, ?, ?)`,
      [linkId, user.id, reason]
    );
    res.json({ ok: true });
  } catch (err: any) {
    // UNIQUE(link_id, user_id) collision — treat as idempotent success
    // from the client's POV, the first report already exists.
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '이미 신고한 링크입니다.' });
    }
    console.error('[purchase-links/report] insert failed:', err);
    res.status(500).json({ error: 'Failed to save report' });
  }
});

// GET /api/admin/purchase-link-reports (admin)
//
// Returns every open report, joined with link + album + reporter info
// so the admin dashboard renders one row per report with enough
// context to decide dismiss-vs-delete without a follow-up query.
router.get('/admin/purchase-link-reports', requireAuth, (req, res) => {
  const user = req.user!;
  if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' });

  const rows = queryAll(
    `SELECT r.id, r.reason, r.created_at,
            r.link_id,
            pl.url AS link_url, pl.store_name AS link_store,
            pl.price AS link_price, pl.currency AS link_currency,
            pl.status AS link_status,
            a.id AS album_id, a.slug AS album_slug, a.mbid AS album_mbid,
            a.title AS album_title, a.artist_name AS album_artist,
            r.user_id AS reporter_id,
            COALESCE(ru.display_name, ru.name) AS reporter_name,
            pl.user_id AS link_user_id,
            COALESCE(lu.display_name, lu.name) AS link_user_name
     FROM purchase_link_reports r
     INNER JOIN purchase_links pl ON pl.id = r.link_id
     INNER JOIN albums a ON a.id = pl.album_id
     LEFT JOIN users ru ON ru.id = r.user_id
     LEFT JOIN users lu ON lu.id = pl.user_id
     ORDER BY r.created_at DESC`
  ) as Array<{
    id: number;
    reason: 'soldout' | 'price' | 'expired';
    created_at: string;
    link_id: number;
    link_url: string;
    link_store: string | null;
    link_price: number | null;
    link_currency: string | null;
    link_status: string | null;
    album_id: number;
    album_slug: string | null;
    album_mbid: string | null;
    album_title: string;
    album_artist: string | null;
    reporter_id: number | null;
    reporter_name: string | null;
    link_user_id: number | null;
    link_user_name: string | null;
  }>;

  res.json({
    reports: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      createdAt: r.created_at,
      linkId: r.link_id,
      linkUrl: r.link_url,
      linkStore: r.link_store,
      linkPrice: r.link_price,
      linkCurrency: r.link_currency,
      linkStatus: normalizeStatus(r.link_status),
      albumSlug: r.album_slug || r.album_mbid || '',
      albumTitle: r.album_title,
      albumArtist: r.album_artist,
      reporterId: r.reporter_id,
      reporterName: r.reporter_name,
      linkUserId: r.link_user_id,
      linkUserName: r.link_user_name,
    })),
  });
});

// DELETE /api/admin/purchase-link-reports/:id (admin) — dismiss one
// specific report without touching the underlying link. Used when a
// report is false-positive and the link is still valid.
router.delete('/admin/purchase-link-reports/:id', requireAuth, (req, res) => {
  const user = req.user!;
  if (!user.is_admin) return res.status(403).json({ error: 'Forbidden' });

  const reportId = parseInt((req.params.id as string), 10);
  if (isNaN(reportId)) return res.status(400).json({ error: 'Invalid id' });

  const row = queryGet(
    `SELECT id FROM purchase_link_reports WHERE id = ?`,
    [reportId]
  );
  if (!row) return res.status(404).json({ error: 'Report not found' });

  execute(`DELETE FROM purchase_link_reports WHERE id = ?`, [reportId]);
  res.json({ ok: true });
});

export default router;
