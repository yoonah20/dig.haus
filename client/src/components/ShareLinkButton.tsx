import { useState } from 'react';

// Lucide-style three-node share glyph. Used in a Gmail / Slack etc.
// everywhere, so readers know what the icon does without a label.
const SHARE_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"
  >
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const CHECK_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

interface Props {
  /** Used as the share-sheet title (Mail subject line etc.). Most
   *  receiving apps will still fetch og:title for a rich preview, so
   *  the param only shows up on the handful of targets that don't. */
  title: string;
  /** Override if the canonical album URL differs from window.location
   *  (e.g. we arrived via raw mbid before the slug-normalise redirect
   *  fires). Defaults to the current location. */
  url?: string;
}

// Share affordance next to the album title. Prefers the OS-native share
// sheet via navigator.share — that way a reader on mobile can flip
// straight into KakaoTalk / SMS / Notes without a clipboard round-trip.
// Desktop Safari, Firefox, and older Chrome don't expose the API; those
// fall back to copying the URL to the clipboard and flashing a check
// icon so the reader knows *something* happened.
export default function ShareLinkButton({ title, url }: Props) {
  const [copied, setCopied] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const shareUrl = url || window.location.href;

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url: shareUrl });
        return;
      } catch (err) {
        // User dismissed the sheet — no feedback is the right feedback.
        if ((err as DOMException).name === 'AbortError') return;
        // Other failure (permission, etc.) → drop through to clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard also unavailable (insecure context, locked-down
      // browser). Silent — a failing share icon is better than an
      // alert popup that hijacks the page.
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="이 페이지 공유"
      title={copied ? '링크 복사됨' : '공유'}
      className={`inline-flex items-center justify-center p-1 rounded transition-colors cursor-pointer ${
        copied ? 'text-accent' : 'text-gray-600 hover:text-accent'
      }`}
    >
      {copied ? CHECK_ICON : SHARE_ICON}
    </button>
  );
}
