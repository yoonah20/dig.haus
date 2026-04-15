import type { PriceTagLink } from '../types';

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  JPY: '¥',
  GBP: '£',
  EUR: '€',
  KRW: '₩',
};

function formatPrice(price: number | null, currency: string): React.ReactNode {
  if (price === null || price === undefined) return '-';
  const sym = CURRENCY_SYMBOL[currency] || '';
  if (currency === 'JPY' || currency === 'KRW') {
    return `${sym}${Math.round(price).toLocaleString()}`;
  }
  // Pull the decimal point closer to the digits on either side. Courier
  // leaves visually large gaps around "." otherwise.
  const [whole, frac] = price.toFixed(2).split('.');
  return (
    <>
      {sym}
      {whole}
      <span style={{ margin: '0 -1.5px' }}>.</span>
      {frac}
    </>
  );
}

interface PriceTagStackProps {
  links: PriceTagLink[];
  maxVisible?: number;
  showOverflow?: boolean;
}

// Semi-circle notches punched into the top/bottom mid-edges — like a hang
// tag pierced for a string. Two radial gradients composite with
// `intersect` so only the two small circles get cut out of the element.
const NOTCH_R = 2.6;
const NOTCH_MASK =
  `radial-gradient(circle ${NOTCH_R}px at 50% 0, transparent 98%, #000 100%),` +
  `radial-gradient(circle ${NOTCH_R}px at 50% 100%, transparent 98%, #000 100%)`;

// Top + bottom red rules, centered, spanning the middle 80% of the sticker
// width. Both rules sit 4px inside the top / bottom edges. Stroke is a
// hairline 0.75px so the rules read printed-on-paper thin instead of a
// solid band. Rendered as background linear-gradients layered over the
// white fill — the red ends at 90% of width, clear of the side notches at
// x=0 / x=100%, so the mask never clips them.
const RED = '#c8321f';

function buildRulesBg(color: string): string {
  return (
    `linear-gradient(to right, transparent 10%, ${color} 10%, ${color} 90%, transparent 90%) left 0 top 4px / 100% 0.75px no-repeat,` +
    `linear-gradient(to right, transparent 10%, ${color} 10%, ${color} 90%, transparent 90%) left 0 bottom 4px / 100% 0.75px no-repeat`
  );
}

// Visual theme per status. `status === null` = default white/red tag.
interface StickerTheme {
  fill: string;
  text: string;
  // Full layered overlay on top of `fill`; null = plain fill.
  overlay: string | null;
  strike: boolean;
  // `heavy` stickers bump font-weight and add a thin text-stroke for a
  // visually bolder read without changing font-size.
  heavy: boolean;
}
const THEME_DEFAULT: StickerTheme = {
  fill: '#fff',
  text: '#000',
  overlay: buildRulesBg(RED),
  strike: false,
  heavy: false,
};
const THEME_UPCOMING: StickerTheme = {
  fill: '#00ce01',
  text: '#3b4340',
  overlay: null,
  strike: false,
  heavy: false,
};
const THEME_SALE: StickerTheme = {
  fill: '#ffe41a',
  text: '#e54200',
  overlay: null,
  strike: false,
  heavy: true,
};
const THEME_SOLDOUT: StickerTheme = {
  fill: '#f8931f',
  text: '#3b4340',
  overlay: null,
  strike: true,
  heavy: false,
};

function themeForStatus(status: string | null | undefined): StickerTheme {
  switch (status) {
    case 'upcoming':
      return THEME_UPCOMING;
    case 'sale':
      return THEME_SALE;
    case 'soldout':
      return THEME_SOLDOUT;
    default:
      return THEME_DEFAULT;
  }
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
        const theme = themeForStatus(link.status);
        const statusTitle =
          link.status === 'upcoming'
            ? '발매예정 · '
            : link.status === 'sale'
              ? '세일 · '
              : link.status === 'soldout'
                ? '품절 · '
                : '';
        return (
          // The notch mask also clips box-shadows, so put the drop-shadow
          // on a parent filter — it follows the notched silhouette.
          <div
            key={link.id}
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
              title={`${statusTitle}${link.format ? link.format + ' · ' : ''}${link.storeName}`}
              className="flex items-center justify-center select-none hover:brightness-95 transition"
              style={{
                padding: '8px 6px 6px 6px',
                minWidth: '41px',
                fontFamily: "'Courier New', 'Courier', ui-monospace, monospace",
                fontSize: '11px',
                fontWeight: theme.heavy ? 900 : 700,
                letterSpacing: '0.03em',
                lineHeight: 1,
                color: theme.text,
                WebkitTextStroke: theme.heavy ? '0.5px currentColor' : undefined,
                background: theme.overlay
                  ? `${theme.overlay}, ${theme.fill}`
                  : theme.fill,
                maskImage: NOTCH_MASK,
                WebkitMaskImage: NOTCH_MASK,
                maskComposite: 'intersect',
                WebkitMaskComposite: 'source-in',
              }}
            >
              <span
                className="tabular-nums"
                style={
                  theme.strike
                    ? {
                        textDecoration: 'line-through',
                        textDecorationColor: theme.text,
                        textDecorationThickness: '1.25px',
                      }
                    : undefined
                }
              >
                {formatPrice(link.price, link.currency)}
              </span>
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
