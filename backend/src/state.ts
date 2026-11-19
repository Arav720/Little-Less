// In-memory app state. Good enough for a one-day demo (resets when the server restarts).
// The frontend polls GET /api/state every second to show the scorecard, cart and log.

export type Scan = {
  item: string;
  brand: string | null;
  category: string;
  color: string | null;
  visible_text: string | null;
  quality_notes: string | null;
  authenticity_flags: string | null;
  search_query: string;
  at: number;
};

export type Verdict = {
  item: string;
  asked_price: number | null;
  fair_low: number | null;
  fair_high: number | null;
  online_price: number | null;
  price_verdict: 'fair' | 'slightly_high' | 'overpriced' | 'good_deal' | 'fixed_mrp' | 'unknown';
  counter_offer: number | null;
  fit_verdict: 'great_fit' | 'ok_fit' | 'poor_fit' | 'unknown';
  fit_note: string;
  quality_note: string;
  recommendation: string;
  at: number;
};

export type CartItem = { product_id: string; name: string; price: number; qty: number; source: 'online' | 'shop' };

export type Order = {
  order_id: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  coupon: string | null;
  placed_at: number;
  eta: string;
  status: string;
  return_requested?: string;
};

export type LogEntry = { id: number; at: number; kind: 'user' | 'agent' | 'tool' | 'system' | 'error'; text: string };

export const state = {
  latestFrame: null as null | { dataUrl: string; at: number },
  lastScan: null as Scan | null,
  verdict: null as Verdict | null,
  cart: [] as CartItem[],
  coupon: null as null | { code: string; percent: number },
  orders: [] as Order[],
  log: [] as LogEntry[],
  agent: null as null | { agentId: string; channel: string },
  textHistory: [] as { role: 'user' | 'assistant'; content: string }[],
};

let logId = 0;
export function addLog(kind: LogEntry['kind'], text: string) {
  state.log.push({ id: ++logId, at: Date.now(), kind, text });
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  console.log(`[${kind}] ${text}`);
}

export function resetShopping() {
  state.lastScan = null;
  state.verdict = null;
  state.cart = [];
  state.coupon = null;
  state.orders = [];
  state.log = [];
  state.textHistory = [];
}

/** What the browser needs to draw the UI (no camera image, it's big). */
export function publicState() {
  const { latestFrame, textHistory, ...rest } = state;
  return { ...rest, hasFrame: Boolean(latestFrame), frameAgeMs: latestFrame ? Date.now() - latestFrame.at : null };
}
