import { Router } from 'express';
import axios from 'axios';
import https from 'https';
import rateLimit from 'express-rate-limit';

// Rate limiter for admin endpoints that call Claude or scrape external pages.
// 20 calls per minute per IP — generous for legit admin work, blocks runaway loops.
const adminClaudeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many admin requests, slow down.' },
});

const httpsAgent = new https.Agent({ family: 4 });
import { getRelease, getLabelByName, getArtistReleases, searchAlbums } from '../services/musicbrainz.js';
import { searchTrack } from '../services/spotify.js';
import { searchVideo } from '../services/youtube.js';
import { searchBandcamp } from '../services/bandcamp.js';
import { searchRelease, searchMasterUrl, getMasterMarketData, getDiscogsReleaseDetail, getDiscogsArtistReleases } from '../services/discogs.js';
import { getAlbumInfo, getSimilarAlbums } from '../services/lastfm.js';
import { searchReviews, scrapeReviewFromUrl } from '../services/reviews.js';
import { generateSimilarDescriptions, generatePronunciation, getClient as getAnthropicClient } from '../services/claude.js';
import { hostCustomCover, CustomCoverError } from '../services/customCoverHost.js';
import {
  getCachedAlbum,
  cacheAlbum,
  updateAlbumFields,
  getCachedReviews,
  cacheReviews,
} from '../utils/cache.js';
import { execute, queryAll, queryGet, transaction } from '../db/index.js';
import { generateSlug, resolveAlbumId } from '../utils/slug.js';
import { requireAdmin } from '../middleware/auth.js';
import { convertToKrw, convertToUsd, getRates, convertToKrwSync, convertToUsdSync } from '../services/exchangeRates.js';
import { searchAlbumsInDb } from '../utils/albumSearch.js';

const router = Router();

// Broad/useless tags to exclude
const EXCLUDED_TAGS = new Set([
  'rock', 'pop', 'electronic', 'music', 'hip hop', 'hip-hop',
  'r&b', 'classical', 'soundtrack', 'vocal', 'spoken word',
  'rock music', 'pop music', 'electronic music',
  'new release', 'new', 'release', 'album', 'single',
]);

// Known short genre names to keep (3 chars or less)
const VALID_SHORT_GENRES = new Set([
  'emo', 'edm', 'rap', 'ska', 'dub', 'rnb',
]);

// Known short genre names to keep (4-5 chars)
const VALID_MID_GENRES = new Set([
  'jazz', 'soul', 'funk', 'punk', 'doom', 'folk', 'goth',
  'trap', 'wave', 'core', 'math', 'post', 'prog', 'surf',
  'noise', 'drone', 'lo-fi', 'lofi', 'grind', 'crust',
  'djent', 'sludge', 'metal', 'blues', 'indie', 'house',
  'techno', 'disco', 'salsa', 'bossa', 'swing', 'opera',
]);

function cleanGenres(raw: string[], artistName?: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const artistLower = (artistName || '').toLowerCase().trim();

  for (const tag of raw) {
    const lower = tag.toLowerCase().trim();
    if (!lower) continue;
    if (seen.has(lower)) continue;
    if (EXCLUDED_TAGS.has(lower)) continue;
    // Filter artist name as tag
    if (artistLower && lower === artistLower) continue;
    // Filter anything with digits (years, dates like "4-25", "2026")
    if (/\d/.test(lower)) continue;
    // Filter 3 chars or less unless in whitelist
    if (lower.length <= 3 && !VALID_SHORT_GENRES.has(lower)) continue;
    // Filter 4-5 chars unless in whitelist or compound genre (contains space/hyphen)
    if (lower.length <= 5 && !VALID_MID_GENRES.has(lower) && !/[\s-]/.test(lower)) continue;
    // Filter "X music" pattern
    if (lower.endsWith(' music')) continue;

    seen.add(lower);
    const titleCased = lower.replace(/\b\w/g, (c) => c.toUpperCase());
    result.push(titleCased);
  }

  // Sort: longer (more specific) tags first
  result.sort((a, b) => b.length - a.length);

  return result.slice(0, 5);
}

// ─── Helper: build album base data (fast path) ─────────────────────────────

