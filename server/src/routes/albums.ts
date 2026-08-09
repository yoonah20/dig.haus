import { Router } from 'express';
import { adminClaudeLimiter } from '../middleware/adminRateLimit.js';
import { getRelease, getLabelByName, searchAlbums } from '../services/musicbrainz.js';
import { searchTrack } from '../services/spotify.js';
import { searchVideo } from '../services/youtube.js';
import { searchBandcamp } from '../services/bandcamp.js';
import { searchRelease, searchMasterUrl, getMasterMarketData, getDiscogsReleaseDetail, getDiscogsMasterMainRelease } from '../services/discogs.js';
import { getAlbumInfo, getSimilarAlbums } from '../services/lastfm.js';
import { generateSimilarDescriptions, generatePronunciation } from '../services/claude.js';
import { invokeLlm } from '../services/llmRouter.js';
import { hostCustomCover, CustomCoverError } from '../services/customCoverHost.js';
import {
  getCachedAlbum,
  cacheAlbum,
  updateAlbumFields,
} from '../utils/cache.js';
import { execute, queryAll, queryGet, transaction, getDb } from '../db/index.js';
import { generateSlug, resolveAlbumId } from '../utils/slug.js';
import { setAnonEdgeCache, setEdgeCache } from '../utils/edgeCache.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import type { AppUser } from '../auth/passport.js';
import { convertToKrw, convertToUsd, getRates, convertToKrwSync, convertToUsdSync } from '../services/exchangeRates.js';
import { searchAlbumsInDb } from '../utils/albumSearch.js';
import { syncSingleAlbumRelease } from '../jobs/releaseSyncJob.js';
import { enqueueAutoCuration } from '../services/autoCuration.js';

const router = Router();

// Broad/useless tags to exclude. Two families:
//   1) Top-of-the-tree genre buckets that are too coarse to be
//      interesting next to the subgenres that come in with them
//   2) Personal / meta tags — Last.fm users tag albums with how they
//      relate to them ("favorite", "seen live", "owned") rather than
//      what they sound like. These pass every length/digit heuristic
//      and need explicit removal. Nationality tags (japanese, korean,
//      american, british, ...) survive because they're useful for
//      dig.haus's niche-international audience.
const EXCLUDED_TAGS = new Set([
  // Non-musical metadata buckets. Broad genre names (rock, pop,
  // hip-hop, classical, r&b, electronic, soundtrack, vocal, spoken
  // word) used to sit here — they were pulled out so they're treated
  // the same as jazz / soul / funk / punk, which were always allowed
  // through. The cleanGenres length+sort+top-5 pass keeps cards from
  // being papered with "Rock" when a more specific subgenre exists.
  // What stays here is genuinely non-genre noise: the word "music"
  // on its own, generic release-state words, and "X music" wrappers
  // that the ` music` suffix gate also catches but kept explicit so
  // the intent is grep-able.
  'music',
  'rock music', 'pop music', 'electronic music',
  'new release', 'new', 'release', 'album', 'single',

  // personal / collection-management tags
  'favorite', 'favorites', 'favourite', 'favourites',
  'favorite album', 'favorite albums', 'favourite album', 'favourite albums',
  'favorite songs', 'favourite songs', 'favorite song', 'favourite song',
  'favorite artist', 'favourite artist', 'favorite artists', 'favourite artists',
  'all time favorite', 'all time favorites', 'all-time favorite', 'all-time favorites',
  'top', 'top albums', 'top album', 'best', 'best albums', 'best album',
  'best ever', 'best of', 'the best',
  'best song', 'best songs', 'best track', 'best tracks',
  'favorite track', 'favorite tracks', 'favourite track', 'favourite tracks',
  'owned', 'own', 'own it', 'i own', 'albums i own',
  'want', 'wanted', 'wantlist', 'wishlist', 'want to hear',
  'heard', 'not heard', 'unheard', 'listened', 'to listen',
  'to-listen', 'need to listen', "haven't listened",
  'seen live', 'seenlive', 'seen-live',
  'recommended', 'recommendation', 'recommendations',

  // emotional / quality adjectives that get tagged like genres
  'awesome', 'amazing', 'great', 'good', 'excellent',
  'brilliant', 'cool', 'nice', 'beautiful', 'epic',
  'masterpiece', 'masterpieces', 'classic', 'classics',
  'overrated', 'underrated', 'under appreciated', 'underappreciated',
  'love', 'loved', 'love it', 'lovely',

  // format / source tags (belong on the physical row, not the genre list)
  'vinyl', 'cd', 'cassette', 'tape', 'mp3', 'flac',
  'lossless', 'hi-res', 'hires', '320', '320 kbps', '320kbps',
  'spotify', 'apple music', 'itunes', 'youtube', 'bandcamp', 'soundcloud',
]);

// Substring patterns for tag families too varied to enumerate fully
// above — catch anything that looks like a collection/listening-state
// annotation rather than a musical descriptor.
const EXCLUDED_PATTERNS: RegExp[] = [
  /\bfavou?rit/i,          // favorite, favourites, favoriting, ...
  /^my\b/i,                 // my albums, my collection, my favorites
  /\bto listen\b/i,
  /\bnot heard\b/i,
  /\blistened\b/i,
  /\bwishlist\b/i,
  /\bwant(ed| to| list)\b/i,
  /\bseen live\b/i,
  /\bmust hear\b/i,
  /\bneed to\b/i,
  // Anything containing "best" — editorial / listicle metadata
  // ("best of 2024", "best songs ever", "best metal albums") is
  // never a genre. Earlier the pattern only caught specific
  // phrasings; broadened to a single \bbest\b match because the
  // long-tail of "best of YYYY" / "best <subgenre>" variants is
  // too large to enumerate by hand and they're never musical
  // descriptors. False positives ("personal best" as an album
  // name) are vanishingly rare in tag space.
  /\bbest\b/i,
];

// Admin-curated tag blacklist, layered on top of EXCLUDED_TAGS. Loaded
// from the tag_blacklist table once and cached for 60s so the per-
// album cleanGenres path doesn't hit SQLite on every call. The cache
// is invalidated explicitly by the PATCH /tags handler when admin
// blacklists new tags so the new entry takes effect immediately.
let _tagBlacklistCache: Set<string> | null = null;
let _tagBlacklistCacheAt = 0;
const TAG_BLACKLIST_TTL_MS = 60_000;
function getTagBlacklist(): Set<string> {
  const now = Date.now();
  if (
    _tagBlacklistCache &&
    now - _tagBlacklistCacheAt < TAG_BLACKLIST_TTL_MS
  ) {
    return _tagBlacklistCache;
  }
  const rows = queryAll(`SELECT tag FROM tag_blacklist`) as Array<{ tag: string }>;
  _tagBlacklistCache = new Set(rows.map((r) => r.tag.toLowerCase()));
  _tagBlacklistCacheAt = now;
  return _tagBlacklistCache;
}
export function invalidateTagBlacklistCache(): void {
  _tagBlacklistCache = null;
  _tagBlacklistCacheAt = 0;
}

// Tags banned by policy without needing a tag_blacklist row — the
// long-tail of editorial / collection metadata that can't be
// enumerated one entry at a time:
//   - digit-only ("2005", "1990") — release-year noise
//   - anything containing "best" ("best of 2024", "best songs ever",
//     "best metal albums") — listicle / editorial fluff
// Used at PATCH input sanitisation so the operator can't accidentally
// reintroduce them via the TagEditor input. The cleanGenres pass on
// the read+write paths (EXCLUDED_PATTERNS) handles the import-time
// gate; this is the defence on the manual-edit path.
function isAutoBannedTag(lowerTrimmed: string): boolean {
  if (/^\d+$/.test(lowerTrimmed)) return true;
  if (/\bbest\b/.test(lowerTrimmed)) return true;
  return false;
}

// Known short genre names to keep (3 chars or less)
const VALID_SHORT_GENRES = new Set([
  'emo', 'edm', 'rap', 'ska', 'dub', 'rnb', 'pop', 'r&b',
]);

