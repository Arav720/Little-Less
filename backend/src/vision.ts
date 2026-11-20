// inspectProduct = look at the camera + judge personal fit (ONE fast LLM call)
// + price check and verdict maths (plain code, instant).
// Doing this in one tool instead of 3 separate LLM steps saves several seconds per reply.
import { fastCompletion } from './llm.js';
import { findProduct, loadProfile, type Product } from './data.js';
import { state, addLog, type Scan, type Verdict } from './state.js';

const FRESH_MS = 15_000;

function visionPrompt(description: string | undefined) {
  return `You help a shopper in an Indian street market.
${description ? `The shopper says: "${description}".` : ''}
Identify the main product ${description ? '(use the image if it is clear, else the description)' : 'in the image'} and judge if it suits THIS shopper.
Shopper profile: ${JSON.stringify(loadProfile())}

Judge fit ONLY on their stated style, colours, wardrobe (avoid duplicates), goals and budget. Never comment on body, skin or looks.

Reply with ONLY a JSON object, no markdown:
{"item": short name e.g. "olive cotton T-shirt",
 "brand": string or null,
 "category": "clothing"|"electronics"|"accessories"|"food"|"home"|"other",
 "color": string or null,
 "visible_text": important label/tag text or null,
 "quality_notes": one short line on visible quality, or null,
 "authenticity_flags": signs of a copy/fake, or null,
 "search_query": 3-6 words to search a catalog,
 "fit_verdict": "great_fit"|"ok_fit"|"poor_fit"|"unknown",
 "fit_note": one short line why, referring to their profile}
If there is no clear product and no description, set "item" to "nothing clear".`;
}

const round10 = (n: number) => Math.round(n / 10) * 10;

function priceVerdict(p: Product | null, asked: number | null): Verdict['price_verdict'] {
  if (!p) return 'unknown';
  if (p.price_type === 'fixed_mrp') return 'fixed_mrp';
  if (asked == null) return 'unknown';
  const [low, high] = p.local_fair;
  if (asked < low) return 'good_deal';
  if (asked <= high) return 'fair';
  if (asked <= high * 1.2) return 'slightly_high';
  return 'overpriced';
}

function recommendation(p: Product | null, pv: Verdict['price_verdict'], counter: number | null, fit: string): string {
  if (!p) return 'Not in our price list, so treat any number as a rough estimate.';
  if (fit === 'poor_fit' && pv !== 'good_deal') return 'Does not match your taste or goals. Skip it.';
  switch (pv) {
    case 'good_deal':
      return 'Below the usual price. Buy it.';
    case 'fair':
      return 'Fair price. Go ahead.';
    case 'slightly_high':
    case 'overpriced':
      return `Offer ₹${counter}. Walk away above ₹${p.local_fair[1]}, or order online for ₹${p.online_price}.`;
    case 'fixed_mrp':
      return p.healthier_alternative
        ? `Fixed MRP. A better-for-you option is ₹${p.healthier_alternative.online_price} online.`
        : `Fixed MRP of ₹${p.mrp}. Never pay more than that.`;
    default:
      return `Ask the price. Fair is ₹${p.local_fair[0]}–${p.local_fair[1]}, online ₹${p.online_price}.`;
  }
}

export async function inspectProduct(args: { description?: string; asked_price?: number } = {}) {
  const frame = state.latestFrame && Date.now() - state.latestFrame.at < FRESH_MS ? state.latestFrame : null;
  const description = args.description?.trim() || undefined;
  if (!frame && !description) {
    return { error: 'Camera is off and no description given. Ask the user to show the item or say what it is.' };
  }

  // 1) One LLM call: identify + personal fit (with image if we have one).
  const content: any[] = [{ type: 'text', text: visionPrompt(description) }];
  if (frame) content.push({ type: 'image_url', image_url: { url: frame.dataUrl } });
  const text = await fastCompletion([{ role: 'user', content }]);
  let parsed: any = {};
  try {
    parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
  } catch {
    /* fall through with description only */
  }

  const scan: Scan = {
    item: String(parsed.item ?? description ?? 'unknown'),
    brand: parsed.brand ?? null,
    category: String(parsed.category ?? 'other'),
    color: parsed.color ?? null,
    visible_text: parsed.visible_text ?? null,
    quality_notes: parsed.quality_notes ?? null,
    authenticity_flags: parsed.authenticity_flags ?? null,
    search_query: String(parsed.search_query ?? description ?? ''),
    at: Date.now(),
  };
  if (scan.item === 'nothing clear' && !description) {
    return { error: 'Nothing clear in the camera. Ask the user to hold the item closer.' };
  }
  state.lastScan = scan;
  addLog('tool', `Saw: ${scan.item}${scan.brand ? ` (${scan.brand})` : ''}`);

  // 2) Price check + verdict maths in code (instant).
  const product = findProduct(`${scan.search_query} ${scan.item} ${description ?? ''}`);
  state.lastProductId = product?.id ?? null;
  const asked = typeof args.asked_price === 'number' ? args.asked_price : null;
  const pv = priceVerdict(product, asked);
  const counter = product && product.price_type === 'negotiable'
    ? round10(product.local_fair[0] + (product.local_fair[1] - product.local_fair[0]) * 0.3)
    : null;
  const fit = (['great_fit', 'ok_fit', 'poor_fit'].includes(parsed.fit_verdict) ? parsed.fit_verdict : 'unknown') as Verdict['fit_verdict'];
  const quality = [scan.quality_notes, scan.authenticity_flags && `Watch out: ${scan.authenticity_flags}`].filter(Boolean).join(' ');

  state.verdict = {
    item: scan.item,
    asked_price: asked,
    fair_low: product?.local_fair[0] ?? null,
    fair_high: product?.local_fair[1] ?? null,
    online_price: product?.online_price ?? null,
    price_verdict: pv,
    counter_offer: pv === 'slightly_high' || pv === 'overpriced' ? counter : null,
    fit_verdict: fit,
    fit_note: String(parsed.fit_note ?? ''),
    quality_note: quality,
    recommendation: recommendation(product, pv, counter, fit),
    at: Date.now(),
  };
  addLog('tool', product
    ? `Price check: ${product.name} fair ₹${product.local_fair[0]}-${product.local_fair[1]}, online ₹${product.online_price}${asked ? `, asked ₹${asked}` : ''} → ${pv}`
    : `Price check: "${scan.item}" not in catalog`);

  // 3) Everything the main LLM needs to speak the verdict.
  return {
    seen: scan,
    product_id: product?.id ?? null,
    in_catalog: Boolean(product),
    price_type: product?.price_type ?? null,
    asked_price: asked,
    fair_local_range: product?.local_fair ?? null,
    online_price: product?.online_price ?? null,
    mrp: product?.mrp ?? null,
    price_verdict: pv,
    counter_offer: state.verdict.counter_offer,
    walk_away_above: product?.price_type === 'negotiable' ? product.local_fair[1] : null,
    fit_verdict: fit,
    fit_note: state.verdict.fit_note,
    nutrition: product?.nutrition ?? null,
    healthier_alternative: product?.healthier_alternative ?? null,
    notes: product?.notes ?? '',
    card_shown_on_screen: true,
  };
}
