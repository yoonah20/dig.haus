import axios from 'axios';
import https from 'https';
import { memoAsync } from '../utils/memoCache.js';

const MB_TTL = 60 * 1000; // 1 minute coalescing window

const MB_BASE = 'https://musicbrainz.org/ws/2';
const headers = {
  'User-Agent': 'dig.haus/1.0 (contact@dig.haus)',
  'Accept': 'application/json',
};
const httpsAgent = new https.Agent({ family: 4 });

let lastRequestTime = 0;

async function rateLimitedRequest(url: string, params: Record<string, string>) {
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - lastRequestTime));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return axios.get(url, { headers, params, httpsAgent });
}

async function _searchAlbums(query: string): Promise<
  Array<{
    mbid: string;
    title: string;
    artist: string;
    year: string;
    format: string;
    label: string;
    coverArtUrl: string;
  }>
> {
  try {
    const res = await rateLimitedRequest(`${MB_BASE}/release`, {
      query,
      fmt: 'json',
      limit: '25',
    });

    const releases = res.data.releases || [];

    // Filter to full-length albums only — strip singles, EPs, broadcasts,
    // and the noisy secondary types (compilations, live, remix, demo,
    // DJ-mix, mixtape, interview, spokenword). The previous filter only
    // dropped Single + Broadcast, so EPs and "Album + Compilation"
    // groups (greatest-hits packages, B-sides collections) slipped
    // through and dominated the result list for catalog-heavy artists.
    // Soundtracks are kept — they're legitimate album-shaped releases.
    const NOISY_SECONDARY_TYPES = new Set([
      'Compilation', 'Live', 'Remix', 'Demo', 'DJ-mix',
      'Mixtape/Street', 'Interview', 'Spokenword',
    ]);
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const r of releases) {
      const rgid = r['release-group']?.id;
      const key = rgid || `${r.title}::${r['artist-credit']?.[0]?.name}`;
      if (seen.has(key)) continue;
      const primaryType = r['release-group']?.['primary-type'] || '';
      if (primaryType !== 'Album') continue;
      const secondaryTypes: string[] = r['release-group']?.['secondary-types'] || [];
      if (secondaryTypes.some((t) => NOISY_SECONDARY_TYPES.has(t))) continue;
      seen.add(key);
      unique.push(r);
    }

    return unique.map((r: any) => {
      // Same comma-joined credit treatment used in _getRelease so
      // a search result for a collab album surfaces both artists
      // in the dropdown ("Nine Inch Nails, Boys Noize") instead
      // of only the first credit. Empty arrays fall through to
      // 'Unknown' the same way the previous single-credit code did.
      const credits = Array.isArray(r['artist-credit']) ? r['artist-credit'] : [];
      const names = credits
        .map((c: any) => c?.name || c?.artist?.name || '')
        .filter((s: string) => s.length > 0);
      const artist = names.length > 0 ? names.join(', ') : 'Unknown';
      return {
        mbid: r.id,
        title: r.title,
        artist,
        year: r.date?.substring(0, 4) || '',
        format: r.media?.[0]?.format || '',
        label: r['label-info']?.[0]?.label?.name || '',
        coverArtUrl: `https://coverartarchive.org/release/${r.id}/front-250`,
      };
    });
  } catch (err) {
    console.warn(`[mb] searchAlbums failed for "${query}":`, (err as Error).message);
    return [];
  }
}

async function _searchArtists(query: string): Promise<
  Array<{
    mbid: string;
    name: string;
    country: string;
    tags: string[];
  }>
> {
  try {
    const res = await rateLimitedRequest(`${MB_BASE}/artist`, {
      query,
      fmt: 'json',
      limit: '25',
    });

    const artists = res.data.artists || [];
    return artists.map((a: any) => ({
      mbid: a.id,
      name: a.name,
      country: a.country || '',
      tags: (a.tags || []).map((t: any) => t.name),
    }));
  } catch (err) {
    console.warn(`[mb] searchArtists failed for "${query}":`, (err as Error).message);
    return [];
  }
}

