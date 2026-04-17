// Short Korean relative-time labels for timestamps that are shown
// inline alongside other info (purchase-link subline etc.) — so the
// strings need to stay compact and unambiguous. Month = 30 days, year
// = 365 days; these approximations are fine for the "몇 달 전" / "N년
// 전" bands because we don't show exact dates here anyway.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelativeKo(iso: string | Date, now: Date = new Date()): string {
  const then = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(then.getTime())) return '';
  const diff = now.getTime() - then.getTime();
  if (diff < MINUTE) return '방금';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}일 전`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}주 전`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}달 전`;
  return `${Math.floor(diff / YEAR)}년 전`;
}
