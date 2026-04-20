import { searchAlbums } from '../services/musicbrainz.js';
import { searchDiscogsAlbums } from '../services/discogs.js';

// Shared MusicBrainz + Discogs album search used by /api/search (admin)
// and /api/album-requests/search (logged-in users triggering the
// request flow). Both callers get the same merged / deduped / sorted
// result shape; only the route-level gating differs.

function generateSplitQueries(query: string): Array<{ artist: string; album: string }> {
  const words = query.trim().split(/\s+/);
  if (words.length < 2) return [];
  const splits: Array<{ artist: string; album: string }> = [];
  for (let i = 1; i < words.length; i++) {
    splits.push({
      artist: words.slice(0, i).join(' '),
      album: words.slice(i).join(' '),
    });
  }
  return splits;
}

function relevanceScore(
  result: { artist: string; title: string },
  queryWords: string[]
): number {
  const artist = result.artist.toLowerCase();
  const title = result.title.toLowerCase();
  const combined = `${artist} ${title}`;

  let score = 0;
  for (const w of queryWords) {
    if (combined.includes(w)) score += 1;
  }
  const queryStr = queryWords.join(' ');
  if (artist.includes(queryStr)) score += 3;
  if (title.includes(queryStr)) score += 2;
  return score;
}

export interface ExternalSearchResult {
  mbid: string;
  title: string;
  artist: string;
  year?: string | null;
  format?: string | null;
  label?: string | null;
  coverArtUrl?: string | null;
}

export async function searchExternalMerged(
  query: string
): Promise<ExternalSearchResult[]> {
  const queryWords = query.toLowerCase().trim().split(/\s+/).filter(Boolean);

  // Parallel: full-query search against both sources + split queries
  // (artist + album combinations for multi-word input).
  const [mbAlbums, discogsAlbums] = await Promise.all([
    searchAlbums(query),
    searchDiscogsAlbums(query),
  ]);

  let splitResults: typeof mbAlbums = [];
  if (queryWords.length >= 2) {
    const splits = generateSplitQueries(query);
    const splitSearches = splits.map((s) =>
      searchAlbums(`artist:"${s.artist}" AND release:"${s.album}"`)
    );
    const splitOutcomes = await Promise.allSettled(splitSearches);
    for (const outcome of splitOutcomes) {
      if (outcome.status === 'fulfilled') {
        splitResults.push(...outcome.value);
      }
    }
  }

  // Merge + dedupe by (normalised artist, normalised title).
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const seen = new Set<string>();
  const merged: ExternalSearchResult[] = [];

  const addUnique = (items: ExternalSearchResult[]) => {
    for (const a of items) {
      const key = `${normalize(a.artist)}::${normalize(a.title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(a);
    }
  };

  addUnique(mbAlbums);
  addUnique(splitResults);
  // searchDiscogsAlbums queries type=master, so d.discogsId is a MASTER
  // id. Prefix accordingly so the resolver doesn't treat it as a release
  // id — otherwise we'd call /releases/{masterId} and happily return a
  // totally unrelated release that happens to share that numeric id.
  addUnique(
    discogsAlbums.map((d) => ({
      mbid: `discogs-master-${d.discogsId}`,
      title: d.title,
      artist: d.artist,
      year: d.year,
      format: d.format,
      label: d.label,
      coverArtUrl: d.coverArtUrl,
    }))
  );

  // Filter: require query words to appear in artist+title. The user
  // typed those words on purpose — every one of them is a deliberate
  // disambiguator, so for short-to-medium queries (≤3 words) we
  // demand every word match. The previous `>=3 ? 2 : 1` rule let a
  // 3-word search like "in mourning immortal" keep dozens of "in
  // mourning" + "immortal-less" results sitting under the real hit,
  // which was the exact "why is this noise here" complaint. Queries
  // of 4+ words allow one miss so a single common-word tokenization
  // difference doesn't sink otherwise-good candidates.
  const minRelevance =
    queryWords.length <= 3 ? queryWords.length : queryWords.length - 1;
  const filtered = merged.filter(
    (a) => relevanceScore(a, queryWords) >= minRelevance
  );

  // Sort: relevance first, then year descending.
  filtered.sort((a, b) => {
    const ra = relevanceScore(a, queryWords);
    const rb = relevanceScore(b, queryWords);
    if (ra !== rb) return rb - ra;
    const ya = parseInt(a.year || '', 10) || 0;
    const yb = parseInt(b.year || '', 10) || 0;
    return yb - ya;
  });

  return filtered.slice(0, 25);
}
