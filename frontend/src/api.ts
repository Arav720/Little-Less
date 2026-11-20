// Fetch helpers + shared types (mirror backend/src/state.ts).

export type Verdict = {
  item: string;
  category?: string;
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
  likely_copy?: boolean;
  size_tip?: string | null;
  suggestion?: string | null;
  decision?: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' };
  price_source?: 'catalog' | 'web' | 'none';
  sources?: { source: string; price: number; link: string }[];
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

export type Bargain = {
  item: string;
  walk_away: number;
  online_price: number | null;
  moves: { who: 'shop' | 'you'; price: number }[];
  status: 'negotiating' | 'final_offer' | 'deal' | 'walked_away';
  deal_price: number | null;
};

export type FeedEntry = {
  id: number;
  at: number;
  kind: 'user' | 'agent' | 'shop' | 'status' | 'card' | 'error' | 'system';
  text: string;
  via?: 'voice' | 'text';
  card?:
    | { type: 'verdict'; data: Verdict }
    | { type: 'bargain'; data: Bargain }
    | { type: 'order'; data: Order };
};

export type AppState = {
  feed: FeedEntry[];
  cart: CartItem[];
  coupon: { code: string; percent: number } | null;
  orders: Order[];
  agent: { agentId: string; channel: string } | null;
  hasFrame: boolean;
  shopLanguage?: string;
};

export type Profile = {
  name?: string;
  city?: string;
  speaks?: string;
  shopkeeper_language?: string;
  clothing?: {
    style?: string;
    favourite_colours?: string[];
    avoid_colours?: string[];
    sizes?: { tshirt?: string; shoes?: string };
    already_owns?: string;
  };
  health_goals?: string[];
  wardrobe?: { item: string; colour: string; count: number }[];
  demo?: boolean;
  tech?: string;
  budget_style?: string;
  saved_coupons?: string[];
  onboarded?: boolean;
  [key: string]: unknown;
};

export type ConfigStatus = Record<string, boolean | string>;

/**
 * Each browser gets its own private session id (kept in localStorage), so friends or
 * judges using the same link never see each other's conversation, profile or orders.
 */
function makeId() {
  return (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^a-zA-Z0-9-]/g, '');
}
export const sessionId: string = (() => {
  try {
    const saved = localStorage.getItem('ll-session');
    if (saved && /^[a-zA-Z0-9-]{8,64}$/.test(saved)) return saved;
    const id = makeId();
    localStorage.setItem('ll-session', id);
    return id;
  } catch {
    return makeId(); // private mode: a fresh session per page load
  }
})();

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'x-session-id': sessionId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
};

export const rupees = (n: number | null | undefined) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
