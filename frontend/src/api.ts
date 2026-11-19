// Tiny fetch helpers + shared types (mirror backend/src/state.ts).

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

export type AppState = {
  lastScan: { item: string; brand: string | null; color: string | null } | null;
  verdict: Verdict | null;
  cart: CartItem[];
  coupon: { code: string; percent: number } | null;
  orders: Order[];
  log: LogEntry[];
  agent: { agentId: string; channel: string } | null;
  hasFrame: boolean;
  frameAgeMs: number | null;
};

export type ConfigStatus = Record<string, boolean | string>;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
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

export const rupees = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN')}`);
