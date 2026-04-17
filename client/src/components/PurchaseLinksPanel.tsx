import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  usePurchaseLinks,
  useCreatePurchaseLink,
  useUpdatePurchaseLink,
  useDeletePurchaseLink,
  useReportPurchaseLink,
  type PurchaseLinkPayload,
  type PurchaseLinkReportReason,
} from '../hooks/usePurchaseLinks';
import type { PurchaseLink, FormatPrice, PurchaseLinkStatus } from '../types';
import { formatRelativeKo } from '../utils/relativeTime';

const CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'KRW'] as const;
type Currency = (typeof CURRENCIES)[number];

const FORMATS = ['Vinyl', 'CD', 'Cassette'] as const;
type Format = (typeof FORMATS)[number];

const FORMAT_EMOJI: Record<Format, string> = {
  Vinyl: '🖤',
  CD: '💿',
  Cassette: '📼',
};

const STATUSES: ReadonlyArray<{ value: PurchaseLinkStatus; label: string; emoji: string }> = [
  { value: 'upcoming', label: '발매예정', emoji: '🔜' },
  { value: 'sale', label: '세일', emoji: '🏷️' },
  { value: 'soldout', label: '품절', emoji: '🚫' },
];

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  JPY: '¥',
  GBP: '£',
  EUR: '€',
  KRW: '₩',
};

const REPORT_REASONS: ReadonlyArray<{
  value: PurchaseLinkReportReason;
  label: string;
}> = [
  { value: 'soldout', label: '품절 됨' },
  { value: 'price', label: '가격 다름' },
  { value: 'expired', label: '링크 만료' },
];

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

const STATUS_LABEL: Record<PurchaseLinkStatus, string> = {
  upcoming: '발매예정',
  sale: '세일',
  soldout: '품절',
};

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

// Small overlay button for the three card actions (report/edit/delete).
// Styles kept uniform so the overhang reads as one group, not three
// different control families.
function OverlayButton({
  onClick,
  title,
  children,
  variant = 'neutral',
}: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  children: React.ReactNode;
  variant?: 'neutral' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`w-6 h-6 rounded-full border flex items-center justify-center text-[13px] leading-none shadow-[0_2px_4px_rgba(0,0,0,0.4)] cursor-pointer transition-colors ${
        variant === 'danger'
          ? 'bg-[#1a1a1a] border-white/10 text-red-500 hover:text-red-300 hover:border-red-500/40'
          : 'bg-[#1a1a1a] border-white/10 text-gray-300 hover:text-[#e8a020] hover:border-[#e8a020]/50'
      }`}
    >
      {children}
    </button>
  );
}

// Small popover anchored to the link card. Closes on outside click,
// Escape, or successful submit.
function ReportPopover({
  linkId,
  onClose,
}: {
  linkId: number;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<PurchaseLinkReportReason>('soldout');
  const [err, setErr] = useState<string | null>(null);
  const report = useReportPurchaseLink();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    // pointerdown would fire BEFORE the trigger's own onClick completed
    // synchronously, so the popover would close immediately after
    // opening. `click` on the next event loop tick is safe.
    document.addEventListener('click', onDocClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onDocClick);
    };
  }, [onClose]);

  const submit = async () => {
    setErr(null);
    try {
      await report.mutateAsync({ linkId, reason });
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? '신고에 실패했습니다.';
      setErr(msg);
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="구매처 신고"
      className="absolute top-full right-0 mt-2 z-30 w-52 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl p-2.5 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-gray-400 text-[11px] uppercase tracking-wider mb-1.5">
        신고 사유
      </div>
      <div className="flex flex-col gap-0.5">
        {REPORT_REASONS.map((r) => (
          <label
            key={r.value}
            className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/5 cursor-pointer text-gray-200"
          >
            <input
              type="radio"
              name={`report-${linkId}`}
              value={r.value}
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
              className="accent-[#e8a020]"
            />
            {r.label}
          </label>
        ))}
      </div>
      {err && (
        <div className="text-red-400 text-[11px] mt-1.5 px-1">{err}</div>
      )}
      <div className="flex items-center justify-end gap-1.5 mt-2">
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 px-2 py-1 cursor-pointer"
        >
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={report.isPending}
          className="bg-[#e8a020] text-black font-semibold rounded-md px-2.5 py-1 hover:bg-[#f3b438] disabled:opacity-50 cursor-pointer"
        >
          {report.isPending ? '…' : '신고'}
        </button>
      </div>
    </div>
  );
}

