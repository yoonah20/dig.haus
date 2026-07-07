import { useState, useCallback, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import axios from '../../lib/axios';
import { useGenerateReviewSummary } from '../../hooks/useAlbum';
import type { AlbumDetail, StreamingLinks, BuyInfo } from '../../types';
import CoverArt from '../CoverArt';
import PlayChip from '../PlayChip';
import VoteButtons from '../VoteButtons';
import CrateButton from './CrateButton';
import { useAuth } from '../../contexts/AuthContext';
import CopyTitleButton from '../CopyTitleButton';

import ArtistCredit from '../ArtistCredit';

function AdminMenuItem({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const base = 'w-full text-left px-3 py-1.5 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
  const color = danger
    ? 'text-red-400 hover:bg-red-900/30 hover:text-red-300'
    : 'text-gray-300 hover:bg-white/5 hover:text-accent';
  return (
    <button role="menuitem" onClick={onClick} disabled={disabled} className={`${base} ${color}`}>
      {children}
    </button>
  );
}

function TagEditor({
  tags,
  albumId,
  isAdmin,
}: {
  tags: string[];
  albumId: string;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Inline confirmation row that surfaces what just happened — most
  // visible when admin is in cleanup mode and clicking × repeatedly.
  // Without it the only feedback was the tag chip vanishing, with no
  // signal that the server-side blacklist + cross-album strip
  // succeeded. Auto-clears after ~2.4s; the timer resets on each
  // new event so back-to-back clicks don't stack stale messages.
  const [toast, setToast] = useState<{
    blacklisted: string[];
    strippedTotal: number;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const persist = useCallback(
    async (
      nextTags: string[],
      opts: { removeOnly?: string[]; blacklist?: string[] } = {}
    ) => {
      setSaving(true);
      try {
        const res = await axios.patch<{
          ok: boolean;
          tags: string[];
          blacklisted?: string[];
          strippedAlbumCount?: number;
        }>(`/api/albums/${albumId}/tags`, {
          tags: nextTags,
          // Explicit signals to the server. The earlier diff-based
          // approach over-banned because the client only sees the
          // top N cleaned tags while the DB may have stored 30 raw
          // tags from import — diffing against the raw list flagged
          // every invisible tag as "removed" on a single × click.
          // Sending the operator's intent directly fixes that.
          removeOnly: opts.removeOnly ?? [],
          blacklist: opts.blacklist ?? [],
        });
        await queryClient.invalidateQueries({ queryKey: ['album', albumId] });
        await queryClient.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
        const banned = res.data?.blacklisted ?? [];
        if (banned.length > 0) {
          setToast({
            blacklisted: banned,
            strippedTotal: res.data?.strippedAlbumCount ?? 0,
          });
          if (toastTimerRef.current != null) {
            window.clearTimeout(toastTimerRef.current);
          }
          toastTimerRef.current = window.setTimeout(() => {
            setToast(null);
            toastTimerRef.current = null;
          }, 2400);
        }
      } catch (err) {
        console.error('Update tags error:', err);
        alert('태그 저장에 실패했습니다.');
      } finally {
        setSaving(false);
      }
    },
    [albumId, queryClient]
  );

  // Two distinct removal paths:
  //   − (album-only): tag doesn't fit this album, but the tag itself
  //     is still valid elsewhere. Listed in removeOnly so the server
  //     skips the blacklist + cross-album strip.
  //   × (blacklist): tag is globally bad. Server diffs and bans it
  //     everywhere — destructive, so a confirm popup gates it. The
  //     count of currently-tagged albums prefetches into the popup
  //     copy so the curator sees blast radius before committing
  //     (an accidental click on "black metal" reads "47개 앨범에서
  //     제거됩니다" and gets bailed out instead of swallowed silently).
  const removeTagFromAlbum = (tag: string) => {
    if (saving) return;
    void persist(tags.filter((t) => t !== tag), { removeOnly: [tag] });
  };
  const removeTagAndBlacklist = async (tag: string) => {
    if (saving) return;
    let countLine = '';
    try {
      const { data } = await axios.get<{ albumCount: number }>(
        `/api/admin/tags/usage/${encodeURIComponent(tag)}`
      );
      const n = data?.albumCount ?? 0;
      if (n > 0) {
        countLine = `\n\n현재 ${n}개 앨범에 등록돼 있고, 모두에서 제거됩니다.`;
      }
    } catch {
      // Count fetch is best-effort; the confirm still fires without it.
    }
    const ok = window.confirm(
      `"${tag}" 태그를 블랙리스트에 추가합니다.${countLine}\n\n` +
        `• 향후 자동 import에서 차단\n` +
        `• 되돌릴 경우 앨범별로 수동 재등록 필요\n\n` +
        `계속할까요?`
    );
    if (!ok) return;
    void persist(tags.filter((t) => t !== tag), { blacklist: [tag] });
  };

  const commitAdd = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setAdding(false);
      return;
    }
    if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setInput('');
      setAdding(false);
      return;
    }
    void persist([...tags, trimmed]);
    setInput('');
    setAdding(false);
  };

  const cancelAdd = () => {
    setInput('');
    setAdding(false);
  };

  if (tags.length === 0 && !isAdmin) return null;

  return (
    <div className="mb-6">
      {/* Blacklist confirmation — only renders for admin after a × that
          fired the blacklist path. Sits above the tag chips so it's
          visible without scrolling and pushes the chips down a touch
          (they animate back up when the toast clears). */}
      {toast && (
        <div
          className="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/15 border border-accent/40 text-[12px] text-accent animate-[fadeInUp_220ms_ease-out]"
          role="status"
          aria-live="polite"
        >
          <span aria-hidden>🚫</span>
          <span>
            <strong className="font-semibold">{toast.blacklisted.join(', ')}</strong>
            {' '}블랙리스트에 추가됨
            {toast.strippedTotal > 0 && (
              <span className="text-[#c47020]/80">
                {' '}· 다른 앨범 {toast.strippedTotal}개에서도 제거
              </span>
            )}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
      {tags.map((g) => (
        <span
          key={g}
          className="group/tag flex items-center gap-1 px-3 py-1 bg-white/5 text-gray-300 text-xs rounded-full"
        >
          <span>{g}</span>
          {isAdmin && (
            <>
              <button
                onClick={() => removeTagFromAlbum(g)}
                disabled={saving}
                className="text-gray-500 hover:text-gray-200 disabled:opacity-40 cursor-pointer leading-none text-sm"
                title={`"${g}" 이 앨범에서만 빵기 (블랙리스트 X)`}
                aria-label={`"${g}" 태그 이 앨범에서만 제거`}
              >
                −
              </button>
              <button
                onClick={() => removeTagAndBlacklist(g)}
                disabled={saving}
                className="text-gray-500 hover:text-red-400 disabled:opacity-40 cursor-pointer leading-none"
                title={`"${g}" 블랙리스트 추가 + 모든 앨범에서 제거`}
                aria-label={`"${g}" 태그 블랙리스트에 추가`}
              >
                ×
              </button>
            </>
          )}
        </span>
      ))}
      {isAdmin &&
        (adding ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 rounded-full">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitAdd();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelAdd();
                }
              }}
              disabled={saving}
              maxLength={80}
              placeholder="태그 이름"
              className="bg-transparent text-gray-200 text-xs px-1 py-0.5 outline-none focus:outline-none w-28"
            />
            <button
              onClick={commitAdd}
              disabled={saving}
              className="text-xs text-accent hover:text-white disabled:opacity-40 cursor-pointer"
              aria-label="태그 저장"
            >
              {saving ? '...' : '✓'}
            </button>
            <button
              onClick={cancelAdd}
              disabled={saving}
              className="text-xs text-gray-500 hover:text-white disabled:opacity-40 cursor-pointer"
              aria-label="취소"
            >
              ✕
            </button>
          </span>
        ) : (
          <button
            onClick={() => setAdding(true)}
            disabled={saving}
            className="px-3 py-1 border border-dashed border-gray-600 hover:border-accent text-gray-500 hover:text-accent text-xs rounded-full transition-colors cursor-pointer disabled:opacity-40"
          >
            + 태그 추가
          </button>
        ))}
      </div>
    </div>
  );
}

