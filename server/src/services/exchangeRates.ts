import axios from 'axios';

const API_URL = 'https://open.er-api.com/v6/latest/USD';
const FRESH_MS = 6 * 60 * 60 * 1000;   // 6h — considered fresh
const STALE_MS = 24 * 60 * 60 * 1000;  // 24h — acceptable stale window while refreshing

interface RatesCache {
  rates: Record<string, number>; // 1 USD = rates[X] X
  fetchedAt: number;
}

const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  JPY: 150,
  KRW: 1380,
  EUR: 0.93,
  GBP: 0.78,
};

let cache: RatesCache | null = null;
let inflight: Promise<RatesCache> | null = null;

async function fetchFresh(): Promise<RatesCache> {
  const { data } = await axios.get(API_URL, { timeout: 5000 });
  if (data?.result !== 'success' || !data.rates) {
    throw new Error('unexpected exchange-rate response');
  }
  return {
    rates: data.rates as Record<string, number>,
    fetchedAt: Date.now(),
  };
}

function refreshAsync(): void {
  if (inflight) return;
  inflight = fetchFresh()
    .then((fresh) => {
      cache = fresh;
      console.log('[rates] refreshed from open.er-api.com');
      return fresh;
    })
    .catch((err) => {
      console.warn('[rates] fetch failed:', (err as Error).message);
      if (!cache) cache = { rates: { ...FALLBACK_RATES }, fetchedAt: Date.now() };
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
}

/**
 * Get current exchange rates. Stale-while-revalidate:
 *   - Fresh (<6h): return immediately
 *   - Stale (<24h): return stale AND kick off background refresh
 *   - Very stale / missing: block until fetch or fallback
 */
async function getRatesCache(): Promise<RatesCache> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < FRESH_MS) return cache;
  if (cache && now - cache.fetchedAt < STALE_MS) {
    refreshAsync();
    return cache;
  }
  if (!inflight) refreshAsync();
  return inflight!;
}

export async function getRates(): Promise<Record<string, number>> {
  const { rates } = await getRatesCache();
  return rates;
}

function toKrw(price: number, fromCurrency: string, rates: Record<string, number>): number | null {
  if (price == null || !isFinite(price)) return null;
  const from = (fromCurrency || '').toUpperCase();
  if (from === 'KRW') return Math.round(price);
  const fromRate = rates[from];
  const krwRate = rates['KRW'];
  if (!fromRate || !krwRate) return null;
  const usd = price / fromRate;
  return Math.round(usd * krwRate);
}

function toUsd(price: number, fromCurrency: string, rates: Record<string, number>): number | null {
  if (price == null || !isFinite(price)) return null;
  const from = (fromCurrency || '').toUpperCase();
  if (from === 'USD') return price;
  const fromRate = rates[from];
  if (!fromRate) return null;
  return price / fromRate;
}

/** Sync converters — preferred when batching multiple conversions. */
export const convertToKrwSync = toKrw;
export const convertToUsdSync = toUsd;

/** Convenience one-off async wrappers (back-compat). */
export async function convertToKrw(price: number, fromCurrency: string): Promise<number | null> {
  const rates = await getRates();
  return toKrw(price, fromCurrency, rates);
}

export async function convertToUsd(price: number, fromCurrency: string): Promise<number | null> {
  const rates = await getRates();
  return toUsd(price, fromCurrency, rates);
}

/** Warm the cache at server startup so the first request doesn't block. */
export function warmExchangeRates(): void {
  getRatesCache().catch(() => {});
}
