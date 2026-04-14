import { Router } from 'express';
import { queryGet, queryAll, execute } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { resolveAlbumPk } from '../utils/slug.js';
import { convertToKrw } from '../services/exchangeRates.js';

const router = Router();

const ALLOWED_CURRENCIES = new Set(['USD', 'JPY', 'GBP', 'EUR', 'KRW']);
const ALLOWED_FORMATS = new Set(['Vinyl', 'CD', 'Cassette', 'Box', 'Other']);

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
            pl.format, pl.note, pl.user_id, pl.created_at,
            u.name AS user_name, u.avatar_url AS user_avatar
     FROM purchase_links pl
     LEFT JOIN users u ON u.id = pl.user_id
     WHERE pl.album_id = ?
     ORDER BY pl.created_at DESC`,
    [albumPk]
  );

  const enriched = await Promise.all(
    rows.map(async (r: any) => {
      const priceKrw =
        r.price != null && r.currency
          ? await convertToKrw(r.price, r.currency)
          : null;
      return {
        id: r.id,
        url: r.url,
        storeName: r.store_name,
        storeFaviconUrl: r.store_favicon_url,
        price: r.price,
        currency: r.currency,
        priceKrw,
        format: r.format,
        note: r.note,
        userId: r.user_id,
        userName: r.user_name,
        userAvatar: r.user_avatar,
        createdAt: r.created_at,
      };
    })
  );

  res.json({ purchaseLinks: enriched });
});

// POST /api/albums/:id/purchase-links (admin only)
router.post('/albums/:id/purchase-links', requireAdmin, async (req, res) => {
  const user = req.user!;
  const albumPk = resolveAlbumPk((req.params.id as string));
  if (!albumPk) return res.status(404).json({ error: 'Album not found' });

  const { url, price, currency, format, note } = req.body as {
    url?: string;
    price?: number;
    currency?: string;
    format?: string;
    note?: string;
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

  try {
    execute(
      `INSERT INTO purchase_links
       (album_id, user_id, url, store_name, store_favicon_url, price, currency, format, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [albumPk, user.id, url, storeName, faviconUrl, priceNum, currencyNorm, formatNorm, noteNorm]
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

// DELETE /api/purchase-links/:id (owner only)
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

export default router;