const linkServices = [
  {
    key: 'discogs' as const,
    name: 'Discogs',
    color: '#e8e8e8',
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
        <path d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm0 21.6A9.6 9.6 0 1 1 12 2.4a9.6 9.6 0 0 1 0 19.2zm0-16.8a7.2 7.2 0 1 0 0 14.4 7.2 7.2 0 0 0 0-14.4zm0 12a4.8 4.8 0 1 1 0-9.6 4.8 4.8 0 0 1 0 9.6zm0-7.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z" />
      </svg>
    ),
  },
  {
    key: 'spotify' as const,
    name: 'Spotify',
    color: '#1DB954',
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    ),
  },
  {
    key: 'youtube' as const,
    name: 'YouTube',
    color: '#FF0000',
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  {
    key: 'bandcamp' as const,
    name: 'Bandcamp',
    color: '#1DA0C3',
    icon: (
      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
        <path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z" />
      </svg>
    ),
  },
];

// Every service link — Spotify included — is a plain anchor to its
// https URL. On mobile the OS's universal / app links open the native
// app straight from the tap; with no app the web player opens in a new
// tab. Spotify used to be special-cased through a spotify: scheme +
// timed window.open fallback, but on iOS Safari that deferred
// window.open always tripped the "attempting to open a pop-up window"
// allow/deny prompt (the app opened fine, then the frozen fallback
// fired on return). A real anchor click has none of that — same path
// YouTube / Bandcamp already take.
function LinkButton({ link }: { link: { key: string; name: string; color: string; icon: React.ReactNode; url: string } }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 bg-white/5 hover:bg-white/10 rounded-lg px-3 py-2 transition-colors group"
    >
      <span style={{ color: link.color }}>{link.icon}</span>
      <span className="text-xs text-gray-400 group-hover:text-white transition-colors">
        {link.name}
      </span>
    </a>
  );
}

function formatReleaseDate(date: string): string {
  // "2026-03-14" → "2026년 3월 14일", "2026-03" → "2026년 3월", "2026" → "2026"
  const parts = date.split('-');
  const year = parts[0];
  const month = parts[1] ? parseInt(parts[1], 10) : null;
  const day = parts[2] ? parseInt(parts[2], 10) : null;
  if (month && day) return `${year}년 ${month}월 ${day}일`;
  if (month) return `${year}년 ${month}월`;
  return year;
}


interface HeaderSectionProps {
  album: AlbumDetail['album'];
  streaming: StreamingLinks;
  buy: BuyInfo;
}

