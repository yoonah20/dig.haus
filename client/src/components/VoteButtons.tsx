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

// Split-pill: one rounded control with 굿굿 on the left (muted blue)
// and 별루 on the right (muted red). Desaturated gradients fit the
// dark page; idle halves keep a faint tint so the pair reads as
// interactive even when nothing is picked.
export default function VoteButtons({ albumId, upvotes, downvotes, userVote }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tooltip, setTooltip] = useState<'up' | 'down' | null>(null);
  const [busy, setBusy] = useState(false);
  const [localUp, setLocalUp] = useState(upvotes);
  const [localDown, setLocalDown] = useState(downvotes);
  const [localVote, setLocalVote] = useState<'up' | 'down' | null>(userVote);

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
      queryClient.invalidateQueries({ queryKey: ['user-reviews', albumId] });
    } catch {
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
    const palette = isUp
      ? {
          activeFrom: '#4a6b8c',
          activeTo: '#35506e',
          activeText: '#f2f6fb',
          idleFrom: '#131a22',
          idleTo: '#0b0f14',
          idleText: '#6d8299',
        }
      : {
          activeFrom: '#8a4a4a',
          activeTo: '#6e3636',
          activeText: '#fbf0f0',
          idleFrom: '#1f1313',
          idleTo: '#140b0b',
          idleText: '#a06e6e',
        };

    return (
      <div className="relative flex-1">
        <button
          onClick={() => handleVote(direction)}
          disabled={busy}
          style={{
            background: active
              ? `linear-gradient(to bottom, ${palette.activeFrom}, ${palette.activeTo})`
              : `linear-gradient(to bottom, ${palette.idleFrom}, ${palette.idleTo})`,
            color: active ? palette.activeText : palette.idleText,
            padding: '4px 10px',
            fontSize: '13px',
            fontWeight: 600,
            transition: 'background 160ms ease, color 160ms ease',
          }}
          className="w-full inline-flex items-center justify-center gap-1 cursor-pointer disabled:cursor-wait disabled:opacity-60 hover:brightness-110"
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
    <div className="inline-flex items-stretch rounded-full overflow-hidden border border-white/10">
      {half('up', '굿굿', localUp)}
      <div className="w-px self-stretch bg-black/40" aria-hidden />
      {half('down', '별루', localDown)}
    </div>
  );
}
