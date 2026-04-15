import { Router } from 'express';
import { queryAll } from '../db/index.js';

const router = Router();

const SITE_ORIGIN = 'https://dig.haus';

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) => {
    switch (ch) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
      default: return ch;
    }
  });
}

router.get('/sitemap.xml', (_req, res) => {
  try {
    const rows = queryAll(
      `SELECT slug, mbid, updated_at FROM albums
       WHERE COALESCE(slug, mbid) IS NOT NULL
       ORDER BY updated_at DESC`
    ) as Array<{ slug: string | null; mbid: string; updated_at: string | null }>;

    const urls: string[] = [];
    urls.push(`<url><loc>${SITE_ORIGIN}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`);

    for (const row of rows) {
      const id = row.slug || row.mbid;
      if (!id) continue;
      const loc = `${SITE_ORIGIN}/album/${escapeXml(id)}`;
      const lastmod = row.updated_at
        ? `<lastmod>${escapeXml(row.updated_at.replace(' ', 'T'))}Z</lastmod>`
        : '';
      urls.push(`<url><loc>${loc}</loc>${lastmod}<changefreq>weekly</changefreq><priority>0.8</priority></url>`);
    }

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join('\n') +
      '\n</urlset>\n';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    console.error('[sitemap] generation failed:', err);
    res.status(500).send('Failed to generate sitemap');
  }
});

export default router;
