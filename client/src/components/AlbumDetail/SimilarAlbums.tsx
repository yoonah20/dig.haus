import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import axios from '../../lib/axios';
import type { SimilarAlbum } from '../../types';
import { openSpotifyAlbum } from '../../utils/spotify';
import { useAuth } from '../../contexts/AuthContext';

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function BandcampIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current">
      <path d="M0 18.75l7.437-13.5H24l-7.438 13.5H0z" />
    </svg>
  );
}

function DiscogsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current">
      <path d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm0 21.6A9.6 9.6 0 1 1 12 2.4a9.6 9.6 0 0 1 0 19.2zm0-16.8a7.2 7.2 0 1 0 0 14.4 7.2 7.2 0 0 0 0-14.4zm0 12a4.8 4.8 0 1 1 0-9.6 4.8 4.8 0 0 1 0 9.6zm0-7.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z" />
    </svg>
  );
}

function ServiceIcons({ album }: { album: SimilarAlbum }) {
  const links = [
    { key: 'spotify', url: album.spotifyUrl, color: '#1DB954', Icon: SpotifyIcon },
    { key: 'youtube', url: album.youtubeUrl, color: '#FF0000', Icon: YouTubeIcon },
    { key: 'bandcamp', url: album.bandcampUrl, color: '#1DA0C3', Icon: BandcampIcon },
  ].filter((l) => !!l.url);

  if (links.length === 0) return null;

  // Wrap every link in a single dark pill so the brand-coloured icons read
  // against the background instead of disappearing into the cover art's
  // shadows. The previous per-icon circles relied on a low-contrast
  // black/70 disc that was easy to miss on dark covers.
  return (
    <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/75 backdrop-blur-sm ring-1 ring-white/10">
      {links.map(({ key, url, color, Icon }) =>
        key === 'spotify' ? (
          <button
            key={key}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openSpotifyAlbum(url!);
            }}
            className="flex items-center justify-center w-4 h-4 transition-opacity hover:opacity-100 opacity-90 cursor-pointer"
            style={{ color }}
            title="Spotify에서 듣기"
            aria-label="Spotify에서 듣기"
          >
            <Icon />
          </button>
        ) : (
          <a
            key={key}
            href={url!}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center w-4 h-4 transition-opacity hover:opacity-100 opacity-90"
            style={{ color }}
            title={key === 'youtube' ? 'YouTube에서 듣기' : 'Bandcamp에서 듣기'}
            aria-label={key === 'youtube' ? 'YouTube에서 듣기' : 'Bandcamp에서 듣기'}
          >
            <Icon />
          </a>
        )
      )}
    </div>
  );
}

interface AlbumCardProps {
  album: SimilarAlbum;
  index: number;
  albumId: string;
}

