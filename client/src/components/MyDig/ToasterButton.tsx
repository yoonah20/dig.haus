// 토스터 PNG download chip. Click renders / downloads the PNG via
// the URL prop the parent provides; mobile devices route through the
// OS share sheet (canShare) so the image lands in the camera roll
// instead of Downloads.
//
// Generalised 2026-05-17 as part of the mydig redesign — the button
// is no longer tied to the vinyl wall. The parent passes whatever
// toaster endpoint they want rendered (per-crate, per-user, snapshot)
// plus a filename hint. The server endpoint is responsible for the
// actual cover layout + caching.

import { resolveApiUrl } from '../../utils/apiUrl';

interface Props {
  // Server-relative endpoint path, e.g.
  //   /api/mydig/crates/42/toaster.png
  //   /api/mydig/:username/toaster.png
  // resolveApiUrl prepends VITE_API_URL when set (split-origin deploy).
  path: string;
  // Download filename hint for the OS share sheet + Files-app save.
  // The server also sets Content-Disposition with its own filename,
  // which wins on cross-origin desktop downloads; this one is just
  // for the Web Share API File constructor.
  filenameHint: string;
  // Display tone — owner-prominent (slightly louder) vs visitor-quiet
  // for the page header.
  variant?: 'default' | 'prominent';
  // Optional label override — defaults to "토스터".
  label?: string;
}

export default function ToasterButton({
  path,
  filenameHint,
  variant = 'default',
  label = '토스터',
}: Props) {
  // ?download=1 flips the server response from inline (image/png +
  // browser default disposition) to attachment (Content-Disposition
  // header). Cross-origin responses ignore the <a download> attribute,
  // so the server has to set the header for the click to actually save.
  const downloadPath = path.includes('?')
    ? `${path}&download=1`
    : `${path}?download=1`;
  const url = resolveApiUrl(downloadPath) ?? downloadPath;

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
    if (!isCoarsePointer || typeof navigator.canShare !== 'function') return;
    e.preventDefault();
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], filenameHint, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      window.location.assign(url);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      window.location.assign(url);
    }
  };

  const baseClass =
    variant === 'prominent'
      ? 'text-[12px] text-[#f4ebd9] hover:text-white bg-[rgba(40,20,20,0.8)] border border-[rgba(220,170,80,0.45)] hover:border-[rgba(220,170,80,0.8)] rounded-full px-3 py-1 cursor-pointer transition-colors'
      : 'text-[11px] text-gray-200 hover:text-accent bg-background/40 border border-white/10 hover:border-accent/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors';

  return (
    <a
      href={url}
      onClick={handleClick}
      className={baseClass}
      title="토스터 이미지 (PNG) 저장"
    >
      <span className="hidden md:inline">🖼 </span>
      {label}
    </a>
  );
}
