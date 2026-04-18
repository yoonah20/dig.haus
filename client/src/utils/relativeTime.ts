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

// SQLite's datetime('now') returns a bare "YYYY-MM-DD HH:MM:SS" string
// in UTC — no timezone suffix. Browsers parse that as *local* time,
// which made Korean users see "9시간 전" on albums they'd just
// registered. Normalise by treating any bare datetime string as UTC.
export function parseServerTimestamp(iso: string | Date): Date {
  if (iso instanceof Date) return iso;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  if (hasTz) return new Date(iso);
  const normalised = iso.includes('T') ? iso : iso.replace(' ', 'T');
  return new Date(`${normalised}Z`);
}

export function formatRelativeKo(iso: string | Date, now: Date = new Date()): string {
  const then = parseServerTimestamp(iso);
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

// "MM-DD HH:MM" in the viewer's local timezone. Used in compact
// forensic tables (admin Claude call log) where a full ISO timestamp
// would clutter but a relative label ("3분 전") is too vague for
// lining up adjacent calls. Safer than raw string-slicing the
// server's UTC datetime, which misses the KST offset and silently
// breaks if the format ever includes a space instead of 'T'.
export function formatShortKstDateTime(iso: string | Date): string {
  const d = parseServerTimestamp(iso);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}
