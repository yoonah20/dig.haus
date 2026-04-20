// Probe Serper's /search endpoint — part 2: pagination.
//
// Having established that `num` doesn't paginate (num=40 returns same ~9
// results as num=10), the question is whether Serper's `page` parameter
// works for fetching real page 2, 3, 4. If so, the fix is to call N
// times with explicit page numbers and dedupe.

import 'dotenv/config';
import axios from 'axios';

const apiKey = process.env.SERPER_API_KEY;
if (!apiKey) {
  console.error('SERPER_API_KEY missing');
  process.exit(1);
}

async function probe(q: string, num: number, page: number, label: string) {
  try {
    const resp = await axios.post(
      'https://google.serper.dev/search',
      { q, num, page },
      {
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    const organic = Array.isArray(resp.data?.organic) ? resp.data.organic : [];
    const urls = organic.map((r: any) => r.link as string).filter(Boolean);
    console.log(`[${label.padEnd(36)}] status=${resp.status} organic=${urls.length}`);
    urls.forEach((u: string, i: number) => console.log(`    ${i + 1}. ${u}`));
    return urls;
  } catch (err) {
    console.log(`[${label.padEnd(36)}] ERROR ${(err as Error).message}`);
    return [];
  }
}

async function main() {
  const artist = 'Winterfylleth';
  const album = 'The Imperious Horizon';
  const q = `${artist} ${album} album review`;

  const seen = new Set<string>();
  for (const page of [1, 2, 3, 4]) {
    const urls = await probe(q, 10, page, `unquoted num=10 page=${page}`);
    const newOnes = urls.filter((u) => !seen.has(u));
    console.log(`    (new on this page: ${newOnes.length})\n`);
    urls.forEach((u) => seen.add(u));
  }
  console.log(`\n=== total unique URLs across pages 1-4: ${seen.size} ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
