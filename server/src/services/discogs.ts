import axios from 'axios';
import https from 'https';
import { memoAsync } from '../utils/memoCache.js';
import { signedGet } from './discogsOauth.js';

const DISCOGS_MEMO_TTL = 6 * 60 * 60 * 1000; // 6 hours

const DISCOGS_BASE = 'https://api.discogs.com';
const httpsAgent = new https.Agent({ family: 4 });

function getHeaders(): Record<string, string> {
  const token = process.env.DISCOGS_TOKEN || '';
  const headers: Record<string, string> = {
    'User-Agent': 'dig.haus/1.0',
  };
  // Only include Authorization if the token looks like a valid personal access token
  if (token && token.length > 20) {
    headers['Authorization'] = `Discogs token=${token}`;
  }
  return headers;
}

/** Remove Discogs disambiguation suffix like "(23)" from artist names */
function cleanArtistName(name: string): string {
  return name.replace(/\s*\(\d+\)$/, '').trim();
}

/**
 * Resolve a Discogs master ID to its canonical main_release ID.
 * Returns null if the master is broken or has no main_release set.
 */
export async function getDiscogsMasterMainRelease(masterId: number): Promise<number | null> {
  try {
    const res = await axios.get(`${DISCOGS_BASE}/masters/${masterId}`, {
      headers: getHeaders(),
      httpsAgent,
    });
    const mainRelease = res.data?.main_release;
    return typeof mainRelease === 'number' && mainRelease > 0 ? mainRelease : null;
  } catch (err) {
    console.warn(`[discogs] getDiscogsMasterMainRelease failed for master=${masterId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Fetch a Discogs master's original release year — distinct from the year
 * of any specific release / reissue. Used to override the reissue year that
 * `/releases/{id}` returns when the user registers a remaster.
 */
export async function getDiscogsMasterYear(masterId: number): Promise<string | null> {
  try {
    const res = await axios.get(`${DISCOGS_BASE}/masters/${masterId}`, {
      headers: getHeaders(),
      httpsAgent,
    });
    const y = res.data?.year;
    return y ? String(y) : null;
  } catch (err) {
    console.warn(`[discogs] getDiscogsMasterYear failed for master=${masterId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Scan a Discogs master's versions for the earliest non-Japan release with a
 * real label. Used as an escape hatch when `main_release` points at a JP
 * licensee pressing (Universal Music Japan, Avex, Soundholic …) — in that
 * case the pressing label is the local distributor, not the album's origin
 * label. The Discogs artist-discography UI shows the latter; we replicate
 * that by preferring any non-JP version's label. JP-only albums fall back
 * to their pressing label naturally because this function returns null when
 * no non-JP version with a label exists.
 *
 * Versions are sorted by `released` ascending so the chosen label tracks
 * the original-issue territory rather than a later non-JP reissue.
 */
async function getDiscogsMasterEarliestNonJpLabel(masterId: number): Promise<string | null> {
  try {
    const res = await axios.get(`${DISCOGS_BASE}/masters/${masterId}/versions`, {
      headers: getHeaders(),
      httpsAgent,
      params: {
        sort: 'released',
        sort_order: 'asc',
        per_page: '100',
      },
    });
    const versions: any[] = res.data?.versions || [];
    for (const v of versions) {
      if ((v.country || '') === 'Japan') continue;
      const candidate = (v.label || '').trim();
      if (!candidate) continue;
      if (candidate.toLowerCase() === 'not on label') continue;
      return candidate;
    }
    return null;
  } catch (err) {
    console.warn(`[discogs] getDiscogsMasterEarliestNonJpLabel failed for master=${masterId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Fetch full release details from Discogs by release ID.
 */
export async function getDiscogsReleaseDetail(discogsId: number): Promise<{
  title: string;
  artist: string;
  artistId: number | null;
  year: string;
  releaseDate: string;
  label: string;
  genres: string[];
  format: string;
  coverArtUrl: string;
  masterId: number | null;
  discogsUrl: string;
} | null> {
  try {
    const res = await axios.get(`${DISCOGS_BASE}/releases/${discogsId}`, {
      headers: getHeaders(),
      httpsAgent,
    });
    const r = res.data;
    const artist = cleanArtistName(r.artists?.[0]?.name || '');
    const artistId = r.artists?.[0]?.id || null;
    const masterId: number | null = r.master_id || null;

    // Discogs releases describe a SPECIFIC pressing — for reissues this is
    // the reissue year, not the album's original year. If a master exists,
    // pull its year (the canonical original release year) and prefer that.
    //
    // Label resolution: trust the main_release's pressing label by default
    // (Discogs editors curate `main_release` to point at the canonical
    // issue, which is what the artist-discography UI displays). The
    // override case is when main_release itself happens to be a Japan
    // pressing — then `pressingLabel` is the JP licensee (Soundholic,
    // Universal Music Japan, Avex …) rather than the album's origin
    // label. Fan out to a versions scan and pick the earliest non-JP
    // version's label so the registration lands on the origin issuer.
    // JP-only albums fall through to the JP pressing label naturally.
    let originalYear = r.year?.toString() || '';
    let originalDate = r.released || r.year?.toString() || '';
    let labelName = r.labels?.[0]?.name || '';
    const mainReleaseCountry: string = r.country || '';
    if (masterId) {
      const [masterYear, nonJpLabel] = await Promise.all([
        getDiscogsMasterYear(masterId),
        mainReleaseCountry === 'Japan'
          ? getDiscogsMasterEarliestNonJpLabel(masterId)
          : Promise.resolve(null),
      ]);
      if (masterYear && masterYear !== originalYear) {
        originalYear = masterYear;
        // The master only carries a year, not a full date — drop the
        // reissue's specific date so the page shows just the original year.
        originalDate = masterYear;
      }
      if (nonJpLabel) {
        labelName = nonJpLabel;
      }
    }

    return {
      title: r.title || '',
      artist,
      artistId,
      year: originalYear,
      releaseDate: originalDate,
      label: labelName,
      genres: [...(r.genres || []), ...(r.styles || [])],
      format: r.formats?.[0]?.name || '',
      coverArtUrl: r.images?.[0]?.uri || r.thumb || '',
      masterId,
      discogsUrl: r.uri ? `https://www.discogs.com${r.uri}` : '',
    };
  } catch (err) {
    console.warn(`[discogs] getDiscogsReleaseDetail failed for id=${discogsId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Get artist discography from Discogs.
 */
async function _getDiscogsArtistReleases(artistId: number): Promise<
  Array<{
    title: string;
    year: string;
    type: string;
    thumbUrl: string;
    masterId: number | null;
  }>
> {
  try {
    const res = await axios.get(`${DISCOGS_BASE}/artists/${artistId}/releases`, {
      headers: getHeaders(),
      httpsAgent,
      params: { sort: 'year', sort_order: 'desc', per_page: '50' },
    });
    const releases = res.data?.releases || [];
    const seen = new Set<number>();
    const results: Array<{ title: string; year: string; type: string; thumbUrl: string; masterId: number | null }> = [];
    for (const r of releases) {
      const mid = r.master_id || r.id;
      if (seen.has(mid)) continue;
      seen.add(mid);
      if (r.role !== 'Main') continue;
      const fmt = (r.format || '').toLowerCase();
      if (fmt.includes('file') || fmt.includes('digital') || fmt === 'wav' || fmt === 'flac' || fmt === 'mp3') continue;
      if (fmt.includes('single') || fmt.includes('7"') || fmt.includes('compilation') || fmt.includes('dvd')) continue;
      results.push({
        title: r.title || '',
        year: r.year?.toString() || '',
        type: r.type || '',
        thumbUrl: r.thumb || '',
        masterId: r.master_id || null,
      });
    }
    return results;
  } catch (err) {
    console.warn(`[discogs] getDiscogsArtistReleases failed for artistId=${artistId}:`, (err as Error).message);
    return [];
  }
}

export const getDiscogsArtistReleases = memoAsync(
  'discogs:artistReleases',
  _getDiscogsArtistReleases,
  DISCOGS_MEMO_TTL
);

export async function searchDiscogsAlbums(
  query: string,
  year?: string | null
): Promise<
  Array<{
    title: string;
    artist: string;
    year: string;
    label: string;
    format: string;
    coverArtUrl: string;
    discogsId: number;
  }>
> {
  try {
    const res = await axios.get(`${DISCOGS_BASE}/database/search`, {
      headers: getHeaders(),
      httpsAgent,
      params: {
        q: query,
        type: 'master',
        per_page: '20',
        // Optional year filter — when the caller's input contained a
        // 4-digit year token (e.g. "bring me the horizon 2026"), the
        // upstream search restricts to masters released that year so
        // brand-new releases surface ahead of the artist's deep back
        // catalogue. Discogs accepts this as a top-level search param.
        ...(year ? { year } : {}),
      },
    });

    const results = res.data?.results || [];

    // Filter out singles, EPs, and other non-album formats. type=master
    // already strips most non-canonical pressings but Discogs masters
    // still include single/EP-shaped releases — same shape that the
    // artist-discography helper above filters with this exact pattern.
    // Without it the registration search surfaces "Soilwork - Steelbath
    // Suicide (single)" between full albums.
    const NON_ALBUM_FORMAT_TOKENS = new Set([
      'single', 'ep', 'maxi-single', 'mini-album',
      'compilation', 'mixtape',
      '7"', '10"',
      'dvd', 'blu-ray', 'vhs',
    ]);
    const isAlbumFormat = (raw: string): boolean => {
      const fmt = (raw || '').toLowerCase().trim();
      if (!fmt) return true;
      return !NON_ALBUM_FORMAT_TOKENS.has(fmt);
    };

    // Deduplicate by title (Discogs returns many editions of the same release)
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const r of results) {
      const formats: string[] = Array.isArray(r.format) ? r.format : [];
      if (formats.length > 0 && !formats.some(isAlbumFormat)) continue;
      const key = (r.title || '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
    }

    return unique.map((r: any) => {
      // Discogs title format: "Artist - Title"
      const parts = (r.title || '').split(' - ');
      const artist = cleanArtistName(parts[0]?.trim() || '');
      const title = parts.slice(1).join(' - ').trim() || r.title || '';
      return {
        title,
        artist,
        year: r.year?.toString() || '',
        label: r.label?.[0] || '',
        format: r.format?.[0] || '',
        coverArtUrl: r.cover_image || r.thumb || '',
        discogsId: r.id,
      };
    });
  } catch (err) {
    console.warn(`[discogs] searchDiscogsAlbums failed for "${query}":`, (err as Error).message);
    return [];
  }
}

export async function searchRelease(
  artist: string,
  title: string
): Promise<{
  discogsId: number;
  url: string;
  year: string;
  label: string;
  format: string;
} | null> {
  try {
    const res = await axios.get(`${DISCOGS_BASE}/database/search`, {
      headers: getHeaders(),
      httpsAgent,
      params: {
        artist,
        release_title: title,
        type: 'release',
        per_page: '5',
      },
    });

    const results = res.data?.results || [];
    if (results.length === 0) return null;

    const first = results[0];
    return {
      discogsId: first.id,
      url: first.uri ? `https://www.discogs.com${first.uri}` : '',
      year: first.year || '',
      label: first.label?.[0] || '',
      format: first.format?.[0] || '',
    };
  } catch (err) {
    console.warn(`[discogs] searchRelease failed for "${artist} - ${title}":`, (err as Error).message);
    return null;
  }
}

/**
 * Lightweight master-release lookup: returns the master URL or null.
 * One API call; used to surface a canonical Discogs page for similar-album cards.
 */
export async function searchMasterUrl(
  artist: string,
  title: string
): Promise<string | null> {
  try {
    const res = await axios.get(`${DISCOGS_BASE}/database/search`, {
      headers: getHeaders(),
      httpsAgent,
      params: {
        artist,
        release_title: title,
        type: 'master',
        per_page: '1',
      },
    });
    const masterId = res.data?.results?.[0]?.id;
    return masterId ? `https://www.discogs.com/master/${masterId}` : null;
  } catch (err) {
    console.warn(`[discogs] searchMasterUrl failed for "${artist} - ${title}":`, (err as Error).message);
    return null;
  }
}

export interface FormatStats {
  format: string;
  lowestPrice: number | null;
  copiesForSale: number;
  sellUrl: string;
}

export interface MasterMarketData {
  masterId: number;
  discogsUrl: string;
  label: string;
  year: string;
  formats: FormatStats[];
}

/**
 * Search for a master release, then aggregate marketplace stats across
 * all versions grouped by major_formats (Vinyl, CD, Cassette).
 *
 * 1. /database/search?type=master → master_id
 * 2. /masters/{id}/versions → group release IDs by major_formats
 * 3. /marketplace/stats/{release_id} for each release → aggregate per format
 */
export async function getMasterMarketData(
  artist: string,
  title: string,
  knownMasterId?: number | null
): Promise<MasterMarketData | null> {
  try {
    let masterId: number;
    let label = '';
    let year = '';

    if (knownMasterId && knownMasterId > 0) {
      // Admin pinned (or a prior fetch already resolved) a specific master →
      // skip the search step. Avoids wrong-master mis-resolution for albums
      // with ambiguous names / same-name artists.
      masterId = knownMasterId;
    } else {
      // Step 1: find master release.
      //
      // Structured search (artist + release_title) is normally the cleanest path,
      // but Discogs has a quirk where ALL-CAPS titles containing special chars
      // (e.g. "WOR$T GIRL IN AMERICA") return 0 results even though the master
      // exists. Fall back to free-text q= in that case, then filter by artist so
      // we don't accept a random unrelated master.
      const searchRes = await axios.get(`${DISCOGS_BASE}/database/search`, {
        headers: getHeaders(),
        httpsAgent,
        params: {
          artist,
          release_title: title,
          type: 'master',
          per_page: '5',
        },
      });

      let results = searchRes.data?.results || [];

      if (results.length === 0) {
        const fallback = await axios.get(`${DISCOGS_BASE}/database/search`, {
          headers: getHeaders(),
          httpsAgent,
          params: {
            q: `${artist} ${title}`,
            type: 'master',
            per_page: '10',
          },
        });
        const artistLower = artist.toLowerCase();
        results = (fallback.data?.results || []).filter((r: any) => {
          const t = (r.title || '').toLowerCase();
          return t.startsWith(`${artistLower} -`) || t.startsWith(`${artistLower} feat`);
        });
        if (results.length > 0) {
          console.log(`[discogs] search fallback (q=) matched "${artist} - ${title}" → master ${results[0].id}`);
        }
      }

      if (results.length === 0) return null;

      const master = results[0];
      masterId = master.id;
      label = master.label?.[0] || '';
      year = master.year || '';
    }

    // Step 2: get all versions and group by major_formats
    const versionsRes = await axios.get(`${DISCOGS_BASE}/masters/${masterId}/versions`, {
      headers: getHeaders(),
      httpsAgent,
      params: { per_page: '100' },
    });

    const versions = versionsRes.data?.versions || [];
    const formatReleases = new Map<string, number[]>();
    for (const v of versions) {
      for (const mf of v.major_formats || []) {
        // Only track Vinyl, CD, Cassette
        if (mf !== 'Vinyl' && mf !== 'CD' && mf !== 'Cassette') continue;
        if (!formatReleases.has(mf)) formatReleases.set(mf, []);
        formatReleases.get(mf)!.push(v.id);
      }
    }

    console.log(`[discogs] Master ${masterId}: ${versions.length} versions, formats: ${[...formatReleases.entries()].map(([f, ids]) => `${f}(${ids.length})`).join(', ')}`);

    // Step 3: get marketplace stats per format, then aggregate.
    //
    // Discogs caps authenticated callers at 60 req/min. A popular master can have
    // 100+ versions per format, which — if fired fully in parallel — guarantees
    // 429s and makes Vinyl/CD silently disappear for new albums. So cap samples
    // per format and run them with small concurrency. The stats are a rough
    // "at a glance" indicator anyway (totals get slightly underestimated, lowest
    // price is barely affected).
    const SAMPLE_PER_FORMAT = 12;
    const STATS_CONCURRENCY = 3;
    const formats: FormatStats[] = [];

    async function mapLimit<T, R>(
      items: T[],
      limit: number,
      fn: (item: T) => Promise<R>
    ): Promise<PromiseSettledResult<R>[]> {
      const out: PromiseSettledResult<R>[] = new Array(items.length);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
          const idx = cursor++;
          try {
            out[idx] = { status: 'fulfilled', value: await fn(items[idx]) };
          } catch (err) {
            out[idx] = { status: 'rejected', reason: err };
          }
        }
      });
      await Promise.all(workers);
      return out;
    }

    for (const [fmt, releaseIds] of formatReleases) {
      const sampled = releaseIds.slice(0, SAMPLE_PER_FORMAT);
      const statsResults = await mapLimit(sampled, STATS_CONCURRENCY, async (rid) => {
        const res = await axios.get(`${DISCOGS_BASE}/marketplace/stats/${rid}`, {
          headers: getHeaders(),
          httpsAgent,
          params: { curr_abbr: 'USD' },
        });
        return {
          numForSale: res.data.num_for_sale || 0,
          lowestPrice: res.data.lowest_price?.value ?? null,
        };
      });

      let totalForSale = 0;
      let overallLowest: number | null = null;

      for (const r of statsResults) {
        if (r.status !== 'fulfilled') continue;
        totalForSale += r.value.numForSale;
        if (r.value.lowestPrice !== null) {
          if (overallLowest === null || r.value.lowestPrice < overallLowest) {
            overallLowest = r.value.lowestPrice;
          }
        }
      }

      const ok = statsResults.filter((r) => r.status === 'fulfilled').length;
      console.log(`[discogs] ${fmt}: sampled ${ok}/${sampled.length} of ${releaseIds.length} releases → ${totalForSale} for sale, lowest=$${overallLowest}`);

      if (totalForSale > 0) {
        formats.push({
          format: fmt,
          lowestPrice: overallLowest,
          copiesForSale: totalForSale,
          sellUrl: `https://www.discogs.com/sell/list?master_id=${masterId}&format=${encodeURIComponent(fmt)}`,
        });
      }
    }

    return {
      masterId,
      discogsUrl: `https://www.discogs.com/master/${masterId}`,
      label,
      year,
      formats,
    };
  } catch (err) {
    console.warn(`[discogs] getMasterMarketData failed for "${artist} - ${title}":`, (err as Error).message);
    return null;
  }
}

export async function getMarketplaceStats(
  discogsId: number
): Promise<{
  medianPrice: number | null;
  lowestPrice: number | null;
  copiesForSale: number;
} | null> {
  try {
    const res = await axios.get(`${DISCOGS_BASE}/marketplace/stats/${discogsId}`, {
      headers: getHeaders(),
      httpsAgent,
      params: { curr_abbr: 'USD' },
    });

    const data = res.data;
    return {
      medianPrice: data.median?.value ?? null,
      lowestPrice: data.lowest_price?.value ?? null,
      copiesForSale: data.num_for_sale || 0,
    };
  } catch (err) {
    console.warn(`[discogs] getMarketplaceStats failed for id=${discogsId}:`, (err as Error).message);
    return null;
  }
}

export async function getLabelInfo(
  labelName: string
): Promise<{
  id: number;
  name: string;
  foundingYear: string;
  country: string;
  genreFocus: string[];
  releases: number;
} | null> {
  try {
    // Search for the label
    const searchRes = await axios.get(`${DISCOGS_BASE}/database/search`, {
      headers: getHeaders(),
      httpsAgent,
      params: {
        q: labelName,
        type: 'label',
        per_page: '5',
      },
    });

    const results = searchRes.data?.results || [];
    if (results.length === 0) return null;

    const labelId = results[0].id;

    // Get label details
    const labelRes = await axios.get(`${DISCOGS_BASE}/labels/${labelId}`, {
      headers: getHeaders(),
      httpsAgent,
    });

    const label = labelRes.data;

    // Extract founding year from profile text (e.g. "Founded in 1990", "Established 1990", "since 1990")
    let foundingYear = '';
    const profile = label.profile || '';
    const yearMatch = profile.match(/(?:founded|established|started|since|est\.?)\s*(?:in\s+)?(\d{4})/i);
    if (yearMatch) {
      foundingYear = yearMatch[1];
    }

    return {
      id: label.id,
      name: label.name || '',
      foundingYear,
      country: label.contact_info?.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/)?.[0] || '',
      genreFocus: label.genres || [],
      releases: label.releases_url ? label.num_releases || 0 : 0,
    };
  } catch (err) {
    console.warn(`[discogs] getLabelInfo failed for "${labelName}":`, (err as Error).message);
    return null;
  }
}

