// Live online prices for products that are NOT in our catalog.
// Uses Serper.dev's Google Shopping API (free key: serper.dev, 2,500 searches, no card).
import { config } from './config.js';
import { addLog } from './state.js';

export type Offer = { title: string; source: string; price: number; link: string };

export type WebPrices = {
  query: string;
  offers: Offer[];
  online_low: number;
  online_median: number;
  online_high: number;
  /** Rough fair street-price band, derived from online prices (an estimate, not data). */
  fair_low: number;
  fair_high: number;
};

const round10 = (n: number) => Math.round(n / 10) * 10;

/** "₹1,299.00" → 1299 */
function parseRupees(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return null;
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export const webSearchEnabled = () => Boolean(config.serperKey);

// Shopping results for "iPhone 13" are full of cases and screen guards; drop those
// unless the user is actually asking about an accessory.
const ACCESSORY = /\b(case|cover|screen ?guard|tempered|protector|skin|pouch|strap|cable|stand|holder|sticker|refill|spare|replacement|parts?)\b/i;
const STOP = new Set(['the', 'a', 'an', 'for', 'with', 'and', 'of', 'in', 'price', 'online', 'new', 'buy', 'india']);

function isRelevant(title: string, query: string) {
  const t = title.toLowerCase();
  if (ACCESSORY.test(t) && !ACCESSORY.test(query)) return false;
  // Most of the important query words (model names, numbers) should appear in the title.
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length) return true;
  const hits = words.filter((w) => t.includes(w)).length;
  const numbersOk = words.filter((w) => /\d/.test(w)).every((w) => t.includes(w)); // "13" must match "13", not "15"
  return numbersOk && hits / words.length >= 0.5;
}

/**
 * branded=false (e.g. "black T-shirt"): results mix ₹300 basics with ₹7,000 designer pieces,
 * so the "typical" price is taken from the lower-middle of the listings, not the median.
 */
export async function searchWebPrices(query: string, branded = true): Promise<WebPrices | null> {
  if (!config.serperKey || !query.trim()) return null;
  const started = Date.now();
  try {
    const res = await fetch('https://google.serper.dev/shopping', {
      method: 'POST',
      headers: { 'X-API-KEY': config.serperKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'in', hl: 'en', location: 'India' }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      addLog('error', `Web price search failed (${res.status})`);
      return null;
    }
    const data = (await res.json()) as { shopping?: any[] };
    const offers: Offer[] = (data.shopping ?? [])
      .map((s) => ({ title: String(s.title ?? ''), source: String(s.source ?? ''), price: parseRupees(s.price) ?? 0, link: String(s.link ?? '') }))
      .filter((o) => o.price > 0)
      .filter((o) => isRelevant(o.title, query))
      .slice(0, 12);
    if (!offers.length) return null;

    // Ignore extreme outliers (accessories, bundles) by trimming the cheapest/most expensive 20%.
    const prices = offers.map((o) => o.price).sort((a, b) => a - b);
    const trim = Math.floor(prices.length * 0.2);
    const core = prices.length >= 5 ? prices.slice(trim, prices.length - trim) : prices;
    const typical = branded ? 0.5 : 0.3;
    const median = core[Math.floor((core.length - 1) * typical)];
    const low = core[0];
    // For generic items, ignore the expensive tail when showing the range.
    const high = branded ? core[core.length - 1] : Math.min(core[core.length - 1], median * 2);

    console.log(`[web] "${query}" ${offers.length} offers in ${Date.now() - started}ms`);
    return {
      query,
      offers: offers.filter((o) => o.price >= low && o.price <= high).slice(0, 5),
      online_low: low,
      online_median: median,
      online_high: high,
      fair_low: round10(low * 0.85),
      // Top of the fair range = the typical online price (rounded up): paying more than online is never "fair".
      fair_high: Math.ceil(median / 10) * 10,
    };
  } catch (err) {
    addLog('error', `Web price search error: ${(err as Error).message}`);
    return null;
  }
}
