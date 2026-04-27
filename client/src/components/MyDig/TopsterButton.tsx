// Topster PNG download chip. Renders as an <a download> so the
// browser handles the file save natively — no extra blob plumbing
// needed. The PNG endpoint lives on the server and is rendered on
// demand (1500×800 RYM-style cover grid + per-row caption columns +
// dig.haus brand stamp); see server/src/services/topsterRenderer.ts
// and the routes in server/src/routes/mydig.ts.
//
// Sibling to ShareButton: 공유 copies the URL to clipboard, 토스터
// downloads a shareable image. The two affordances are deliberately
// separate buttons because copying a link and saving an image are
// distinct intents — no point hiding one behind a dropdown when the
// space exists for both.

export default function TopsterButton({
  username,
  snapshotSlug,
  snapshotName,
  themeTitle,
}: {
  username: string;
  snapshotSlug?: string | null;
  // Snapshot name takes precedence in the filename so saved files
  // for the same user but different snapshots don't collide.
  snapshotName?: string | null;
  // Live-wall theme title — used as the live filename when no
  // snapshot is active. Falls back to "wall" if the user hasn't
  // set a theme.
  themeTitle?: string | null;
}) {
  const url = snapshotSlug
    ? `/api/mydig/${encodeURIComponent(username)}/snapshots/${encodeURIComponent(snapshotSlug)}/topster.png`
    : `/api/mydig/${encodeURIComponent(username)}/topster.png`;

  const labelPart = snapshotName || themeTitle || 'wall';
  const safeLabel = labelPart
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\-_ ]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  const fileName = safeLabel
    ? `${username}-${safeLabel}-topster.png`
    : `${username}-topster.png`;

  return (
    <a
      href={url}
      download={fileName}
      className="text-[11px] text-gray-200 hover:text-[#e8a020] bg-[#1a130a]/40 border border-white/10 hover:border-[#e8a020]/50 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
      title="토스터 이미지 (PNG) 저장"
    >
      <span className="hidden md:inline">🖼 </span>토스터
    </a>
  );
}
