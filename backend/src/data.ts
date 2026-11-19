// Loads/saves the mock catalog and the user's profile (JSON files in backend/data).
import { readFileSync, writeFileSync } from 'node:fs';
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

export function loadProfile(): Record<string, unknown> {
  return JSON.parse(readFileSync(file('profile.json'), 'utf8'));
}

export function saveProfile(profile: Record<string, unknown>) {
  writeFileSync(file('profile.json'), JSON.stringify(profile, null, 2));
}

/** Very simple keyword search: the product whose keywords appear most in the query wins. */
export function findProduct(query: string): Product | null {
  const q = query.toLowerCase();
  const { products } = loadCatalog();
  let best: Product | null = null;
  let bestScore = 0;
  for (const p of products) {
    if (p.id === query) return p;
    const score = p.keywords.reduce((s, k) => (q.includes(k.toLowerCase()) ? s + k.length : s), 0);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

export function getProduct(id: string): Product | null {
  return loadCatalog().products.find((p) => p.id === id) ?? null;
}
