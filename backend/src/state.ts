// In-memory app state for one shopping session (resets when the server restarts).
// The app polls GET /api/state every second and draws the conversation feed from `feed`.

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

export type BargainMove = { who: 'shop' | 'you'; price: number };
export type Bargain = {
  item: string;
  opening_offer: number;
  walk_away: number; // never offer above this
  online_price: number | null;
  moves: BargainMove[];
  status: 'negotiating' | 'final_offer' | 'deal' | 'walked_away';
  deal_price: number | null;
};

/**
 * One entry in the conversation feed the user sees.
 *  user   – what the user said (via voice or typed)
 *  agent  – Little Less talking to the user
 *  shop   – Little Less talking to the shopkeeper (bargaining)
 *  status – small progress line ("Checking prices online…")
 *  card   – rich card: price verdict, bargaining, order
 *  error  – something went wrong (shown softly)
 */
export type FeedEntry = {
  id: number;
  at: number;
  kind: 'user' | 'agent' | 'shop' | 'status' | 'card' | 'error' | 'system';
  text: string;
  via?: 'voice' | 'text';
  card?: { type: 'verdict' | 'bargain' | 'order'; data: unknown };
};

export type ChatMsg = { role: 'user' | 'assistant'; content: string };

// ---------------------------------------------------------------------------
// Sessions: every browser gets its own private session (conversation, profile,
// camera frame, voice call, orders). The browser sends its id in the
// "x-session-id" header (or ?sid= for Agora's calls). Code everywhere just uses
// `state`, which automatically points at the session of the current request.
// ---------------------------------------------------------------------------
import { AsyncLocalStorage } from 'node:async_hooks';

function freshSession(id: string) {
  return {
    id,
    lastSeen: Date.now(),
    profile: null as Record<string, unknown> | null,
    latestFrame: null as null | { dataUrl: string; at: number },
    lastScan: null as Scan | null,
    verdict: null as Verdict | null,
    lastProductId: null as string | null,
    cart: [] as CartItem[],
    coupon: null as null | { code: string; percent: number },
    orders: [] as Order[],
    feed: [] as FeedEntry[],
    agent: null as null | { agentId: string; channel: string },
    /** The ONE conversation memory, shared by voice and typed chat. */
    history: [] as ChatMsg[],
    bargain: null as Bargain | null,
    bargainCardId: null as number | null,
    orderCardIds: {} as Record<string, number>,
    /** Turn counter + the user's latest words: used to require a real "yes" before any order. */
    turn: 0,
    lastUserText: '',
    /** Turn in which the order total was shown to the user (null = nothing waiting for a yes). */
    confirmTurn: null as number | null,
    /** Last voice turn (Agora sometimes re-sends the same sentence). */
    lastTurn: { text: '', at: 0, reply: '', promise: null as Promise<string> | null },
  };
}
export type Session = ReturnType<typeof freshSession>;

const sessions = new Map<string, Session>();
const fallback = freshSession('default');
export const sessionContext = new AsyncLocalStorage<Session>();

export const isValidSessionId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(id);

export function getSession(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = freshSession(id);
    sessions.set(id, s);
  }
  s.lastSeen = Date.now();
  return s;
}

/** The session of the request being handled right now. */
export const current = (): Session => sessionContext.getStore() ?? fallback;

/** `state.x` always means "x of the current user's session". */
export const state = new Proxy({} as Session, {
  get: (_t, key) => (current() as any)[key],
  set: (_t, key, value) => {
    (current() as any)[key] = value;
    return true;
  },
});

// Forget sessions idle for 6 hours (keeps memory small during the event).
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, s] of sessions) if (s.lastSeen < cutoff && !s.agent) sessions.delete(id);
}, 10 * 60 * 1000).unref();

let nextId = 0;

function push(entry: Omit<FeedEntry, 'id' | 'at'>) {
  const e: FeedEntry = { id: ++nextId, at: Date.now(), ...entry };
  state.feed.push(e);
  if (state.feed.length > 300) state.feed.splice(0, state.feed.length - 300);
  return e;
}

/**
 * Backwards-compatible logger. 'tool' lines are developer details: printed to the
 * server console only, never shown to the user.
 */
export function addLog(kind: 'user' | 'agent' | 'tool' | 'system' | 'error', text: string) {
  console.log(`[${kind}] ${text}`);
  if (kind === 'tool') return;
  if (kind === 'error') return; // errors are shown via addFeedError with friendly text
  push({ kind, text });
}

export const addUser = (text: string, via: 'voice' | 'text') => {
  console.log(`[user/${via}] ${text}`);
  return push({ kind: 'user', text, via });
};
export const addAgent = (text: string, kind: 'agent' | 'shop' = 'agent') => {
  console.log(`[${kind}] ${text}`);
  return push({ kind, text });
};
export const addStatus = (text: string) => push({ kind: 'status', text });
export const addFeedError = (text: string) => push({ kind: 'error', text });

export function addCard(type: 'verdict' | 'bargain' | 'order', data: unknown) {
  return push({ kind: 'card', text: '', card: { type, data } });
}

export function updateCard(id: number | null, data: unknown) {
  const e = id != null ? state.feed.find((f) => f.id === id) : null;
  if (e?.card) {
    e.card.data = data;
    return true;
  }
  return false;
}

export function resetShopping() {
  state.lastScan = null;
  state.verdict = null;
  state.lastProductId = null;
  state.bargain = null;
  state.bargainCardId = null;
  state.orderCardIds = {};
  state.cart = [];
  state.coupon = null;
  state.orders = [];
  state.feed = [];
  state.history = [];
  state.confirmTurn = null;
}

/** What the browser needs to draw the UI (no camera image, it's big). */
export function publicState() {
  const { latestFrame, history, bargainCardId, orderCardIds, profile, lastTurn, id, lastSeen, ...rest } = current();
  return { ...rest, shopLanguage: String(profile?.shopkeeper_language ?? 'Kannada'), hasFrame: Boolean(latestFrame), frameAgeMs: latestFrame ? Date.now() - latestFrame.at : null };
}
