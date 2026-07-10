import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import axios from '../../lib/axios';
import type { SimilarAlbum } from '../../types';
import { tryOpenSpotifyDesktopApp } from '../../utils/spotify';
import { useAuth } from '../../contexts/AuthContext';
import CardOverlayButton from '../CardOverlayButton';
import PlayChip from '../PlayChip';
import { SectionTitle, Field, Panel } from '../ui';

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
    <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-pill bg-black/75 backdrop-blur-sm ring-1 ring-white/10">
      {links.map(({ key, url, color, Icon }) => {
        // Plain anchors — on mobile the OS opens the native app from a
        // real tap via universal / app links. stopPropagation keeps the
        // card's own navigate() from firing. Spotify additionally hands
        // off to the desktop app via the spotify: protocol on desktop
        // only (mobile relies on the anchor's default https navigation;
        // the protocol + window.open dance there trips iOS Safari's
        // pop-up prompt).
        const label =
          key === 'spotify'
            ? 'Spotify에서 듣기'
            : key === 'youtube'
              ? 'YouTube에서 듣기'
              : 'Bandcamp에서 듣기';
        return (
          <a
            key={key}
            href={url!}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              if (key === 'spotify' && tryOpenSpotifyDesktopApp(url!)) {
                e.preventDefault();
              }
            }}
            className="flex items-center justify-center w-4 h-4 transition-opacity hover:opacity-100 opacity-90"
            style={{ color }}
            title={label}
            aria-label={label}
          >
            <Icon />
          </a>
        );
      })}
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
      <Panel borderTone="accent" pad="sm" className="overflow-hidden flex flex-col gap-2">
        <div className="text-xs text-gray-400 truncate" title={`${album.artist} — ${album.title}`}>
          {album.artist} — {album.title}
        </div>
        <Field
          type="url"
          placeholder="Spotify URL"
          value={spotify}
          onChange={(e) => setSpotify(e.target.value)}
          disabled={saving}
        />
        <Field
          type="url"
          placeholder="YouTube URL"
          value={youtube}
          onChange={(e) => setYoutube(e.target.value)}
          disabled={saving}
        />
        <Field
          type="url"
          placeholder="Bandcamp URL"
          value={bandcamp}
          onChange={(e) => setBandcamp(e.target.value)}
          disabled={saving}
        />
        <Field
          as="textarea"
          placeholder="한국어 설명"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={saving}
          rows={3}
          className="resize-none"
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
            className="px-2 py-0.5 text-xs text-accent hover:text-white disabled:opacity-40 cursor-pointer"
            aria-label="저장"
          >
            {saving ? '...' : '✓'}
          </button>
        </div>
      </Panel>
    );
  }

  // In-DB picks deep-link to the local album page via React Router so
  // navigation stays SPA-internal (no full reload, query cache
  // preserved). Out-of-DB picks fall back to Discogs as before — open
  // in a new tab so the source album page stays put. The wrapper
  // element changes accordingly; the inner card markup is identical
  // either way.
  const inAppLink = !!(album.inDb && album.mbid);
  const discogsHref = album.discogsUrl
    || `https://www.discogs.com/search/?q=${encodeURIComponent(`${album.artist} ${album.title}`)}&type=master`;
  const wrapperClassName = 'relative block group/card h-full';

  const cardInner = (
    <>
      <div className="h-full flex flex-col bg-panel rounded-panel overflow-hidden hover:bg-panel-hover transition-colors group">
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
          {/* ▶ chip bottom-right matches the home grid + album
              hero placement. Falls back to spotifyUrl as the
              identity key when mbid is null (similar picks can
              lack a local mbid when they're not in our DB yet) —
              PlayChip hides itself if neither is usable. Hover
              reveal via the outer `group/card` the card anchor
              already exposes. */}
          <PlayChip
            albumMbid={album.mbid ?? album.spotifyUrl ?? ''}
            spotifyUrl={album.spotifyUrl}
            title={album.title}
            artist={album.artist}
            size={26}
            hoverGroup="group-hover/card"
          />
        </div>
        {/* flex-1 lets this block fill the leftover height of the
            tallest card in the row — items-stretch on the grid
            equalises card heights, shorter reasons just leave extra
            whitespace. Titles truncate (1–2 lines) because the pick
            is identifiable by cover + artist anyway; reason text is
            never clipped so the curator's rationale reads in full. */}
        <div className="p-3 flex-1 flex flex-col">
          <p className="text-white font-semibold line-clamp-2 text-[15px]" title={album.title}>
            {album.title}
          </p>
          <p className="text-gray-400 truncate text-[13px]" title={album.artist}>
            {album.artist}
          </p>
          {album.reason && (
            <p className="text-gray-500 mt-2 leading-snug break-words text-[13px]">
              {album.reason}
            </p>
          )}
        </div>
      </div>
      {isAdmin && (
        <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 sm:opacity-0 sm:group-hover/card:opacity-100 sm:focus-within:opacity-100 sm:transition-opacity">
          {album.mbid && (
            <CardOverlayButton
              onClick={registerAlbum}
              disabled={registering || registered}
              title={registered ? '등록됨' : '이 앨범 등록'}
            >
              {registering ? '…' : registered ? '✓' : '+'}
            </CardOverlayButton>
          )}
          <CardOverlayButton onClick={startEdit} title="수정">
            ✎
          </CardOverlayButton>
          <CardOverlayButton
            variant="danger"
            onClick={deleteEntry}
            title="이 추천 삭제"
          >
            ×
          </CardOverlayButton>
        </div>
      )}
    </>
  );

  return inAppLink ? (
    <Link to={`/album/${album.mbid}`} className={wrapperClassName}>
      {cardInner}
    </Link>
  ) : (
    <a
      href={discogsHref}
      target="_blank"
      rel="noopener noreferrer"
      className={wrapperClassName}
    >
      {cardInner}
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
      <Panel borderTone="dashed" pad="sm" className="overflow-hidden flex flex-col gap-2">
        <div className="text-xs text-gray-400">비슷한 앨범 수동 추가</div>
        <Field
          type="text"
          placeholder="아티스트"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          disabled={saving}
          autoFocus
        />
        <Field
          type="text"
          placeholder="앨범명"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
          onKeyDown={(e) => { if (e.key === 'Enter' && !saving) handleAdd(); }}
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
            className="px-2 py-0.5 text-xs text-accent hover:text-white disabled:opacity-40 cursor-pointer"
          >
            {saving ? '추가 중...' : '✓ 추가'}
          </button>
        </div>
      </Panel>
    );
  }

  return (
    <button
      onClick={() => setOpen(true)}
      className="bg-transparent rounded-panel border-2 border-dashed border-white/10 hover:border-accent/40 flex flex-col items-center justify-center h-full transition-colors cursor-pointer group"
    >
      <span className="text-2xl text-gray-600 group-hover:text-accent transition-colors">+</span>
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
      <SectionTitle variant="tape" meta={<AiSummaryBadge />}>
        비앨추 (비슷한 앨범 추천)
      </SectionTitle>

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
      className="inline-flex items-center text-[10px] font-sans font-semibold tracking-wider uppercase text-accent/80 border border-accent/40 rounded-pill px-1.5 py-0.5 leading-none align-middle translate-y-[-2px]"
      title="AI가 정리한 내용입니다."
      aria-label="AI 요약"
    >
      AI 요약
    </span>
  );
}
