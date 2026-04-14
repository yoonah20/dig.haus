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

    // Deduplicate by release-group, keep only Album/EP (skip Singles, Compilations)
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const r of releases) {
      const rgid = r['release-group']?.id;
      const key = rgid || `${r.title}::${r['artist-credit']?.[0]?.name}`;
      if (seen.has(key)) continue;
      // Filter out singles and compilations
      const primaryType = r['release-group']?.['primary-type'] || '';
      if (primaryType === 'Single' || primaryType === 'Broadcast') continue;
      seen.add(key);
      unique.push(r);
    }

    return unique.map((r: any) => ({
      mbid: r.id,
      title: r.title,
      artist: r['artist-credit']?.[0]?.name || 'Unknown',
      year: r.date?.substring(0, 4) || '',
      format: r.media?.[0]?.format || '',
      label: r['label-info']?.[0]?.label?.name || '',
      coverArtUrl: `https://coverartarchive.org/release/${r.id}/front-250`,
    }));
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
    return {
      mbid: r.id,
      title: r.title,
      artist: r['artist-credit']?.[0]?.name || 'Unknown',
      artistMbid: r['artist-credit']?.[0]?.artist?.id || '',
      date: r.date || '',
      year: r.date?.substring(0, 4) || '',
      country: r.country || '',
      barcode: r.barcode || '',
      status: r.status || '',
      packaging: r.packaging || '',
      labels: (r['label-info'] || []).map((li: any) => ({
        name: li.label?.name || '',
        catalogNumber: li['catalog-number'] || '',
      })),
      genres: (r.genres || []).map((g: any) => g.name),
      releaseGroup: r['release-group']
        ? {
            mbid: r['release-group'].id,
            title: r['release-group'].title,
            primaryType: r['release-group']['primary-type'] || '',
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