function LinkButton({
  link,
  canReport,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  link: PurchaseLink;
  canReport: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const showKrwConversion =
    link.priceKrw != null && link.currency && link.currency !== 'KRW';
  const hasAnyOverlay = canReport || canEdit || canDelete;
  const registeredLabel = formatRelativeKo(link.createdAt);

  return (
    <div className="group relative flex items-center gap-3 bg-[#1a1a1a] hover:bg-[#252525] rounded-xl px-4 py-3 transition-colors">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 flex-1 min-w-0"
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
        <div className="min-w-0">
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
              link.status ? STATUS_LABEL[link.status] : null,
              showKrwConversion ? formatKrw(link.priceKrw) : null,
              link.note,
              // Relative time sits at the end of the second line — a
              // quiet "this was added 3 days ago" cue so readers can
              // weigh freshness without a date column cluttering the
              // card.
              registeredLabel || null,
            ]}
          />
        </div>
      </a>

      {/* Overlay — three pill buttons overhanging the card's top-right
          corner, hover-revealed. Pulled out of the card body via
          -top-3 so adding/removing these doesn't change the card's
          layout height. */}
      {hasAnyOverlay && (
        <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {canReport && (
            <OverlayButton
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setReporting((v) => !v);
              }}
              title="신고"
            >
              ⚑
            </OverlayButton>
          )}
          {canEdit && (
            <OverlayButton
              onClick={(e) => {
                e.preventDefault();
                onEdit();
              }}
              title="수정"
            >
              ✎
            </OverlayButton>
          )}
          {canDelete && (
            <OverlayButton
              variant="danger"
              onClick={(e) => {
                e.preventDefault();
                if (confirm('이 구매처 링크를 삭제할까요?')) onDelete();
              }}
              title="삭제"
            >
              ×
            </OverlayButton>
          )}
        </div>
      )}

      {reporting && (
        <ReportPopover linkId={link.id} onClose={() => setReporting(false)} />
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

// Dotted-outline sibling card that sits between user links and the
// Discogs price card. Neutral grey tone instead of amber so it reads
// as a companion to the existing link cards rather than a CTA peeking
// out — the user explicitly wanted this to blend into the row.
function AddPurchaseLinkCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 bg-transparent hover:bg-[#1a1a1a] border border-dashed border-white/15 hover:border-white/30 rounded-xl px-4 py-3 transition-colors cursor-pointer"
    >
      <span className="w-5 h-5 rounded-sm border border-dashed border-white/25 group-hover:border-white/50 flex items-center justify-center text-gray-400 group-hover:text-gray-200 text-sm flex-shrink-0">
        +
      </span>
      <span className="text-sm text-gray-400 group-hover:text-gray-200 font-medium">
        구매처 추가
      </span>
    </button>
  );
}

function SegButton({
  active,
  onClick,
  children,
  title,
  grow,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  /** When true, the button stretches to fill its flex parent. Used
   *  for the format picker where Vinyl/CD/Cassette split the row
   *  evenly. Off by default so the currency symbols + status pills
   *  size to their content instead of eating equal slabs of the
   *  row. */
  grow?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${grow ? 'flex-1 flex items-center justify-center' : ''} px-2.5 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
        active
          ? 'bg-[#e8a020] text-black'
          : 'text-gray-400 hover:text-white hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

function LinkForm({
  initial,
  submitting,
  errorMessage,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: PurchaseLink;
  submitting: boolean;
  /** Pre-formatted server error (409 cap, invalid URL, etc.) — null
   *  when nothing has gone wrong yet. */
  errorMessage: string | null;
  submitLabel: string;
  onSubmit: (payload: PurchaseLinkPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [priceInput, setPriceInput] = useState(
    initial?.price != null ? String(initial.price) : ''
  );
  const [currency, setCurrency] = useState<Currency>(
    (initial && CURRENCIES.includes(initial.currency as Currency))
      ? (initial.currency as Currency)
      : 'USD'
  );
  const [format, setFormat] = useState<Format | null>(
    (initial?.format && (FORMATS as readonly string[]).includes(initial.format))
      ? (initial.format as Format)
      : 'Vinyl'
  );
  const [note, setNote] = useState(initial?.note ?? '');
  const [status, setStatus] = useState<PurchaseLinkStatus | null>(initial?.status ?? null);

  const canSubmit = url.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const priceNum = priceInput.trim() === '' ? null : parseFloat(priceInput);
    await onSubmit({
      url: url.trim(),
      price: priceNum !== null && isFinite(priceNum) ? priceNum : null,
      currency,
      format,
      note: note.trim() || null,
      status,
    });
  };

  return (
    <div className="space-y-1.5">
      <form
        onSubmit={handleSubmit}
        className="bg-[#141414] rounded-xl border border-white/10 p-4 max-w-xl space-y-3.5"
      >
        {/* URL — full width, labelled, because it's the one required
            field and people paste long URLs into it. */}
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
            구매처 URL
          </span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="w-full bg-black/30 text-white text-sm rounded-md px-3 h-9 outline-none border border-white/10 focus:border-[#e8a020]/60"
            required
          />
        </label>

        {/* Price first so the URL → price tab order matches how the
            link is actually being described ("this costs $25"),
            followed by the pickers that don't take keyboard input. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <span className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
              가격 (선택)
            </span>
            <div className="flex items-stretch h-9 bg-black/30 rounded-md overflow-hidden border border-white/10 focus-within:border-[#e8a020]/60 divide-x divide-white/10">
              <input
                type="number"
                step="0.01"
                min="0"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="0.00"
                className="flex-1 min-w-0 bg-transparent text-white text-sm px-2 outline-none tabular-nums"
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
          </div>

          <div>
            <span className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
              포맷
            </span>
            <div className="flex items-stretch h-9 bg-black/30 rounded-md overflow-hidden border border-white/10 divide-x divide-white/10">
              {/* grow + equal basis makes the three cells share width
                  evenly so "Cassette" doesn't stretch past "Vinyl" /
                  "CD". Currency + status rows leave grow off so
                  those pills size to content. */}
              {FORMATS.map((f) => (
                <SegButton key={f} grow active={format === f} onClick={() => setFormat(f)}>
                  <span className="mr-1">{FORMAT_EMOJI[f]}</span>
                  {f}
                </SegButton>
              ))}
            </div>
          </div>
        </div>

        {/* Status + note on one row. Status pills collapse to a
            compact group; note takes the rest of the row so long
            descriptions have room without stealing focus. */}
        <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] gap-3.5">
          <div>
            <span className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
              상태 (선택)
            </span>
            <div className="flex items-stretch h-9 bg-black/30 rounded-md overflow-hidden border border-white/10 divide-x divide-white/10">
              {STATUSES.map((s) => (
                <SegButton
                  key={s.value}
                  active={status === s.value}
                  onClick={() => setStatus(status === s.value ? null : s.value)}
                >
                  <span className="mr-1">{s.emoji}</span>
                  {s.label}
                </SegButton>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1">
              메모 (선택)
            </span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              placeholder="black, 180g, red/blue split..."
              className="w-full bg-black/30 text-white text-sm rounded-md px-3 h-9 outline-none border border-white/10 focus:border-[#e8a020]/60"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-200 text-sm h-9 px-3 cursor-pointer"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="bg-[#e8a020] text-black font-semibold text-sm rounded-md px-4 h-9 hover:bg-[#f3b438] disabled:opacity-50 cursor-pointer"
          >
            {submitting ? '...' : submitLabel}
          </button>
        </div>
      </form>
      {errorMessage && (
        <div className="text-red-400 text-xs pl-2">{errorMessage}</div>
      )}
    </div>
  );
}

function AddLinkForm({ albumId, onDone }: { albumId: string; onDone: () => void }) {
  const create = useCreatePurchaseLink(albumId);
  const [err, setErr] = useState<string | null>(null);
  return (
    <LinkForm
      submitting={create.isPending}
      errorMessage={err}
      submitLabel="저장"
      onSubmit={async (payload) => {
        setErr(null);
        try {
          await create.mutateAsync(payload);
          onDone();
        } catch (e: any) {
          const msg = e?.response?.data?.error ?? '저장 실패. URL을 확인해 주세요.';
          setErr(msg);
        }
      }}
      onCancel={onDone}
    />
  );
}

function EditLinkForm({
  albumId,
  link,
  onDone,
}: {
  albumId: string;
  link: PurchaseLink;
  onDone: () => void;
}) {
  const update = useUpdatePurchaseLink(albumId);
  const [err, setErr] = useState<string | null>(null);
  return (
    <LinkForm
      initial={link}
      submitting={update.isPending}
      errorMessage={err}
      submitLabel="수정"
      onSubmit={async (payload) => {
        setErr(null);
        try {
          await update.mutateAsync({ id: link.id, ...payload });
          onDone();
        } catch (e: any) {
          const msg = e?.response?.data?.error ?? '저장 실패. URL을 확인해 주세요.';
          setErr(msg);
        }
      }}
      onCancel={onDone}
    />
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
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const sortedLinks = [...(data?.purchaseLinks || [])].sort(
    (a, b) =>
      (a.priceKrw ?? Number.POSITIVE_INFINITY) -
      (b.priceKrw ?? Number.POSITIVE_INFINITY)
  );

  const discogsCards = discogsFormats
    .filter((f) => f.copiesForSale > 0 && f.lowestPrice !== null)
    .sort(
      (a, b) =>
        (DISCOGS_FORMAT_ORDER[a.format] ?? 99) -
        (DISCOGS_FORMAT_ORDER[b.format] ?? 99)
    );

  const hasAnyCard =
    sortedLinks.length > 0 || discogsCards.length > 0 || !!user || adding;

  return (
    <div className="space-y-3">
      {adding && (
        <AddLinkForm albumId={albumId} onDone={() => setAdding(false)} />
      )}

      {hasAnyCard && (
        <div className="flex flex-wrap gap-3">
          {sortedLinks.map((link) => {
            const isOwner = !!user && user.id === link.userId;
            const canEdit = !!user && (isOwner || user.isAdmin);
            const canDelete = !!user && (isOwner || user.isAdmin);
            // Non-owners can flag a link; owners and admins don't need
            // the button (owners can just delete, admins handle from
            // the dashboard).
            const canReport = !!user && !isOwner && !user.isAdmin;
            if (editingId === link.id) {
              return (
                <div key={link.id} className="w-full">
                  <EditLinkForm
                    albumId={albumId}
                    link={link}
                    onDone={() => setEditingId(null)}
                  />
                </div>
              );
            }
            return (
              <LinkButton
                key={link.id}
                link={link}
                canReport={canReport}
                canEdit={canEdit}
                canDelete={canDelete}
                onEdit={() => setEditingId(link.id)}
                onDelete={() => del.mutate(link.id)}
              />
            );
          })}

          {discogsCards.map((fmt) => (
            <DiscogsFormatCard key={fmt.format} fmt={fmt} />
          ))}

          {/* Dotted add-card anchors the end of the row so it reads as
              an action, not a divider between user links and Discogs
              prices. Any logged-in user can trigger it; the server
              caps at 3 per user per album and surfaces the 409 as a
              form error if they overshoot. */}
          {!!user && !adding && (
            <AddPurchaseLinkCard onClick={() => setAdding(true)} />
          )}
        </div>
      )}
    </div>
  );
}
