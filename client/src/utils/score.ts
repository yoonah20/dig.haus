export function getScoreColor(score: number): string {
  if (score > 85) return 'text-cyan-400';
  if (score > 75) return 'text-green-400';
  if (score > 50) return 'text-yellow-400';
  return 'text-red-400';
}

export function getScoreBgColor(score: number): string {
  if (score > 85) return 'bg-cyan-400/10 text-cyan-400';
  if (score > 75) return 'bg-green-400/10 text-green-400';
  if (score > 50) return 'bg-yellow-400/10 text-yellow-400';
  return 'bg-red-400/10 text-red-400';
}
