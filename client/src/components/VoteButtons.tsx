import { useEffect, useState } from 'react';
import axios from '../lib/axios';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  albumId: string;
  upvotes: number;
  downvotes: number;
  userVote: 'up' | 'down' | null;
}

// Split-pill toggle: one control with a 굿굿 half (blue) and a 별루
// half (red). The two sides are mutually exclusive anyway — a single
// pill makes that wordless. Clicking the active half clears the vote.
export default function VoteButtons({ albumId, upvotes, downvotes, userVote }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tooltip, setTooltip] = useState<'up' | 'down' | null>(null);
  const [busy, setBusy] = useState(false);
  const [localUp, setLocalUp] = useState(upvotes);
  const [localDown, setLocalDown] = useState(downvotes);
  const [localVote, setLocalVote] = useState<'up' | 'down' | null>(userVote);

  // When the parent's album query refetches (e.g. because a 50자 평 was
  // submitted or deleted, which upserts/withdraws this user's vote on the
  // server), sync the fresh server state into our local optimistic state.
  // Skip while a vote request is in flight so we don't clobber the optimistic
  // update mid-roundtrip.
  useEffect(() => {
    if (busy) return;
    setLocalUp(upvotes);
    setLocalDown(downvotes);
    setLocalVote(userVote);
  }, [upvotes, downvotes, userVote, busy]);

  const handleVote = async (direction: 'up' | 'down') => {
    if (!user) {
      setTooltip(direction);
      setTimeout(() => setTooltip(null), 2000);
      return;
    }
    if (busy) return;

    const prevVote = localVote;
    const willCancel = prevVote === direction;
    const nextVote = willCancel ? null : direction;

    // Optimistic update
    setLocalVote(nextVote);
    let nextUp = localUp;
    let nextDown = localDown;
    if (prevVote === 'up') nextUp = Math.max(0, nextUp - 1);
    if (prevVote === 'down') nextDown = Math.max(0, nextDown - 1);
    if (nextVote === 'up') nextUp += 1;
    if (nextVote === 'down') nextDown += 1;
    setLocalUp(nextUp);
    setLocalDown(nextDown);

    setBusy(true);
    try {
      const { data } = await axios.post(`/api/albums/${albumId}/vote`, { vote: nextVote });
      setLocalUp(data.upvotes);
      setLocalDown(data.downvotes);
      setLocalVote(data.userVote);
      queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      // The 굿굿/별루 vote is mirrored onto the user's 50자 평 — refresh the
      // speech-bubble badge to reflect the change.
      queryClient.invalidateQueries({ queryKey: ['user-reviews', albumId] });
    } catch {
      // Revert
      setLocalVote(prevVote);
      setLocalUp(upvotes);
      setLocalDown(downvotes);
    } finally {
      setBusy(false);
    }
  };

  const half = (direction: 'up' | 'down', label: string, count: number) => {
    const active = localVote === direction;
    const isUp = direction === 'up';
    const emoji = isUp ? '👍' : '👎';
    // Blue for 굿굿, red for 별루. The inactive side dims the same
    // hue so the pair reads as one object rather than two orphan pills.
    const activeBg = isUp ? '#3b82f6' : '#dc2626';
    const activeFg = '#ffffff';
    const idleFg = isUp ? '#60a5fa' : '#f87171';

    return (
      <div className="relative flex-1">
        <button
          onClick={() => handleVote(direction)}
          disabled={busy}
          style={{
            background: active ? activeBg : 'transparent',
            color: active ? activeFg : idleFg,
            opacity: active ? 1 : 0.7,
            padding: '6px 14px',
            fontSize: '13px',
            fontWeight: 600,
            transition: 'all 150ms ease',
          }}
          className="w-full inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-wait disabled:opacity-60 hover:!opacity-100"
        >
          <span style={{ fontSize: '13px', lineHeight: 1 }}>{emoji}</span>
          <span>{label}</span>
          <span className="tabular-nums">{count.toLocaleString()}</span>
        </button>
        {tooltip === direction && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 whitespace-nowrap bg-[#1a1a1a] border border-[#e8a020]/40 text-[#e8a020] text-xs rounded-md px-3 py-1.5 shadow-lg z-50 pointer-events-none">
            입장하기(로그인)가 필요합니다
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="inline-flex items-stretch rounded-full overflow-hidden border"
      style={{
        borderColor: 'rgba(255,255,255,0.1)',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      {half('up', '굿굿', localUp)}
      <div className="w-px self-stretch bg-white/10" aria-hidden />
      {half('down', '별루', localDown)}
    </div>
  );
}
