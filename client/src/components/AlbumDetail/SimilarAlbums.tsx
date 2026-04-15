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

  return (
    <div className="absolute bottom-2 right-2 flex gap-1">
      {links.map(({ key, url, color, Icon }) => (
        key === 'spotify' ? (
          <button
            key={key}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openSpotifyAlbum(url!);
            }}
            className="flex items-center justify-center w-5 h-5 rounded-full transition-opacity hover:opacity-100 opacity-80 cursor-pointer"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)', color }}
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
            className="flex items-center justify-center w-5 h-5 rounded-full transition-opacity hover:opacity-100 opacity-80"
            style={{ backgroundColor: 'rgba(0,0,0,0.7)', color }}
          >
            <Icon />
          </a>
        )
      ))}
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
    <a href={discogsHref} target="_blank" rel="noopener noreferrer" className="relative block group/card">
      <div className="bg-[#1a1a1a] rounded-xl overflow-hidden hover:bg-[#252525] transition-colors group">
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
        <div className="p-3">
          <p className="text-white font-semibold line-clamp-2" style={{ fontSize: '0.9375rem' }} title={album.title}>
            {album.title}
          </p>
          <p className="text-gray-400 truncate" style={{ fontSize: '0.8125rem' }} title={album.artist}>
            {album.artist}
          </p>
          {album.reason && (
            <p className="text-gray-500 mt-2 leading-snug" style={{ fontSize: '0.8125rem' }}>{album.reason}</p>
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
        </div>
      )}
    </a>
  );
}

export default function SimilarAlbums({ albums, albumId }: { albums: SimilarAlbum[]; albumId: string }) {
  if (albums.length === 0) return null;

  return (
    <section>
      <h2 className="text-2xl font-bold text-white mb-6 font-serif">
        비앨추(비슷한 앨범 추천)
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {albums.map((album, idx) => (
          <AlbumCard key={album.mbid ?? idx} album={album} index={idx} albumId={albumId} />
        ))}
      </div>
    </section>
  );
}
