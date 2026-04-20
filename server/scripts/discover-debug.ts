// One-shot debug for the review-URL discovery pipeline.
//
// Calls Serper → domain-filter → Haiku and prints each stage so we can
// see where candidates drop. Useful when an album comes back short from
// the admin UI and we need to know which stage is responsible without
// adding permanent logs to production.
//
// Usage:
//   tsx server/scripts/discover-debug.ts "Artist" "Album Title"
//
// Needs SERPER_API_KEY + ANTHROPIC_API_KEY in server/.env.

import 'dotenv/config';
import { EXCLUDED_URL_DOMAINS } from '../src/services/reviews.js';
import { searchReviewUrls } from '../src/services/serper.js';
import { selectEditorialReviewUrls } from '../src/services/claude.js';

async function main() {
  const [artist, album] = process.argv.slice(2);
  if (!artist || !album) {
    console.error('usage: tsx server/scripts/discover-debug.ts "Artist" "Album Title"');
    process.exit(1);
  }

  console.log(`\n=== discover: ${artist} / ${album} ===\n`);

  const candidates = await searchReviewUrls(artist, album);
  console.log(`[1] serper returned ${candidates.length} candidates`);
  candidates.forEach((c, i) => {
    console.log(`    ${String(i + 1).padStart(2)}. ${c.url}`);
  });

  const filtered = candidates.filter((c) => {
    try {
      const host = new URL(c.url).hostname.toLowerCase();
      return !EXCLUDED_URL_DOMAINS.some((d) => host.includes(d));
    } catch {
      return false;
    }
  });
  const dropped = candidates.filter((c) => !filtered.includes(c));
  console.log(`\n[2] after EXCLUDED_URL_DOMAINS: ${filtered.length} (${dropped.length} dropped)`);
  dropped.forEach((c) => console.log(`    - ${c.url}`));

  if (filtered.length === 0) {
    console.log('\n[3] skipped — nothing to hand to Haiku');
    return;
  }

  const picked = await selectEditorialReviewUrls(artist, album, filtered);
  console.log(`\n[3] haiku picked ${picked.length}`);
  picked.forEach((u, i) => console.log(`    ${String(i + 1).padStart(2)}. ${u}`));

  const pickedSet = new Set(picked);
  const rejected = filtered.filter((c) => !pickedSet.has(c.url));
  console.log(`\n[4] haiku rejected ${rejected.length}`);
  rejected.forEach((c) => console.log(`    - ${c.url}`));

  console.log(
    `\nsummary: serper=${candidates.length} → domain-filter=${filtered.length} → haiku-pick=${picked.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
