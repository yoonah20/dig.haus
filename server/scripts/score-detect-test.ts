// Quick local verification of the aria-label rating detector against a
// cached HTML file. Mirrors the logic in
// server/src/services/reviews.ts:detectAriaLabelRating so we can sanity-
// check a new site's rating markup without wiring up the full extractor.
//
// Usage:
//   curl -s -L -A "Mozilla/5.0" "URL" -o /tmp/page.html
//   tsx server/scripts/score-detect-test.ts /tmp/page.html

import { readFileSync } from 'node:fs';

function detectAriaLabelRating(html: string): number | null {
  const containerRe =
    /<[a-z]+\b[^>]*class\s*=\s*"[^"]*(?:rating|stars|score)[^"]*"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = containerRe.exec(html)) !== null) {
    const tagText = m[0];
    const attr =
      /aria-label\s*=\s*"([^"]+)"/i.exec(tagText)?.[1] ||
      /title\s*=\s*"([^"]+)"/i.exec(tagText)?.[1] ||
      /alt\s*=\s*"([^"]+)"/i.exec(tagText)?.[1];
    console.log(`  container: ${tagText.slice(0, 120)}...`);
    console.log(`  attr: ${attr ?? '(none)'}`);
    if (!attr) continue;
    const outOf = attr.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s+out\s+of\s+(\d{1,3})/i);
    if (outOf) {
      const score = parseFloat(outOf[1].replace(',', '.'));
      const scale = parseInt(outOf[2], 10);
      if ([5, 10, 20, 100].includes(scale) && score >= 0 && score <= scale) {
        return Math.max(0, Math.min(100, Math.round((score / scale) * 100)));
      }
    }
    const frac = attr.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*\/\s*(\d{1,3})/);
    if (frac) {
      const score = parseFloat(frac[1].replace(',', '.'));
      const scale = parseInt(frac[2], 10);
      if ([5, 10, 20, 100].includes(scale) && score >= 0 && score <= scale) {
        return Math.max(0, Math.min(100, Math.round((score / scale) * 100)));
      }
    }
  }
  return null;
}

const path = process.argv[2];
if (!path) {
  console.error('usage: tsx score-detect-test.ts <html-file>');
  process.exit(1);
}

const html = readFileSync(path, 'utf8');
console.log(`file: ${path} (${html.length} chars)\n`);
const score = detectAriaLabelRating(html);
console.log(`\n=> detectAriaLabelRating: ${score === null ? 'null' : score + '/100'}`);
