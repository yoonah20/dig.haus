// A/B probe: s.jina.ai (Jina Search) vs Serper for review-URL discovery.
//
// Motivation: Serper's pain at our volume isn't the per-call cost (~600
// albums/month ≈ $0.60) but the $50/mo paid floor once the one-time free
// credits run out. Jina Search is attractive because we ALREADY depend on
// r.jina.ai for page fetching — same vendor, same key, and in link-only
// mode (X-Respond-With: no-content) it returns just url/title/description
// for a few hundred tokens per query, effectively free at this volume.
//
// The one unknown is coverage: does Jina surface the same editorial metal
// blogs / zines Serper does, especially for niche albums and KR-relevant
// results? Jina doesn't document an hl/gl locale passthrough, so this has
// to be checked empirically before wiring it into the engine selector.
// This script does exactly that — same query both engines, side by side,
// with a domain-overlap breakdown so the operator can judge recall.
//
// Usage:
//   tsx server/scripts/jina-search-probe.ts "Artist" "Album Title"
//   tsx server/scripts/jina-search-probe.ts            # runs a built-in niche set
//
// Needs JINA_API_KEY (for Jina; get a free key at jina.ai — no card) and
// SERPER_API_KEY (to compare against the current engine) in server/.env.
// Missing either key just skips that side so you can still eyeball one.

import 'dotenv/config';
import axios from 'axios';

const jinaKey = process.env.JINA_API_KEY;
const serperKey = process.env.SERPER_API_KEY;

interface Hit {
  url: string;
  title: string;
  snippet: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '?';
  }
}

// Jina Search in link-only mode. `X-Respond-With: no-content` drops the
// rendered page body so we pay for metadata only — the cheap mode that
// makes Jina viable as a discovery engine. Response shape:
//   { code, status, data: [ { title, url, description, ... } ] }
async function jinaSearch(q: string): Promise<Hit[]> {
  if (!jinaKey) return [];
  const resp = await axios.get('https://s.jina.ai/', {
    params: { q },
    headers: {
      Authorization: `Bearer ${jinaKey}`,
      Accept: 'application/json',
      'X-Respond-With': 'no-content',
    },
    timeout: 30000,
    validateStatus: () => true,
  });
  if (resp.status !== 200) {
    console.log(`  [jina] HTTP ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`);
    return [];
  }
  const data = Array.isArray(resp.data?.data) ? resp.data.data : [];
  return data
    .map((r: any): Hit => ({
      url: typeof r?.url === 'string' ? r.url : '',
      title: typeof r?.title === 'string' ? r.title : '',
      snippet: typeof r?.description === 'string' ? r.description : '',
    }))
    .filter((h: Hit) => h.url && /^https?:\/\//i.test(h.url));
}

// Serper, mirroring services/serper.ts (pages 1-2, dedupe, zero-new stop).
async function serperSearch(q: string): Promise<Hit[]> {
  if (!serperKey) return [];
  const seen = new Set<string>();
  const all: Hit[] = [];
  for (let page = 1; page <= 2; page++) {
    const resp = await axios.post(
      'https://google.serper.dev/search',
      { q, num: 10, page },
      {
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    const organic = Array.isArray(resp.data?.organic) ? resp.data.organic : [];
    let added = 0;
    for (const r of organic) {
      const url = typeof r?.link === 'string' ? r.link : '';
      if (!url || seen.has(url)) continue;
      seen.add(url);
      all.push({ url, title: r?.title ?? '', snippet: r?.snippet ?? '' });
      added++;
    }
    if (added === 0) break;
  }
  return all;
}

function printList(label: string, hits: Hit[]): void {
  console.log(`\n  ${label} (${hits.length}):`);
  if (hits.length === 0) {
    console.log('    (none)');
    return;
  }
  hits.forEach((h, i) =>
    console.log(`    ${String(i + 1).padStart(2)}. ${hostOf(h.url).padEnd(28)} ${h.url}`)
  );
}

async function compare(artist: string, album: string): Promise<void> {
  const q = `${artist} ${album} album review`;
  console.log(`\n${'='.repeat(72)}\n${artist} — ${album}\n  q="${q}"`);

  const [jina, serper] = await Promise.all([
    jinaSearch(q).catch((e) => {
      console.log(`  [jina] error: ${(e as Error).message}`);
      return [] as Hit[];
    }),
    serperSearch(q).catch((e) => {
      console.log(`  [serper] error: ${(e as Error).message}`);
      return [] as Hit[];
    }),
  ]);

  printList('JINA', jina);
  printList('SERPER', serper);

  // Domain-overlap breakdown — the recall question in one view: what does
  // Jina find that Serper doesn't, and (more importantly) what editorial
  // sources does Serper surface that Jina misses?
  const jHosts = new Set(jina.map((h) => hostOf(h.url)));
  const sHosts = new Set(serper.map((h) => hostOf(h.url)));
  const both = [...jHosts].filter((h) => sHosts.has(h));
  const jinaOnly = [...jHosts].filter((h) => !sHosts.has(h));
  const serperOnly = [...sHosts].filter((h) => !jHosts.has(h));
  console.log('\n  domain overlap:');
  console.log(`    both       : ${both.join(', ') || '(none)'}`);
  console.log(`    jina-only  : ${jinaOnly.join(', ') || '(none)'}`);
  console.log(`    serper-only: ${serperOnly.join(', ') || '(none)'}`);
}

async function main(): Promise<void> {
  if (!jinaKey) console.warn('! JINA_API_KEY missing — Jina side will be empty');
  if (!serperKey) console.warn('! SERPER_API_KEY missing — Serper side will be empty');

  const [artist, album] = process.argv.slice(2);
  const targets: Array<[string, string]> =
    artist && album
      ? [[artist, album]]
      : [
          // Built-in niche set from the live catalogue — the exact "maniacal,
          // no mainstream ambition" shape recall has to hold for.
          ['Sodomisery', 'Mazzaroth'],
          ['ByoNoiseGenerator', 'Subnormal Dives'],
          ['Gaerea', 'Loss'],
          ['Vomitory', 'In Death Throes'],
        ];

  for (const [a, t] of targets) {
    await compare(a, t);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
