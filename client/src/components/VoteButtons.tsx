import { useState } from 'react';
import axios from 'axios';
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

    const activeClasses = isUp
      ? 'bg-[#2563eb] text-white border-[#2563eb]'
      : 'bg-[#dc2626] text-white border-[#dc2626]';
    const inactiveClasses = isUp
      ? 'bg-[#1a1f35] text-[#6884c0] border-[#2a3352] hover:border-[#3a4a70]'
      : 'bg-[#2a1515] text-[#a85656] border-[#4a2525] hover:border-[#6a3535]';

    return (
      <div className="relative">
        <button
          onClick={() => handleVote(direction)}
          disabled={busy}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-60 hover:brightness-110 ${active ? activeClasses : inactiveClasses}`}
        >
          <span className={`text-base leading-none ${active ? '' : 'opacity-60 grayscale'}`}>{emoji}</span>
          <span>{label}</span>
          <span className="text-[10px] opacity-80">{arrow}</span>
          <span className="tabular-nums text-xs">{count.toLocaleString()}</span>
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