function AlbumCard({ album, index, albumId }: AlbumCardProps) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [spotify, setSpotify] = useState('');
  const [youtube, setYoutube] = useState('');
  const [bandcamp, setBandcamp] = useState('');
  const [reason, setReason] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);

  const registerAlbum = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!album.mbid || registering || registered) return;
    setRegistering(true);
    try {
      // Hitting GET /api/albums/:mbid caches the album in the DB (same flow
      // as RegisterAlbumModal). Navigate into the freshly-registered page so
      // admins can immediately verify metadata / kick off review collection.
      await axios.get(`/api/albums/${encodeURIComponent(album.mbid)}`);
      await queryClient.invalidateQueries({ queryKey: ['album-list'] });
      setRegistered(true);
      navigate(`/album/${album.mbid}`);
    } catch (err) {
      console.error('Register album error:', err);
      alert('앨범 등록에 실패했습니다.');
    } finally {
      setRegistering(false);
    }
  }, [album.mbid, registering, registered, queryClient, navigate]);

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSpotify(album.spotifyUrl || '');
    setYoutube(album.youtubeUrl || '');
    setBandcamp(album.bandcampUrl || '');
    setReason(album.reason || '');
    setEditing(true);
  }, [album]);

  const cancelEdit = useCallback(() => {
    if (saving) return;
    setEditing(false);
  }, [saving]);

  const saveEdit = useCallback(async () => {
    setSaving(true);
    try {
      await axios.patch(`/api/albums/${albumId}/similar/${index}`, {
        spotifyUrl: spotify,
        youtubeUrl: youtube,
        bandcampUrl: bandcamp,
        reason,
      });
      await queryClient.invalidateQueries({ queryKey: ['album-similar', albumId] });
      setEditing(false);
    } catch (err) {
      console.error('Save similar album error:', err);
      alert('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [albumId, index, spotify, youtube, bandcamp, reason, queryClient]);

  // Admin-only delete for entries that landed completely off-target. We
  // confirm before firing because deletes are non-trivial to walk back —
  // the next AI re-generation may not pick the same album again.
  const deleteEntry = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`"${album.artist} — ${album.title}"\n\n이 추천을 삭제할까요?`)) return;
    try {
      await axios.delete(`/api/albums/${albumId}/similar/${index}`);
      await queryClient.invalidateQueries({ queryKey: ['album-similar', albumId] });
    } catch (err) {
      console.error('Delete similar album error:', err);
      alert('삭제에 실패했습니다.');
    }
  }, [albumId, index, album.artist, album.title, queryClient]);

  if (editing) {
    return (
      <div className="bg-[#1a1a1a] rounded-xl overflow-hidden border border-[#e8a020]/40 p-3 flex flex-col gap-2">
        <div className="text-xs text-gray-400 truncate" title={`${album.artist} — ${album.title}`}>
          {album.artist} — {album.title}
        </div>
        <input
          type="url"
          placeholder="Spotify URL"
          value={spotify}
          onChange={(e) => setSpotify(e.target.value)}
          disabled={saving}
          className="bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1 text-xs text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
        />
        <input
          type="url"
          placeholder="YouTube URL"
          value={youtube}
          onChange={(e) => setYoutube(e.target.value)}
          disabled={saving}
          className="bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1 text-xs text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
        />
        <input
          type="url"
          placeholder="Bandcamp URL"
          value={bandcamp}
          onChange={(e) => setBandcamp(e.target.value)}
          disabled={saving}
          className="bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1 text-xs text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
        />
        <textarea
          placeholder="한국어 설명"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={saving}
          rows={3}
          className="bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1 text-xs text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60 resize-none"
        />
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={cancelEdit}
            disabled={saving}
            className="px-2 py-0.5 text-xs text-gray-400 hover:text-white disabled:opacity-40 cursor-pointer"
            aria-label="취소"
          >
            ✕
          </button>
          <button
            onClick={saveEdit}
            disabled={saving}
            className="px-2 py-0.5 text-xs text-[#e8a020] hover:text-white disabled:opacity-40 cursor-pointer"
            aria-label="저장"
          >
            {saving ? '...' : '✓'}
          </button>
        </div>
      </div>
    );
  }

  const discogsHref = album.discogsUrl
    || `https://www.discogs.com/search/?q=${encodeURIComponent(`${album.artist} ${album.title}`)}&type=master`;

  return (
    <a href={discogsHref} target="_blank" rel="noopener noreferrer" className="relative block group/card h-full">
      <div className="h-full flex flex-col bg-[#1a1a1a] rounded-xl overflow-hidden hover:bg-[#252525] transition-colors group">
        <div className="relative aspect-square bg-[#111] overflow-hidden">
          {album.imageUrl ? (
            <img
              src={album.imageUrl}
              alt={album.title}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-700 text-4xl">
              &#9835;
            </div>
          )}
          <ServiceIcons album={album} />
        </div>
        {/* flex-1 lets this block fill the leftover height of the
            tallest card in the row — items-stretch on the grid
            equalises card heights, shorter reasons just leave extra
            whitespace. Titles truncate (1–2 lines) because the pick
            is identifiable by cover + artist anyway; reason text is
            never clipped so the curator's rationale reads in full. */}
        <div className="p-3 flex-1 flex flex-col">
          <p className="text-white font-semibold line-clamp-2" style={{ fontSize: '0.9375rem' }} title={album.title}>
            {album.title}
          </p>
          <p className="text-gray-400 truncate" style={{ fontSize: '0.8125rem' }} title={album.artist}>
            {album.artist}
          </p>
          {album.reason && (
            <p
              className="text-gray-500 mt-2 leading-snug break-words"
              style={{ fontSize: '0.8125rem' }}
            >
              {album.reason}
            </p>
          )}
        </div>
      </div>
      {isAdmin && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
          {album.mbid && (
            <button
              onClick={registerAlbum}
              disabled={registering || registered}
              className={`w-6 h-6 flex items-center justify-center text-xs bg-black/70 rounded hover:!opacity-100 disabled:cursor-not-allowed ${
                registered ? 'text-green-400' : 'text-[#e8a020]'
              }`}
              title={registered ? '등록됨' : '이 앨범 등록'}
              aria-label={registered ? '등록됨' : '이 앨범 등록'}
            >
              {registering ? '…' : registered ? '✓' : '+'}
            </button>
          )}
          <button
            onClick={startEdit}
            className="w-6 h-6 flex items-center justify-center text-xs bg-black/70 text-gray-200 rounded hover:!opacity-100"
            title="수정"
            aria-label="수정"
          >
            ✏️
          </button>
          <button
            onClick={deleteEntry}
            className="w-6 h-6 flex items-center justify-center text-xs bg-black/70 text-gray-200 rounded hover:!opacity-100 hover:text-red-400"
            title="이 추천 삭제"
            aria-label="이 추천 삭제"
          >
            🗑️
          </button>
        </div>
      )}
    </a>
  );
}