async function getOrFetchAlbumBase(mbid: string) {
  let cached = getCachedAlbum(mbid);

  if (cached && cached.updated_at) {
    const genres = cached.genres ? JSON.parse(cached.genres) : [];
    const cachedFallbacks = cached.cover_art_fallbacks
      ? JSON.parse(cached.cover_art_fallbacks) : [];

    let buyData = {
      discogsUrl: cached.discogs_url,
      formats: cached.discogs_formats_json ? JSON.parse(cached.discogs_formats_json) : [],
      bandcampUrl: cached.bandcamp_url,
    };

    // Backfill release_date if missing — fire and forget
    if (!cached.release_date && cached.mbid && !cached.mbid.startsWith('discogs-')) {
      getRelease(cached.mbid).then((mb) => {
        if (mb?.date) updateAlbumFields(mbid, { release_date: mb.date });
      }).catch((err) => {
        console.warn(`[backfill] release_date failed for mbid=${mbid}:`, (err as Error).message);
      });
    }

    // Refresh Discogs prices if stale (>24h) — fire and forget
    const formatsUpdatedAt = cached.discogs_formats_updated_at;
    const formatsStale = !formatsUpdatedAt ||
      (Date.now() - new Date(formatsUpdatedAt).getTime()) > 6 * 60 * 60 * 1000;
    if (formatsStale && cached.artist_name && cached.title) {
      getMasterMarketData(cached.artist_name, cached.title).then((fresh) => {
        if (fresh && fresh.formats.length > 0) {
          updateAlbumFields(mbid, {
            discogs_url: fresh.discogsUrl,
            discogs_formats_json: JSON.stringify(fresh.formats),
            discogs_formats_updated_at: new Date().toISOString(),
          });
        }
      }).catch((err) => {
        console.warn(`[backfill] Discogs price refresh failed for mbid=${mbid}:`, (err as Error).message);
      });
    }

    // Fill title_meaning if missing (backfill for cached albums)
    // "_none_" marks albums where meaning was attempted but empty (prevents re-calling)
    let titleMeaning = cached.title_meaning || null;
    if (titleMeaning === '_none_') titleMeaning = null;

    if (!cached.title_meaning && cached.title && cached.artist_name) {
      try {
        const pron = await generatePronunciation(cached.artist_name, cached.title);
        const fields: Record<string, any> = {};
        if (pron?.titleMeaning) {
          titleMeaning = pron.titleMeaning;
          fields.title_meaning = titleMeaning;
        } else {
          fields.title_meaning = '_none_'; // mark as attempted
        }
        if (!cached.artist_ko && pron?.artistKo) fields.artist_ko = pron.artistKo;
        if (!cached.title_ko && pron?.titleKo) fields.title_ko = pron.titleKo;
        updateAlbumFields(mbid, fields);
      } catch (err) {
        console.warn(`[pronunciation] backfill failed for mbid=${mbid}:`, (err as Error).message);
      }
    }

    return {
      album: {
        mbid: cached.mbid,
        slug: cached.slug || null,
        title: cached.title,
        artist: cached.artist_name,
        artistMbid: cached.artist_mbid,
        releaseDate: cached.release_date || cached.release_year?.toString() || '',
        label: cached.label_name,
        genres: cleanGenres(genres, cached.artist_name),
        coverArtUrl: cached.cover_art_url,
        coverArtFallbacks: cachedFallbacks,
        artistKo: cached.artist_ko || null,
        titleKo: cached.title_ko || null,
        titleMeaning,
      },
      streaming: {
        spotify: cached.spotify_url,
        appleMusic: cached.apple_music_url,
        appleMusicEmbedUrl: cached.apple_music_embed_url || null,
        youtube: cached.youtube_url,
        bandcamp: cached.bandcamp_url,
      },
      buy: buyData,
      discography: [] as any[],
      artistName: cached.artist_name || '',
      albumTitle: cached.title || '',
      discogsArtistId: cached.discogs_artist_id || null,
    };
  }

  // Fresh fetch — determine source: MusicBrainz or Discogs
  const isDiscogs = mbid.startsWith('discogs-');
  let artistName = '';
  let albumTitle = '';
  let labelName = '';
  let releaseDate = ''; // full date "YYYY-MM-DD" or "YYYY"
  let format = '';
  let genres: string[] = [];
  let primaryCoverArtUrl = '';
  let artistMbid: string | null = null;
  let discogsArtistId: number | null = null;

  if (isDiscogs) {
    const discogsId = parseInt(mbid.replace('discogs-', ''), 10);
    const detail = await getDiscogsReleaseDetail(discogsId);
    if (!detail) return null;

    artistName = detail.artist;
    albumTitle = detail.title;
    labelName = detail.label;
    releaseDate = detail.releaseDate || detail.year;
    discogsArtistId = detail.artistId;
    format = detail.format;
    genres = detail.genres;
    primaryCoverArtUrl = detail.coverArtUrl;
  } else {
    const mbRelease = await getRelease(mbid);
    if (!mbRelease) return null;

    artistName = mbRelease.artist || '';
    albumTitle = mbRelease.title || '';
    const mbLabel = mbRelease.labels?.[0]?.name || '';
    labelName = (mbLabel && mbLabel !== '[no label]') ? mbLabel : '';
    releaseDate = mbRelease.date || mbRelease.year || '';
    format = mbRelease.media?.[0]?.format || '';
    genres = mbRelease.genres || [];
    primaryCoverArtUrl = mbRelease.coverArtUrl || '';
    artistMbid = mbRelease.artistMbid || null;
  }

  // Fetch links + metadata in parallel
  const [
    spotifyFetch, appleMusicFetch, youtubeFetch,
    bandcampFetch, discogsFetch, lastfmFetch,
  ] = await Promise.allSettled([
    searchTrack(artistName, albumTitle),
    axios.get('https://itunes.apple.com/search', {
      params: { term: `${artistName} ${albumTitle}`, entity: 'album', limit: 1 },
      httpsAgent, timeout: 5000,
    }).then((r) => {
      const result = r.data?.results?.[0];
      return { url: result?.collectionViewUrl || null, collectionId: result?.collectionId || null };
    }),
    searchVideo(artistName, albumTitle),
    searchBandcamp(artistName, albumTitle),
    isDiscogs ? Promise.resolve(null) : searchRelease(artistName, albumTitle),
    getAlbumInfo(artistName, albumTitle),
  ]);

  const spotifyResult = spotifyFetch.status === 'fulfilled' ? spotifyFetch.value : null;
  const spotifyUrl = spotifyResult?.url || null;
  const spotifyImageUrl = spotifyResult?.imageUrl || null;
  const appleMusicResult = appleMusicFetch.status === 'fulfilled' ? appleMusicFetch.value : null;
  const appleMusicUrl = appleMusicResult?.url || null;
  const appleMusicCollectionId = appleMusicResult?.collectionId || null;
  const youtubeUrl = youtubeFetch.status === 'fulfilled' ? youtubeFetch.value : null;
  const bandcampResult = bandcampFetch.status === 'fulfilled' ? bandcampFetch.value : null;
  const bandcampUrl = bandcampResult?.url || null;
  const discogsRelease = discogsFetch.status === 'fulfilled' ? discogsFetch.value : null;
  const lastfmInfo = lastfmFetch.status === 'fulfilled' ? lastfmFetch.value : null;

  if (!labelName && discogsRelease?.label) labelName = discogsRelease.label;

  // Discogs market data
  let masterMarket: Awaited<ReturnType<typeof getMasterMarketData>> = null;
  try {
    masterMarket = await getMasterMarketData(artistName, albumTitle);
  } catch (err) {
    console.warn(`[discogs] master market fetch failed for "${artistName} - ${albumTitle}":`, (err as Error).message);
  }

  // Merge genres from Last.fm
  genres = [...new Set([...genres, ...(lastfmInfo?.tags || [])])];

  const coverArtFallbacks = [lastfmInfo?.imageUrl, spotifyImageUrl]
    .filter((u): u is string => !!u && u.length > 0);

  // Pronunciation will be generated in the reviews endpoint (Step 2)
  // to avoid duplicate Claude API calls
  const artistKo: string | null = null;
  const titleKo: string | null = null;
  const titleMeaning: string | null = null;

  const releaseYear = releaseDate.substring(0, 4);

  // Generate slug
  const fallbackId = isDiscogs ? mbid.replace('discogs-', '') : mbid.substring(0, 8);
  const slug = generateSlug(artistName, albumTitle, releaseYear, fallbackId);

  const albumData = {
    mbid,
    slug,
    title: albumTitle,
    artist: artistName,
    artistMbid: artistMbid,
    releaseDate,
    label: labelName,
    genres: cleanGenres(genres, artistName),
    coverArtUrl: primaryCoverArtUrl,
    coverArtFallbacks,
    artistKo,
    titleKo,
    titleMeaning,
  };

  const streamingData = {
    spotify: spotifyUrl,
    appleMusic: appleMusicUrl,
    appleMusicEmbedUrl: appleMusicCollectionId
      ? `https://embed.music.apple.com/us/album/${appleMusicCollectionId}`
      : null,
    youtube: youtubeUrl,
    bandcamp: bandcampUrl,
  };

  const buyData = {
    discogsUrl: masterMarket?.discogsUrl || discogsRelease?.url || null,
    formats: masterMarket?.formats || [],
    bandcampUrl: bandcampUrl,
  };

  // Cache
  cacheAlbum({
    mbid,
    slug,
    title: albumTitle,
    artist_name: artistName,
    artist_mbid: artistMbid,
    label_name: labelName,
    label_id: null,
    release_year: releaseYear ? parseInt(releaseYear, 10) : null,
    release_date: releaseDate || null,
    format: format || null,
    genres,
    cover_art_url: primaryCoverArtUrl,
    cover_art_fallbacks: coverArtFallbacks,
    spotify_url: spotifyUrl,
    apple_music_url: appleMusicUrl,
    apple_music_embed_url: streamingData.appleMusicEmbedUrl,
    youtube_url: youtubeUrl,
    bandcamp_url: bandcampUrl,
    discogs_id: masterMarket?.masterId || discogsRelease?.discogsId || null,
    discogs_artist_id: discogsArtistId,
    discogs_url: masterMarket?.discogsUrl || discogsRelease?.url || null,
    discogs_formats_json: buyData.formats.length > 0 ? JSON.stringify(buyData.formats) : null,
    artist_ko: artistKo,
    title_ko: titleKo,
    title_meaning: titleMeaning,
  });

  return {
    album: albumData,
    streaming: streamingData,
    buy: buyData,
    discography: [] as any[],
    artistName,
    albumTitle,
    discogsArtistId,
  };
}