export default function HeaderSection({ album, streaming, buy }: HeaderSectionProps) {
  const [deleting, setDeleting] = useState(false);
  const [editingCover, setEditingCover] = useState(false);
  const [coverInput, setCoverInput] = useState('');
  const [updatingCover, setUpdatingCover] = useState(false);
  const [coverSize, setCoverSize] = useState<{ w: number; h: number } | null>(null);

  const [editingKo, setEditingKo] = useState(false);
  const [savingKo, setSavingKo] = useState(false);
  const [regeneratingKo, setRegeneratingKo] = useState(false);
  const [artistKoInput, setArtistKoInput] = useState('');
  const [titleKoInput, setTitleKoInput] = useState('');
  const [titleMeaningInput, setTitleMeaningInput] = useState('');
  const [editingAlbum, setEditingAlbum] = useState(false);
  const [savingAlbum, setSavingAlbum] = useState(false);
  const [refreshingDiscogs, setRefreshingDiscogs] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [resettingReviews, setResettingReviews] = useState(false);
  const [regeneratingSimilar, setRegeneratingSimilar] = useState(false);
  const adminMenuRef = useRef<HTMLDivElement>(null);
  const [titleInput, setTitleInput] = useState('');
  const [artistInput, setArtistInput] = useState('');
  const [releaseYearInput, setReleaseYearInput] = useState('');
  const [releaseDateInput, setReleaseDateInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [discogsUrlInput, setDiscogsUrlInput] = useState('');
  const [spotifyUrlInput, setSpotifyUrlInput] = useState('');
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [bandcampUrlInput, setBandcampUrlInput] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const albumId = album.slug || album.mbid;

  const handleRefreshDiscogs = useCallback(async () => {
    if (refreshingDiscogs) return;
    setRefreshingDiscogs(true);
    try {
      const { data } = await axios.post(`/api/albums/${albumId}/refresh-discogs`);
      await queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      const n = data?.formatsFound ?? 0;
      if (n === 0) {
        alert('Discogs에서 시세 정보를 찾지 못했습니다.');
      }
    } catch (err) {
      console.error('Refresh discogs error:', err);
      alert('시세 갱신에 실패했습니다.');
    } finally {
      setRefreshingDiscogs(false);
    }
  }, [albumId, queryClient, refreshingDiscogs]);

  // Surface 요약 생성 in the ⚙️ 관리 menu so admin can regenerate
  // the Korean summary after reviews are crawled — the
  // ReviewsAdminBar (which also exposes this action) only renders
  // while reviews_crawled_at IS NULL, so once an album lands a
  // partial review set without a summary the bar is gone and the
  // ⚙️ menu becomes the only entry point.
  const generateSummary = useGenerateReviewSummary(albumId);
  const handleGenerateSummary = useCallback(async () => {
    if (generateSummary.isPending) return;
    try {
      await generateSummary.mutateAsync();
    } catch (err: any) {
      alert(
        err?.response?.data?.error ||
          '요약 생성에 실패했습니다. 리뷰가 2개 이상 필요합니다.'
      );
    }
  }, [generateSummary]);

  const handleResetReviews = useCallback(async () => {
    if (resettingReviews) return;
    if (!confirm('이 앨범의 모든 리뷰와 요약을 삭제하고 "리뷰 없음" 상태로 되돌릴까요?')) return;
    setResettingReviews(true);
    try {
      await axios.delete(`/api/reviews/album/${albumId}`);
      await queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      await queryClient.invalidateQueries({ queryKey: ['album-reviews', albumId] });
    } catch (err) {
      console.error('Reset reviews error:', err);
      alert('리뷰 리셋에 실패했습니다.');
    } finally {
      setResettingReviews(false);
    }
  }, [albumId, queryClient, resettingReviews]);

  const handleRegenerateSimilar = useCallback(async () => {
    if (regeneratingSimilar) return;
    if (!confirm('비슷한 앨범 목록을 초기화하고 다시 찾을까요? (외부 API 호출됩니다)')) return;
    setRegeneratingSimilar(true);
    try {
      await axios.post(`/api/albums/${albumId}/similar/regenerate`);
      // Invalidate triggers GET /similar which now re-runs the first-
      // visit auto-fetch path with similar_albums_lastfm = NULL.
      await queryClient.invalidateQueries({ queryKey: ['album-similar', albumId] });
    } catch (err) {
      console.error('Regenerate similar error:', err);
      alert('비슷한 앨범 재생성에 실패했습니다.');
    } finally {
      setRegeneratingSimilar(false);
    }
  }, [albumId, queryClient, regeneratingSimilar]);

  // Reset cached cover dimensions when the source URL changes, so the badge
  // doesn't briefly display the previous image's resolution while the new
  // one loads.
  useEffect(() => {
    setCoverSize(null);
  }, [album.coverArtUrl]);

  useEffect(() => {
    if (!adminMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target as Node)) {
        setAdminMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAdminMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [adminMenuOpen]);

  const startEditKo = useCallback(() => {
    setArtistKoInput(album.artistKo || '');
    setTitleKoInput(album.titleKo || '');
    setTitleMeaningInput(album.titleMeaning || '');
    setEditingKo(true);
  }, [album.artistKo, album.titleKo, album.titleMeaning]);

  const cancelEditKo = useCallback(() => {
    if (savingKo) return;
    setEditingKo(false);
  }, [savingKo]);

  const handleRegenerateKo = useCallback(async () => {
    if (regeneratingKo) return;
    setRegeneratingKo(true);
    try {
      await axios.post(`/api/albums/${albumId}/regenerate-pronunciation`);
      await queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    } catch (err) {
      console.error('Regenerate pronunciation error:', err);
      alert('번역 재생성에 실패했습니다.');
    } finally {
      setRegeneratingKo(false);
    }
  }, [albumId, queryClient, regeneratingKo]);

  const saveEditKo = useCallback(async () => {
    setSavingKo(true);
    try {
      await axios.patch(`/api/albums/${albumId}/metadata`, {
        artist_ko: artistKoInput,
        title_ko: titleKoInput,
        title_meaning: titleMeaningInput,
      });
      await queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      await queryClient.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
      setEditingKo(false);
    } catch (err) {
      console.error('Save metadata error:', err);
      alert('저장에 실패했습니다.');
    } finally {
      setSavingKo(false);
    }
  }, [albumId, artistKoInput, titleKoInput, titleMeaningInput, queryClient]);

  const startEditCover = useCallback(() => {
    // Pre-fill with the Spotify 640x640 cover when we have one cached
    // on the album. That URL is the most common manual swap target
    // (Spotify's cover art is consistently well-composed and high-res,
    // and coverArtFallbacks already holds it from first-load). Input
    // text is auto-selected on focus below, so if admin has a different
    // URL ready they just Ctrl+V to replace. If no Spotify URL is
    // cached, field opens empty.
    const fallbacks = album.coverArtFallbacks ?? [];
    const spotifyUrl = fallbacks.find((u) => u.includes('i.scdn.co/image/'));
    setCoverInput(spotifyUrl ?? '');
    setEditingCover(true);
  }, [album.coverArtFallbacks]);

  const cancelEditCover = useCallback(() => {
    if (updatingCover) return;
    setEditingCover(false);
  }, [updatingCover]);

  const saveEditCover = useCallback(async () => {
    const trimmed = coverInput.trim();
    if (!trimmed || trimmed === album.coverArtUrl) {
      setEditingCover(false);
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      alert('http:// 또는 https:// 로 시작하는 URL을 입력해주세요.');
      return;
    }
    setUpdatingCover(true);
    try {
      await axios.patch(`/api/albums/${albumId}/cover-art`, { coverArtUrl: trimmed });
      await queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      await queryClient.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
      setEditingCover(false);
    } catch (err) {
      console.error('Update cover art error:', err);
      // Surface the server's specific error (e.g. "upstream returned 403") so
      // admins know whether to retry a different URL vs. debug the server.
      const detail =
        axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
          ? err.response.data.error
          : null;
      alert(
        detail
          ? `커버 이미지 변경에 실패했습니다.\n\n${detail}`
          : '커버 이미지 변경에 실패했습니다.'
      );
    } finally {
      setUpdatingCover(false);
    }
  }, [album.coverArtUrl, albumId, coverInput, queryClient]);

  // Drop the current custom cover and re-host the album's earliest
  // working fallback URL (typically the Cover Art Archive original
  // captured at first-fetch). The server iterates fallbacks until one
  // hosts successfully, so a rotted top-of-list URL doesn't block the
  // revert.
  const revertCover = useCallback(async () => {
    if (!confirm('커스텀 커버를 삭제하고 기본값으로 되돌릴까요?')) return;
    setUpdatingCover(true);
    try {
      await axios.delete(`/api/albums/${albumId}/cover-art`);
      await queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      await queryClient.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
      setEditingCover(false);
    } catch (err) {
      console.error('Revert cover art error:', err);
      const detail =
        axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
          ? err.response.data.error
          : null;
      alert(
        detail
          ? `기본값 되돌리기에 실패했습니다.\n\n${detail}`
          : '기본값 되돌리기에 실패했습니다.'
      );
    } finally {
      setUpdatingCover(false);
    }
  }, [albumId, queryClient]);

  const handleDelete = useCallback(async () => {
    if (!confirm('이 앨범을 DB에서 삭제할까요? 되돌릴 수 없습니다.')) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/albums/${albumId}`);

      // Purge every cached query that referenced this album
      queryClient.removeQueries({ queryKey: ['album', albumId] });
      queryClient.removeQueries({ queryKey: ['album-reviews', albumId] });
      queryClient.removeQueries({ queryKey: ['album-similar', albumId] });
      queryClient.removeQueries({ queryKey: ['purchase-links', albumId] });
      // Force the homepage / admin list to refetch with the row gone
      await queryClient.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
      await queryClient.invalidateQueries({ queryKey: ['admin-stats'] });

      // Remove from recent albums in localStorage
      const stored = localStorage.getItem('recentAlbums');
      if (stored) {
        const recent = JSON.parse(stored).filter((a: any) =>
          a.mbid !== albumId && a.mbid !== album.mbid && a.mbid !== album.slug
        );
        localStorage.setItem('recentAlbums', JSON.stringify(recent));
      }
      navigate('/', { replace: true });
    } catch {
      setDeleting(false);
    }
  }, [albumId, navigate, queryClient, album.mbid, album.slug]);

  const startEditAlbum = useCallback(() => {
    setTitleInput(album.title || '');
    setArtistInput(album.artist || '');
    const yearFromDate = album.releaseDate?.match(/^(\d{4})/)?.[1] || '';
    setReleaseYearInput(
      album.releaseYear != null ? String(album.releaseYear) : yearFromDate
    );
    setReleaseDateInput(
      /^\d{4}-\d{2}-\d{2}$/.test(album.releaseDate || '') ? album.releaseDate : ''
    );
    setLabelInput(album.label || '');
    setDiscogsUrlInput(album.discogsUrl || '');
    setSpotifyUrlInput(streaming.spotify || '');
    setYoutubeUrlInput(streaming.youtube || '');
    setBandcampUrlInput(streaming.bandcamp || '');
    setEditingAlbum(true);
  }, [album, streaming]);

  const cancelEditAlbum = useCallback(() => {
    if (savingAlbum) return;
    setEditingAlbum(false);
  }, [savingAlbum]);

  const saveEditAlbum = useCallback(async () => {
    const title = titleInput.trim();
    const artist = artistInput.trim();
    if (!title || !artist) {
      alert('타이틀과 아티스트는 필수입니다.');
      return;
    }
    const yearStr = releaseYearInput.trim();
    let releaseYear: number | null = null;
    if (yearStr) {
      const n = parseInt(yearStr, 10);
      if (!Number.isInteger(n) || n < 1900 || n > 2100) {
        alert('발매년도는 1900~2100 사이의 숫자여야 합니다.');
        return;
      }
      releaseYear = n;
    }
    const releaseDate = releaseDateInput.trim();
    if (releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
      alert('발매일은 YYYY-MM-DD 형식이어야 합니다.');
      return;
    }

    const urlOrNull = (s: string): string | null => {
      const t = s.trim();
      if (!t) return null;
      if (!/^https?:\/\//i.test(t)) return t; // server will reject with a clear message
      return t;
    };
    const badUrl = [
      ['Discogs', discogsUrlInput],
      ['Spotify', spotifyUrlInput],
      ['YouTube', youtubeUrlInput],
      ['Bandcamp', bandcampUrlInput],
    ].find(([, u]) => u.trim() && !/^https?:\/\//i.test(u.trim()));
    if (badUrl) {
      alert(`${badUrl[0]} URL은 http:// 또는 https:// 로 시작해야 합니다.`);
      return;
    }

    setSavingAlbum(true);
    try {
      await axios.patch(`/api/albums/${albumId}`, {
        title,
        artist_name: artist,
        release_year: releaseYear,
        release_date: releaseDate || null,
        label_name: labelInput.trim() || null,
        discogs_url: urlOrNull(discogsUrlInput),
        spotify_url: urlOrNull(spotifyUrlInput),
        youtube_url: urlOrNull(youtubeUrlInput),
        bandcamp_url: urlOrNull(bandcampUrlInput),
      });
      await queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      await queryClient.invalidateQueries({ queryKey: ['album-list'], refetchType: 'all' });
      setEditingAlbum(false);
    } catch (err) {
      console.error('Update album error:', err);
      const detail =
        axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
          ? err.response.data.error
          : null;
      alert(detail ? `앨범 수정에 실패했습니다.\n\n${detail}` : '앨범 수정에 실패했습니다.');
    } finally {
      setSavingAlbum(false);
    }
  }, [albumId, titleInput, artistInput, releaseYearInput, releaseDateInput, labelInput, discogsUrlInput, spotifyUrlInput, youtubeUrlInput, bandcampUrlInput, queryClient]);

  const allLinks: Array<{ key: string; name: string; color: string; icon: React.ReactNode; url: string }> = [];
  if (buy.discogsUrl) {
    const discogsDef = linkServices.find((s) => s.key === 'discogs')!;
    allLinks.push({ ...discogsDef, url: buy.discogsUrl });
  }
  for (const s of linkServices) {
    if (s.key === 'discogs') continue;
    const url = streaming[s.key as keyof StreamingLinks];
    if (url && typeof url === 'string') {
      allLinks.push({ ...s, url });
    }
  }

  return (
    <div className="relative flex flex-col md:flex-row md:gap-6">
      {/* Decorative listening-digman + turntable illustration tucked
          into the empty right side of the header on lg+. Sized + anchored
          bottom-right so it leaves the artist / title / KO / vote rows
          (which all anchor left in the info column) untouched. The
          asset's bg matches --color-background so the rectangular
          frame blends into the page; pointer-events-none + DOM-order
          first so the streaming link buttons (which can wrap into the
          right edge on very wide info columns) paint over it cleanly. */}
      <img
        src="/textures/digman_turntable.webp"
        alt=""
        aria-hidden
        loading="lazy"
        className="hidden lg:block absolute bottom-0 right-0 w-56 pointer-events-none select-none"
      />
      {user?.isAdmin && (
        <div ref={adminMenuRef} className="absolute top-0 right-0">
          <button
            onClick={() => setAdminMenuOpen((v) => !v)}
            className="text-xs text-gray-600 hover:text-accent transition-colors px-2 py-1 rounded-md border border-transparent hover:border-white/10 cursor-pointer"
            aria-haspopup="menu"
            aria-expanded={adminMenuOpen}
          >
            ⚙️ 관리
          </button>
          {adminMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-1 w-48 bg-[#111] border border-white/10 rounded-md shadow-xl py-1 z-30"
            >
              <AdminMenuItem
                onClick={() => { setAdminMenuOpen(false); void handleRefreshDiscogs(); }}
                disabled={refreshingDiscogs}
              >
                {refreshingDiscogs ? '갱신 중...' : '💰 시세 갱신'}
              </AdminMenuItem>
              <AdminMenuItem
                onClick={() => { setAdminMenuOpen(false); void handleRegenerateSimilar(); }}
                disabled={regeneratingSimilar}
              >
                {regeneratingSimilar ? '재생성 중...' : '🎯 비슷한 앨범 재생성'}
              </AdminMenuItem>
              <AdminMenuItem
                onClick={() => { setAdminMenuOpen(false); void handleGenerateSummary(); }}
                disabled={generateSummary.isPending}
              >
                {generateSummary.isPending ? '생성 중...' : '📝 요약 생성'}
              </AdminMenuItem>
              <AdminMenuItem
                onClick={() => { setAdminMenuOpen(false); void handleResetReviews(); }}
                disabled={resettingReviews}
              >
                {resettingReviews ? '리셋 중...' : '🔄 전체 리뷰 리셋'}
              </AdminMenuItem>
              <div className="my-1 border-t border-white/10" />
              <AdminMenuItem
                onClick={() => { setAdminMenuOpen(false); void handleDelete(); }}
                disabled={deleting}
                danger
              >
                {deleting ? '삭제 중...' : '🗑️ 삭제'}
              </AdminMenuItem>
            </div>
          )}
        </div>
      )}

      {/* Cover Art */}
      <div className="w-full md:w-[22rem] flex-shrink-0">
        <div className="relative group/cover aspect-square bg-panel rounded-panel overflow-hidden transition-shadow duration-300 hover:shadow-[0_0_20px_rgba(232,160,32,0.3)]">
          <CoverArt
            src={album.coverArtUrl}
            fallbacks={album.coverArtFallbacks}
            alt={album.title}
            className="w-full h-full object-cover transition-all duration-300 group-hover/cover:scale-[1.02] group-hover/cover:brightness-110"
            onLoad={user?.isAdmin
              ? ({ naturalWidth, naturalHeight }) =>
                  setCoverSize({ w: naturalWidth, h: naturalHeight })
              : undefined}
          />
          {/* Upper-left lamp wash — selective absorption from the
              레코드샵 카운터 plan (mydig storefront's pendant-light
              language applied here in a single localized spot). The
              warm radial gradient + screen blend makes the cover
              read as picked off the wall and held under a desk
              lamp rather than floating in pure black. Pointer-events
              none + z-10 so the wash sits over the cover image but
              doesn't block the cover's hover affordances or the
              ▶ chip / admin overlay buttons that live at z>=10. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[1]"
            style={{
              // Two-pass lamp wash. The first radial gives a strong
              // warm hot-spot at the upper-left corner; the second
              // diagonal linear-gradient extends a softer wash
              // across roughly the upper-left third of the sleeve so
              // the lamp light reads as a bigger pool rather than a
              // single bright point. Earlier values (alpha 0.18,
              // small radius) read fine on mydig's 95px wall LPs but
              // got diluted over the album-page cover at 320px and
              // up — bumped the alpha and the radius so the wash is
              // visible at hero scale.
              background:
                'radial-gradient(circle 70% at 0% 0%, rgba(255, 215, 150, 0.45) 0%, rgba(255, 215, 150, 0.18) 25%, transparent 55%), linear-gradient(135deg, rgba(255, 205, 130, 0.18) 0%, transparent 35%)',
              mixBlendMode: 'screen',
            }}
          />
          {/* ▶ chip at the hero cover's bottom-right. Revealed on
              hover over the cover wrapper (`group/cover`) so the
              chip reads as a hovered affordance matching every
              other cover ▶ chip in the app. */}
          <PlayChip
            albumMbid={album.mbid}
            spotifyUrl={streaming.spotify}
            title={album.title}
            artist={album.artist}
            size={35}
            hoverGroup="group-hover/cover"
          />
          {user?.isAdmin && !editingCover && (
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover/cover:opacity-100 transition-opacity">
              {coverSize && (
                <span
                  className="hidden md:inline px-1.5 py-1 rounded-md bg-black/60 backdrop-blur-sm border border-white/10 text-[11px] tabular-nums text-gray-300"
                  title="현재 이미지 해상도"
                >
                  {coverSize.w}×{coverSize.h}
                </span>
              )}
              <button
                onClick={startEditCover}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/60 backdrop-blur-sm border border-accent/40 text-accent hover:bg-accent hover:text-black transition-all cursor-pointer"
                title="커버 이미지 URL 수정"
                aria-label="커버 이미지 URL 수정"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 7.125L16.862 4.487"
                  />
                </svg>
              </button>
              <button
                onClick={() => {
                  const query = `${album.title} ${album.artist} cover`;
                  const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/60 backdrop-blur-sm border border-accent/40 text-accent hover:bg-accent hover:text-black transition-all cursor-pointer"
                title={`"${album.title} ${album.artist} cover" Google 이미지 검색`}
                aria-label="구글 이미지 검색"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                  />
                </svg>
              </button>
            </div>
          )}
          {user?.isAdmin && editingCover && (
            <div className="absolute inset-0 z-20 bg-black/85 backdrop-blur-sm flex flex-col justify-center p-4 gap-2">
              <label className="text-xs text-gray-400">새 커버 이미지 URL</label>
              <input
                type="url"
                value={coverInput}
                onChange={(e) => setCoverInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !updatingCover) saveEditCover();
                  if (e.key === 'Escape') cancelEditCover();
                }}
                // Auto-select the pre-filled value so Ctrl+V / ⌘V
                // immediately replaces it when admin has a different
                // URL on the clipboard. Harmless when the field is
                // empty (select() on empty is a no-op).
                onFocus={(e) => e.currentTarget.select()}
                disabled={updatingCover}
                placeholder="https://..."
                autoFocus
                className="bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-sm text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60 w-full"
              />
              <div className="flex justify-between items-center gap-2 mt-1">
                {/* Revert lives left-aligned so it reads as a meta
                    action separate from the cancel/save pair. Hidden
                    when there's no fallback to revert to (no point
                    surfacing a button that would only ever 404). */}
                {(album.coverArtFallbacks?.length ?? 0) > 0 ? (
                  <button
                    onClick={revertCover}
                    disabled={updatingCover}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-accent disabled:opacity-40 cursor-pointer"
                    title="기본 커버로 되돌리기"
                  >
                    ↩ 기본값
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button
                    onClick={cancelEditCover}
                    disabled={updatingCover}
                    className="px-2 py-1 text-sm text-gray-400 hover:text-white disabled:opacity-40 cursor-pointer"
                    title="취소"
                    aria-label="취소"
                  >
                    ✕
                  </button>
                  <button
                    onClick={saveEditCover}
                    disabled={updatingCover}
                    className="px-2 py-1 text-sm text-accent hover:text-white disabled:opacity-40 cursor-pointer"
                    title="저장"
                    aria-label="저장"
                  >
                    {updatingCover ? '...' : '✓'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info + Streaming */}
      <div className="flex flex-col flex-1 min-w-0 p-4 md:pl-0">
        <div>
          {/* Artist on its own line, title + action icons below */}
          <div className="mb-0.5">
            <ArtistCredit
              credit={album.artistCredit}
              fallback={album.artist}
              className="text-editorial-md md:text-editorial-md text-accent hover:underline font-display font-bold cursor-pointer text-left leading-tight"
            />
          </div>
          <div className="flex items-baseline gap-1 flex-wrap min-w-0 mb-1">
            <h1 className="font-bold text-white font-display text-editorial-md md:text-editorial-lg break-words min-w-0 leading-tight">
              {album.title}
            </h1>
            <div className="flex-shrink-0 flex items-center gap-1 self-center">
              <CopyTitleButton
                text={`${album.title} ${album.artist}`}
                label={`"${album.title} ${album.artist}" 복사`}
                iconClassName="w-3 h-3"
              />

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const q = encodeURIComponent(
                    `${album.title} ${album.artist} vinyl`
                  );
                  window.open(
                    `https://www.google.com/search?q=${q}`,
                    '_blank',
                    'noopener,noreferrer'
                  );
                }}
                title="vinyl 검색"
                aria-label={`"${album.title} ${album.artist} vinyl" 구글 검색`}
                className="inline-flex items-center justify-center p-0.5 rounded text-gray-600 hover:text-accent transition-colors cursor-pointer"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-3 h-3"
                  aria-hidden
                >
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
              {user?.isAdmin && (
                <button
                  onClick={startEditAlbum}
                  className="text-gray-600 hover:text-accent transition-colors cursor-pointer text-xs px-1 py-0.5 rounded border border-transparent hover:border-white/10"
                  title="앨범 수정"
                  aria-label="앨범 수정"
                >
                  ✏️
                </button>
              )}
            </div>
          </div>

          {editingKo ? (
            <div className="mt-4 mb-5 bg-white/5 border border-white/10 rounded-lg p-3 max-w-md">
              <div className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 items-center text-sm">
                <label className="text-gray-400">아티스트 발음</label>
                <input
                  type="text"
                  value={artistKoInput}
                  onChange={(e) => setArtistKoInput(e.target.value)}
                  disabled={savingKo}
                  className="bg-panel-strong border border-white/10 rounded-md px-2 py-1 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
                />
                <label className="text-gray-400">앨범 발음</label>
                <input
                  type="text"
                  value={titleKoInput}
                  onChange={(e) => setTitleKoInput(e.target.value)}
                  disabled={savingKo}
                  className="bg-panel-strong border border-white/10 rounded-md px-2 py-1 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
                />
                <label className="text-gray-400">앨범 뜻</label>
                <input
                  type="text"
                  value={titleMeaningInput}
                  onChange={(e) => setTitleMeaningInput(e.target.value)}
                  disabled={savingKo}
                  className="bg-panel-strong border border-white/10 rounded-md px-2 py-1 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
                />
              </div>
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={cancelEditKo}
                  disabled={savingKo}
                  className="px-2 py-1 text-sm text-gray-400 hover:text-white disabled:opacity-40 cursor-pointer"
                  title="취소"
                  aria-label="취소"
                >
                  ✕
                </button>
                <button
                  onClick={saveEditKo}
                  disabled={savingKo}
                  className="px-2 py-1 text-sm text-accent hover:text-white disabled:opacity-40 cursor-pointer"
                  title="저장"
                  aria-label="저장"
                >
                  {savingKo ? '...' : '✓'}
                </button>
              </div>
            </div>
          ) : (
            (() => {
              const artistPart = album.artistKo?.trim() || '';
              const titlePart = [album.titleKo, album.titleMeaning]
                .filter((p): p is string => !!p && p.trim().length > 0)
                .join(' · ');
              const segments = [artistPart, titlePart].filter((s) => s.length > 0);
              const hasContent = segments.length > 0;
              if (!hasContent && !user?.isAdmin) return null;
              return (
                <div className="flex items-center gap-2 text-gray-500 text-sm font-normal mt-1 mb-3">
                  {hasContent ? <span>[{segments.join(' ~ ')}]</span> : <span className="italic text-gray-600">한국어 번역 없음</span>}
                  {user?.isAdmin && (
                    <>
                      <button
                        onClick={startEditKo}
                        className="text-gray-600 hover:text-accent transition-colors cursor-pointer"
                        title="한국어 번역 수정"
                        aria-label="한국어 번역 수정"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={handleRegenerateKo}
                        disabled={regeneratingKo}
                        className="text-gray-600 hover:text-accent transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-wait"
                        title="한국어 번역 재생성 (외부 API 호출)"
                        aria-label="한국어 번역 재생성"
                      >
                        {regeneratingKo ? '...' : '🔄'}
                      </button>
                    </>
                  )}
                </div>
              );
            })()
          )}

          <div className="flex items-center gap-2 text-gray-400 text-sm mb-6 flex-wrap">
            {album.releaseDate && (
              album.releaseYear ? (
                <Link
                  to={`/dig?lens=year:${album.releaseYear}`}
                  className="hover:text-accent transition-colors"
                  title={`${album.releaseYear}년 발매작 보기`}
                >
                  {formatReleaseDate(album.releaseDate)}
                </Link>
              ) : (
                <span>{formatReleaseDate(album.releaseDate)}</span>
              )
            )}
            {album.label && (
              <>
                {album.releaseDate && <span className="text-gray-600">&middot;</span>}
                <Link
                  to={`/dig?lens=label:${encodeURIComponent(album.label)}`}
                  className="hover:text-accent transition-colors"
                  title={`${album.label} 작품 보기`}
                >
                  {album.label}
                </Link>
              </>
            )}
          </div>

          {/* Action bar — was previously sitting between the header
              and the body grid, which created a hard horizontal break
              and a floating-in-the-middle feel. Inside the header it
              reads as a per-album action group, and a tag row below
              still acts as the separator from the metadata above.
              py-3 + mb-6 gives the chip cluster symmetric ~36px gaps
              above and below (24px from the release-date row's mb-6
              plus 12px of inner padding on top; 12px inner + 24px
              mb-6 on bottom), so the bar reads as a deliberate
              separator instead of being squeezed between siblings. */}
          <div className="flex items-stretch gap-2 py-3 mb-6">
            <VoteButtons
              albumId={albumId}
              upvotes={album.upvotes ?? 0}
              downvotes={album.downvotes ?? 0}
              userVote={album.userVote ?? null}
            />
            <CrateButton
              albumId={album.id ?? null}
              crateCount={album.crateCount ?? 0}
            />
          </div>

          <TagEditor tags={album.genres} albumId={albumId} isAdmin={!!user?.isAdmin} />
        </div>

        {allLinks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {allLinks.map((link) => (
              <LinkButton key={link.key} link={link} />
            ))}
          </div>
        )}
      </div>

      {user?.isAdmin && editingAlbum && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={cancelEditAlbum}
        >
          <div
            className="bg-[#111] border border-white/10 rounded-xl w-full max-w-lg p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white mb-4">앨범 정보 수정</h2>
            <div className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-3 items-center text-sm">
              <label className="text-gray-400">타이틀</label>
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                disabled={savingAlbum}
                className="bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <label className="text-gray-400">아티스트</label>
              <input
                type="text"
                value={artistInput}
                onChange={(e) => setArtistInput(e.target.value)}
                disabled={savingAlbum}
                className="bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <label className="text-gray-400">발매년도</label>
              <input
                type="number"
                min={1900}
                max={2100}
                value={releaseYearInput}
                onChange={(e) => setReleaseYearInput(e.target.value)}
                disabled={savingAlbum}
                placeholder="예: 2025"
                className="bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <label className="text-gray-400">발매일</label>
              <input
                type="text"
                value={releaseDateInput}
                onChange={(e) => setReleaseDateInput(e.target.value)}
                disabled={savingAlbum}
                placeholder="YYYY-MM-DD (선택)"
                className="bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <label className="text-gray-400">레이블</label>
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                disabled={savingAlbum}
                className="bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <div className="col-span-2 mt-1 mb-0.5 text-[11px] uppercase tracking-wider text-gray-500">외부 링크</div>
              <label className="text-gray-400">Discogs</label>
              <input
                type="url"
                value={discogsUrlInput}
                onChange={(e) => setDiscogsUrlInput(e.target.value)}
                disabled={savingAlbum}
                placeholder="https://www.discogs.com/master/..."
                className="bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <label className="text-gray-400">Spotify</label>
              <input
                type="url"
                value={spotifyUrlInput}
                onChange={(e) => setSpotifyUrlInput(e.target.value)}
                disabled={savingAlbum}
                placeholder="https://open.spotify.com/album/..."
                className="bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <label className="text-gray-400">YouTube</label>
              <input
                type="url"
                value={youtubeUrlInput}
                onChange={(e) => setYoutubeUrlInput(e.target.value)}
                disabled={savingAlbum}
                placeholder="https://youtube.com/..."
                className="bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <label className="text-gray-400">Bandcamp</label>
              <input
                type="url"
                value={bandcampUrlInput}
                onChange={(e) => setBandcampUrlInput(e.target.value)}
                disabled={savingAlbum}
                placeholder="https://artist.bandcamp.com/album/..."
                className="bg-panel-strong border border-white/10 rounded-md px-2 py-1.5 text-gray-200 focus:border-accent focus:outline-none disabled:opacity-60"
              />
            </div>
            <p className="text-xs text-gray-500 mt-4">
              커버/장르/한국어 번역은 각 전용 수정 버튼을 사용하세요. Discogs URL을 master 링크로 바꾸면 저장 후 ⚙️ 관리 → 💰 시세 갱신으로 바로 재크롤링됩니다.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={cancelEditAlbum}
                disabled={savingAlbum}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={saveEditAlbum}
                disabled={savingAlbum}
                className="px-3 py-1.5 text-sm text-accent border border-accent/40 rounded-md hover:bg-accent hover:text-black disabled:opacity-40 cursor-pointer transition-colors"
              >
                {savingAlbum ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