export async function getLabelReleases(
  labelId: number
): Promise<
  Array<{
    id: number;
    title: string;
    artist: string;
    year: string;
    catno: string;
  }>
> {
  try {
    const res = await axios.get(`${DISCOGS_BASE}/labels/${labelId}/releases`, {
      headers: getHeaders(),
      httpsAgent,
      params: {
        per_page: '50',
        sort: 'year',
        sort_order: 'desc',
      },
    });

    const releases = res.data?.releases || [];
    return releases.map((r: any) => ({
      id: r.id,
      title: r.title || '',
      artist: cleanArtistName(r.artist || ''),
      year: r.year?.toString() || '',
      catno: r.catno || '',
    }));
  } catch (err) {
    console.warn(`[discogs] getLabelReleases failed for labelId=${labelId}:`, (err as Error).message);
    return [];
  }
}

/**
 * Collection + wantlist counts for a linked user. One cheap call each:
 * the folder-0 endpoint reports the total count directly, and a
 * per_page=1 wants page carries the total in its pagination block. No
 * collection contents are stored or held — just the two integers the
 * profile card displays. Uses the user's own OAuth credentials so private
 * collections still report correctly. Memo-cached for 30 minutes.
 *
 * Per-release/master ownership matching deliberately lives nowhere here:
 * a correct "do I own this album" badge needs the full collection
 * enumerated (Discogs has no per-master membership endpoint), which is
 * the auto-sync milestone, not this lightweight link.
 */
