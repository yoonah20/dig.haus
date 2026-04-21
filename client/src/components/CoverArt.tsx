import { useState, useMemo, useEffect } from 'react';

interface CoverArtProps {
  src: string | null;
  fallbacks?: string[];
  alt: string;
  className?: string;
  // Fires once the underlying <img> has decoded — gives the parent the
  // intrinsic pixel dimensions (used by admin UI to surface the resolution
  // of the currently-displayed cover).
  onLoad?: (size: { naturalWidth: number; naturalHeight: number }) => void;
}

function getInitials(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

const API_BASE = import.meta.env.VITE_API_URL || '';

const PROXIED_HOSTS = [
  'coverartarchive.org',
  '.archive.org',
  '.scdn.co',
  '.discogs.com',
  'lastfm.freetls.fastly.net',
];

function proxify(url: string): string {
  // Admin-replaced covers are persisted by the backend under
  // /api/custom-covers/<hash>.webp. The DB stores that site-relative path —
  // resolve it against API_BASE so the <img> loads from the backend origin.
  if (url.startsWith('/api/custom-covers/')) {
    return `${API_BASE}${url}`;
  }
  try {
    const u = new URL(url);
    const host = u.hostname;
    const match = PROXIED_HOSTS.some((h) =>
      h.startsWith('.') ? host.endsWith(h) : host === h
    );
    if (!match) return url;
    return `${API_BASE}/api/cover?src=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

export default function CoverArt({ src, fallbacks = [], alt, className = '', onLoad }: CoverArtProps) {
  const allSrcs = useMemo(
    () =>
      [src, ...fallbacks]
        .filter((u): u is string => !!u && u.length > 0)
        .map(proxify),
    [src, fallbacks]
  );
  const srcsKey = allSrcs.join('\n');
  const [srcIdx, setSrcIdx] = useState(0);
  const [failed, setFailed] = useState(allSrcs.length === 0);

  // Reset retry/failed state whenever the source list changes (e.g. admin
  // pastes a new cover URL). Without this, a previously-failed card would
  // stay stuck on its initials placeholder even after the URL is fixed.
  useEffect(() => {
    setSrcIdx(0);
    setFailed(allSrcs.length === 0);
  }, [srcsKey, allSrcs.length]);

  if (failed || allSrcs.length === 0) {
    const initials = getInitials(alt);
    return (
      <div
        className={`flex items-center justify-center bg-[#1a1a1a] text-gray-500 font-bold select-none ${className}`}
        title={alt}
      >
        <span className="text-2xl">{initials || '?'}</span>
      </div>
    );
  }

  return (
    <img
      src={allSrcs[srcIdx]}
      alt={alt}
      loading="lazy"
      decoding="async"
      // Without this the browser's native image-drag hijacks any
      // parent-level HTML5 drag — e.g. the VinylWall editor couldn't
      // initiate drag-from-candidates because the <img> started a
      // "copy image" drag on mousedown and the parent's onDragStart
      // (which sets our application/x-mydig-album dataTransfer)
      // never ran. No page in dig.haus actually wants native image
      // drag, so disabling globally here is safer than wrapping
      // every caller.
      draggable={false}
      className={className}
      onLoad={(e) => {
        if (!onLoad) return;
        const img = e.currentTarget;
        onLoad({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      }}
      onError={() => {
        const next = srcIdx + 1;
        if (next < allSrcs.length) {
          setSrcIdx(next);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}
