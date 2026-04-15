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
  const amount =
    currency === 'JPY' || currency === 'KRW'
      ? Math.round(price).toLocaleString()
      : price.toFixed(2);
  // Symbol sits flush against the amount, e.g. "$2.89" / "₩3,200".
  return `${sym}${amount}`;
}

interface PriceTagStackProps {
  links: PriceTagLink[];
  maxVisible?: number;
  showOverflow?: boolean;
}

// Semi-circle notches on the left/right mid-edges. Two radial gradients are
// composited with `intersect` so only the two small circles get cut out of
// the element.
const NOTCH_R = 5;
const NOTCH_MASK =
  `radial-gradient(circle ${NOTCH_R}px at 0 50%, transparent 98%, #000 100%),` +
  `radial-gradient(circle ${NOTCH_R}px at 100% 50%, transparent 98%, #000 100%)`;

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
                className="pointer-events-auto relative z-10 -mb-2 mr-2 bg-[#c8321f] text-white text-[9px] leading-none font-bold tracking-wider px-1.5 py-1 select-none"
                style={{ transform: `rotate(${(-rotation).toFixed(1)}deg)` }}
              >
                품절
              </span>
            )}
            {/* The notch mask also clips box-shadows, so put the drop-shadow
                on a parent filter — it follows the notched silhouette. */}
            <div
              className="pointer-events-auto"
              style={{
                filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))',
                transform: `rotate(${rotation.toFixed(1)}deg)`,
              }}
            >
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`${link.isSoldOut ? '품절 · ' : ''}${link.format ? link.format + ' · ' : ''}${link.storeName}`}
                className="flex items-center justify-center bg-white text-black select-none hover:brightness-95 transition"
                style={{
                  padding: '7px 14px',
                  minWidth: '56px',
                  fontFamily: "'Courier New', 'Courier', ui-monospace, monospace",
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.03em',
                  lineHeight: 1,
                  maskImage: NOTCH_MASK,
                  WebkitMaskImage: NOTCH_MASK,
                  maskComposite: 'intersect',
                  WebkitMaskComposite: 'source-in',
                }}
              >
                <span className="tabular-nums">{formatPrice(link.price, link.currency)}</span>
              </a>
            </div>
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
