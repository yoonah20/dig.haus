import { queryAll } from '../db/index.js';

// Pricing duplicated from routes/admin.ts — two unrelated consumers
// need the same numbers (dashboard display there, pre-flight budget
// gate here), and wiring a mutual import would couple a request-path
// module to the admin route file. A 6-line constant is cheap enough
// to keep in both places; keep them in sync when Anthropic pricing
// changes.
const PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};
const WEB_SEARCH_PER_1000 = 10;

// Rolling-24h Claude spend ceiling. The per-album STEP1_BUDGET_CAP_USD
// in reviews.ts stops a single runaway pipeline; this cap is the
// "admin accidentally ran 🔍 리뷰 모아오기 on 20 obscure albums back
// to back" guard. $1.00 comfortably covers ~10-20 normal warm-ups
// (≈$0.05 each) plus the incidental pronunciation / similar-desc /
// summary calls around them. Crossing it means something is off —
// either a pricing blow-up or a loop — and the right answer is to
// stop and investigate rather than keep spending.
export const ROLLING_24H_USD_CAP = 1.0;

export function getRollingDailyClaudeSpendUsd(): number {
  const rows = queryAll(
    `SELECT model,
            SUM(input_tokens) AS in_tok,
            SUM(output_tokens) AS out_tok,
            SUM(web_search_count) AS search_n
     FROM claude_usage_log
     WHERE created_at >= datetime('now', '-1 day')
     GROUP BY model`
  ) as Array<{ model: string; in_tok: number; out_tok: number; search_n: number }>;

  let total = 0;
  for (const r of rows) {
    const prices =
      PRICING_PER_1M[r.model] ?? PRICING_PER_1M['claude-haiku-4-5-20251001'];
    total += (r.in_tok / 1_000_000) * prices.input;
    total += (r.out_tok / 1_000_000) * prices.output;
    total += (r.search_n / 1000) * WEB_SEARCH_PER_1000;
  }
  return total;
}
