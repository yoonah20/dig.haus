import { useCallback, useState } from 'react';
import {
  useApproveAlbumRequest,
  useDiscardAlbumRequest,
  type AlbumRequest,
} from '../../hooks/useAlbumRequests';
import { resolveApiUrl } from '../../utils/apiUrl';

// Admin-side card rendered in place of AlbumCard when the sort is
// set to [등록 요청작]. Intentionally styled distinct from the real
// album card (muted saturation + dashed amber border + pending badge)
// so admin never confuses a pending request for a live album.

const MAX_AVATARS = 3;

function Avatar({
  src,
  name,
  size = 20,
}: {
  src: string | null;
  name: string | null;
  size?: number;
}) {
  const resolved = resolveApiUrl(src);
  if (resolved) {
    return (
      <img
        src={resolved}
        alt={name || ''}
        className="rounded-full object-cover border border-[#120c05]"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
        title={name || '익명'}
      />
    );
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div
      className="rounded-full bg-[#2a1f10] text-[#e8a020] flex items-center justify-center border border-[#120c05] font-semibold"
      style={{ width: size, height: size, fontSize: Math.max(size * 0.45, 9) }}
      title={name || '익명'}
    >
      {initial}
    </div>
  );
}

export default function AlbumRequestCard({ request }: { request: AlbumRequest }) {
  const approve = useApproveAlbumRequest();
  const discard = useDiscardAlbumRequest();
  const [flipped, setFlipped] = useState(false);

  const busy = approve.isPending || discard.isPending;

  const handleApprove = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (busy) return;
      if (!confirm(`"${request.artist} — ${request.title}" 을(를) 등록할까요?\n\nClaude 리뷰 수집 / 음차 / 유사작 파이프라인이 즉시 실행됩니다.`)) return;
      try {
        await approve.mutateAsync(request.mbid);
      } catch (err: any) {
        alert(err?.response?.data?.error || '등록에 실패했습니다.');
      }
    },
    [busy, approve, request.mbid, request.title, request.artist]
  );

  const handleDiscard = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (busy) return;
      if (!confirm(`"${request.artist} — ${request.title}" 요청을 무시할까요?`)) return;
      try {
        await discard.mutateAsync(request.mbid);
      } catch (err: any) {
        alert(err?.response?.data?.error || '무시 처리에 실패했습니다.');
      }
    },
    [busy, discard, request.mbid, request.title, request.artist]
  );

  const visibleRequesters = request.requesters.slice(0, MAX_AVATARS);
  const extra = request.requesters.length - visibleRequesters.length;
  const firstRequester = request.requesters[0];

  // Notes from the first requester (if any) surface on the flipped
  // back. Multiple-requester notes concatenated with a separator.
  const allNotes = request.requesters
    .map((r) => (r.notes && r.notes.trim() ? `· ${r.userName || '익명'}: ${r.notes}` : null))
    .filter(Boolean) as string[];

  return (
    <div
      className="relative block album-card-outer"
      onClick={() => setFlipped((v) => !v)}
      style={{ cursor: 'pointer' }}
    >
      <div className="relative aspect-square" style={{ perspective: '1000px' }}>
        <div
          className="relative w-full h-full"
          style={{
            transformStyle: 'preserve-3d',
            transition: 'transform 0.5s ease',
            transform: flipped ? 'rotateY(180deg)' : undefined,
          }}
        >
          {/* Front — muted cover + pending badge */}
          <div
            className="absolute inset-0 bg-[#1a1a1a] rounded-xl overflow-hidden border border-dashed border-[#e8a020]/50"
            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
          >
            {request.coverArtUrl ? (
              <img
                src={request.coverArtUrl}
                alt=""
                aria-hidden
                loading="lazy"
                className="w-full h-full object-cover"
                style={{ filter: 'saturate(0.55) brightness(0.75)' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl text-gray-700">
                &#9835;
              </div>
            )}

            {/* Pending badge — top-left */}
            <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-sm ring-1 ring-[#e8a020]/40 text-[10px] text-[#e8a020] font-medium tracking-wide uppercase">
              pending
            </div>

            {/* Request-count chip — top-right */}
            {request.requestCount > 1 && (
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-[#e8a020] text-black text-[11px] font-semibold tabular-nums">
                {request.requestCount}명이 요청
              </div>
            )}

            {/* Title / artist — bottom gradient overlay */}
            <div
              className="absolute inset-x-0 bottom-0 px-3 pt-8 pb-3"
              style={{
                background:
                  'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 60%, transparent 100%)',
              }}
            >
              <p
                className="text-white line-clamp-2"
                style={{ fontSize: '15px', fontWeight: 700, lineHeight: 1.25 }}
                title={request.title}
              >
                {request.title}
              </p>
              <p
                className="text-gray-300 line-clamp-1"
                style={{ fontSize: '12px', marginTop: '2px' }}
                title={request.artist}
              >
                {request.artist}
                {request.year && <> · {request.year}</>}
              </p>

              {/* Requester avatar stack */}
              <div className="flex items-center gap-1.5 mt-2">
                <div className="flex -space-x-1.5">
                  {visibleRequesters.map((r) => (
                    <Avatar
                      key={r.id}
                      src={r.userAvatar}
                      name={r.userName}
                      size={18}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-gray-400 truncate">
                  {firstRequester?.userName || '익명'}
                  {extra > 0 && ` +${extra}`}
                </span>
              </div>
            </div>
          </div>

          {/* Back — details + approve/discard. Whole card is clickable
              to flip; buttons stopPropagation so clicks on them don't
              flip the card mid-action. */}
          <div
            className="absolute inset-0 rounded-xl overflow-hidden bg-[#14100a] border border-[#e8a020]/40 p-3 flex flex-col"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <h3
              className="text-white font-semibold line-clamp-2"
              style={{ fontSize: '14px', lineHeight: 1.25 }}
            >
              {request.title}
            </h3>
            <p
              className="text-gray-400 line-clamp-1"
              style={{ fontSize: '12px', marginTop: '2px' }}
            >
              {request.artist}
              {request.year && <> · {request.year}</>}
            </p>

            {allNotes.length > 0 ? (
              <div className="mt-2 flex-1 min-h-0 overflow-y-auto text-[11px] text-gray-300 leading-snug space-y-1">
                {allNotes.map((n, i) => (
                  <p key={i} className="break-words">{n}</p>
                ))}
              </div>
            ) : (
              <div className="mt-2 flex-1 text-[11px] text-gray-600 italic">
                남긴 메모 없음
              </div>
            )}

            <div className="flex gap-1.5 mt-2">
              <button
                onClick={handleApprove}
                disabled={busy}
                className="flex-1 text-xs font-medium text-black bg-[#e8a020] hover:bg-[#f0b040] rounded-md py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {approve.isPending ? '등록 중…' : '등록'}
              </button>
              <button
                onClick={handleDiscard}
                disabled={busy}
                className="flex-1 text-xs font-medium text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md py-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {discard.isPending ? '처리 중…' : '무시'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
