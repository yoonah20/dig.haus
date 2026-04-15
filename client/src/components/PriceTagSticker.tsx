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
const NOTCH_R = 3.5;
const NOTCH_MASK =
  `radial-gradient(circle ${NOTCH_R}px at 0 50%, transparent 98%, #000 100%),` +
  `radial-gradient(circle ${NOTCH_R}px at 100% 50%, transparent 98%, #000 100%)`;

// Top + bottom red rules, centered, spanning the middle 80% of the sticker
// width. Both rules sit 4px inside the top / bottom edges. Stroke is a
// hairline 0.75px so the rules read printed-on-paper thin instead of a
// solid band. Rendered as background linear-gradients layered over the
// white fill — the red ends at 90% of width, clear of the side notches at
// x=0 / x=100%, so the mask never clips them.
const RED = '#c8321f';
const RULES_BG =
  `linear-gradient(to right, transparent 10%, ${RED} 10%, ${RED} 90%, transparent 90%) left 0 top 4px / 100% 0.75px no-repeat,` +
  `linear-gradient(to right, transparent 10%, ${RED} 10%, ${RED} 90%, transparent 90%) left 0 bottom 4px / 100% 0.75px no-repeat`;

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
                className="flex items-center justify-center text-black select-none hover:brightness-95 transition"
                style={{
                  // Asymmetric vertical padding (8/6 instead of 7/7) nudges
                  // the price digits 1px lower so they sit a touch below
                  // the geometric centre of the sticker — reads more like
                  // a hand-stamped tag.
                  padding: '8px 10px 6px 10px',
                  minWidth: '52px',
                  // Classic printed-serif stack. Didot / Bodoni land on
                  // macOS first (high-contrast, elegant, very "printed"),
                  // Georgia handles Windows/Linux without hairline loss
                  // at small sizes, falling through to generic serif.
                  fontFamily:
                    "'Didot', 'Bodoni 72', 'Playfair Display', Georgia, 'Times New Roman', serif",
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                  lineHeight: 1,
                  background: `${RULES_BG}, #fff`,
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
