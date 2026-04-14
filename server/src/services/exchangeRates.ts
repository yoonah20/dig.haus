import axios from 'axios';

const API_URL = 'https://open.er-api.com/v6/latest/USD';
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface RatesCache {
  rates: Record<string, number>; // relative to USD: 1 USD = rates[X] X
  fetchedAt: number;
}

// Fallback static rates — used only if the API is unreachable on first load.
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

async function getRatesCache(): Promise<RatesCache> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;

  if (!inflight) {
    inflight = fetchFresh()
      .then((fresh) => {
        cache = fresh;
        console.log('[rates] refreshed from open.er-api.com');
        return fresh;
      })
      .catch((err) => {
        console.warn('[rates] fetch failed, using fallback:', (err as Error).message);
        // Only populate the fallback if we have no cache at all — never overwrite
        // a previously-successful response with the static numbers.
        if (!cache) cache = { rates: { ...FALLBACK_RATES }, fetchedAt: Date.now() };
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Convert a price from `fromCurrency` into KRW. Returns null if either the
 * source or target currency is missing from the rate table.
 */
export async function convertToKrw(price: number, fromCurrency: string): Promise<number | null> {
  if (price == null || !isFinite(price)) return null;
  const from = (fromCurrency || '').toUpperCase();
  if (from === 'KRW') return Math.round(price);

  const { rates } = await getRatesCache();
  const fromRate = rates[from];
  const krwRate = rates['KRW'];
  if (!fromRate || !krwRate) return null;

  const usd = price / fromRate;
  return Math.round(usd * krwRate);
}

/**
 * Convert a price from `fromCurrency` into USD. Returns null if the source
 * currency is missing from the rate table.
 */
export async function convertToUsd(price: number, fromCurrency: string): Promise<number | null> {
  if (price == null || !isFinite(price)) return null;
  const from = (fromCurrency || '').toUpperCase();
  if (from === 'USD') return price;

  const { rates } = await getRatesCache();
  const fromRate = rates[from];
  if (!fromRate) return null;
  return price / fromRate;
}

/**
 * Warm the cache at server startup so the first request doesn't block.
 */
export function warmExchangeRates(): void {
  getRatesCache().catch(() => {});
}