async function _getRelease(mbid: string): Promise<any | null> {
  try {
    const res = await rateLimitedRequest(`${MB_BASE}/release/${mbid}`, {
      inc: 'artists+labels+genres+release-groups',
      fmt: 'json',
    });

    const r = res.data;
    // Reissues / remasters get their own MusicBrainz release with the reissue
    // year in r.date. The release-group's first-release-date holds the
    // ORIGINAL year of the album, which is what we want to display.
    const firstReleaseDate: string = r['release-group']?.['first-release-date'] || '';
    const originalDate = firstReleaseDate || r.date || '';
    // Multi-artist credit. MB returns `artist-credit` as an array
    // with each entry carrying name + artist.id + an optional
    // `joinphrase` (" & ", " feat. ", " vs " etc). We discard the
    // joinphrase and always render with ", " on the client per the
    // site's house style; the site doesn't model the original
    // joining word as a meaningful distinction yet. Empty / single-
    // entry albums collapse to a 1-element array so the cache shape
    // is uniform.
    const credits = Array.isArray(r['artist-credit']) ? r['artist-credit'] : [];
    const artistCredit = credits
      .map((c: any) => ({
        name: c?.name || c?.artist?.name || '',
        mbid: c?.artist?.id || null,
      }))
      .filter((c: any) => c.name.length > 0);
    const joinedArtist = artistCredit.length > 0
      ? artistCredit.map((c: any) => c.name).join(', ')
      : 'Unknown';

    // Label resolution. The fetched MB release is a SPECIFIC pressing
    // — its `label-info[0]` is the label of that pressing. For a JP
    // (or other regional) reissue that means we'd surface "Universal
    // Music Japan" or "Avex" instead of the original Western label.
    // Whenever the release sits in a release-group, fetch the group's
    // earliest release and use its label as the canonical answer. The
    // current pressing's labels stay available as
    // `releaseSpecificLabels` for callers that genuinely want the
    // per-pressing info. The previous trigger required both date fields
    // to be present and to differ, which silently passed through JP
    // reissues that happened to share the group's first-release-date
    // (or that had no date metadata on the fetched pressing).
    const releaseSpecificLabels = (r['label-info'] || []).map((li: any) => ({
      name: li.label?.name || '',
      catalogNumber: li['catalog-number'] || '',
    }));
    let labels = releaseSpecificLabels;
    const rgId: string | undefined = r['release-group']?.id;
    if (rgId) {
      try {
        const rgRes = await rateLimitedRequest(`${MB_BASE}/release`, {
          'release-group': rgId,
          inc: 'labels',
          fmt: 'json',
          limit: '100',
        });
        const releases: any[] = rgRes.data?.releases || [];
        const candidates = releases
          .filter(
            (rel: any) =>
              rel.date &&
              Array.isArray(rel['label-info']) &&
              rel['label-info'].length > 0 &&
              rel['label-info'][0]?.label?.name
          )
          .sort((a: any, b: any) => a.date.localeCompare(b.date));
        // Prefer non-Japan releases. Strict chronological pick would
        // surface JP advance pressings (e.g. Soilwork's Chainheart
        // Machine has a Soundholic JP issue dated a year before the
        // Listenable Records EU original) as the "canonical" label,
        // which is the opposite of what the Discogs artist UI shows
        // and is exactly the licensee-leak the user reported. MB
        // country codes are ISO 3166 so 'JP' is the exact match.
        // Falls back to the strict earliest when only JP candidates
        // carry label info.
        const nonJpCandidates = candidates.filter((rel: any) => rel.country !== 'JP');
        const canonical = nonJpCandidates[0] || candidates[0];
        if (canonical) {
          const canonicalLabels = (canonical['label-info'] || []).map(
            (li: any) => ({
              name: li.label?.name || '',
              catalogNumber: li['catalog-number'] || '',
            })
          );
          if (canonicalLabels.length > 0 && canonicalLabels[0].name) {
            labels = canonicalLabels;
          }
        }
      } catch (err) {
        // Soft-fail to per-release labels if the group-wide lookup
        // doesn't resolve — better to ship the JP label than nothing.
        console.warn(
          `[mb] release-group canonical-label lookup failed for rgId=${rgId}:`,
          (err as Error).message
        );
      }
    }

    return {
      mbid: r.id,
      title: r.title,
      // `artist` stays the comma-joined display string so single-
      // string callers still see the full collab text. Structured
      // form lives on `artistCredit` for callers that render each
      // name as its own clickable element.
      artist: joinedArtist,
      artistMbid: artistCredit[0]?.mbid || '',
      artistCredit,
      date: originalDate,
      year: originalDate.substring(0, 4) || '',
      // Keep raw release-specific fields available for callers that need them
      // (e.g. "this pressing was issued on …" UI, market data).
      releaseSpecificDate: r.date || '',
      firstReleaseDate,
      country: r.country || '',
      barcode: r.barcode || '',
      status: r.status || '',
      packaging: r.packaging || '',
      labels,
      releaseSpecificLabels,
      genres: (r.genres || []).map((g: any) => g.name),
      releaseGroup: r['release-group']
        ? {
            mbid: r['release-group'].id,
            title: r['release-group'].title,
            primaryType: r['release-group']['primary-type'] || '',
            // Secondary types qualify the primary — Live, Compilation,
            // Soundtrack, Remix, Demo, DJ-mix, Mixtape/Street,
            // Interview, Spokenword, etc. Empty array means "plain
            // studio LP" which is the canonical tier in search
            // ranking. Stored verbatim from MB so we can re-classify
            // without re-fetching if the ranking rule changes.
            secondaryTypes: Array.isArray(r['release-group']['secondary-types'])
              ? (r['release-group']['secondary-types'] as string[])
              : [],
            firstReleaseDate,
          }
        : null,
      media: (r.media || []).map((m: any) => ({
        format: m.format || '',
        trackCount: m['track-count'] || 0,
      })),
      coverArtUrl: `https://coverartarchive.org/release/${r.id}/front-250`,
    };
  } catch (err) {
    console.warn(`[mb] getRelease failed for mbid=${mbid}:`, (err as Error).message);
    return null;
  }
}

