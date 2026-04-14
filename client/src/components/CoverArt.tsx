import { useState, useMemo } from 'react';

interface CoverArtProps {
  src: string | null;
  fallbacks?: string[];
  alt: string;
  className?: string;
}

function getInitials(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export default function CoverArt({ src, fallbacks = [], alt, className = '' }: CoverArtProps) {
  const allSrcs = useMemo(
    () => [src, ...fallbacks].filter((u): u is string => !!u && u.length > 0),
    [src, fallbacks]
  );
  const [srcIdx, setSrcIdx] = useState(0);
  const [failed, setFailed] = useState(allSrcs.length === 0);

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
      className={className}
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
