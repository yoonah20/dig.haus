interface DiscographyItem {
  mbid: string;
  title: string;
  year: string;
  primaryType: string;
  coverArtUrl: string;
}

interface DiscographyProps {
  items: DiscographyItem[];
  currentMbid: string;
  artistName: string;
}

function getDiscogsUrl(item: DiscographyItem, artistName: string): string {
  // discogs-master-{id} → direct master link
  const masterMatch = item.mbid.match(/^discogs-master-(\d+)$/);
  if (masterMatch) {
    return `https://www.discogs.com/master/${masterMatch[1]}`;
  }
  // Fallback: Discogs search
  return `https://www.discogs.com/search/?q=${encodeURIComponent(`${artistName} ${item.title}`)}&type=master`;
}

export default function Discography({ items, currentMbid, artistName }: DiscographyProps) {
  if (items.length === 0) return null;

  return (
    <section>
      <h2
        className="text-2xl font-bold text-white mb-6 font-serif"
      >
        {artistName} 디스코그래피
      </h2>

      <div className="relative">
        <div className="flex gap-4 overflow-x-auto pb-3 -mx-2 px-2 scrollbar-thin scrollbar-thumb-gray-700">
        {items.map((item) => {
          const isCurrent = item.mbid === currentMbid;
          const href = getDiscogsUrl(item, artistName);
          return (
            <a
              key={item.mbid || item.title}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex-shrink-0 w-40 rounded-xl overflow-hidden transition-all duration-200 ease-out cursor-pointer hover:-translate-y-0.5 ${
                isCurrent
                  ? 'ring-2 ring-[#e8a020] bg-[#e8a020]/10'
                  : 'bg-[#1a1a1a] hover:bg-[#252525]'
              }`}
            >
              <div className="aspect-square bg-[#111] overflow-hidden">
                <img
                  src={item.coverArtUrl}
                  alt={item.title}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
              <div className="p-3">
                <p
                  className={`text-sm font-medium line-clamp-2 ${
                    isCurrent ? 'text-[#e8a020]' : 'text-white'
                  }`}
                  title={item.title}
                >
                  {item.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {item.year && (
                    <span className="text-gray-500 text-xs">{item.year}</span>
                  )}
                  {item.primaryType && item.primaryType !== 'Album' && (
                    <span className="text-gray-600 text-[10px] bg-white/5 px-1.5 py-0.5 rounded">
                      {item.primaryType}
                    </span>
                  )}
                </div>
              </div>
            </a>
          );
        })}
        </div>
        {/* Right-edge fade hint for scrollable content */}
        <div
          className="pointer-events-none absolute top-0 right-0 bottom-3 w-12"
          style={{
            background:
              'linear-gradient(to right, rgba(15,15,15,0), rgba(15,15,15,1))',
          }}
          aria-hidden
        />
      </div>
    </section>
  );
}
