import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  usePurchaseLinks,
  useCreatePurchaseLink,
  useDeletePurchaseLink,
} from '../hooks/usePurchaseLinks';
import type { PurchaseLink, FormatPrice } from '../types';
import LoginRequiredTooltip from './LoginRequiredTooltip';

const CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'KRW'] as const;
type Currency = (typeof CURRENCIES)[number];

const FORMATS = ['Vinyl', 'CD', 'Cassette'] as const;
type Format = (typeof FORMATS)[number];

const FORMAT_EMOJI: Record<Format, string> = {
  Vinyl: '🖤',
  CD: '💿',
  Cassette: '📼',
};

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  JPY: '¥',
  GBP: '£',
  EUR: '€',
  KRW: '₩',
};

function formatPrice(price: number | null, currency: string): string {
  if (price === null || price === undefined) return '';
  const sym = CURRENCY_SYMBOL[currency] || '';
  if (currency === 'JPY' || currency === 'KRW') {
    return `${sym}${Math.round(price).toLocaleString()}`;
  }
  return `${sym}${price.toFixed(2)}`;
}

function formatKrw(price: number | null): string {
  if (price === null || price === undefined) return '';
  return `₩${Math.round(price).toLocaleString()}`;
}

function Subline({ parts }: { parts: Array<string | null | undefined> }) {
  const visible = parts.filter((p): p is string => !!p && p.length > 0);
  if (visible.length === 0) return null;
  return (
    <div className="mt-0.5 text-xs text-gray-500 truncate">
      {visible.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="text-gray-600 mx-1.5">·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}

function LinkButton({
  link,
  canDelete,
  onDelete,
}: {
  link: PurchaseLink;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const showKrwConversion =
    link.priceKrw != null && link.currency && link.currency !== 'KRW';

  return (
    <div className="group flex items-center gap-3 bg-[#1a1a1a] hover:bg-[#252525] rounded-xl px-4 py-3 transition-colors">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3"
      >
        {link.storeFaviconUrl ? (
          <img
            src={link.storeFaviconUrl}
            alt=""
            aria-hidden
            className="w-5 h-5 rounded-sm flex-shrink-0"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="w-5 h-5 rounded-sm bg-white/10 flex-shrink-0" />
        )}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-white text-sm font-medium group-hover:text-[#e8a020] transition-colors">
              {link.storeName}
            </span>
            {link.price !== null && (
              <span className="text-[#e8a020] text-sm font-bold tabular-nums">
                {formatPrice(link.price, link.currency)}
              </span>
            )}
          </div>
          <Subline
            parts={[
              link.format,
              showKrwConversion ? formatKrw(link.priceKrw) : null,
              link.note,
            ]}
          />
        </div>
      </a>
      {canDelete && (
        <button
          onClick={(e) => {
            e.preventDefault();
            if (confirm('이 구매처 링크를 삭제할까요?')) onDelete();
          }}
          className="text-red-700 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer px-2"
          title="삭제"
        >
          ×
        </button>
      )}
    </div>
  );
}

const DISCOGS_FAVICON = 'https://www.google.com/s2/favicons?domain=discogs.com&sz=64';

function DiscogsFormatCard({ fmt }: { fmt: FormatPrice }) {
  return (
    <a
      href={fmt.sellUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 bg-[#161b2a] hover:bg-[#1d2336] rounded-xl pl-4 pr-4 py-3 transition-colors min-w-0"
    >
      <img
        src={DISCOGS_FAVICON}
        alt=""
        aria-hidden
        className="w-5 h-5 rounded-sm flex-shrink-0"
        referrerPolicy="no-referrer"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-medium truncate group-hover:text-[#e8a020] transition-colors">
            Discogs
          </span>
          {fmt.lowestPrice !== null && (
            <span className="text-[#e8a020] text-sm font-bold tabular-nums">
              ${fmt.lowestPrice.toFixed(2)}
            </span>
          )}
          <span className="text-gray-500 text-xs tabular-nums">
            ({fmt.copiesForSale}개{fmt.copiesForSale > 1 ? ' 중 최저가' : ''})
          </span>
        </div>
        <Subline
          parts={[
            fmt.format,
            fmt.lowestPriceKrw != null ? formatKrw(fmt.lowestPriceKrw) : null,
          ]}
        />
      </div>
    </a>
  );
}

function SegButton({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
        active
          ? 'bg-[#e8a020] text-black'
          : 'text-gray-400 hover:text-white hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

function AddLinkForm({ albumId, onDone }: { albumId: string; onDone: () => void }) {
  const create = useCreatePurchaseLink(albumId);
  const [url, setUrl] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [format, setFormat] = useState<Format | null>('Vinyl');
  const [note, setNote] = useState('');
  const [isSoldOut, setIsSoldOut] = useState(false);

  const canSubmit = url.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const priceNum = priceInput.trim() === '' ? null : parseFloat(priceInput);
    try {
      await create.mutateAsync({
        url: url.trim(),
        price: priceNum !== null && isFinite(priceNum) ? priceNum : null,
        currency,
        format,
        note: note.trim() || null,
        isSoldOut,
      });
      setUrl('');
      setPriceInput('');
      setCurrency('USD');
      setFormat('Vinyl');
      setNote('');
      setIsSoldOut(false);
      onDone();
    } catch {}
  };

  return (
    <div className="space-y-1.5">
      <form
        onSubmit={handleSubmit}
        className="bg-[#141414] rounded-lg p-2 flex items-stretch gap-2 flex-wrap"
      >
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
          className="bg-black/30 text-white text-sm rounded-md px-3 h-9 outline-none border border-white/10 focus:border-[#e8a020]/60 flex-[2] min-w-[180px]"
          required
        />

        {/* Price + currency: one attached pill group */}
        <div className="flex items-stretch h-9 bg-black/30 rounded-md overflow-hidden border border-white/10 focus-within:border-[#e8a020]/60 divide-x divide-white/10">
          <input
            type="number"
            step="0.01"
            min="0"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="0.00"
            className="bg-transparent text-white text-sm px-2 outline-none w-20 tabular-nums"
          />
          {CURRENCIES.map((c) => (
            <SegButton
              key={c}
              active={currency === c}
              onClick={() => setCurrency(c)}
              title={c}
            >
              {CURRENCY_SYMBOL[c]}
            </SegButton>
          ))}
        </div>

        {/* Format: attached pill group */}
        <div className="flex items-stretch h-9 bg-black/30 rounded-md overflow-hidden border border-white/10 divide-x divide-white/10">
          {FORMATS.map((f) => (
            <SegButton key={f} active={format === f} onClick={() => setFormat(f)}>
              <span className="mr-1">{FORMAT_EMOJI[f]}</span>
              {f}
            </SegButton>
          ))}
        </div>

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          placeholder="black, 180g, red/blue split..."
          className="bg-black/30 text-white text-sm rounded-md px-3 h-9 outline-none border border-white/10 focus:border-[#e8a020]/60 flex-[2] min-w-[140px]"
        />

        <label className="flex items-center gap-1.5 h-9 px-2.5 rounded-md bg-black/30 border border-white/10 text-xs text-gray-300 select-none cursor-pointer hover:border-[#e8a020]/60">
          <input
            type="checkbox"
            checked={isSoldOut}
            onChange={(e) => setIsSoldOut(e.target.checked)}
            className="accent-[#e8a020] cursor-pointer"
          />
          현재 품절
        </label>

        <button
          type="submit"
          disabled={!canSubmit || create.isPending}
          className="bg-[#e8a020] text-black font-semibold text-sm rounded-md px-3 h-9 hover:bg-[#f3b438] disabled:opacity-50 cursor-pointer"
        >
          {create.isPending ? '...' : '저장'}
        </button>

        <button
          type="button"
          onClick={onDone}
          className="text-gray-500 hover:text-gray-300 text-sm h-9 px-2 cursor-pointer"
          title="취소"
        >
          ×
        </button>
      </form>
      {create.isError && (
        <div className="text-red-400 text-xs pl-2">저장 실패. URL을 확인해 주세요.</div>
      )}
    </div>
  );
}

const DISCOGS_FORMAT_ORDER: Record<string, number> = { Vinyl: 0, CD: 1, Cassette: 2 };

export default function PurchaseLinksPanel({
  albumId,
  discogsFormats = [],
}: {
  albumId: string;
  discogsFormats?: FormatPrice[];
}) {
  const { user } = useAuth();
  const { data } = usePurchaseLinks(albumId);
  const del = useDeletePurchaseLink(albumId);
  const [open, setOpen] = useState(false);

  // User-registered links: cheapest first by KRW-converted price.
  const sortedLinks = [...(data?.purchaseLinks || [])].sort(
    (a, b) =>
      (a.priceKrw ?? Number.POSITIVE_INFINITY) -
      (b.priceKrw ?? Number.POSITIVE_INFINITY)
  );

  // Discogs cards always at the end, in fixed format order.
  const discogsCards = discogsFormats
    .filter((f) => f.copiesForSale > 0 && f.lowestPrice !== null)
    .sort(
      (a, b) =>
        (DISCOGS_FORMAT_ORDER[a.format] ?? 99) -
        (DISCOGS_FORMAT_ORDER[b.format] ?? 99)
    );

  const hasAnyCard = sortedLinks.length > 0 || discogsCards.length > 0;

  return (
    <div className="space-y-3">
      {hasAnyCard && (
        <div className="flex flex-wrap gap-3">
          {sortedLinks.map((link) => (
            <LinkButton
              key={link.id}
              link={link}
              canDelete={!!user && (user.id === link.userId || user.isAdmin)}
              onDelete={() => del.mutate(link.id)}
            />
          ))}
          {discogsCards.map((fmt) => (
            <DiscogsFormatCard key={fmt.format} fmt={fmt} />
          ))}
        </div>
      )}

      {user?.isAdmin && (
        open ? (
          <AddLinkForm albumId={albumId} onDone={() => setOpen(false)} />
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="text-sm text-[#e8a020]/80 hover:text-[#e8a020] cursor-pointer"
          >
            + 구매처 추가
          </button>
        )
      )}
    </div>
  );
}