// Known short genre names to keep (4-5 chars)
const VALID_MID_GENRES = new Set([
  'rock', 'vocal',
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
  const blacklist = getTagBlacklist();

  for (const tag of raw) {
    const lower = tag.toLowerCase().trim();
    if (!lower) continue;
    if (seen.has(lower)) continue;
    if (EXCLUDED_TAGS.has(lower)) continue;
    if (blacklist.has(lower)) continue;
    if (EXCLUDED_PATTERNS.some((re) => re.test(lower))) continue;
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

// Resolve the genres shown on the album detail page. If the admin has
// run PATCH /api/albums/:id/tags at least once, `manual_genres` carries
// their explicit picks — those bypass the import-side filters in
// cleanGenres so additions like "Hip-Hop" / "Rock" / short codes that
// the import gate would silently strip can still appear. When the
// override column is null (legacy rows / albums admin never touched)
// we fall back to cleanGenres(raw).
//
// Title-casing applied so the override matches the visual style of the
// filtered path. Capped at the same top-N used by cleanGenres so a
// runaway raw list (e.g. an admin paste of 30 tags) doesn't blow up
// the header section layout.
function resolveDisplayGenres(
  manualJson: string | null | undefined,
  rawGenres: string[],
  artistName?: string
): string[] {
  if (manualJson) {
    try {
      const parsed = JSON.parse(manualJson);
      if (Array.isArray(parsed)) {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const t of parsed) {
          if (typeof t !== 'string') continue;
          const trimmed = t.trim();
          if (!trimmed) continue;
          const key = trimmed.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(trimmed.replace(/\b\w/g, (c) => c.toUpperCase()));
          if (out.length >= 5) break;
        }
        return out;
      }
    } catch {
      // Fall through to cleanGenres on malformed JSON.
    }
  }
  return cleanGenres(rawGenres, artistName);
}

// ─── Helper: build album base data (fast path) ─────────────────────────────

interface GetOrFetchOpts {
  /** Stamped into albums.requested_by_user_id for new rows only
   *  (never overrides an existing value). Unified registration flow
   *  as of 2026-04: every new album (admin or user) lands with
   *  reviews_crawled_at NULL. Admin explicitly kicks off the Claude
   *  review pipeline later via approveAlbumRequest / 리뷰 모아오기.
   *  Similar-album + pronunciation calls are still fine to run eagerly
   *  — they're ~$0.005 each, not the $0.10+ that reviews_search costs. */
  requestedByUserId?: number;
}

// Public wrapper used by routes/albumRequests.ts for user submissions.
// Exposed via a separate name so the module-private internals stay
// private; the request path passes `requestedByUserId` for
// attribution on the "내 등록 앨범" profile section.
export async function getOrFetchAlbumBaseForSubmission(
  mbid: string,
  opts: GetOrFetchOpts
) {
  return getOrFetchAlbumBase(mbid, opts);
}

async function getOrFetchAlbumBase(mbid: string, opts: GetOrFetchOpts = {}) {
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

    // Backfill release_date if missing — fire and forget. Only runs when
    // BOTH date and year are absent so an admin who explicitly clears the
    // release_date (typically while fixing a reissue year) doesn't see it
    // restored from MusicBrainz on the next page load. mb.date already
    // prefers release-group first-release-date, so this fills in the
    // original year for older cached rows that pre-date that change.
    if (
      !cached.release_date &&
      !cached.release_year &&
      cached.mbid &&
      !cached.mbid.startsWith('discogs-') &&
      !cached.mbid.startsWith('manual-')
    ) {
      getRelease(cached.mbid).then((mb) => {
        if (mb?.date) updateAlbumFields(mbid, { release_date: mb.date });
      }).catch((err) => {
        console.warn(`[backfill] release_date failed for mbid=${mbid}:`, (err as Error).message);
      });
    }

    // Backfill artist_credit_json for legacy rows that pre-date the
    // multi-artist column. Fires only on real MB ids (Discogs path
    // synthesises a single-element credit at insert time and never
    // benefits from a second fetch). Also overwrites artist_name with
    // the comma-joined credit so list endpoints that don't return
    // the structured array still render the full collab text.
    if (
      !cached.artist_credit_json &&
      cached.mbid &&
      !cached.mbid.startsWith('discogs-') &&
      !cached.mbid.startsWith('manual-')
    ) {
      getRelease(cached.mbid).then((mb) => {
        if (!mb?.artistCredit || mb.artistCredit.length === 0) return;
        updateAlbumFields(mbid, {
          artist_credit_json: JSON.stringify(mb.artistCredit),
          artist_name: mb.artist,
        });
      }).catch((err) => {
        console.warn(`[backfill] artist_credit failed for mbid=${mbid}:`, (err as Error).message);
      });
    }

    // Refresh Discogs prices if stale (>24h) — fire and forget
    const formatsUpdatedAt = cached.discogs_formats_updated_at;
    const formatsStale = !formatsUpdatedAt ||
      (Date.now() - new Date(formatsUpdatedAt).getTime()) > 6 * 60 * 60 * 1000;
    if (formatsStale && cached.artist_name && cached.title) {
      getMasterMarketData(cached.artist_name, cached.title, cached.discogs_id || null).then((fresh) => {
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

    // Backfill Korean transliteration + meaning when missing.
    // "_none_" marks albums where the meaning was attempted but came back
    // empty (proper nouns etc.) so we don't re-call for the meaning alone.
    let titleMeaning = cached.title_meaning || null;
    if (titleMeaning === '_none_') titleMeaning = null;
    let artistKo: string | null = cached.artist_ko || null;
    let titleKo: string | null = cached.title_ko || null;

    // Retry not only when title_meaning is unset, but also when the KO
    // fields are still empty. A pronunciation call that FAILED entirely
    // (e.g. during the DeepSeek `deepseek-chat` 400 outage) wrote
    // title_meaning='_none_' as its "attempted" marker without any KO
    // fields — and the old `!title_meaning`-only gate then treated that
    // truthy '_none_' as "done" and locked the album out of ever getting
    // Korean. Proper-noun albums with a legitimately empty meaning already
    // carry KO transliterations, so this extra clause doesn't re-run them.
    // Fire-and-forget: an LLM call must never block the album base read.
    // This used to `await`, which parked the whole page on the
    // LoadingSkeleton for the full pronunciation round-trip on every
    // visit — and permanently for albums where the call keeps returning
    // null (title_meaning stays '_none_' with empty KO, so needsPron
    // never clears and the blocking call re-fires each load). The fresh
    // KO now lands on the next visit instead of this one, matching the
    // release_date / artist_credit / Discogs-price backfills above.
    const needsPron =
      !!cached.title &&
      !!cached.artist_name &&
      (!cached.title_meaning || (!artistKo && !titleKo));
    if (needsPron) {
      generatePronunciation(cached.artist_name, cached.title).then((pron) => {
        const fields: Record<string, any> = {};
        if (pron?.titleMeaning) {
          fields.title_meaning = pron.titleMeaning;
        } else {
          fields.title_meaning = '_none_'; // mark as attempted
        }
        if (!artistKo && pron?.artistKo) fields.artist_ko = pron.artistKo;
        if (!titleKo && pron?.titleKo) fields.title_ko = pron.titleKo;
        updateAlbumFields(mbid, fields);
      }).catch((err) => {
        console.warn(`[pronunciation] backfill failed for mbid=${mbid}:`, (err as Error).message);
      });
    }

    // Parse the multi-artist credit JSON if present. Older cached
    // rows have artist_credit_json = NULL — synthesise a 1-element
    // credit from the legacy single fields so the response shape
    // is uniform (display layer doesn't have to special-case
    // missing-credit). Async backfill above may populate the JSON
    // on a subsequent visit.
    let artistCredit: Array<{ name: string; mbid: string | null }>;
    if (cached.artist_credit_json) {
      try {
        artistCredit = JSON.parse(cached.artist_credit_json);
      } catch {
        artistCredit = [{ name: cached.artist_name, mbid: cached.artist_mbid || null }];
      }
    } else {
      artistCredit = [{ name: cached.artist_name, mbid: cached.artist_mbid || null }];
    }

    return {
      album: {
        mbid: cached.mbid,
        slug: cached.slug || null,
        title: cached.title,
        artist: cached.artist_name,
        artistMbid: cached.artist_mbid,
        artistCredit,
        releaseDate: cached.release_date || cached.release_year?.toString() || '',
        releaseYear: cached.release_year ?? null,
        format: cached.format || null,
        discogsUrl: cached.discogs_url || null,
        label: cached.label_name,
        // manual_genres (admin override via PATCH /tags) wins when set —
        // it survives the EXCLUDED_TAGS / length / digit gates that
        // cleanGenres applies to import-side noise.
        genres: resolveDisplayGenres(cached.manual_genres, genres, cached.artist_name),
        coverArtUrl: cached.cover_art_url,
        coverArtFallbacks: cachedFallbacks,
        artistKo,
        titleKo,
        titleMeaning,
        reviewsCrawledAt: cached.reviews_crawled_at || null,
      },
      streaming: {
        spotify: cached.spotify_url,
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
  // Multi-artist credit collected from whichever source we end up
  // hitting. MusicBrainz populates this with the full collab array;
  // Discogs only gives us a single string so we synthesise a 1-
  // element credit so the cache + response shape is uniform.
  let artistCredit: Array<{ name: string; mbid: string | null }> = [];
  // MusicBrainz release-group classification — copied through so the
  // search ranker can treat plain studio LPs as a tier above live /
  // compilation / remix groups. NULL on the Discogs path because
  // Discogs doesn't carry the release-group "secondary types"
  // vocabulary.
  let primaryType: string | null = null;
  let secondaryTypes: string[] | null = null;

  if (isDiscogs) {
    // Two shapes accepted:
    //   discogs-master-{id}  → a MASTER id (from search / discography lookups)
    //   discogs-{id}         → a RELEASE id (legacy)
    // Master ids need one extra hop to resolve to main_release before we can
    // pull the release detail; otherwise we'd fetch /releases/{masterId} which
    // is a completely different release with the same numeric id.
    const raw = mbid.replace(/^discogs-/, '');
    let releaseId: number;
    if (raw.startsWith('master-')) {
      const masterId = parseInt(raw.replace('master-', ''), 10);
      if (!Number.isFinite(masterId) || !masterId) return null;
      const mainRelease = await getDiscogsMasterMainRelease(masterId);
      if (!mainRelease) return null;
      releaseId = mainRelease;
    } else {
      releaseId = parseInt(raw, 10);
      if (!Number.isFinite(releaseId) || !releaseId) return null;
    }
    const detail = await getDiscogsReleaseDetail(releaseId);
    if (!detail) return null;

    artistName = detail.artist;
    albumTitle = detail.title;
    labelName = detail.label;
    releaseDate = detail.releaseDate || detail.year;
    discogsArtistId = detail.artistId;
    format = detail.format;
    genres = detail.genres;
    primaryCoverArtUrl = detail.coverArtUrl;
    // Discogs gives a single-string artist (often already comma- or
    // " & "-joined when the release is a collab). We don't try to
    // split it back into structured entries — it'd be a heuristic
    // hack — so synthesise a one-element credit. Albums sourced via
    // Discogs that turn out to be collabs will only get the
    // structured credit if/when admin re-fetches via MusicBrainz.
    artistCredit = [{ name: artistName, mbid: null }];
  } else {
    // getRelease throws on a transient MusicBrainz failure (so the
    // memo cache evicts and a retry re-hits MB) and returns a falsy
    // value only for a genuinely unknown release. Both collapse to
    // "not found" here — the album-requests route surfaces the
    // friendly "외부 소스에서 찾지 못했어요, 다시 검색해 주세요" message,
    // and because the failure wasn't cached the retry actually works.
    let mbRelease: Awaited<ReturnType<typeof getRelease>>;
    try {
      mbRelease = await getRelease(mbid);
    } catch (err) {
      console.warn(`[albums] MB release fetch failed for mbid=${mbid}:`, (err as Error).message);
      return null;
    }
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
    artistCredit = mbRelease.artistCredit || [];
    if (artistCredit.length === 0 && artistName) {
      artistCredit = [{ name: artistName, mbid: artistMbid }];
    }
    primaryType = mbRelease.releaseGroup?.primaryType || null;
    secondaryTypes = mbRelease.releaseGroup?.secondaryTypes ?? null;
  }

  // Fetch links + metadata in parallel
  const [
    spotifyFetch, youtubeFetch,
    bandcampFetch, discogsFetch, lastfmFetch,
  ] = await Promise.allSettled([
    searchTrack(artistName, albumTitle),
    searchVideo(artistName, albumTitle),
    searchBandcamp(artistName, albumTitle),
    isDiscogs ? Promise.resolve(null) : searchRelease(artistName, albumTitle),
    getAlbumInfo(artistName, albumTitle),
  ]);

  const spotifyResult = spotifyFetch.status === 'fulfilled' ? spotifyFetch.value : null;
  const spotifyUrl = spotifyResult?.url || null;
  const spotifyImageUrl = spotifyResult?.imageUrl || null;
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
    artistCredit,
    releaseDate,
    releaseYear: releaseYear ? parseInt(releaseYear, 10) : null,
    format: format || null,
    discogsUrl: masterMarket?.discogsUrl || discogsRelease?.url || null,
    label: labelName,
    genres: cleanGenres(genres, artistName),
    coverArtUrl: primaryCoverArtUrl,
    coverArtFallbacks,
    artistKo,
    titleKo,
    titleMeaning,
    // Unified flow: every fresh album lands with reviews_crawled_at
    // NULL. Admin opts into the Claude review pipeline later via
    // 리뷰 모아오기 or 요약 생성.
    reviewsCrawledAt: null,
  };

  const streamingData = {
    spotify: spotifyUrl,
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
    artist_credit: artistCredit,
    label_name: labelName,
    label_id: null,
    release_year: releaseYear ? parseInt(releaseYear, 10) : null,
    release_date: releaseDate || null,
    format: format || null,
    genres,
    cover_art_url: primaryCoverArtUrl,
    cover_art_fallbacks: coverArtFallbacks,
    spotify_url: spotifyUrl,
    youtube_url: youtubeUrl,
    bandcamp_url: bandcampUrl,
    discogs_id: masterMarket?.masterId || discogsRelease?.discogsId || null,
    discogs_artist_id: discogsArtistId,
    discogs_url: masterMarket?.discogsUrl || discogsRelease?.url || null,
    discogs_formats_json: buyData.formats.length > 0 ? JSON.stringify(buyData.formats) : null,
    artist_ko: artistKo,
    title_ko: titleKo,
    title_meaning: titleMeaning,
    primary_type: primaryType,
    secondary_types: secondaryTypes,
  });

  // Stamp the user-submission marker. reviews_crawled_at stays NULL
  // regardless of who registered — admin kicks the Claude review
  // pipeline later via "리뷰 모아오기", or drops manual reviews in
  // and clicks "요약 생성" to stamp. No more review warmup on
  // registration for anyone: the ~$0.10 cost is opt-in now, not a
  // side effect of clicking "+ 등록".
  if (opts.requestedByUserId != null) {
    updateAlbumFields(mbid, {
      requested_by_user_id: opts.requestedByUserId,
    });
  }

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

const ALBUM_PAGE_SIZE_DEFAULT = 20;
// Ceiling for client-requested pageSize. Bumped from 50 to 150 so
// /dig's adaptive sizing can fully fill ultra-density × tall
// monitors (10 cols × ≥10 rows). The server-side N+1 subqueries
// per row are still cheap enough at this scale to not need
// JOIN/GROUP-BY collapsing — at ~600 albums and a few thousand
// reviews, the correlated subqueries hit indexes for the LIMIT'd
// row set and beat a full-aggregate JOIN materialisation by ~2×
// (benchmarked 2026-05-02). Revisit if/when album count or
// review count grows an order of magnitude.
const ALBUM_PAGE_SIZE_MAX = 150;

const SORT_CLAUSES: Record<string, string> = {
  registered_desc:   `a.id DESC`,
  registered_asc:    `a.id ASC`,
  release_date_desc: `COALESCE(a.release_date, a.release_year || '-01-01') DESC, a.id DESC`,
  release_date_asc:  `COALESCE(a.release_date, a.release_year || '-01-01') ASC, a.id ASC`,
  artist_az:         `LOWER(a.artist_name) ASC, a.id ASC`,
  score_desc:        `avg_score IS NULL, avg_score DESC, a.id DESC`,
  score_asc:         `avg_score IS NULL, avg_score ASC, a.id ASC`,
  // 50자 평이 많은 앨범 우선. user_review_count is selected on every row
  // already (see ALBUM_ROW_SELECT) so this is a column reference, not an
  // inline subquery.
  user_review_count_desc: `user_review_count DESC, a.id DESC`,
  upvotes_desc:      `upvotes DESC, a.id DESC`,
  downvotes_desc:    `downvotes DESC, a.id DESC`,
  // Admin-only "리뷰 없음" sort — registered newest first within the
  // uncrawled subset. The WHERE filter that narrows to that subset
  // lives in the request handler, paired with this ORDER BY.
  no_reviews:        `a.id DESC`,
};

const ALBUM_ROW_SELECT = `
  SELECT a.id, a.slug, a.mbid, a.title, a.artist_name, a.release_date, a.release_year,
         a.cover_art_url, a.cover_art_fallbacks, a.genres, a.spotify_url,
         a.reviews_crawled_at, a.created_at,
         COALESCE((SELECT SUM(CASE WHEN vote='up' THEN 1 ELSE 0 END) FROM album_votes WHERE album_id = a.id), 0) AS upvotes,
         COALESCE((SELECT SUM(CASE WHEN vote='down' THEN 1 ELSE 0 END) FROM album_votes WHERE album_id = a.id), 0) AS downvotes,
         (SELECT AVG(CASE
                       WHEN COALESCE(r.manual_score, r.score) IS NOT NULL AND r.score_max > 0
                       THEN (COALESCE(r.manual_score, r.score) * 1.0 / r.score_max) * 100
                     END)
          FROM reviews r WHERE r.album_mbid = a.mbid) AS avg_score,
         (SELECT COUNT(*) FROM reviews r
          WHERE r.album_mbid = a.mbid
            AND COALESCE(r.manual_score, r.score) IS NOT NULL
            AND r.score_max > 0) AS review_count,
         COALESCE((SELECT COUNT(*) FROM user_reviews WHERE album_id = a.id), 0) AS user_review_count,
         -- crate_count: distinct users who have this album in any of
         -- their PUBLIC crates. Replaces the prior owned_count +
         -- wanted_count (collections + wants tables, both absorbed
         -- into crates 2026-04-28). Public-only because private
         -- crates are explicitly the "남들 눈치 안 보고 담는 곳" —
         -- their counts shouldn't surface on album cards.
         COALESCE((
           SELECT COUNT(DISTINCT cb.user_id)
           FROM crate_items ci
           JOIN crate_boxes cb ON cb.id = ci.crate_id
           WHERE ci.album_id = a.id AND cb.is_public = 1
         ), 0) AS crate_count
  FROM albums a
`;

router.get('/', async (req, res) => {
  try {
    // Public home grid — response is identical for every viewer with
    // the same query string (sort / page / lens / seed all live in
    // the URL, so cache keys split cleanly). A logged-in user who just
    // registered an album sees it in the grid on the next refetch via
    // the client's post-mutation cache-key bump; anon visitors seeing
    // a new registration up to 5 minutes late is acceptable, and the
    // longer TTL is what keeps the LAX-colo HIT rate high.
    setEdgeCache(res, 'public, max-age=0, s-maxage=300, stale-while-revalidate=900');

    const sortKey = (req.query.sort as string) || 'release_date_desc';
    const isPriceSort = sortKey === 'price_asc' || sortKey === 'price_desc';
    // Random sort is seeded — the client passes a per-session seed (int) so
    // pagination and infinite scroll produce a stable shuffle across page
    // fetches. Without a seed each request would re-shuffle and users would
    // see duplicates across pages. Seed is validated as a non-negative int
    // to make it safe to interpolate into SQL.
    let orderBy = SORT_CLAUSES[sortKey] || SORT_CLAUSES.release_date_desc;
    if (sortKey === 'random') {
      const rawSeed = parseInt((req.query.seed as string) || '0', 10);
      const seed = Number.isFinite(rawSeed) && rawSeed >= 0 ? rawSeed : 0;
      orderBy = `((a.id * ${seed} + ${seed + 31}) % 10007)`;
    }

    const pageRaw = parseInt((req.query.page as string) || '1', 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

    // Mobile uses a smaller pageSize for infinite scroll; desktop keeps 20.
    // Clamped so a malformed param can't trigger an unbounded fetch.
    const pageSizeRaw = parseInt((req.query.pageSize as string) || '', 10);
    const pageSize =
      Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
        ? Math.min(pageSizeRaw, ALBUM_PAGE_SIZE_MAX)
        : ALBUM_PAGE_SIZE_DEFAULT;
    const offset = (page - 1) * pageSize;

    // Score-based sorts only make sense with enough scored reviews to
    // average meaningfully. Anything under 3 is a single opinion
    // dressed up as a ranking. The WHERE clause is a correlated
    // subquery on reviews rather than a HAVING on the selected
    // review_count column because SQLite doesn't let us reference
    // aliased SELECT columns in WHERE.
    const isScoreSort = sortKey === 'score_desc' || sortKey === 'score_asc';
    // Admin-only work queue: albums where the review pipeline has
    // never been triggered. reviews_crawled_at is the canonical
    // signal — backfilled to NOT NULL on legacy rows; stays NULL on
    // every new registration until admin runs the scrape. Ordering
    // falls back to registered_desc inside SORT_CLAUSES below.
    const isNoReviewsSort = sortKey === 'no_reviews';

    // Lens filter — one active lens at a time, encoded as
    // ?lens=<type>:<value>. Supported types: `label` (a.label_name —
    // the labels-table FK never gets populated in practice, so we
    // key off the name column the importer actually fills) and
    // `year` (a.release_year). The UI only ever emits one lens, and
    // anything not matching the two known shapes is silently
    // dropped — invalid values fall through to "no lens" rather
    // than erroring, since the typical bad input is a stale shared
    // URL pointing at a deleted entity. Both values are bound as
    // `?` params so they can never be SQL-injected.
    const whereParts: string[] = [];
    const filterParams: any[] = [];
    if (isScoreSort) {
      whereParts.push(
        `(SELECT COUNT(*) FROM reviews r
            WHERE r.album_mbid = a.mbid
              AND COALESCE(r.manual_score, r.score) IS NOT NULL
              AND r.score_max > 0) >= 3`
      );
    } else if (isNoReviewsSort) {
      whereParts.push(`a.reviews_crawled_at IS NULL`);
    }

    const rawLens = (req.query.lens as string) || '';
    const lensColon = rawLens.indexOf(':');
    if (lensColon > 0) {
      const lensType = rawLens.slice(0, lensColon);
      const lensVal = rawLens.slice(lensColon + 1);
      if (lensType === 'label') {
        if (lensVal.length > 0 && lensVal.length <= 200) {
          // COLLATE NOCASE so the lens treats "Century Media" /
          // "century media" / "CENTURY MEDIA" as one label, in case
          // a casing variant slips in between canonicalisation
          // migration runs (or arrives via a shared URL someone
          // typed by hand). NOCASE is ASCII-only — non-ASCII label
          // names compare byte-equal, which is the same behavior as
          // the previous `=` comparison.
          whereParts.push(`a.label_name = ? COLLATE NOCASE`);
          filterParams.push(lensVal);
        }
      } else if (lensType === 'artist') {
        // Same shape as the label lens: exact match on the text column
        // the importer fills (a.artist_name), COLLATE NOCASE so casing
        // variants fold together. Unlike label, the artist lens has no
        // picker — it's reached only by clicking an artist name (search
        // row / album card / album header), so there's no lens-options
        // entry and no browsable list to grow unbounded. Multi-artist
        // collaborations stored as a joined artist_name won't match a
        // single member here; that's accepted until it's a real
        // complaint (then artist_mbid becomes the upgrade path).
        if (lensVal.length > 0 && lensVal.length <= 200) {
          whereParts.push(`a.artist_name = ? COLLATE NOCASE`);
          filterParams.push(lensVal);
        }
      } else if (lensType === 'year') {
        const yNum = parseInt(lensVal, 10);
        if (Number.isFinite(yNum) && yNum > 1900 && yNum < 2200) {
          whereParts.push(`a.release_year = ?`);
          filterParams.push(yNum);
        }
      }
    }

    const filterSql = whereParts.length
      ? `WHERE ${whereParts.join(' AND ')}`
      : '';

    const total =
      (queryGet(
        `SELECT COUNT(*) AS c FROM albums a ${filterSql}`,
        filterParams
      )?.c as number) || 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    let albums: any[];
    if (isPriceSort) {
      // Currency conversion has to happen in-app, so fetch all albums + all
      // purchase links, compute min USD price per album, sort, then paginate.
      const allAlbums = queryAll(
        `${ALBUM_ROW_SELECT} ${filterSql}`,
        filterParams
      ) as any[];
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

      albums = allAlbums.slice(offset, offset + pageSize);
    } else {
      albums = queryAll(
        `${ALBUM_ROW_SELECT}
         ${filterSql}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
        [...filterParams, pageSize, offset]
      );
    }

    // Batch-fetch all purchase links for the listed albums, then group + sort
    // by KRW-converted price to pick each album's top 3 for the cover stickers.
    const topLinksByAlbum = new Map<number, any[]>();
    // Status flags for the cover-sticker stack (PRE-ORDER / SALE /
    // SOLD OUT). Computed from *all* links, not the top-3 subset,
    // so a cheap regular copy doesn't hide a soldout listing from
    // the grid-level indicators.
    const statusFlagsByAlbum = new Map<
      number,
      { preorder: boolean; sale: boolean; soldout: boolean }
    >();
    if (albums.length > 0) {
      const placeholders = albums.map(() => '?').join(',');
      const linkRows = queryAll(
        `SELECT album_id, id, url, store_name, store_favicon_url, price, currency, format, status
         FROM purchase_links WHERE album_id IN (${placeholders})`,
        albums.map((a: any) => a.id)
      );

      const listRates = await getRates();
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
            ? convertToKrwSync(l.price, l.currency, listRates)
            : null,
        format: l.format,
        status: allowedStatus.has(l.status) ? l.status : null,
      }));

      for (const link of enriched) {
        const bucket = topLinksByAlbum.get(link.albumId) || [];
        bucket.push(link);
        topLinksByAlbum.set(link.albumId, bucket);

        if (link.status) {
          const flags =
            statusFlagsByAlbum.get(link.albumId) ||
            { preorder: false, sale: false, soldout: false };
          if (link.status === 'upcoming') flags.preorder = true;
          else if (link.status === 'sale') flags.sale = true;
          else if (link.status === 'soldout') flags.soldout = true;
          statusFlagsByAlbum.set(link.albumId, flags);
        }
      }
      for (const [aid, links] of topLinksByAlbum) {
        // Two-key sort: push soldout entries behind in-stock ones, then
        // by KRW ascending within each group. The home grid only shows
        // the very cheapest sticker (maxVisible=1), and a sold-out
        // listing as the headline price is misleading — the user can't
        // actually buy at that price. Preferring an available copy
        // even at a higher tag matches what a shopper actually cares
        // about; if every link is sold out we still surface the
        // cheapest one so the price information isn't lost.
        links.sort((a, b) => {
          const aSold = a.status === 'soldout';
          const bSold = b.status === 'soldout';
          if (aSold !== bSold) return aSold ? 1 : -1;
          return (
            (a.priceKrw ?? Number.POSITIVE_INFINITY) -
            (b.priceKrw ?? Number.POSITIVE_INFINITY)
          );
        });
        topLinksByAlbum.set(
          aid,
          links.slice(0, 3).map(({ albumId: _ignored, ...rest }) => rest)
        );
      }
    }

    // ── HOT flag ─────────────────────────────────────────────────────
    // Top-10 albums by either side of the 굿굿/별루 vote. The sticker
    // is "this album is moving the needle, in either direction" — a
    // pile of 별루 votes is just as worth flagging as a pile of 굿굿.
    // Floor: 3 on whichever side qualifies, so a single early vote
    // doesn't earn the badge. Ranking key: max(up, down) desc, so an
    // album with 50 굿굿 ranks alongside one with 50 별루.
    const HOT_MIN = 3;
    const HOT_LIMIT = 10;
    const hotIdRows = queryAll(
      `WITH vote_counts AS (
         SELECT album_id,
                SUM(CASE WHEN vote='up' THEN 1 ELSE 0 END) AS up_count,
                SUM(CASE WHEN vote='down' THEN 1 ELSE 0 END) AS down_count
         FROM album_votes
         GROUP BY album_id
       )
       SELECT album_id AS id, up_count, down_count
       FROM vote_counts
       WHERE up_count >= ? OR down_count >= ?
       ORDER BY MAX(up_count, down_count) DESC, album_id DESC
       LIMIT ?`,
      [HOT_MIN, HOT_MIN, HOT_LIMIT]
    ) as Array<{ id: number; up_count: number; down_count: number }>;
    const hotAlbumIds = new Set(hotIdRows.map((r) => r.id));

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
        releaseDate: a.release_date || null,
        coverArtUrl: a.cover_art_url,
        coverArtFallbacks: a.cover_art_fallbacks ? JSON.parse(a.cover_art_fallbacks) : [],
        spotifyUrl: a.spotify_url ?? null,
        averageScore: a.avg_score != null ? Math.round(a.avg_score) : null,
        reviewCount: a.review_count || 0,
        userReviewCount: a.user_review_count || 0,
        upvotes: a.upvotes || 0,
        downvotes: a.downvotes || 0,
        priceTagLinks: topLinksByAlbum.get(a.id) || [],
        genres,
        reviewsCrawledAt: a.reviews_crawled_at,
        createdAt: a.created_at,
        crateCount: a.crate_count || 0,
        isHot: hotAlbumIds.has(a.id),
        // Cover-sticker status set — true if at least one purchase
        // link for this album has that status (any format, any
        // store). Drives the PRE-ORDER / SALE / SOLD OUT chips on
        // the home grid.
        hasPreorderLink: !!statusFlagsByAlbum.get(a.id)?.preorder,
        hasSaleLink: !!statusFlagsByAlbum.get(a.id)?.sale,
        hasSoldoutLink: !!statusFlagsByAlbum.get(a.id)?.soldout,
      };
    });

    res.json({
      albums: result,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    console.error('List albums error:', error);
    res.status(500).json({ error: 'Failed to list albums' });
  }
});

// ─── GET /api/albums/neighbors — prev/next album given a sort order ──────
//
// Returns the immediately preceding and following album for the given
// album ID + sort, so the album page can show browse arrows. For
// random sort, returns a random album. price_asc/price_desc are
// excluded (too expensive to compute inline).

// ─── GET /api/albums/lens-options — picker data for /dig lens menu ─────
//
// Returns the lens values the picker should offer:
//   - labels: distinct label_name values present on registered albums,
//     sorted by album count desc, capped so the popover stays short.
//     Grouped on label_name (not label_id) because the labels-table FK
//     is never populated in practice — the importer fills label_name.
//     Casing variants of the same label ("Frontiers Music Srl" vs
//     "Frontiers Music SRL") surface as separate rows; normalising is
//     a follow-up cleanup, not this PR's concern.
//   - years: distinct release_year values across the catalog, sorted
//     descending (newer first) since that's the dominant browsing
//     direction. NULL release_year is dropped.
//
// One read per surface mount; no auth gating — the picker is part of
// /dig's public surface. The shape is intentionally flat / pre-counted
// so the client doesn't have to do its own aggregation.
router.get('/lens-options', (_req, res) => {
  try {
    // GROUP BY NOCASE folds casing variants into one picker row even
    // when the canonicalisation migration hasn't run on the variants
    // yet (e.g. a new variant arrived between deploys). MIN() picks
    // a deterministic representative for the display name — in ASCII
    // that's the uppercase-leaning variant ("SRL" < "Srl"), which is
    // fine as a safety-net default; the one-shot migration that
    // already ran is what gives the catalog its real canonical form.
    const labels = queryAll(
      `SELECT MIN(a.label_name) AS name, COUNT(*) AS count
         FROM albums a
        WHERE a.label_name IS NOT NULL AND a.label_name != ''
        GROUP BY a.label_name COLLATE NOCASE
        ORDER BY count DESC, MIN(a.label_name) COLLATE NOCASE ASC
        LIMIT 60`
    );
    const years = queryAll(
      `SELECT a.release_year AS year, COUNT(*) AS count
         FROM albums a
        WHERE a.release_year IS NOT NULL
        GROUP BY a.release_year
        ORDER BY a.release_year DESC`
    );
    res.json({ labels, years });
  } catch (e) {
    console.error('lens-options error', e);
    res.status(500).json({ error: 'lens-options failed' });
  }
});

router.get('/neighbors', (req, res) => {
  try {
    // Prev/next pointers depend only on the current album + sort key
    // (both in the URL). No per-user state. Same TTL as the album
    // grid since the same data drives both surfaces.
    setEdgeCache(res, 'public, max-age=0, s-maxage=300, stale-while-revalidate=900');

    const sortKey = (req.query.sort as string) || 'release_date_desc';
    const albumId = req.query.id as string;
    if (!albumId) return res.json({ prev: null, next: null });

    // Resolve to internal row
    const resolved = resolveAlbumId(albumId);
    const mbid = resolved?.mbid || albumId;
    const current = getCachedAlbum(mbid);
    if (!current) return res.json({ prev: null, next: null });

    const id = current.id;

    // Random: just pick two random albums that aren't the current one
    if (sortKey === 'random') {
      const randoms = queryAll(
        `SELECT slug, mbid, title, artist_name, cover_art_url, cover_art_fallbacks
         FROM albums WHERE id != ? ORDER BY RANDOM() LIMIT 2`,
        [id]
      ) as any[];
      const fmt = (r: any) => r ? {
        slug: r.slug || r.mbid,
        title: r.title,
        artist: r.artist_name,
        coverArtUrl: r.cover_art_url,
        coverArtFallbacks: r.cover_art_fallbacks ? JSON.parse(r.cover_art_fallbacks) : [],
      } : null;
      return res.json({
        prev: fmt(randoms[0] || null),
        next: fmt(randoms[1] || null),
      });
    }

    // Price sorts are too complex for a simple neighbor query
    if (sortKey === 'price_asc' || sortKey === 'price_desc') {
      return res.json({ prev: null, next: null });
    }

    const orderByClause = SORT_CLAUSES[sortKey] || SORT_CLAUSES.release_date_desc;

    // Mirror the home-list filters so prev/next navigation doesn't
    // jump to albums that wouldn't appear in the filtered grid:
    //   - score_*: at least 3 scored reviews
    //   - no_reviews: reviews_crawled_at IS NULL (admin work queue)
    // Other sorts keep the full list.
    const isScoreSortNeighbor =
      sortKey === 'score_desc' || sortKey === 'score_asc';
    const isNoReviewsNeighbor = sortKey === 'no_reviews';
    let neighborFilterSql = '';
    if (isScoreSortNeighbor) {
      neighborFilterSql = `WHERE (SELECT COUNT(*) FROM reviews r
               WHERE r.album_mbid = a.mbid
                 AND COALESCE(r.manual_score, r.score) IS NOT NULL
                 AND r.score_max > 0) >= 3`;
    } else if (isNoReviewsNeighbor) {
      neighborFilterSql = `WHERE a.reviews_crawled_at IS NULL`;
    }

    // Strategy: get the full sorted list of (id, slug, mbid, title, artist, cover)
    // and find our position. For a DB of ~thousands this is fast enough.
    const allRows = queryAll(
      `${ALBUM_ROW_SELECT} ${neighborFilterSql} ORDER BY ${orderByClause}`
    ) as any[];

    const idx = allRows.findIndex((r: any) => r.id === id);
    if (idx === -1) return res.json({ prev: null, next: null });

    const fmt = (r: any) => r ? {
      slug: r.slug || r.mbid,
      title: r.title,
      artist: r.artist_name,
      coverArtUrl: r.cover_art_url,
      coverArtFallbacks: r.cover_art_fallbacks ? JSON.parse(r.cover_art_fallbacks) : [],
    } : null;

    res.json({
      prev: idx > 0 ? fmt(allRows[idx - 1]) : null,
      next: idx < allRows.length - 1 ? fmt(allRows[idx + 1]) : null,
    });
  } catch (error) {
    console.error('Neighbors error:', error);
    res.json({ prev: null, next: null });
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
      return res
        .status(502)
        .json({ error: 'LLM이 빈 응답/파싱 불가 결과를 반환했습니다.' });
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
    // Surface the underlying reason (e.g. "DeepSeek API 400: ... you passed
    // deepseek-chat") so the admin can tell an env/model problem apart from
    // a transient one instead of a generic "failed".
    const msg = (error as Error)?.message || 'unknown';
    console.error('Regenerate pronunciation error:', error);
    res.status(500).json({ error: `번역 재생성 실패: ${msg}` });
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

// ─── PATCH /api/albums/:id — admin edit core album metadata ─────────────

router.patch('/:id', requireAdmin, (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const row = queryGet('SELECT mbid FROM albums WHERE mbid = ?', [mbid]);
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const fields: Record<string, any> = {};

  const strField = (key: string, max: number, required = false) => {
    if (!(key in body)) return null;
    const v = body[key];
    if (v === null || v === '') return required ? `${key} is required` : (fields[key] = null, null);
    if (typeof v !== 'string') return `${key} must be a string`;
    const trimmed = v.trim();
    if (required && !trimmed) return `${key} is required`;
    if (trimmed.length > max) return `${key} is too long (max ${max})`;
    fields[key] = trimmed || null;
    return null;
  };

  let err: string | null = null;
  err = strField('title', 500, true) || err;
  err = strField('artist_name', 500, true) || err;
  err = strField('label_name', 500) || err;
  err = strField('format', 200) || err;

  if ('release_year' in body) {
    const v = body.release_year;
    if (v === null || v === '') {
      fields.release_year = null;
    } else {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (!Number.isInteger(n) || n < 1900 || n > 2100) {
        err = err || 'release_year must be an integer between 1900 and 2100';
      } else {
        fields.release_year = n;
      }
    }
  }

  if ('release_date' in body) {
    const v = body.release_date;
    if (v === null || v === '') {
      fields.release_date = null;
    } else if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
      err = err || 'release_date must be YYYY-MM-DD';
    } else {
      fields.release_date = v.trim();
    }
  }

  const urlField = (key: string) => {
    if (!(key in body)) return null;
    const v = body[key];
    if (v === null || v === '') {
      fields[key] = null;
      return null;
    }
    if (typeof v !== 'string') return `${key} must be a string`;
    const trimmed = v.trim();
    if (!trimmed) {
      fields[key] = null;
      return null;
    }
    if (trimmed.length > 2000) return `${key} is too long`;
    if (!/^https?:\/\//i.test(trimmed)) return `${key} must start with http(s)://`;
    fields[key] = trimmed;
    return null;
  };

  err = urlField('discogs_url') || err;
  err = urlField('spotify_url') || err;
  err = urlField('youtube_url') || err;
  err = urlField('bandcamp_url') || err;

  // If the Discogs URL changed, try to pull the master ID out of it so the
  // price crawler can skip the artist/title search and pin to this exact
  // master on next 시세 갱신. Non-master URLs (release/, search) clear the
  // stored master ID so the crawler falls back to name-based search.
  if ('discogs_url' in fields) {
    const url: string | null = fields.discogs_url;
    if (!url) {
      fields.discogs_id = null;
    } else {
      const m = url.match(/discogs\.com\/(?:[a-z]{2}\/)?master\/(\d+)/i);
      fields.discogs_id = m ? parseInt(m[1], 10) : null;
    }
    // Any Discogs link edit invalidates the cached prices — clear the
    // timestamp so the next page view picks them up, and admins can hit
    // 시세 갱신 explicitly for an instant refresh.
    fields.discogs_formats_json = null;
    fields.discogs_formats_updated_at = null;
  }

  if (err) return res.status(400).json({ error: err });
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    updateAlbumFields(mbid, fields);
    const updated = queryGet(
      `SELECT mbid, title, artist_name, release_year, release_date, label_name, format,
              discogs_url, discogs_id, spotify_url, youtube_url, bandcamp_url
       FROM albums WHERE mbid = ?`,
      [mbid]
    );
    res.json({ ok: true, album: updated });
  } catch (error) {
    console.error('Update album error:', error);
    res.status(500).json({ error: 'Failed to update album' });
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

// ─── DELETE /api/albums/:id/cover-art — revert to first working fallback ────
//
// Drops a custom-set cover and re-hosts the album's earliest known
// fallback URL (typically the Cover Art Archive original captured at
// album-fetch time, sometimes a Spotify CDN URL further down the
// list). Iterates fallbacks in order so a rotted CAA URL falls
// through to the next candidate instead of failing the whole revert.
// 404 when there's nothing to revert to (no fallbacks recorded), 502
// when every fallback fails to host.
router.delete('/:id/cover-art', requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const row = queryGet(
    'SELECT mbid, cover_art_fallbacks FROM albums WHERE mbid = ?',
    [mbid]
  );
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }

  let fallbacks: string[] = [];
  if (row.cover_art_fallbacks) {
    try {
      const parsed = JSON.parse(row.cover_art_fallbacks);
      if (Array.isArray(parsed)) {
        fallbacks = parsed.filter(
          (u): u is string =>
            typeof u === 'string' && /^https?:\/\//i.test(u.trim())
        );
      }
    } catch {
      // ignore — treated as empty
    }
  }
  if (fallbacks.length === 0) {
    return res
      .status(404)
      .json({ error: '되돌릴 기본 커버 URL이 없습니다.' });
  }

  const failures: Array<{ url: string; msg: string }> = [];
  for (const url of fallbacks) {
    try {
      const hostedUrl = await hostCustomCover(url.trim());
      updateAlbumFields(mbid, { cover_art_url: hostedUrl });
      return res.json({ ok: true, coverArtUrl: hostedUrl });
    } catch (err) {
      const msg =
        err instanceof CustomCoverError ? err.message : 'unknown error';
      failures.push({ url, msg });
    }
  }
  console.error('Revert cover art — all fallbacks failed:', failures);
  return res.status(502).json({
    error: '모든 fallback 커버 호스팅에 실패했습니다.',
  });
});

// ─── POST /api/albums/:id/refresh-discogs — admin re-fetch Discogs prices ───

router.post('/:id/refresh-discogs', requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const row = queryGet(
    'SELECT mbid, artist_name, title, discogs_id FROM albums WHERE mbid = ?',
    [mbid]
  );
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }
  if (!row.artist_name || !row.title) {
    return res.status(400).json({ error: 'Album is missing artist or title' });
  }

  try {
    const fresh = await getMasterMarketData(row.artist_name, row.title, row.discogs_id || null);
    const formats = fresh?.formats || [];
    updateAlbumFields(mbid, {
      discogs_url: fresh?.discogsUrl || null,
      discogs_id: fresh?.masterId || null,
      discogs_formats_json: formats.length > 0 ? JSON.stringify(formats) : null,
      discogs_formats_updated_at: new Date().toISOString(),
    });
    res.json({ ok: true, formatsFound: formats.length, formats });
  } catch (error) {
    console.error('Refresh discogs error:', error);
    res.status(500).json({ error: 'Failed to refresh Discogs data' });
  }
});

// ─── POST /api/albums/:id/refresh-links — admin re-resolve all links ─────
//
// On-demand counterpart to the first-registration link discovery
// (getOrFetchAlbumBase fetches Spotify / YouTube / Bandcamp / Discogs in
// parallel). Pre-orders often get registered before these exist or land
// on the wrong release, so this re-searches every store/streaming link
// from scratch. Same "overwrite only on a hit" rule everywhere: a null
// lookup leaves the existing link intact rather than blanking a good one
// on a transient miss. Discogs + Spotify go through the shared release-
// sync resolver (which also refreshes market formats); YouTube + Bandcamp
// are resolved here with the identical rule.
//
// No LLM cost — these are the same external APIs already hit on every
// album registration (Spotify/Discogs/YouTube/Bandcamp), just re-invoked
// once per admin click.

router.post('/:id/refresh-links', requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const row = queryGet(
    'SELECT mbid, artist_name, title FROM albums WHERE mbid = ?',
    [mbid]
  ) as { mbid: string; artist_name: string | null; title: string | null } | undefined;
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }
  if (!row.artist_name || !row.title) {
    return res.status(400).json({ error: 'Album is missing artist or title' });
  }

  try {
    const links = await syncSingleAlbumRelease(mbid);
    const found = { ...links, youtube: false, bandcamp: false };

    const [ytRes, bcRes] = await Promise.allSettled([
      searchVideo(row.artist_name, row.title),
      searchBandcamp(row.artist_name, row.title),
    ]);
    if (ytRes.status === 'fulfilled' && ytRes.value) {
      updateAlbumFields(mbid, { youtube_url: ytRes.value });
      found.youtube = true;
    }
    if (bcRes.status === 'fulfilled' && bcRes.value?.url) {
      updateAlbumFields(mbid, { bandcamp_url: bcRes.value.url });
      found.bandcamp = true;
    }

    res.json({ ok: true, ...found });
  } catch (error) {
    console.error('Refresh links error:', error);
    res.status(500).json({ error: 'Failed to refresh links' });
  }
});

// ─── POST /api/albums/:id/sync-release — admin release-day resync ────────
//
// Manual counterpart to the daily releaseSyncJob: re-resolves the
// Discogs / Spotify links (overwriting a wrong pre-release match) and,
// if the album was never crawled, kicks off the review-collection
// pipeline. Lets the admin recover an album that aged past the job's
// 7-day auto-retry window, or force the whole release-day flow on
// demand.

router.post('/:id/sync-release', requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const row = queryGet(
    'SELECT mbid, reviews_crawled_at FROM albums WHERE mbid = ?',
    [mbid]
  );
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }

  try {
    const links = await syncSingleAlbumRelease(mbid);
    let reviewQueued = false;
    if (!row.reviews_crawled_at) {
      enqueueAutoCuration(mbid);
      reviewQueued = true;
    }
    res.json({ ok: true, ...links, reviewQueued });
  } catch (error) {
    console.error('Sync release error:', error);
    res.status(500).json({ error: 'Failed to sync release data' });
  }
});

// Review pipeline endpoints (/:id/reviews/discover, /add-url, /manual,
// /generate-summary, /mark-none) moved to routes/albumReviews.ts.


// ─── PATCH /api/albums/:id/tags — admin replace genre tag list ──────────
//
// Updates an album's tag list and (optionally) blacklists tags the
// curator wants globally banned. The earlier version inferred
// blacklist intent by diffing the client's payload against the raw
// stored genres, which over-banned because the album detail GET
// surfaces a top-N cleaned subset (cleanGenres) — the client never
// saw the raw list, so a single × click would pull every digit-
// containing or otherwise-filtered tag along for the ride.
//
// New contract — explicit signals only, no diff inference:
//   - `tags` (string[]):     tags the operator wants visible AFTER
//                            edit. Server merges them into the
//                            existing raw list (unseen tags stay).
//   - `blacklist` (string[]): tags to globally ban — added to
//                            tag_blacklist, removed from this album,
//                            stripped from every other album.
//   - `removeOnly` (string[]): tags to remove from THIS album only.
//                            No blacklist, no cross-album strip.
//
// Blacklist + removeOnly are also subtracted from the stored raw
// list so the curator's intent persists. New tags in `tags` (not
// previously stored) get appended to the end of the raw list,
// preserving import order for existing tags.

router.patch('/:id/tags', requireAdmin, (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const row = queryGet(
    'SELECT mbid, genres, manual_genres FROM albums WHERE mbid = ?',
    [mbid]
  ) as { mbid: string; genres: string | null; manual_genres: string | null } | null;
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const body = req.body ?? {};
  const tagsRaw = body.tags;
  if (!Array.isArray(tagsRaw)) {
    return res.status(400).json({ error: 'tags must be an array of strings' });
  }
  const removeOnlyRaw = body.removeOnly;
  const blacklistRaw = body.blacklist;

  const sanitiseList = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of arr) {
      if (typeof t !== 'string') continue;
      const trimmed = t.trim();
      if (!trimmed || trimmed.length > 80) continue;
      const key = trimmed.toLowerCase();
      // Digit-only tags are auto-banned by policy — silently drop
      // them from any input array. Stops accidental year tag
      // additions and stops the operator from polluting
      // tag_blacklist with entries that don't help (everything
      // numeric is already filtered).
      if (isAutoBannedTag(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
      if (out.length >= 30) break;
    }
    return out;
  };

  const visible = sanitiseList(tagsRaw);
  const removeOnly = sanitiseList(removeOnlyRaw);
  const blacklistList = sanitiseList(blacklistRaw);

  // Lower-cased lookup sets for the merge pass below.
  const removeOnlyLower = new Set(removeOnly.map((t) => t.toLowerCase()));
  const blacklistLower = new Set(blacklistList.map((t) => t.toLowerCase()));
  const visibleLowerSet = new Set(visible.map((t) => t.toLowerCase()));

  // Previously-stored raw tags — full list, may include digit tags
  // and other entries the cleanGenres pass would hide from the
  // client. We keep these intact unless explicitly listed for
  // removal, so a × on one tag doesn't take 25 invisible neighbours
  // along with it.
  const previousRaw: string[] = row.genres
    ? (() => {
        try {
          const arr = JSON.parse(row.genres);
          return Array.isArray(arr)
            ? arr.filter((t): t is string => typeof t === 'string')
            : [];
        } catch {
          return [];
        }
      })()
    : [];

  // Build the next raw list:
  //   1. Keep every previously-stored tag that wasn't explicitly
  //      removed or blacklisted (case-insensitive).
  //   2. Append any tag in `visible` that isn't already present —
  //      these are NEW additions the operator typed in.
  // Cap at 30 to mirror the historical limit. Order: existing first
  // (preserves import order), additions last.
  const nextRaw: string[] = [];
  const nextLower = new Set<string>();
  for (const t of previousRaw) {
    const lower = t.toLowerCase();
    if (removeOnlyLower.has(lower) || blacklistLower.has(lower)) continue;
    if (nextLower.has(lower)) continue;
    nextRaw.push(t);
    nextLower.add(lower);
    if (nextRaw.length >= 30) break;
  }
  for (const t of visible) {
    const lower = t.toLowerCase();
    if (nextLower.has(lower)) continue;
    if (removeOnlyLower.has(lower) || blacklistLower.has(lower)) continue;
    if (nextRaw.length >= 30) break;
    nextRaw.push(t);
    nextLower.add(lower);
  }

  // Admin's manual override list — what they want to see displayed.
  // `visible` IS that intent verbatim (sanitiseList already dropped
  // the digit-only / "best …" entries policy bans), so we save it
  // straight. Stored as JSON; resolveDisplayGenres on the GET path
  // surfaces it instead of cleanGenres(raw) when not null.
  const nextManual = visible;

  let strippedAlbumCountOut = 0;
  try {
    transaction((): void => {
      updateAlbumFields(mbid, {
        genres: JSON.stringify(nextRaw),
        manual_genres: JSON.stringify(nextManual),
      });

      if (blacklistList.length > 0) {
        const adminId = (req.user as { id?: number } | undefined)?.id ?? null;
        const db = getDb();
        const insertBl = db.prepare(
          `INSERT OR IGNORE INTO tag_blacklist (tag, added_by_user_id) VALUES (?, ?)`
        );
        for (const tag of blacklistList) {
          insertBl.run(tag.toLowerCase(), adminId);
        }

        // Cross-album strip: pull rows whose genres OR manual_genres
        // TEXT contains any of the just-blacklisted tags as a substring
        // (rough but cheap LIKE prefilter), then re-filter the parsed
        // JSON arrays exactly. The substring filter overshoots (e.g.
        // "rock" matches "rock and roll") — the JS pass is the
        // authoritative step. manual_genres needs the same sweep
        // because an admin override on album A shouldn't keep a tag
        // alive after album B's curator blacklisted it.
        const likeClauses = blacklistList
          .map(() => `(genres LIKE ? OR manual_genres LIKE ?)`)
          .join(' OR ');
        const likeParams: string[] = [];
        for (const t of blacklistList) {
          const needle = `%${t.replace(/[%_]/g, '')}%`;
          likeParams.push(needle, needle);
        }
        const candidates = queryAll(
          `SELECT mbid, genres, manual_genres FROM albums
           WHERE mbid != ?
             AND (genres IS NOT NULL OR manual_genres IS NOT NULL)
             AND (${likeClauses})`,
          [mbid, ...likeParams]
        ) as Array<{ mbid: string; genres: string | null; manual_genres: string | null }>;
        const updateGenres = getDb().prepare(
          `UPDATE albums SET genres = ?, manual_genres = ? WHERE mbid = ?`
        );
        const stripFromJson = (json: string | null): { next: string | null; changed: boolean } => {
          if (!json) return { next: null, changed: false };
          let parsed: unknown;
          try {
            parsed = JSON.parse(json);
          } catch {
            return { next: json, changed: false };
          }
          if (!Array.isArray(parsed)) return { next: json, changed: false };
          const tags = parsed.filter((t): t is string => typeof t === 'string');
          const next = tags.filter((t) => !blacklistLower.has(t.toLowerCase()));
          if (next.length === tags.length) return { next: json, changed: false };
          return { next: JSON.stringify(next), changed: true };
        };
        let strippedAlbumCount = 0;
        for (const cand of candidates) {
          const rawResult = stripFromJson(cand.genres);
          const manualResult = stripFromJson(cand.manual_genres);
          if (rawResult.changed || manualResult.changed) {
            updateGenres.run(rawResult.next, manualResult.next, cand.mbid);
            strippedAlbumCount += 1;
          }
        }
        if (strippedAlbumCount > 0) {
          console.log(
            `[tags] blacklisted ${blacklistList.length} tag(s); stripped from ${strippedAlbumCount} other album(s)`
          );
        }
        strippedAlbumCountOut = strippedAlbumCount;
      }
    });

    if (blacklistList.length > 0) invalidateTagBlacklistCache();
    res.json({
      ok: true,
      tags: visible,
      blacklisted: blacklistList.map((t) => t.toLowerCase()),
      strippedAlbumCount: strippedAlbumCountOut,
    });
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

// Review-level endpoints (/reviews/:reviewId/score, /excerpt, /rescrape)
// moved to routes/albumReviews.ts.

// ─── DELETE /api/albums/:id — remove album and related data ─────────────
//
// Two authorization paths:
//   1. Admin — can delete anything, always
//   2. Requester retract — the user who originally submitted the
//      album can pull it back ONLY while nothing foreign has
//      engaged with it yet (no admin-scraped reviews, no votes,
//      user_reviews, purchase_links, collections or wants from
//      anyone other than themselves). Intent is "whoops, wrong
//      album, let me undo" for a mis-submission, not a way to
//      delete a row with community content on it.

router.delete('/:id', requireAuth, async (req, res) => {
  const user = req.user as AppUser;
  const idOrSlug = req.params.id as string;
  const row = queryGet(
    `SELECT id, mbid, requested_by_user_id FROM albums WHERE slug = ? OR mbid = ? LIMIT 1`,
    [idOrSlug, idOrSlug]
  );
  if (!row) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const albumPk: number = row.id;
  const albumMbid: string = row.mbid;

  if (!user.is_admin) {
    if (row.requested_by_user_id !== user.id) {
      return res.status(403).json({ error: '본인이 등록한 앨범만 삭제할 수 있어요.' });
    }
    // Same foreign-engagement count as /me/album-requests uses for
    // the canDelete flag. Server enforces it independently in case
    // the client disregarded the flag or the state changed between
    // the list fetch and the delete click.
    const engagement = queryGet(
      `SELECT
         (SELECT COUNT(*) FROM reviews WHERE album_mbid = ?)
         + (SELECT COUNT(*) FROM user_reviews WHERE album_id = ? AND user_id != ?)
         + (SELECT COUNT(*) FROM album_votes WHERE album_id = ? AND user_id != ?)
         + (SELECT COUNT(*) FROM purchase_links WHERE album_id = ? AND user_id != ?)
         + (SELECT COUNT(DISTINCT cb.user_id)
            FROM crate_items ci JOIN crate_boxes cb ON cb.id = ci.crate_id
            WHERE ci.album_id = ? AND cb.user_id != ?)
         AS n`,
      [
        albumMbid,
        albumPk, user.id,
        albumPk, user.id,
        albumPk, user.id,
        albumPk, user.id,
      ]
    ) as { n: number };
    if ((engagement?.n ?? 0) > 0) {
      return res.status(409).json({
        error: '리뷰·투표·구매처 등이 이미 등록된 앨범은 삭제할 수 없어요.',
      });
    }
  }

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
      // crate_items.album_id has ON DELETE CASCADE, so deleting the
      // album row below clears any crates that reference it. No
      // explicit DELETE FROM crate_items needed.
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

// ─── GET /api/albums/:id — fast: base info ───────────────────────────────

router.get('/:id', async (req, res) => {
  // Anonymous viewers see an album response with userVote=null and no
  // other per-user fields, so the response is identical across anon
  // visitors and safe to edge-cache. Logged-in viewers get userVote
  // populated, which would poison neighbouring users if cached. Cold
  // path (first visit to an album) fires external enrichment and can
  // take seconds; caching the warm response saves later anon visitors
  // from re-paying that cost.
  setAnonEdgeCache(req, res, 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');

  const param = (req.params.id as string);
  // Resolve slug or mbid to actual mbid
  const resolved = resolveAlbumId(param);

  // Slug not in DB and not a valid mbid/discogs-id → 404
  if (
    !resolved &&
    !param.match(/^[0-9a-f]{8}-/) &&
    !param.startsWith('discogs-') &&
    !param.startsWith('manual-')
  ) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const mbid = resolved?.mbid || param;

  try {
    const result = await getOrFetchAlbumBase(mbid);
    if (!result) {
      return res.status(404).json({ error: 'Album not found' });
    }

    // Discography is intentionally not fetched here. It is never
    // rendered on the client (the field survives only in the response
    // type), and the MusicBrainz getArtistReleases call — memoised for
    // just 60s, so effectively firing on every album load — plus its
    // Discogs fallback were blocking the base response (the whole page
    // sits on the LoadingSkeleton until this resolves). Removing them
    // takes two external round-trips off the critical path for data
    // nobody displays. Restore from git history if a discography
    // surface is ever built.

    // Vote counts + current user's vote, plus the public crate_count
    // (DISTINCT users with this album in any of their public crates,
    // replaces the prior owned/wanted/per-format ownership data after
    // collections + wants were absorbed into crates 2026-04-28). The
    // per-user crate membership state for the 담기 chip is owned by
    // the new /api/mydig/crates endpoints — the album response only
    // carries the public aggregate.
    const albumRow = queryGet(`SELECT id FROM albums WHERE mbid = ?`, [mbid]);
    const albumPk = albumRow?.id;
    let upvotes = 0;
    let downvotes = 0;
    let userVote: 'up' | 'down' | null = null;
    let crateCount = 0;
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
      crateCount =
        (queryGet(
          `SELECT COUNT(DISTINCT cb.user_id) AS c
           FROM crate_items ci
           JOIN crate_boxes cb ON cb.id = ci.crate_id
           WHERE ci.album_id = ? AND cb.is_public = 1`,
          [albumPk]
        )?.c as number) || 0;
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
      album: {
        ...result.album,
        // Numeric DB pkey — needed for crate item endpoints which key
        // on the integer FK rather than the mbid. CrateButton on the
        // album page reads it; without it the 담기 dropdown can't
        // toggle membership.
        id: albumPk,
        upvotes,
        downvotes,
        userVote,
        crateCount,
      },
      streaming: result.streaming,
      buy: { ...result.buy, formats: formatsWithKrw },
      discography: result.discography,
    });
  } catch (error) {
    console.error('Album detail error:', error);
    res.status(500).json({ error: 'Failed to fetch album details' });
  }
});

// GET /api/albums/:id/reviews moved to routes/albumReviews.ts.

// ─── GET /api/albums/:mbid/similar — slow: similar albums ───────────────────

router.get('/:id/similar', async (req, res) => {
  // Similar-album picks are cached in the DB (similar_albums_lastfm
  // column), regenerated only when the column is NULL or admin
  // clears it. Longer TTL than most endpoints because the picks
  // change rarely once seeded. The admin sees a clear/re-pick
  // immediately via the client's post-mutation cache-key bump.
  setEdgeCache(res, 'public, max-age=0, s-maxage=600, stale-while-revalidate=1800');

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

    // Only auto-generate on the FIRST visit to an album (when the
    // field has never been populated, i.e. still NULL). Once the
    // column stores anything — including an empty array after an
    // admin cleared hallucinated picks — skip the Claude round trip.
    // Previously `length === 0` re-fired the pipeline after admins
    // deleted all 5, and the same bad Last.fm + Claude output came
    // back on the next request.
    const neverGenerated = cached?.similar_albums_lastfm == null;
    if (neverGenerated && albumTitle && artistName) {
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

              // Short-circuit: when Last.fm already gave us a trusted
              // MBID but no image, skip the MB search entirely and
              // derive the Cover Art Archive URL directly. The search
              // step is where wrong-album artwork creeps in — if we
              // have the right MBID there's no reason to run it.
              if (enrichedMbid && !enrichedImage) {
                enrichedImage = `https://coverartarchive.org/release/${enrichedMbid}/front-250`;
              }

              if (!enrichedMbid || !enrichedImage) {
                try {
                  // Lucene field-scoped query so MusicBrainz can't
                  // hand back a same-titled album by a DIFFERENT
                  // artist ("Incubus Serpent's Temptation" used to
                  // match unrelated Serpent-titled releases from
                  // other bands). Strip `"` / `\` from the user-
                  // provided strings so they can't escape the field.
                  const esc = (s: string) => s.replace(/["\\]/g, '').trim();
                  const query = `artist:"${esc(a.artist)}" AND release:"${esc(a.title)}"`;
                  const mbResults = await searchAlbums(query);

                  // Post-filter: require the result's artist credit
                  // to match our requested artist (case + punctuation
                  // insensitive, substring-in-either-direction so
                  // "Incubus (US)" vs "Incubus" is accepted). Lucene
                  // is still fuzzy enough to slip past field scoping
                  // on common words. Drop the result if nothing
                  // matches — better to show a music-note fallback
                  // than a confidently wrong cover.
                  const norm = (s: string) =>
                    s.toLowerCase().replace(/[^a-z0-9]/g, '');
                  const target = norm(a.artist);
                  const matched = mbResults.filter((r) => {
                    const cand = norm(r.artist);
                    return (
                      cand.length > 0 &&
                      (cand === target ||
                        cand.includes(target) ||
                        target.includes(cand))
                    );
                  });
                  const best = matched[0];
                  if (best) {
                    enrichedMbid = enrichedMbid || best.mbid;
                    enrichedImage = enrichedImage || best.coverArtUrl;
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

        }
        // Persist the result even when it's empty so a future request
        // doesn't re-run the same Last.fm + Claude call on an album
        // with no similar matches. The "first visit only" gate
        // above relies on this stamp.
        updateAlbumFields(mbid, {
          similar_albums_lastfm: JSON.stringify(similarAlbums),
        });
      } catch (error) {
        console.error('Similar albums error:', error);
      }
    }

    // Annotate each pick with whether the mbid resolves to a row in
    // the local albums table — the client uses this flag to route
    // card clicks: in-DB picks navigate to /album/:mbid via SPA
    // link, out-of-DB picks fall through to the Discogs URL. Stored
    // blob doesn't carry inDb (registrations happen after picks
    // were generated), so we compute it fresh on every request.
    const mbidsToCheck = similarAlbums
      .map((a) => a.mbid)
      .filter((m: unknown): m is string => typeof m === 'string' && m.length > 0);
    const existingMbids = new Set<string>();
    if (mbidsToCheck.length > 0) {
      const placeholders = mbidsToCheck.map(() => '?').join(',');
      const rows = queryAll(
        `SELECT mbid FROM albums WHERE mbid IN (${placeholders})`,
        mbidsToCheck
      ) as Array<{ mbid: string }>;
      for (const r of rows) existingMbids.add(r.mbid);
    }
    const annotated = similarAlbums.map((a) => ({
      ...a,
      inDb: typeof a.mbid === 'string' && existingMbids.has(a.mbid),
    }));

    res.json({ similarAlbums: annotated });
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

// ─── DELETE /api/albums/:id/similar/:index — admin remove a similar entry ─
//
// For when the AI picks something obviously off-base (wrong genre, wrong
// era, total miss) and the right move is to drop the suggestion entirely
// rather than try to salvage it via PATCH. Same JSON-array storage as the
// PATCH endpoint, so removal is just a splice.

router.delete('/:id/similar/:index', requireAdmin, (req, res) => {
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

  list.splice(index, 1);

  try {
    updateAlbumFields(mbid, { similar_albums_lastfm: JSON.stringify(list) });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete similar album error:', error);
    res.status(500).json({ error: 'Failed to delete similar album' });
  }
});

// ─── POST /api/albums/:id/similar/regenerate — admin wipe + refetch ────
//
// Clears similar_albums_lastfm so the GET /:id/similar handler's
// "first visit" path fires again — Last.fm fetch + Claude descriptions
// + MusicBrainz enrichment. Used when the initial Last.fm pick batch
// was weak (wrong era / wrong genre) and admin wants a fresh
// round-trip instead of curating one entry at a time. Client is
// expected to invalidate the ['album-similar', id] query immediately
// after this returns, which triggers the GET endpoint to repopulate.

router.post('/:id/similar/regenerate', requireAdmin, (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const cached = getCachedAlbum(mbid);
  if (!cached) {
    return res.status(404).json({ error: 'Album not found' });
  }

  try {
    updateAlbumFields(mbid, { similar_albums_lastfm: null });
    res.json({ ok: true });
  } catch (error) {
    console.error('Regenerate similar albums error:', error);
    res.status(500).json({ error: 'Failed to regenerate similar albums' });
  }
});

// ─── POST /api/albums/:id/similar — admin manually add a similar album ──────
//
// Accepts { artist, title } and enriches with cover art, streaming links,
// and a Claude-generated Korean reason. Appends to the JSON array.

router.post('/:id/similar', adminClaudeLimiter, requireAdmin, async (req, res) => {
  const resolved = resolveAlbumId(req.params.id as string);
  const mbid = resolved?.mbid || (req.params.id as string);

  const cached = getCachedAlbum(mbid);
  if (!cached) {
    return res.status(404).json({ error: 'Album not found' });
  }

  const baseArtist = cached.artist_name || '';
  const baseTitle = cached.title || '';

  const { artist, title } = req.body ?? {};
  if (!artist || !title || typeof artist !== 'string' || typeof title !== 'string') {
    return res.status(400).json({ error: 'artist and title are required' });
  }

  let list: any[] = [];
  try {
    list = cached.similar_albums_lastfm ? JSON.parse(cached.similar_albums_lastfm) : [];
  } catch {
    list = [];
  }

  if (list.length >= 10) {
    return res.status(400).json({ error: 'Maximum 10 similar albums' });
  }

  try {
    // Enrich: cover art via MusicBrainz
    let enrichedMbid = '';
    let enrichedImage = '';
    try {
      const mbResults = await searchAlbums(`${artist} ${title}`);
      if (mbResults.length > 0) {
        enrichedMbid = mbResults[0].mbid;
        enrichedImage = mbResults[0].coverArtUrl;
      }
    } catch {}

    // Streaming links + Discogs in parallel
    const [spResult, ytResult, bcResult, dcMasterResult] = await Promise.allSettled([
      searchTrack(artist, title),
      searchVideo(artist, title),
      searchBandcamp(artist, title),
      searchMasterUrl(artist, title),
    ]);
    const spotifyUrl = spResult.status === 'fulfilled' ? spResult.value?.url || null : null;
    const youtubeUrl = ytResult.status === 'fulfilled' ? ytResult.value || null : null;
    const bandcampUrl = bcResult.status === 'fulfilled' ? bcResult.value?.url || null : null;
    const masterUrl = dcMasterResult.status === 'fulfilled' ? dcMasterResult.value : null;

    let releaseUrl: string | null = null;
    if (!masterUrl) {
      try {
        const dcRelease = await searchRelease(artist, title);
        releaseUrl = dcRelease?.url || null;
      } catch {}
    }
    const discogsUrl = masterUrl || releaseUrl
      || `https://www.discogs.com/search/?q=${encodeURIComponent(`${artist} ${title}`)}&type=master`;

    // Route through invokeLlm so the env-driven model router can swap
    // this per-op. Defaults to DeepSeek flash (the hot path); an env
    // override can still promote it, but Anthropic is no longer the
    // safety-net default.
    let reason = '';
    try {
      const result = await invokeLlm({
        operation: 'similar_manual_reason',
        prompt: `"${baseTitle}" by ${baseArtist} 팬을 위한 비슷한 앨범 설명 1-2문장 한국어.\n앨범: "${title}" by ${artist}\nJSON only: {"reason":"한국어 설명"}`,
        maxTokens: 200,
        defaultModel: 'deepseek-v4-flash',
        jsonMode: true,
        albumTitle: `${artist} - ${title}`,
      });
      if (result.text) {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          reason = parsed.reason || '';
        }
      }
    } catch (err) {
      console.warn('[similar-manual] reason generation failed:', (err as Error).message);
    }

    const entry = {
      title: title.trim(),
      artist: artist.trim(),
      mbid: enrichedMbid,
      imageUrl: enrichedImage,
      reason,
      discogsUrl,
      spotifyUrl,
      youtubeUrl,
      bandcampUrl,
    };

    list.push(entry);
    updateAlbumFields(mbid, { similar_albums_lastfm: JSON.stringify(list) });

    res.json({ ok: true, similarAlbum: entry, index: list.length - 1 });
  } catch (error) {
    console.error('Add similar album error:', error);
    res.status(500).json({ error: 'Failed to add similar album' });
  }
});

export default router;