function AddSlot({ albumId }: { albumId: string }) {
  const [open, setOpen] = useState(false);
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleAdd = useCallback(async () => {
    const a = artist.trim();
    const t = title.trim();
    if (!a || !t) {
      alert('아티스트와 앨범명을 모두 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      await axios.post(`/api/albums/${albumId}/similar`, { artist: a, title: t });
      await queryClient.invalidateQueries({ queryKey: ['album-similar', albumId] });
      setOpen(false);
      setArtist('');
      setTitle('');
    } catch (err) {
      console.error('Add similar album error:', err);
      alert('추가에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }, [albumId, artist, title, queryClient]);

  if (open) {
    return (
      <div className="bg-[#1a1a1a] rounded-xl overflow-hidden border border-dashed border-[#e8a020]/40 p-3 flex flex-col gap-2">
        <div className="text-xs text-gray-400">비슷한 앨범 수동 추가</div>
        <input
          type="text"
          placeholder="아티스트"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          disabled={saving}
          autoFocus
          className="bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1 text-xs text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
        />
        <input
          type="text"
          placeholder="앨범명"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
          onKeyDown={(e) => { if (e.key === 'Enter' && !saving) handleAdd(); }}
          className="bg-[#0f0f0f] border border-white/10 rounded-md px-2 py-1 text-xs text-gray-200 focus:border-[#e8a020] focus:outline-none disabled:opacity-60"
        />
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={() => { setOpen(false); setArtist(''); setTitle(''); }}
            disabled={saving}
            className="px-2 py-0.5 text-xs text-gray-400 hover:text-white disabled:opacity-40 cursor-pointer"
          >
            ✕
          </button>
          <button
            onClick={handleAdd}
            disabled={saving}
            className="px-2 py-0.5 text-xs text-[#e8a020] hover:text-white disabled:opacity-40 cursor-pointer"
          >
            {saving ? '추가 중...' : '✓ 추가'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setOpen(true)}
      className="bg-transparent rounded-xl border-2 border-dashed border-white/10 hover:border-[#e8a020]/40 flex flex-col items-center justify-center aspect-[3/4] transition-colors cursor-pointer group"
    >
      <span className="text-2xl text-gray-600 group-hover:text-[#e8a020] transition-colors">+</span>
      <span className="text-xs text-gray-600 group-hover:text-gray-400 mt-1 transition-colors">추가</span>
    </button>
  );
}

export default function SimilarAlbums({ albums, albumId }: { albums: SimilarAlbum[]; albumId: string }) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  // Non-admins only see the section once at least one curated pick
  // exists — an empty AI-seeded section would just advertise broken
  // recommendations. Admins always see it so they can edit, delete,
  // or manually add (+ button).
  if (!isAdmin && albums.length === 0) return null;

  const showAddSlot = isAdmin && albums.length < 5;

  return (
    <section>
      <h2 className="text-2xl font-bold text-white mb-6 font-serif flex items-baseline gap-2">
        <span>비앨추 (비슷한 앨범 추천)</span>
        <AiSummaryBadge />
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 items-stretch">
        {albums.map((album, idx) => (
          <AlbumCard key={album.mbid ?? idx} album={album} index={idx} albumId={albumId} />
        ))}
        {showAddSlot && <AddSlot albumId={albumId} />}
      </div>
    </section>
  );
}

export function AiSummaryBadge() {
  return (
    <span
      className="inline-flex items-center text-[10px] font-sans font-semibold tracking-wider uppercase text-[#e8a020]/80 border border-[#e8a020]/40 rounded-full px-1.5 py-0.5 leading-none align-middle translate-y-[-2px]"
      title="Claude가 정리한 내용입니다."
      aria-label="AI 요약"
    >
      AI 요약
    </span>
  );
}