async function _getArtist(mbid: string): Promise<any | null> {
  try {
    const res = await rateLimitedRequest(`${MB_BASE}/artist/${mbid}`, {
      inc: 'release-groups+genres+url-rels',
      fmt: 'json',
    });

    const a = res.data;
    return {
      mbid: a.id,
      name: a.name,
      sortName: a['sort-name'] || '',
      country: a.country || '',
      type: a.type || '',
      beginDate: a['life-span']?.begin || '',
      endDate: a['life-span']?.end || '',
      genres: (a.genres || []).map((g: any) => g.name),
      urls: (a.relations || [])
        .filter((rel: any) => rel.type === 'url')
        .map((rel: any) => ({
          type: rel.type,
          url: rel.url?.resource || '',
        })),
      releaseGroups: (a['release-groups'] || []).map((rg: any) => ({
        mbid: rg.id,
        title: rg.title,
        primaryType: rg['primary-type'] || '',
        firstReleaseDate: rg['first-release-date'] || '',
      })),
    };
  } catch (err) {
    console.warn(`[mb] getArtist failed for mbid=${mbid}:`, (err as Error).message);
    return null;
  }
}

async function _getLabelByName(
  name: string
): Promise<{ foundingYear: string; country: string } | null> {
  try {
    const res = await rateLimitedRequest(`${MB_BASE}/label`, {
      query: `"${name}"`,
      fmt: 'json',
      limit: '5',
    });

    const labels = res.data.labels || [];
    // Find best match (exact or close name match)
    const match = labels.find(
      (l: any) => l.name.toLowerCase() === name.toLowerCase()
    ) || labels[0];

    if (!match) return null;

    const beginYear = match['life-span']?.begin?.substring(0, 4) || '';
    return {
      foundingYear: beginYear,
      country: match.country || match.area?.name || '',
    };
  } catch (err) {
    console.warn(`[mb] getLabelByName failed for "${name}":`, (err as Error).message);
    return null;
  }
}

async function _getArtistReleases(mbid: string): Promise<
  Array<{
    mbid: string;
    title: string;
    primaryType: string;
    year: string;
    firstReleaseDate: string;
  }>
> {
  try {
    const res = await rateLimitedRequest(`${MB_BASE}/release-group`, {
      artist: mbid,
      fmt: 'json',
      limit: '100',
    });

    const groups = res.data['release-groups'] || [];
    return groups
      .map((rg: any) => ({
        mbid: rg.id,
        title: rg.title,
        primaryType: rg['primary-type'] || '',
        year: rg['first-release-date']?.substring(0, 4) || '',
        firstReleaseDate: rg['first-release-date'] || '',
      }))
      .sort((a: any, b: any) => a.year.localeCompare(b.year));
  } catch (err) {
    console.warn(`[mb] getArtistReleases failed for mbid=${mbid}:`, (err as Error).message);
    return [];
  }
}

// Memoized exports — dedupe identical calls inside a 1-minute window.
export const searchAlbums = memoAsync('mb:searchAlbums', _searchAlbums, MB_TTL);
export const searchArtists = memoAsync('mb:searchArtists', _searchArtists, MB_TTL);
export const getRelease = memoAsync('mb:getRelease', _getRelease, MB_TTL);
export const getArtist = memoAsync('mb:getArtist', _getArtist, MB_TTL);
export const getLabelByName = memoAsync('mb:getLabelByName', _getLabelByName, MB_TTL);
export const getArtistReleases = memoAsync('mb:getArtistReleases', _getArtistReleases, MB_TTL);
