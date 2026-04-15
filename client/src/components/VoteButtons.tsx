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

  const button = (direction: 'up' | 'down', label: string, count: number) => {
    const active = localVote === direction;
    const isUp = direction === 'up';
    const emoji = isUp ? '🔥' : '💀';
    const arrow = isUp ? '▲' : '▼';

    let buttonStyle: React.CSSProperties;
    if (active && isUp) {
      buttonStyle = {
        background: '#e8a020',
        color: '#0f0f0f',
        border: '1px solid transparent',
      };
    } else if (active && !isUp) {
      buttonStyle = {
        background: '#3a3a3a',
        color: '#ffffff',
        border: '1px solid transparent',
      };
    } else if (isUp) {
      buttonStyle = {
        background: 'transparent',
        color: '#e8a020',
        border: '1px solid #e8a020',
        opacity: 0.5,
      };
    } else {
      buttonStyle = {
        background: 'transparent',
        color: '#9a9a9a',
        border: '1px solid #4a4a4a',
        opacity: 0.5,
      };
    }

    return (
      <div className="relative">
        <button
          onClick={() => handleVote(direction)}
          disabled={busy}
          style={{
            ...buttonStyle,
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 600,
            transition: 'all 150ms ease',
          }}
          className="inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-wait disabled:opacity-60 hover:!opacity-80"
        >
          <span style={{ fontSize: '13px', lineHeight: 1 }}>{emoji}</span>
          <span>{label}</span>
          <span style={{ fontSize: '13px', lineHeight: 1 }}>{arrow}</span>
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
    <div className="flex items-center gap-3">
      {button('up', '굿굿', localUp)}
      {button('down', '별루', localDown)}
    </div>
  );
}
