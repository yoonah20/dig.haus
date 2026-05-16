import { searchAlbums } from '../services/musicbrainz.js';
import { searchDiscogsAlbums } from '../services/discogs.js';
import { normalizeSearchQuery } from './albumSearch.js';

// Shared MusicBrainz + Discogs album search used by /api/search (admin)
// and /api/album-requests/search (logged-in users triggering the
// request flow). Both callers get the same merged / deduped / sorted
// result shape; only the route-level gating differs.

// Pull a 4-digit release year out of the query when the user typed
// one — supports the "artist + year → newest album" intent (e.g.
// "bring me the horizon 2026" should surface 2026 releases ahead of
// the artist's deep catalogue). The token is stripped from the
// remaining text so the upstream services and the textual relevance
// scoring don't try to match "2026" inside album titles. Range
// 1900-2099 keeps it from accidentally eating numeric tokens that
// appear in album titles ("Cars" → "1999" was the canonical example
// of why a 4-digit-anywhere regex would over-match).
function extractYearToken(query: string): {
  year: string | null;
  remaining: string;
} {
  const match = query.match(/(?:^|\s)((?:19|20)\d{2})(?=\s|$)/);
  if (!match) return { year: null, remaining: query };
  const year = match[1];
  const remaining = query
    .replace(match[0], ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { year, remaining };
}

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

// Split / collaborative releases — "Artist A / Artist B" or
// "Artist A ● Artist B" in the title field. MusicBrainz tags
// these as primary-type Album so the upstream filter doesn't
// drop them, but for an artist-name search they sit visually
// ahead of the real catalogue ("hot water music / rydell"
// scores higher than "Vows" because its title also contains
// the queried artist name). Demote so standard albums lead
// while splits stay reachable lower in the list.
const SPLIT_TITLE_PATTERN = /\s[\/●•]\s/;

function relevanceScore(
  result: { artist: string; title: string; year?: string | null },
  queryWords: string[],
  yearFilter: string | null
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
  // Year-match boost — when the user explicitly asked for releases
  // from a specific year, results carrying that year jump above
  // textual ties so the requested release lands at the top even
  // when the deep catalogue dominates the upstream relevance order.
  // +5 is large enough to outrank the artist+title exact-substring
  // bonuses (3 + 2) so a year-matching candidate from a partial
  // text match still beats a non-year-matching exact text match.
  if (yearFilter && result.year && result.year.startsWith(yearFilter)) {
    score += 5;
  }
  // Split-album demotion. -4 brings a split with a perfect title +
  // artist substring hit (3 + 2 = 5 from the bonuses, plus N from
  // word matches) below a standard album that scores on artist
  // alone (3 + N). Splits still pass minRelevance so they remain
  // discoverable; they just stop crowding the top of the list.
  if (SPLIT_TITLE_PATTERN.test(result.title)) {
    score -= 4;
  }
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
  // Normalise once at entry so both upstreams (MB + Discogs) and the
  // split-query / scoring paths all see the same cleaned token list.
  // Skips the dash-separator artefact a copy-paste like "Artist -
  // Album" otherwise drags through every layer.
  const normalizedRaw = normalizeSearchQuery(query);
  const { year: yearFilter, remaining: textOnly } =
    extractYearToken(normalizedRaw);
  // If the year was the *only* token, fall back to the raw text so
  // the upstreams don't get an empty query.
  const textForUpstream = textOnly || normalizedRaw;
  const queryWords = textForUpstream.toLowerCase().split(/\s+/).filter(Boolean);

  // MB Lucene supports `date:YYYY` for filtering by release date —
  // append it to the query when the user gave us a year so the
  // upstream returns 2026 releases instead of buring them under the
  // artist's earlier catalogue. The textual portion still drives
  // most of the matching; the date clause just trims the result set.
  const mbQuery = yearFilter
    ? `${textForUpstream} AND date:${yearFilter}`
    : textForUpstream;

  // Parallel: full-query search against both sources + split queries
  // (artist + album combinations for multi-word input).
  const [mbAlbums, discogsAlbums] = await Promise.all([
    searchAlbums(mbQuery),
    searchDiscogsAlbums(textForUpstream, yearFilter),
  ]);

  let splitResults: typeof mbAlbums = [];
  if (queryWords.length >= 2) {
    const splits = generateSplitQueries(textForUpstream);
    const splitSearches = splits.map((s) => {
      const base = `artist:"${s.artist}" AND release:"${s.album}"`;
      return searchAlbums(yearFilter ? `${base} AND date:${yearFilter}` : base);
    });
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
    (a) => relevanceScore(a, queryWords, yearFilter) >= minRelevance
  );

  // Sort: relevance first, then year descending.
  filtered.sort((a, b) => {
    const ra = relevanceScore(a, queryWords, yearFilter);
    const rb = relevanceScore(b, queryWords, yearFilter);
    if (ra !== rb) return rb - ra;
    const ya = parseInt(a.year || '', 10) || 0;
    const yb = parseInt(b.year || '', 10) || 0;
    return yb - ya;
  });

  return filtered.slice(0, 25);
}
