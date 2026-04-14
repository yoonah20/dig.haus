import axios from 'axios';
import https from 'https';
import { memoAsync } from '../utils/memoCache.js';

const LFM_TTL = 60 * 60 * 1000; // 1 hour

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const httpsAgent = new https.Agent({ family: 4 });

function getApiKey(): string {
  return process.env.LASTFM_API_KEY || '';
}

function buildParams(method: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    method,
    api_key: getApiKey(),
    format: 'json',
    ...extra,
  };
}

async function _getSimilarAlbums(
  artist: string,
  album: string
): Promise<Array<{ title: string; artist: string; mbid: string; imageUrl: string }>> {
  try {
    // Last.fm doesn't have album.getSimilar, so we use artist.getSimilar + top albums
    const similarRes = await axios.get(LASTFM_BASE, {
      params: buildParams('artist.getsimilar', { artist, limit: '10' }),
      httpsAgent,
    });

    const similarArtists = similarRes.data?.similarartists?.artist || [];
    const results: Array<{ title: string; artist: string; mbid: string; imageUrl: string }> = [];

    // Get top album for each similar artist (limit to first 5 to avoid rate issues)
    const topAlbumPromises = similarArtists.slice(0, 5).map(async (sa: any) => {
      try {
        const albumsRes = await axios.get(LASTFM_BASE, {
          params: buildParams('artist.gettopalbums', { artist: sa.name, limit: '1' }),
          httpsAgent,
        });
        const topAlbum = albumsRes.data?.topalbums?.album?.[0];
        if (topAlbum) {
          return {
            title: topAlbum.name,
            artist: sa.name,
            mbid: topAlbum.mbid || '',
            imageUrl: topAlbum.image?.find((img: any) => img.size === 'large')?.['#text'] || '',
          };
        }
        return null;
      } catch (err) {
        console.warn(`[lastfm] gettopalbums failed for "${sa.name}":`, (err as Error).message);
        return null;
      }
    });

    const albumResults = await Promise.all(topAlbumPromises);
    for (const r of albumResults) {
      if (r) results.push(r);
    }

    return results;
  } catch (err) {
    console.warn(`[lastfm] getSimilarAlbums failed for "${artist} - ${album}":`, (err as Error).message);
    return [];
  }
}

async function _getArtistInfo(
  artist: string
): Promise<{
  bio: string;
  imageUrl: string;
  similarArtists: string[];
  tags: string[];
  url: string;
} | null> {
  try {
    const res = await axios.get(LASTFM_BASE, {
      params: buildParams('artist.getinfo', { artist }),
      httpsAgent,
    });

    const a = res.data?.artist;
    if (!a) return null;

    return {
      bio: a.bio?.summary || '',
      imageUrl: a.image?.find((img: any) => img.size === 'large')?.['#text'] || '',
      similarArtists: (a.similar?.artist || []).map((sa: any) => sa.name),
      tags: (a.tags?.tag || []).map((t: any) => t.name),
      url: a.url || '',
    };
  } catch (err) {
    console.warn(`[lastfm] getArtistInfo failed for "${artist}":`, (err as Error).message);
    return null;
  }
}

async function _getAlbumInfo(
  artist: string,
  album: string
): Promise<{
  summary: string;
  tags: string[];
  imageUrl: string;
  listeners: number;
  playcount: number;
  url: string;
} | null> {
  try {
    const res = await axios.get(LASTFM_BASE, {
      params: buildParams('album.getinfo', { artist, album }),
      httpsAgent,
    });

    const a = res.data?.album;
    if (!a) return null;

    return {
      summary: a.wiki?.summary || '',
      tags: (a.tags?.tag || []).map((t: any) => t.name),
      imageUrl: a.image?.find((img: any) => img.size === 'large')?.['#text'] || '',
      listeners: parseInt(a.listeners, 10) || 0,
      playcount: parseInt(a.playcount, 10) || 0,
      url: a.url || '',
    };
  } catch (err) {
    console.warn(`[lastfm] getAlbumInfo failed for "${artist} - ${album}":`, (err as Error).message);
    return null;
  }
}

// Memoized exports — dedupe identical calls inside a 5-minute window.
export const getSimilarAlbums = memoAsync('lfm:getSimilarAlbums', _getSimilarAlbums, LFM_TTL);
export const getArtistInfo = memoAsync('lfm:getArtistInfo', _getArtistInfo, LFM_TTL);
export const getAlbumInfo = memoAsync('lfm:getAlbumInfo', _getAlbumInfo, LFM_TTL);
