// Score tier thresholds. `min` is inclusive — a score falls into the
// first tier whose `min` it meets or exceeds. Ordered high → low so
// lookup can short-circuit on the first match.
//
// Ranges:
//   86~100 → masterpiece (명반)
//   76~85  → great       (수작)
//   51~75  → fair        (평작)
//    1~50  → poor        (혹평)
//
// Colors are driven by the --color-score-* tokens in index.css (see
// the "Functional / semantic palette" block) — Tailwind v4 emits the
// text-/bg- utilities from those tokens, so a recolor happens in the
// token file, not here. glowRgb stays as raw triplets because the
// glow composes rgba(…, opacity) strings in inline styles, which
// can't read a Tailwind color token; keep these in sync with the
// tokens if the tier hues ever change.
const SCORE_TIERS = [
  { min: 86, text: 'text-score-masterpiece', bg: 'bg-score-masterpiece/10 text-score-masterpiece', glowRgb: '34, 211, 238' },
  { min: 76, text: 'text-score-great',       bg: 'bg-score-great/10 text-score-great',             glowRgb: '74, 222, 128' },
  { min: 51, text: 'text-score-fair',        bg: 'bg-score-fair/10 text-score-fair',               glowRgb: '250, 204, 21' },
  { min: 0,  text: 'text-score-poor',        bg: 'bg-score-poor/10 text-score-poor',               glowRgb: '248, 113, 113' },
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
