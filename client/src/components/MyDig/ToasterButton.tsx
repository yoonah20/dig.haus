// 토스터 PNG download chip. Renders as an <a download> so the browser
// handles the file save natively — no extra blob plumbing needed. The
// PNG endpoint lives on the server and is rendered on demand
// (1080×1350 portrait, 3×5 cover grid + per-row caption columns +
// dig.haus brand stamp); see server/src/services/toasterRenderer.ts
// and the routes in server/src/routes/mydig.ts.
//
// Sibling to ShareButton: 공유 copies the URL to clipboard, 토스터
// downloads a shareable image. The two affordances are deliberately
// separate buttons because copying a link and saving an image are
// distinct intents — no point hiding one behind a dropdown when the
// space exists for both.

import { resolveApiUrl } from '../../utils/apiUrl';

export default function ToasterButton({
  username,
  snapshotSlug,
}: {
  username: string;
  snapshotSlug?: string | null;
}) {
  // resolveApiUrl prepends VITE_API_URL when set (split-origin deploy:
  // frontend on Vercel www.dig.haus, API on Railway). A bare /api/...
  // would otherwise resolve against the Vercel origin and hit the SPA
  // index.html fallback instead of reaching the renderer.
  //
  // ?download=1 flips the server response from inline (image/png +
  // browser-default disposition) to attachment (Content-Disposition
  // with a derived filename). Cross-origin responses ignore the <a>
  // download attribute, so the server has to set the header for the
  // click to actually download instead of navigating to the PNG.
  const path = snapshotSlug
    ? `/api/mydig/${encodeURIComponent(username)}/snapshots/${encodeURIComponent(snapshotSlug)}/toaster.png?download=1`
    : `/api/mydig/${encodeURIComponent(username)}/toaster.png?download=1`;
  const url = resolveApiUrl(path) ?? path;

  // On mobile, the goal is to land in the photo album, not the
  // Downloads folder. Web Share API with files brings up the OS share
  // sheet (iOS / Android), which always exposes "Save to Photos" /
  // "이미지 저장" as a primary option — that puts the toaster straight
  // into the camera roll. Desktop browsers either lack canShare for
  // files or surface a flow that's worse than a plain download, so we
  // gate on coarse-pointer (touch primary) and fall through to the
  // default <a> attachment download otherwise.
  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
    if (!isCoarsePointer || typeof navigator.canShare !== 'function') return;
    e.preventDefault();
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `${username}-toaster.png`, {
        type: 'image/png',
      });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      // canShare rejected the file payload — fall back to direct nav
      // so the user at least gets the PNG into Downloads.
      window.location.assign(url);
    } catch (err) {
      // AbortError fires when the user dismisses the share sheet —
      // that's a normal cancel, not a failure. Anything else falls
      // back to the direct download path.
      if ((err as { name?: string })?.name === 'AbortError') return;
      window.location.assign(url);
    }
  };

  return (
    <a
      href={url}
      onClick={handleClick}
      className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
      title="토스터 이미지 (PNG) 저장"
    >
      <span className="hidden md:inline">🖼 </span>토스터
    </a>
  );
}