// ─── GET /api/albums — list all albums (paginated + sorted) ─────────────

const ALBUM_PAGE_SIZE = 20;

const SORT_CLAUSES: Record<string, string> = {
  registered_desc:   `a.id DESC`,
  registered_asc:    `a.id ASC`,
  release_date_desc: `COALESCE(a.release_date, a.release_year || '-01-01') DESC, a.id DESC`,
  release_date_asc:  `COALESCE(a.release_date, a.release_year || '-01-01') ASC, a.id ASC`,
  artist_az:         `LOWER(a.artist_name) ASC, a.id ASC`,
  score_desc:        `avg_score IS NULL, avg_score DESC, a.id DESC`,
  score_asc:         `avg_score IS NULL, avg_score ASC, a.id ASC`,
  upvotes_desc:      `upvotes DESC, a.id DESC`,
  downvotes_desc:    `downvotes DESC, a.id DESC`,
};

const ALBUM_ROW_SELECT = `
  SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.release_date, a.release_year,
         a.cover_art_url, a.cover_art_fallbacks, a.genres,
         COALESCE((SELECT SUM(CASE WHEN vote='up' THEN 1 ELSE 0 END) FROM album_votes WHERE album_id = a.id), 0) AS upvotes,
         COALESCE((SELECT SUM(CASE WHEN vote='down' THEN 1 ELSE 0 END) FROM album_votes WHERE album_id = a.id), 0) AS downvotes,
         (SELECT AVG(CASE
                       WHEN COALESCE(r.manual_score, r.score) IS NOT NULL AND r.score_max > 0
                       THEN (COALESCE(r.manual_score, r.score) * 1.0 / r.score_max) * 100
                     END)
          FROM reviews r WHERE r.album_mbid = a.mbid) AS avg_score
  FROM albums a
`;

