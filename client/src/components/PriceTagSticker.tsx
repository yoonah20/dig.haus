import type { PriceTagLink } from '../types';

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  JPY: '¥',
  GBP: '£',
  EUR: '€',
  KRW: '₩',
};

function formatPrice(price: number | null, currency: string): string {
  if (price === null || price === undefined) return '-';
  const sym = CURRENCY_SYMBOL[currency] || '';
  if (currency === 'JPY' || currency === 'KRW') {
    return `${sym}${Math.round(price).toLocaleString()}`;
  }
  return `${sym}${price.toFixed(2)}`;
}

interface PriceTagStackProps {
  links: PriceTagLink[];
  maxVisible?: number;
  showOverflow?: boolean;
}

export default function PriceTagStack({ links, maxVisible = 3, showOverflow = true }: PriceTagStackProps) {
  if (links.length === 0) return null;

  // Sort by KRW-converted price ascending (cheapest first). Links without a
  // KRW price fall to the end — they still count toward overflow so users
  // see there are more options.
  const sorted = [...links].sort((a, b) => {
    const aKrw = a.priceKrw ?? Number.POSITIVE_INFINITY;
    const bKrw = b.priceKrw ?? Number.POSITIVE_INFINITY;
    return aKrw - bKrw;
  });

  const visible = sorted.slice(0, Math.max(1, maxVisible));
  const overflow = sorted.length - visible.length;

  return (
    <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1 pointer-events-none">
      {visible.map((link, i) => {
        const rotation = (i % 2 === 0 ? -1 : 1) * (2 + i);
        return (
          <div key={link.id} className="flex flex-col items-end">
            {link.isSoldOut && (
              <span
                className="pointer-events-auto relative z-10 -mb-2 mr-1 bg-[#c8321f] text-white text-[9px] leading-none font-bold tracking-wider px-1.5 py-1 select-none"
                style={{ transform: `rotate(${(-rotation).toFixed(1)}deg)` }}
              >
                품절
              </span>
            )}
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={`${link.isSoldOut ? '품절 · ' : ''}${link.format ? link.format + ' · ' : ''}${link.storeName}`}
              className="pointer-events-auto flex items-center gap-1.5 bg-white text-black text-[10px] leading-none font-semibold px-2.5 py-1.5 select-none hover:brightness-95 transition"
              style={{ transform: `rotate(${rotation.toFixed(1)}deg)` }}
            >
              {link.storeFaviconUrl ? (
                <img
                  src={link.storeFaviconUrl}
                  alt=""
                  aria-hidden
                  className="w-3 h-3"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="w-3 h-3 bg-gray-300" />
              )}
              {link.format === 'CD' && <span className="text-[10px] leading-none">💿</span>}
              {link.format === 'Cassette' && <span className="text-[10px] leading-none">📼</span>}
              <span className="tabular-nums">{formatPrice(link.price, link.currency)}</span>
            </a>
          </div>
        );
      })}
      {showOverflow && overflow > 0 && (
        <div className="pointer-events-auto bg-black/80 text-white text-[10px] leading-none font-semibold px-2.5 py-1.5 rounded-sm shadow ring-1 ring-white/10">
          +{overflow}
        </div>
      )}
    </div>
  );
}
