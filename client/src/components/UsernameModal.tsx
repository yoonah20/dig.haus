import { useState, useEffect } from 'react';
import axios from '../lib/axios';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (username: string) => void;
  /** Pre-fill the field. Used for the "change username later" case
   *  where a user has one but wants to edit. First-time onboarding
   *  can pass undefined. */
  initialValue?: string;
}

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,18}[a-z0-9])?$/;

// Phase 3a onboarding — a single-purpose modal that claims or edits
// the user's mydig URL slug. Shown automatically from TopNav when
// the "내 가게" link gets clicked by someone who hasn't set one
// yet; same component powers the "change later" path from the
// profile page.
//
// Validation mirrors the server (/api/me/username) exactly so typos
// get flagged before the round-trip. The uniqueness check only the
// server can do — the response message surfaces verbatim.
export default function UsernameModal({ open, onClose, onSaved, initialValue }: Props) {
  const { refresh } = useAuth();
  const [value, setValue] = useState(initialValue ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue ?? '');
      setError(null);
    }
  }, [open, initialValue]);

  if (!open) return null;

  const trimmed = value.trim().toLowerCase();
  const localValid = USERNAME_RE.test(trimmed);

  const handleSave = async () => {
    if (saving || !localValid) return;
    setSaving(true);
    setError(null);
    try {
      await axios.patch('/api/me/username', { username: trimmed });
      // Refresh auth context so the updated username lands on /auth/me
      // and the TopNav link starts routing straight to /my/<new>.
      await refresh();
      onSaved(trimmed);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || '저장에 실패했어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="bg-panel rounded-xl border border-white/10 max-w-md w-full p-6">
        <h2 className="text-lg font-bold text-white mb-2">
          {initialValue ? '사용자명 변경' : '내 가게 이름 정하기'}
        </h2>
        <p className="text-sm text-gray-400 mb-4 leading-relaxed">
          마이딕 URL에 쓰이는 사용자명이에요. 영문 소문자/숫자/밑줄/하이픈 3-20자.
          <br />
          <code className="text-[11px] text-accent">
            dig.haus/my/<span className="text-gray-500">{trimmed || 'your_name'}</span>
          </code>
        </p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && localValid && !saving) handleSave();
            if (e.key === 'Escape' && !saving) onClose();
          }}
          disabled={saving}
          autoFocus
          placeholder="예: dustylp"
          maxLength={30}
          className="w-full bg-panel-strong border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60 mb-2"
        />
        {!localValid && trimmed.length > 0 && (
          <p className="text-xs text-gray-500 mb-2">
            영문 소문자·숫자·하이픈·밑줄 3-20자. 시작과 끝은 영숫자.
          </p>
        )}
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-xs text-gray-400 hover:text-white px-3 py-1.5 disabled:opacity-40 cursor-pointer"
          >
            취소
          </button>
          <Button
            variant="ghost-soft"
            size="sm"
            onClick={handleSave}
            disabled={!localValid || saving}
            className="font-medium"
          >
            {saving ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </div>
  );
}
