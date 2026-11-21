// Loads/saves the mock catalog and the user's profile (JSON files in backend/data).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { current } from './state.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const file = (name: string) => path.join(dataDir, name);

export type Product = {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  price_type: 'negotiable' | 'fixed_mrp';
  local_fair: [number, number];
  online_price: number;
  online_seller: string;
  mrp: number;
  notes?: string;
  nutrition?: Record<string, number>;
  healthier_alternative?: { id: string; name: string; online_price: number; nutrition?: Record<string, number> };
};

export type Catalog = { coupons: { code: string; percent: number; description: string }[]; products: Product[] };

export function loadCatalog(): Catalog {
  return JSON.parse(readFileSync(file('catalog.json'), 'utf8'));
}

// Each user (browser session) has their own profile, saved to data/profiles/<session>.json
// so it survives server restarts. New users start with a BLANK profile (advice falls back to
// common sense); they can fill it in, or load the demo profile from data/profile.json.
const profilesDir = path.join(dataDir, 'profiles');
mkdirSync(profilesDir, { recursive: true });

const BASE_PROFILE: Record<string, unknown> = {
  name: '',
  city: 'Bengaluru',
  speaks: 'English',
  shopkeeper_language: 'Kannada',
  clothing: { style: '', fit: '', favourite_colours: [], avoid_colours: [], sizes: {}, already_owns: '' },
  wardrobe: [],
  health_goals: [],
  diet: '',
  budget_style: 'Balanced: Good value for money',
  usual_max_spend: '',
  tech: '',
  notes: '',
  saved_coupons: ['LITTLE10'],
  onboarded: false,
};
const DEMO_PROFILE: Record<string, unknown> = (() => {
  try {
    return { ...BASE_PROFILE, ...JSON.parse(readFileSync(file('profile.json'), 'utf8')), demo: true, onboarded: true };
  } catch {
    return { ...BASE_PROFILE };
  }
})();

function persist(id: string, profile: Record<string, unknown>) {
  if (id !== 'default') writeFileSync(path.join(profilesDir, `${id}.json`), JSON.stringify(profile, null, 2));
}

export function loadProfile(): Record<string, unknown> {
  const s = current();
  if (s.profile) return s.profile;
  const f = path.join(profilesDir, `${s.id}.json`);
  s.profile = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : structuredClone(BASE_PROFILE);
  return s.profile!;
}

// The voiceprint belongs to the person, not to the profile form: keep it across saves and resets.
const voiceFields = () => {
  const p = loadProfile();
  return p.voiceprint_id ? { voiceprint_id: p.voiceprint_id, voiceprint_seconds: p.voiceprint_seconds } : {};
};

export function saveProfile(profile: Record<string, unknown>, opts: { keepVoiceprint?: boolean } = {}) {
  const s = current();
  const keep = opts.keepVoiceprint === false ? {} : voiceFields();
  s.profile = { ...BASE_PROFILE, ...profile, ...keep, demo: false };
  persist(s.id, s.profile);
}

/** App-side change (voiceprint) that isn't the user editing their profile: keeps demo/onboarded as they are. */
export function patchProfile(patch: Record<string, unknown>, remove: string[] = []) {
  const s = current();
  const next: Record<string, unknown> = { ...loadProfile(), ...patch };
  for (const k of remove) delete next[k];
  s.profile = next;
  persist(s.id, next);
}

/** "Use demo profile" / "Start fresh" buttons. */
export function resetProfile(kind: 'demo' | 'blank') {
  const s = current();
  s.profile = { ...structuredClone(kind === 'demo' ? DEMO_PROFILE : BASE_PROFILE), ...voiceFields() };
  persist(s.id, s.profile);
  return s.profile;
}

/** The profile as the AI sees it: only filled-in fields, no app bookkeeping. */
export function profileForPrompt(): Record<string, unknown> {
  const { onboarded, demo, saved_coupons, voiceprint_id, voiceprint_seconds, ...rest } = loadProfile();
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.length ? v : undefined;
    if (v && typeof v === 'object') {
      const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]).filter(([, x]) => x !== undefined));
      return Object.keys(o).length ? o : undefined;
    }
    return v === '' || v == null ? undefined : v;
  };
  return (clean(rest) as Record<string, unknown>) ?? {};
}

/** Very simple keyword search: the product whose keywords appear most in the query wins. */
export function findProduct(query: string): Product | null {
  const q = query.toLowerCase();
  const { products } = loadCatalog();
  let best: Product | null = null;
  let bestScore = 0;
  for (const p of products) {
    if (p.id === query) return p;
    // Whole-word match only, so "tee" doesn't match "steel" and "bar" doesn't match "barbell".
    const score = p.keywords.reduce((s, k) => {
      const re = new RegExp(`(^|[^a-z0-9])${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
      return re.test(q) ? s + k.length : s;
    }, 0);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

// Products found through live web search live here (in memory) so the cart can use them.
const webProducts = new Map<string, Product>();

export function registerWebProduct(p: Product) {
  webProducts.set(p.id, p);
}

export function getProduct(id: string): Product | null {
  return webProducts.get(id) ?? loadCatalog().products.find((p) => p.id === id) ?? null;
}
