import { Router } from 'express';
import { searchAlbums } from '../services/musicbrainz.js';
import { searchDiscogsAlbums } from '../services/discogs.js';
import { searchAlbumsInDb } from '../utils/albumSearch.js';
import type { AppUser } from '../auth/passport.js';

const router = Router();

/**
 * Generate artist+album split combinations for queries like "converge love is not enough".
 */
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

/**
 * Simple string similarity: what fraction of words in `a` appear in `b`.
 */
function wordOverlap(a: string, b: string): number {
  const wordsA = a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
  if (wordsA.length === 0) return 0;
  const matches = wordsA.filter((w) => wordsB.has(w)).length;
  return matches / wordsA.length;
}

/**
 * Score how relevant a result is to the query.
 * Higher = more relevant.
 */
function relevanceScore(result: { artist: string; title: string }, queryWords: string[]): number {
  const artist = result.artist.toLowerCase();
  const title = result.title.toLowerCase();
  const combined = `${artist} ${title}`;

  let score = 0;
  for (const w of queryWords) {
    if (combined.includes(w)) score += 1;
  }
  // Bonus for exact artist or title substring match
  const queryStr = queryWords.join(' ');
  if (artist.includes(queryStr)) score += 3;
  if (title.includes(queryStr)) score += 2;

  return score;
}

// GET /api/search?q=query
// Admin: full MusicBrainz + Discogs external search.
// Everyone else: falls back to DB-only search over registered albums.
router.get('/', async (req, res) => {
  const query = req.query.q as string;
  if (!query || query.length < 2) {
    return res.json({ albums: [] });
  }

  const user = req.user as AppUser | undefined;
  const isAdmin = !!user?.is_admin;

  if (!isAdmin) {
    try {
      return res.json({ albums: searchAlbumsInDb(query) });
    } catch (error) {
      console.error('DB search fallback error:', error);
      return res.json({ albums: [] });
    }
  }

  try {
    const queryWords = query.toLowerCase().trim().split(/\s+/).filter(Boolean);

    // 1. Parallel searches: full query on both sources
    const [mbAlbums, discogsAlbums] = await Promise.all([
      searchAlbums(query),
      searchDiscogsAlbums(query),
    ]);

    // 2. Split queries for multi-word input (artist + album combinations)
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

    // 3. Merge + deduplicate
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const seen = new Set<string>();
    const merged: any[] = [];

    const addUnique = (items: any[]) => {
      for (const a of items) {
        const key = `${normalize(a.artist)}::${normalize(a.title)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(a);
      }
    };

    // MusicBrainz first, then splits, then Discogs
    addUnique(mbAlbums);
    addUnique(splitResults);
    // searchDiscogsAlbums queries type=master, so d.discogsId is a MASTER id.
    // Prefix accordingly so the resolver doesn't treat it as a release id —
    // otherwise we'd call /releases/{masterId} and happily return a totally
    // unrelated release that happens to share that numeric id.
    addUnique(discogsAlbums.map((d) => ({
      mbid: `discogs-master-${d.discogsId}`,
      title: d.title,
      artist: d.artist,
      year: d.year,
      format: d.format,
      label: d.label,
      coverArtUrl: d.coverArtUrl,
    })));

    // 4. Filter: at least 1 query word must appear in artist+title
    const minRelevance = queryWords.length >= 3 ? 2 : 1;
    const filtered = merged.filter((a) =>
      relevanceScore(a, queryWords) >= minRelevance
    );

    // 5. Sort: relevance first, then year descending
    filtered.sort((a: any, b: any) => {
      const ra = relevanceScore(a, queryWords);
      const rb = relevanceScore(b, queryWords);
      if (ra !== rb) return rb - ra;

      const ya = parseInt(a.year, 10) || 0;
      const yb = parseInt(b.year, 10) || 0;
      return yb - ya;
    });

    res.json({ albums: filtered.slice(0, 25) });
  } catch (error) {
    console.error('Search error:', error);
    res.json({ albums: [] });
  }
});

export default router;
