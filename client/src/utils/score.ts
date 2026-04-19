// Score tier thresholds. `min` is inclusive — a score falls into the
// first tier whose `min` it meets or exceeds. Ordered high → low so
// lookup can short-circuit on the first match.
//
// Ranges:
//   86~100 → cyan  (명반)
//   76~85  → green (수작)
//   51~75  → yellow (평작)
//    1~50  → red   (혹평)
const SCORE_TIERS = [
  { min: 86, text: 'text-cyan-400',   bg: 'bg-cyan-400/10 text-cyan-400',     glowRgb: '34, 211, 238' },
  { min: 76, text: 'text-green-400',  bg: 'bg-green-400/10 text-green-400',   glowRgb: '74, 222, 128' },
  { min: 51, text: 'text-yellow-400', bg: 'bg-yellow-400/10 text-yellow-400', glowRgb: '250, 204, 21' },
  { min: 0,  text: 'text-red-400',    bg: 'bg-red-400/10 text-red-400',       glowRgb: '248, 113, 113' },
] as const;

function tierFor(score: number) {
  return SCORE_TIERS.find((t) => score >= t.min) ?? SCORE_TIERS[SCORE_TIERS.length - 1];
}

export function getScoreColor(score: number): string {
  return tierFor(score).text;
}

export function getScoreBgColor(score: number): string {
  return tierFor(score).bg;
}

// Tailwind's *-400 palette as raw RGB triplets, so we can compose
// rgba(…, opacity) strings for inline styles (gradients, box-shadow glows).
export function getScoreGlowRgb(score: number): string {
  return tierFor(score).glowRgb;
}
