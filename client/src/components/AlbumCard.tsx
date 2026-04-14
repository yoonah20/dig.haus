import { Link } from 'react-router-dom';
import type { AlbumSearchResult } from '../types';
import CoverArt from './CoverArt';
import PriceTagStack from './PriceTagSticker';
import { getScoreColor } from '../utils/score';

export default function AlbumCard({ album }: { album: AlbumSearchResult }) {
  const up = album.upvotes ?? 0;
  const down = album.downvotes ?? 0;
  const priceTagLinks = album.priceTagLinks ?? [];

  return (
    <Link to={`/album/${album.mbid}`} className="block album-flip-outer">
      <div className="relative aspect-square" style={{ perspective: '1000px' }}>
        <div className="album-flip relative w-full h-full">
          {/* Front */}
          <div
            className="absolute inset-0 bg-[#1a1a1a] rounded-xl overflow-hidden"
            style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
          >
            <CoverArt
              src={album.coverArtUrl}
              fallbacks={album.coverArtFallbacks}
              alt={album.title}
              className="w-full h-full object-cover"
            />
            <PriceTagStack links={priceTagLinks} />
          </div>

          {/* Back */}
          <div
            className="absolute inset-0 rounded-xl overflow-hidden"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              background: '#0f0f0f',
            }}
          >
            {/* Mirrored, darkened cover as background */}
            <div
              className="absolute inset-0"
              style={{ transform: 'scaleX(-1)', filter: 'brightness(0.12)' }}
              aria-hidden
            >
              <CoverArt
                src={album.coverArtUrl}
                fallbacks={album.coverArtFallbacks}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            {/* Amber key-color wash */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(135deg, rgba(232,160,32,0.14), rgba(232,160,32,0.04))',
              }}
              aria-hidden
            />
            {/* Info overlay — text reads normally */}
            <div className="absolute inset-0 flex flex-col" style={{ padding: '36px 14px' }}>
              <h3 className="text-white line-clamp-2" style={{ fontSize: '18px', fontWeight: 700, lineHeight: 1.25 }}>
                {album.title}
              </h3>
              <p className="text-gray-300 line-clamp-1" style={{ fontSize: '14px', marginTop: '4px' }}>
                {album.artist}
                {album.year && <> · {album.year}</>}
              </p>
              <div style={{ flexGrow: 1 }} />
              <div className="flex items-center gap-3 tabular-nums" style={{ fontSize: '13px' }}>
                {album.averageScore != null && (
                  <span className={`font-semibold ${getScoreColor(album.averageScore)}`}>
                    ★ {album.averageScore}/100
                  </span>
                )}
                {(up > 0 || down > 0) && (
                  <>
                    <span className="text-[#3b82f6]">▲{up}</span>
                    <span className="text-[#ef4444]">▼{down}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
