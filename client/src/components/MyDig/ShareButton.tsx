import { useState } from 'react';

// URL share — wireframe level. Copies the link to clipboard on click
// and toggles the button label to "복사됨" briefly so the user sees
// feedback. Skipping PNG export for now per the Phase 3 wireframe
// scope; a download-as-image pass can layer on later.
//
// Usage: render alongside the page it shares. `url` is whatever URL
// the visitor should share (current window.location for live pages,
// the snapshot's /snap/:slug URL for snapshot pages).
export default function ShareButton({
  url,
  label = '공유',
}: {
  url: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleClick = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Some browsers block clipboard write without user activation;
      // fall back to a prompt so the URL is still extractable.
      try {
        window.prompt('URL 복사:', url);
      } catch {
        /* swallow */
      }
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
      title={url || '링크 없음'}
    >
      {copied ? (
        '✓ 복사됨'
      ) : (
        <>
          <span className="hidden md:inline">🔗 </span>
          {label}
        </>
      )}
    </button>
  );
}
