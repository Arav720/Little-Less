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
// so it survives server restarts. New users start from the demo profile in data/profile.json
// (so personalised advice works immediately in a demo); anyone can edit it to their own.
const profilesDir = path.join(dataDir, 'profiles');
mkdirSync(profilesDir, { recursive: true });

const BASE_PROFILE: Record<string, unknown> = {
  name: '',
  city: 'Bengaluru',
  speaks: 'English',
  shopkeeper_language: 'Kannada',
  clothing: { style: '', favourite_colours: [], avoid_colours: [], sizes: {}, already_owns: '' },
  wardrobe: [],
  health_goals: [],
  budget_style: 'Balanced: Good value for money',
  saved_coupons: ['LITTLE10'],
  onboarded: false,
};
const DEFAULT_PROFILE: Record<string, unknown> = (() => {
  try {
    return { ...BASE_PROFILE, ...JSON.parse(readFileSync(file('profile.json'), 'utf8')) };
  } catch {
    return BASE_PROFILE;
  }
})();

export function loadProfile(): Record<string, unknown> {
  const s = current();
  if (s.profile) return s.profile;
  const f = path.join(profilesDir, `${s.id}.json`);
  s.profile = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : structuredClone(DEFAULT_PROFILE);
  return s.profile!;
}

export function saveProfile(profile: Record<string, unknown>) {
  const s = current();
  s.profile = { ...BASE_PROFILE, ...profile, demo: false };
  if (s.id !== 'default') writeFileSync(path.join(profilesDir, `${s.id}.json`), JSON.stringify(s.profile, null, 2));
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