router.get('/', async (req, res) => {
  try {
    const sortKey = (req.query.sort as string) || 'registered_desc';
    const isPriceSort = sortKey === 'price_asc' || sortKey === 'price_desc';
    const orderBy = SORT_CLAUSES[sortKey] || SORT_CLAUSES.registered_desc;

    const pageRaw = parseInt((req.query.page as string) || '1', 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const offset = (page - 1) * ALBUM_PAGE_SIZE;

    const total = (queryGet('SELECT COUNT(*) AS c FROM albums')?.c as number) || 0;
    const totalPages = Math.max(1, Math.ceil(total / ALBUM_PAGE_SIZE));

    let albums: any[];
    if (isPriceSort) {
      // Currency conversion has to happen in-app, so fetch all albums + all
      // purchase links, compute min USD price per album, sort, then paginate.
      const allAlbums = queryAll(ALBUM_ROW_SELECT) as any[];
      const allLinks = queryAll(
        `SELECT album_id, price, currency FROM purchase_links
         WHERE price IS NOT NULL AND currency IS NOT NULL`
      ) as any[];

      const rates = await getRates();
      const minUsdByAlbum = new Map<number, number>();
      for (const l of allLinks) {
        const usd = convertToUsdSync(l.price, l.currency, rates);
        if (usd == null) continue;
        const prev = minUsdByAlbum.get(l.album_id);
        if (prev == null || usd < prev) minUsdByAlbum.set(l.album_id, usd);
      }

      const sign = sortKey === 'price_asc' ? 1 : -1;
      allAlbums.sort((a, b) => {
        const pa = minUsdByAlbum.get(a.id);
        const pb = minUsdByAlbum.get(b.id);
        // Nulls last regardless of direction
        if (pa == null && pb == null) return a.id - b.id;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return (pa - pb) * sign;
      });

      albums = allAlbums.slice(offset, offset + ALBUM_PAGE_SIZE);
    } else {
      albums = queryAll(
        `${ALBUM_ROW_SELECT}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [ALBUM_PAGE_SIZE, offset]
      );
    }

    // Batch-fetch all purchase links for the listed albums, then group + sort
    // by KRW-converted price to pick each album's top 3 for the cover stickers.
    const topLinksByAlbum = new Map<number, any[]>();
    if (albums.length > 0) {
      const placeholders = albums.map(() => '?').join(',');
      const linkRows = queryAll(
        `SELECT album_id, id, url, store_name, store_favicon_url, price, currency, format, is_sold_out
         FROM purchase_links WHERE album_id IN (${placeholders})`,
        albums.map((a: any) => a.id)
      );

      const listRates = await getRates();
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
            ? convertToKrwSync(l.price, l.currency, listRates)
            : null,
        format: l.format,
        isSoldOut: !!l.is_sold_out,
      }));

      for (const link of enriched) {
        const bucket = topLinksByAlbum.get(link.albumId) || [];
        bucket.push(link);
        topLinksByAlbum.set(link.albumId, bucket);
      }
      for (const [aid, links] of topLinksByAlbum) {
        links.sort(
          (a, b) =>
            (a.priceKrw ?? Number.POSITIVE_INFINITY) -
            (b.priceKrw ?? Number.POSITIVE_INFINITY)
        );
        topLinksByAlbum.set(
          aid,
          links.slice(0, 3).map(({ albumId: _ignored, ...rest }) => rest)
        );
      }
    }

    const result = albums.map((a: any) => {
      let genres: string[] = [];
      if (a.genres) {
        try {
          const parsed = JSON.parse(a.genres);
          if (Array.isArray(parsed)) genres = parsed.filter((g) => typeof g === 'string');
        } catch {
          // ignore malformed genres
        }
      }
      return {
        mbid: a.slug || a.mbid,
        title: a.title,
        artist: a.artist_name,
        year: a.release_date?.substring(0, 4) || a.release_year?.toString() || null,
        coverArtUrl: a.cover_art_url,
        coverArtFallbacks: a.cover_art_fallbacks ? JSON.parse(a.cover_art_fallbacks) : [],
        averageScore: a.avg_score != null ? Math.round(a.avg_score) : null,
        upvotes: a.upvotes || 0,
        downvotes: a.downvotes || 0,
        priceTagLinks: topLinksByAlbum.get(a.id) || [],
        genres,
      };
    });

    res.json({
      albums: result,
      total,
      page,
      pageSize: ALBUM_PAGE_SIZE,
      totalPages,
    });
  } catch (error) {
    console.error('List albums error:', error);
    res.status(500).json({ error: 'Failed to list albums' });
  }
});

// ─── GET /api/albums/search — DB-only search ────────────────────────────

router.get('/search', (req, res) => {
  const query = (req.query.q as string) || '';
  if (query.trim().length < 1) {
    return res.json({ albums: [] });
  }
  try {
    const albums = searchAlbumsInDb(query);
    res.json({ albums });
  } catch (error) {
    console.error('DB album search error:', error);
    res.json({ albums: [] });
  }
});

// ─── POST /api/albums/:id/regenerate-pronunciation — admin re-run Claude ──

router.post('/:id/regenerate-pronunciation', adminClaudeLimiter, requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const cached = getCachedAlbum(mbid);
  if (!cached) {
    return res.status(404).json({ error: 'Album not found' });
  }
  if (!cached.artist_name || !cached.title) {
    return res.status(400).json({ error: 'Album missing artist/title' });
  }

  try {
    const result = await generatePronunciation(cached.artist_name, cached.title);
    if (!result) {
      return res.status(502).json({ error: 'Claude failed to generate pronunciation' });
    }
    updateAlbumFields(mbid, {
      artist_ko: result.artistKo,
      title_ko: result.titleKo,
      title_meaning: result.titleMeaning,
    });
    res.json({
      ok: true,
      artistKo: result.artistKo,
      titleKo: result.titleKo,
      titleMeaning: result.titleMeaning,
    });
  } catch (error) {
    console.error('Regenerate pronunciation error:', error);
    res.status(500).json({ error: 'Failed to regenerate pronunciation' });
  }
});

// ─── PATCH /api/albums/:id/metadata — admin edit for Korean fields ───────

router.patch('/:id/metadata', requireAdmin, (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const row = queryGet('SELECT mbid FROM albums WHERE mbid = ?', [mbid]);
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const { title_ko, title_meaning, artist_ko } = req.body ?? {};
  const fields: Record<string, string> = {};
  const clean = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const trimmed = v.trim();
    return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
  };

  const tk = clean(title_ko);
  const tm = clean(title_meaning);
  const ak = clean(artist_ko);
  if (tk !== undefined) fields.title_ko = tk;
  if (tm !== undefined) fields.title_meaning = tm;
  if (ak !== undefined) fields.artist_ko = ak;

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    updateAlbumFields(mbid, fields);
    const updated = queryGet(
      'SELECT artist_ko, title_ko, title_meaning FROM albums WHERE mbid = ?',
      [mbid]
    );
    res.json({
      ok: true,
      artistKo: updated?.artist_ko || '',
      titleKo: updated?.title_ko || '',
      titleMeaning: updated?.title_meaning || '',
    });
  } catch (error) {
    console.error('Update metadata error:', error);
    res.status(500).json({ error: 'Failed to update metadata' });
  }
});

// ─── PATCH /api/albums/:id/cover-art — admin replace cover image URL ─────

router.patch('/:id/cover-art', requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const row = queryGet('SELECT mbid FROM albums WHERE mbid = ?', [mbid]);
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const { coverArtUrl } = req.body ?? {};
  if (typeof coverArtUrl !== 'string' || coverArtUrl.trim().length === 0) {
    return res.status(400).json({ error: 'coverArtUrl is required' });
  }
  const url = coverArtUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }
  if (url.length > 2000) {
    return res.status(400).json({ error: 'URL is too long' });
  }

  try {
    // Fetch, resize, and persist the image under server/data/custom-covers/.
    // The DB then points at our own /api/custom-covers/<hash>.webp — avoiding
    // hotlinking, host-allowlist restrictions, and uncached originals.
    const hostedUrl = await hostCustomCover(url);
    updateAlbumFields(mbid, { cover_art_url: hostedUrl });
    res.json({ ok: true, coverArtUrl: hostedUrl });
  } catch (error) {
    if (error instanceof CustomCoverError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Update cover art error:', error);
    res.status(500).json({ error: 'Failed to update cover art' });
  }
});

// ─── POST /api/albums/:id/reviews/add-url — admin add review by URL ─────

router.post('/:id/reviews/add-url', adminClaudeLimiter, requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const albumRow = queryGet(
    'SELECT title, artist_name FROM albums WHERE mbid = ?',
    [mbid]
  );
  if (!albumRow) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const urlRaw = (req.body ?? {}).url;
  if (typeof urlRaw !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  const url = urlRaw.trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }
  if (url.length > 2000) {
    return res.status(400).json({ error: 'URL too long' });
  }

  try {
    const scraped = await scrapeReviewFromUrl(url, albumRow.artist_name, albumRow.title);
    if (!scraped) {
      return res.status(422).json({ error: 'URL에서 리뷰를 추출하지 못했습니다.' });
    }

    execute(
      `INSERT INTO reviews (album_mbid, source_name, score, score_max, excerpt, excerpt_ko, full_review_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(album_mbid, source_name) DO UPDATE SET
         score = excluded.score,
         score_max = excluded.score_max,
         excerpt = excluded.excerpt,
         excerpt_ko = excluded.excerpt_ko,
         full_review_url = excluded.full_review_url,
         scraped_at = datetime('now')`,
      [
        mbid,
        scraped.sourceName,
        scraped.score,
        scraped.scoreMax,
        scraped.excerpt,
        scraped.excerptKo,
        scraped.fullReviewUrl,
      ]
    );

    const saved = queryGet(
      `SELECT id, source_name, score, manual_score, score_max, excerpt, excerpt_ko, full_review_url
       FROM reviews WHERE album_mbid = ? AND source_name = ?`,
      [mbid, scraped.sourceName]
    );

    if (!saved) {
      return res.status(500).json({ error: 'Failed to retrieve saved review' });
    }

    res.json({
      ok: true,
      review: {
        id: saved.id,
        source: saved.source_name,
        score: saved.manual_score ?? saved.score,
        scoreMax: saved.score_max,
        excerpt: saved.excerpt,
        excerptKo: saved.excerpt_ko || null,
        url: saved.full_review_url,
        isManualScore: saved.manual_score != null,
      },
    });
  } catch (err) {
    console.error('Add review URL error:', err);
    res.status(500).json({ error: 'Failed to add review' });
  }
});

// ─── PATCH /api/albums/:id/tags — admin replace genre tag list ──────────

router.patch('/:id/tags', requireAdmin, (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const row = queryGet('SELECT mbid FROM albums WHERE mbid = ?', [mbid]);
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const raw = (req.body ?? {}).tags;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ error: 'tags must be an array of strings' });
  }

  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const trimmed = t.trim();
    if (!trimmed || trimmed.length > 80) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
    if (cleaned.length >= 30) break;
  }

  try {
    updateAlbumFields(mbid, { genres: JSON.stringify(cleaned) });
    res.json({ ok: true, tags: cleaned });
  } catch (error) {
    console.error('Update tags error:', error);
    res.status(500).json({ error: 'Failed to update tags' });
  }
});

// ─── PATCH /api/albums/:id/korean-summary — admin edit AI summary text ───

router.patch('/:id/korean-summary', requireAdmin, (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const row = queryGet('SELECT mbid FROM albums WHERE mbid = ?', [mbid]);
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const raw = (req.body ?? {}).korean_summary;
  let value: string | null;
  if (raw === null) {
    value = null;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    value = trimmed ? trimmed.slice(0, 4000) : null;
  } else {
    return res.status(400).json({ error: 'korean_summary must be a string or null' });
  }

  try {
    updateAlbumFields(mbid, { korean_summary: value });
    res.json({ ok: true, koreanSummary: value });
  } catch (error) {
    console.error('Update korean summary error:', error);
    res.status(500).json({ error: 'Failed to update korean summary' });
  }
});

// ─── POST /api/albums/reviews/:reviewId/score — manual score entry ───────

router.post('/reviews/:reviewId/score', requireAdmin, async (req, res) => {
  const reviewId = parseInt((req.params.reviewId as string), 10);
  const { score } = req.body;

  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }

  // null = explicitly "no score" (stored as NULL); 0 is a valid score.
  let scoreValue: number | null;
  if (score === null) {
    scoreValue = null;
  } else if (typeof score === 'number' && score >= 0 && score <= 100) {
    scoreValue = score;
  } else {
    return res.status(400).json({ error: 'Score must be null or a number 0-100' });
  }

  try {
    execute('UPDATE reviews SET manual_score = ? WHERE id = ?', [scoreValue, reviewId]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Manual score error:', error);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

// ─── PATCH /api/albums/reviews/:reviewId/excerpt — admin edit excerpt_ko ──

router.patch('/reviews/:reviewId/excerpt', requireAdmin, (req, res) => {
  const reviewId = parseInt((req.params.reviewId as string), 10);
  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }

  const raw = (req.body ?? {}).excerpt_ko;
  let value: string | null;
  if (raw === null) {
    value = null;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    value = trimmed ? trimmed.slice(0, 4000) : null;
  } else {
    return res.status(400).json({ error: 'excerpt_ko must be a string or null' });
  }

  const existing = queryGet('SELECT id FROM reviews WHERE id = ?', [reviewId]);
  if (!existing) {
    return res.status(404).json({ error: 'Review not found' });
  }

  try {
    execute('UPDATE reviews SET excerpt_ko = ? WHERE id = ?', [value, reviewId]);
    res.json({ ok: true, excerptKo: value });
  } catch (error) {
    console.error('Update excerpt error:', error);
    res.status(500).json({ error: 'Failed to update excerpt' });
  }
});

// ─── POST /api/albums/reviews/:reviewId/retranslate — re-translate excerpt ──

router.post('/reviews/:reviewId/retranslate', adminClaudeLimiter, requireAdmin, async (req, res) => {
  const reviewId = parseInt((req.params.reviewId as string), 10);
  if (isNaN(reviewId)) {
    return res.status(400).json({ error: 'Invalid review ID' });
  }

  try {
    const review = queryGet('SELECT excerpt, source_name FROM reviews WHERE id = ?', [reviewId]);
    if (!review || !review.excerpt) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `다음 음악 리뷰 발췌문을 자연스러운 한국어로 번역해줘.
- 원문의 의미와 뉘앙스를 유지
- 2-3문장으로 번역
- 출처 언급 금지
- 마크다운 문법 절대 사용 금지 (#, **, *, - 등 특수문자 없이 순수 텍스트로만)

원문:\n${review.excerpt}`,
      }],
    });

    const textBlock = message.content.find((b: any) => b.type === 'text') as any;
    const rawText = textBlock?.text?.trim() || null;
    const excerptKo = rawText
      ? rawText.replace(/#{1,6}\s/g, '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/^-\s/gm, '').trim()
      : null;

    if (excerptKo) {
      execute('UPDATE reviews SET excerpt_ko = ? WHERE id = ?', [excerptKo, reviewId]);
    }

    res.json({ excerptKo });
  } catch (error) {
    console.error('Retranslate error:', error);
    res.status(500).json({ error: 'Failed to retranslate' });
  }
});

// ─── DELETE /api/albums/:id — remove album and related data ─────────────

router.delete('/:id', requireAdmin, async (req, res) => {
  const idOrSlug = req.params.id as string;
  const row = queryGet(
    `SELECT id, mbid FROM albums WHERE slug = ? OR mbid = ? LIMIT 1`,
    [idOrSlug, idOrSlug]
  );
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const albumPk: number = row.id;
  const albumMbid: string = row.mbid;

  try {
    transaction(() => {
      // Text-keyed children (Phase 1 schema uses album_mbid)
      execute('DELETE FROM reviews WHERE album_mbid = ?', [albumMbid]);
      execute(
        'DELETE FROM similar_albums WHERE album_mbid = ? OR similar_album_mbid = ?',
        [albumMbid, albumMbid]
      );
      // Numeric-keyed children (Phase 2 — also covered by ON DELETE CASCADE, but explicit for safety)
      execute('DELETE FROM album_votes WHERE album_id = ?', [albumPk]);
      execute('DELETE FROM purchase_links WHERE album_id = ?', [albumPk]);
      // Phase 3 placeholders that reference albums(id)
      execute('DELETE FROM wishlists WHERE album_id = ?', [albumPk]);
      execute('DELETE FROM collections WHERE album_id = ?', [albumPk]);
      execute('DELETE FROM wants WHERE album_id = ?', [albumPk]);
      execute('DELETE FROM dig_journal_posts WHERE album_id = ?', [albumPk]);
      execute(
        'DELETE FROM album_dna WHERE from_album_id = ? OR to_album_id = ?',
        [albumPk, albumPk]
      );
      // Finally the parent row
      execute('DELETE FROM albums WHERE id = ?', [albumPk]);
    });

    console.log(`[delete] Album deleted: id=${albumPk} mbid=${albumMbid}`);
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete album error:', error);
    res.status(500).json({ error: 'Failed to delete album' });
  }
});

// ─── GET /api/albums/:id — fast: base info + discography ─────────────────

router.get('/:id', async (req, res) => {
  const param = (req.params.id as string);
  // Resolve slug or mbid to actual mbid
  const resolved = resolveAlbumId(param);

  // Slug not in DB and not a valid mbid/discogs-id → 404
  if (!resolved && !param.match(/^[0-9a-f]{8}-/) && !param.startsWith('discogs-')) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const mbid = resolved?.mbid || param;

  try {
    const result = await getOrFetchAlbumBase(mbid);
    if (!result) {
      return res.status(404).json({ error: 'Album not found' });
    }

    // Discography: MusicBrainz first, fallback to Discogs
    const artistMbid = result.album.artistMbid;
    if (artistMbid) {
      try {
        const releaseGroups = await getArtistReleases(artistMbid);
        result.discography = releaseGroups
          .filter((rg: any) => rg.primaryType === 'Album' || rg.primaryType === 'EP' || rg.primaryType === 'Live')
          .map((rg: any) => ({
            mbid: rg.mbid,
            title: rg.title,
            year: rg.year || '',
            primaryType: rg.primaryType || '',
            coverArtUrl: `https://coverartarchive.org/release-group/${rg.mbid}/front-250`,
          }))
          .sort((a: any, b: any) => (b.year || '').localeCompare(a.year || ''));
      } catch (err) {
        console.warn(`[disco] MusicBrainz discography fetch failed for artistMbid=${artistMbid}:`, (err as Error).message);
      }
    }

    // Fallback: Discogs artist discography
    if (result.discography.length === 0 && result.discogsArtistId) {
      try {
        const dcReleases = await getDiscogsArtistReleases(result.discogsArtistId);
        result.discography = dcReleases.map((r) => ({
          mbid: r.masterId ? `discogs-master-${r.masterId}` : '',
          title: r.title,
          year: r.year || '',
          primaryType: r.type === 'master' ? 'Album' : r.type,
          coverArtUrl: r.thumbUrl || '',
        }));
      } catch (err) {
        console.warn(`[disco] Discogs discography fallback failed for artistId=${result.discogsArtistId}:`, (err as Error).message);
      }
    }

    // Vote counts + current user's vote
    const albumRow = queryGet(`SELECT id FROM albums WHERE mbid = ?`, [mbid]);
    const albumPk = albumRow?.id;
    let upvotes = 0;
    let downvotes = 0;
    let userVote: 'up' | 'down' | null = null;
    if (albumPk) {
      const counts = queryGet(
        `SELECT
           SUM(CASE WHEN vote='up' THEN 1 ELSE 0 END) AS up,
           SUM(CASE WHEN vote='down' THEN 1 ELSE 0 END) AS down
         FROM album_votes WHERE album_id = ?`,
        [albumPk]
      );
      upvotes = counts?.up || 0;
      downvotes = counts?.down || 0;
      const currentUser = req.user;
      if (currentUser) {
        const uv = queryGet(
          `SELECT vote FROM album_votes WHERE user_id = ? AND album_id = ?`,
          [currentUser.id, albumPk]
        );
        userVote = uv?.vote || null;
      }
    }

    // Attach KRW conversion to Discogs format prices (they are always USD).
    const formatsWithKrw = await Promise.all(
      (result.buy.formats || []).map(async (fmt: any) => ({
        ...fmt,
        lowestPriceKrw:
          fmt.lowestPrice != null ? await convertToKrw(fmt.lowestPrice, 'USD') : null,
      }))
    );

    res.json({
      album: { ...result.album, upvotes, downvotes, userVote },
      streaming: result.streaming,
      buy: { ...result.buy, formats: formatsWithKrw },
      discography: result.discography,
    });
  } catch (error) {
    console.error('Album detail error:', error);
    res.status(500).json({ error: 'Failed to fetch album details' });
  }
});