/**
 * Public collection count for any Discogs username — read with the
 * app-level token (no OAuth), so it only ever sees what's publicly
 * visible. Used by the avatar-hover member card, where the viewer is
 * someone else: exposing a private collection's size would be wrong, and
 * the app token naturally can't. Returns null when the collection is
 * private or the lookup fails. Memo-cached 30 minutes; the app token's
 * 60/min limit is shared site-wide, so the cache is what keeps a burst of
 * hovers from exhausting it.
 */
export const getPublicCollectionCount = memoAsync(
  'discogs-pub-count',
  async (username: string): Promise<number | null> => {
    try {
      const res = await axios.get(
        `${DISCOGS_BASE}/users/${encodeURIComponent(
          username
        )}/collection/folders/0`,
        { headers: getHeaders(), httpsAgent }
      );
      return typeof res.data?.count === 'number' ? res.data.count : null;
    } catch (err) {
      console.warn(
        `[discogs] getPublicCollectionCount failed for ${username}:`,
        (err as Error).message
      );
      return null;
    }
  },
  30 * 60 * 1000
);

export const getDiscogsCollectionStats = memoAsync(
  'discogs-stats',
  async (
    username: string,
    accessToken: string,
    accessSecret: string
  ): Promise<{ collectionCount: number; wantlistCount: number }> => {
    const base = `${DISCOGS_BASE}/users/${encodeURIComponent(username)}`;
    const [folder, wants] = await Promise.all([
      signedGet(`${base}/collection/folders/0`, accessToken, accessSecret),
      signedGet(`${base}/wants?per_page=1`, accessToken, accessSecret),
    ]);
    return {
      collectionCount: folder?.count ?? 0,
      wantlistCount: wants?.pagination?.items ?? 0,
    };
  },
  30 * 60 * 1000
);