// ─── GET /api/albums/:mbid/reviews — slow: reviews + summary ────────────────

router.get('/:id/reviews', async (req, res) => {
  const resolved = resolveAlbumId((req.params.id as string));
  const mbid = resolved?.mbid || (req.params.id as string);

  try {
    const cached = getCachedAlbum(mbid);
    const artistName = cached?.artist_name || '';
    const albumTitle = cached?.title || '';

    // Check cached reviews
    let reviews = getCachedReviews(mbid);
    let koreanSummary = cached?.korean_summary || null;

    if (!reviews && albumTitle && artistName) {
      try {
        const result = await searchReviews(artistName, albumTitle);
        if (result.reviews.length > 0) {
          cacheReviews(
            mbid,
            result.reviews.map((r) => ({
              source_name: r.sourceName,
              score: r.score,
              score_max: r.scoreMax,
              excerpt: r.excerpt,
              excerpt_ko: r.excerptKo,
              full_review_url: r.fullReviewUrl,
            }))
          );
          reviews = getCachedReviews(mbid);
        }
        const fieldsToUpdate: Record<string, any> = {};
        if (result.koreanSummary && !koreanSummary) {
          koreanSummary = result.koreanSummary;
          fieldsToUpdate.korean_summary = koreanSummary;
          fieldsToUpdate.korean_summary_generated_at = new Date().toISOString();
        }
        if (result.artistKo) fieldsToUpdate.artist_ko = result.artistKo;
        if (result.titleKo) fieldsToUpdate.title_ko = result.titleKo;
        if (result.titleMeaning) fieldsToUpdate.title_meaning = result.titleMeaning;
        if (Object.keys(fieldsToUpdate).length > 0) {
          updateAlbumFields(mbid, fieldsToUpdate);
        }
      } catch (error) {
        console.error('Review search error:', error);
      }
    }

    // Summary is generated in searchReviews Step 3 (Sonnet).
    // No separate fallback needed — if it failed there, retrying won't help.

    const formattedReviews = (reviews || []).map((r: any) => ({
      id: r.id,
      source: r.source_name,
      score: r.manual_score ?? r.score,
      scoreMax: r.score_max,
      excerpt: r.excerpt,
      excerptKo: r.excerpt_ko || null,
      url: r.full_review_url,
      isManualScore: r.manual_score != null,
    }));

    const scoredReviews = formattedReviews.filter(
      (r: any) => r.score != null && r.scoreMax != null && r.scoreMax > 0
    );
    const averageScore =
      scoredReviews.length > 0
        ? scoredReviews.reduce((sum: number, r: any) => sum + (r.score / r.scoreMax) * 100, 0) / scoredReviews.length
        : null;

    // Pronunciation from cache
    const freshCached = getCachedAlbum(mbid);

    res.json({
      reviews: formattedReviews,
      koreanSummary,
      averageScore,
      artistKo: freshCached?.artist_ko || null,
      titleKo: freshCached?.title_ko || null,
    });
  } catch (error) {
    console.error('Reviews endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// ─── GET /api/albums/:mbid/similar — slow: similar albums ───────────────────

router.get('/:id/similar', async (req, res) => {
  const resolved = resolveAlbumId((req.params.id as string));
  const mbid = resolved?.mbid || (req.params.id as string);

  try {
    const cached = getCachedAlbum(mbid);
    const artistName = cached?.artist_name || '';
    const albumTitle = cached?.title || '';

    // Check cache
    let similarAlbums: any[] = [];
    if (cached?.similar_albums_lastfm) {
      try {
        similarAlbums = JSON.parse(cached.similar_albums_lastfm);
      } catch {
        similarAlbums = [];
      }
    }

    if (similarAlbums.length === 0 && albumTitle && artistName) {
      try {
        const lastfmSimilar = await getSimilarAlbums(artistName, albumTitle);

        if (lastfmSimilar.length > 0) {
          let descriptions: Awaited<ReturnType<typeof generateSimilarDescriptions>> = null;
          try {
            descriptions = await generateSimilarDescriptions(
              artistName, albumTitle,
              lastfmSimilar.map((a) => ({ title: a.title, artist: a.artist }))
            );
          } catch (err) {
            console.warn(`[claude] similar-album descriptions failed for "${artistName} - ${albumTitle}":`, (err as Error).message);
          }

          similarAlbums = await Promise.all(
            lastfmSimilar.map(async (a) => {
              const desc = descriptions?.find(
                (d) => d.title.toLowerCase() === a.title.toLowerCase()
                    && d.artist.toLowerCase() === a.artist.toLowerCase()
              );

              let enrichedMbid = a.mbid || '';
              let enrichedImage = a.imageUrl || '';

              if (!enrichedMbid || !enrichedImage) {
                try {
                  const mbResults = await searchAlbums(`${a.artist} ${a.title}`);
                  if (mbResults.length > 0) {
                    enrichedMbid = enrichedMbid || mbResults[0].mbid;
                    enrichedImage = enrichedImage || mbResults[0].coverArtUrl;
                  }
                } catch (err) {
                  console.warn(`[mb] similar-album enrichment failed for "${a.artist} - ${a.title}":`, (err as Error).message);
                }
              }

              // Fetch streaming links + Discogs master in parallel (4 concurrent).
              // Discogs release is a fallback — only called if master lookup misses,
              // saving one external call per similar album with a master URL.
              const [spResult, ytResult, bcResult, dcMasterResult] = await Promise.allSettled([
                searchTrack(a.artist, a.title),
                searchVideo(a.artist, a.title),
                searchBandcamp(a.artist, a.title),
                searchMasterUrl(a.artist, a.title),
              ]);
              const spotifyLink = spResult.status === 'fulfilled' ? spResult.value?.url || null : null;
              const youtubeLink = ytResult.status === 'fulfilled' ? ytResult.value || null : null;
              const bandcampLink = bcResult.status === 'fulfilled' ? bcResult.value?.url || null : null;
              const masterUrl = dcMasterResult.status === 'fulfilled' ? dcMasterResult.value : null;

              let releaseUrl: string | null = null;
              if (!masterUrl) {
                try {
                  const dcRelease = await searchRelease(a.artist, a.title);
                  releaseUrl = dcRelease?.url || null;
                } catch {
                  releaseUrl = null;
                }
              }

              const discogsLink = masterUrl
                || releaseUrl
                || `https://www.discogs.com/search/?q=${encodeURIComponent(`${a.artist} ${a.title}`)}&type=master`;

              return {
                title: a.title, artist: a.artist,
                mbid: enrichedMbid, imageUrl: enrichedImage,
                reason: desc?.descriptionKo || '',
                discogsUrl: discogsLink,
                spotifyUrl: spotifyLink, youtubeUrl: youtubeLink, bandcampUrl: bandcampLink,
              };
            })
          );

          if (similarAlbums.length > 0) {
            updateAlbumFields(mbid, {
              similar_albums_lastfm: JSON.stringify(similarAlbums),
            });
          }
        }
      } catch (error) {
        console.error('Similar albums error:', error);
      }
    }

    res.json({ similarAlbums });
  } catch (error) {
    console.error('Similar endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch similar albums' });
  }
});

// ─── PATCH /api/albums/:id/similar/:index — admin edit a similar entry ──
//
// Similar albums are persisted as a JSON blob inside albums.similar_albums_lastfm
// rather than as distinct DB rows, so we identify entries by their array index.

router.patch('/:id/similar/:index', requireAdmin, (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);
  const index = parseInt(req.params.index as string, 10);

  if (isNaN(index) || index < 0) {
    return res.status(400).json({ error: 'Invalid index' });
  }

  const cached = getCachedAlbum(mbid);
  if (!cached) {
    return res.status(404).json({ error: 'Album not found' });
  }

  let list: any[] = [];
  try {
    list = cached.similar_albums_lastfm ? JSON.parse(cached.similar_albums_lastfm) : [];
  } catch {
    list = [];
  }
  if (index >= list.length) {
    return res.status(404).json({ error: 'Similar album entry not found' });
  }

  const clean = (v: unknown): string | null | undefined => {
    if (v === null) return null;
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    if (!t) return null;
    return t.length > 2000 ? t.slice(0, 2000) : t;
  };

  const { spotifyUrl, youtubeUrl, bandcampUrl, reason } = req.body ?? {};
  const updates: Record<string, string | null> = {};
  const sp = clean(spotifyUrl);
  const yt = clean(youtubeUrl);
  const bc = clean(bandcampUrl);
  const rs = clean(reason);
  if (sp !== undefined) updates.spotifyUrl = sp;
  if (yt !== undefined) updates.youtubeUrl = yt;
  if (bc !== undefined) updates.bandcampUrl = bc;
  if (rs !== undefined) updates.reason = rs;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const updated = { ...list[index], ...updates };
  list[index] = updated;

  try {
    updateAlbumFields(mbid, { similar_albums_lastfm: JSON.stringify(list) });
    res.json({ ok: true, similarAlbum: updated });
  } catch (error) {
    console.error('Update similar album error:', error);
    res.status(500).json({ error: 'Failed to update similar album' });
  }
});

// ─── POST /api/albums/:id/refresh-reviews — add new reviews (keep existing) ─

router.post('/:id/refresh-reviews', adminClaudeLimiter, requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId((req.params.id as string));
  const mbid = resolved?.mbid || (req.params.id as string);

  try {
    const cached = getCachedAlbum(mbid);
    if (!cached) {
      return res.status(404).json({ error: 'Album not found in cache' });
    }

    const artistName = cached.artist_name || '';
    const albumTitle = cached.title || '';

    // Get existing source names to skip
    const existingReviews = getCachedReviews(mbid) || [];
    const existingSources = new Set(
      existingReviews.map((r: any) => r.source_name.toLowerCase().trim())
    );

    let addedCount = 0;
    try {
      const result = await searchReviews(artistName, albumTitle);
      // Insert only reviews from new sources
      for (const r of result.reviews) {
        if (existingSources.has(r.sourceName.toLowerCase().trim())) continue;
        execute(
          `INSERT OR IGNORE INTO reviews (album_mbid, source_name, score, score_max, excerpt, excerpt_ko, full_review_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [mbid, r.sourceName, r.score, r.scoreMax, r.excerpt, r.excerptKo, r.fullReviewUrl]
        );
        addedCount++;
      }

      // Regenerate summary if new reviews were added
      if (addedCount > 0 && result.koreanSummary) {
        updateAlbumFields(mbid, {
          korean_summary: result.koreanSummary,
          korean_summary_generated_at: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Review search error:', error);
    }

    console.log(`[refresh-reviews] ${addedCount} new reviews added for ${mbid}`);
    res.json({ addedCount });
  } catch (error) {
    console.error('Refresh reviews error:', error);
    res.status(500).json({ error: 'Failed to refresh reviews' });
  }
});

export default router;
