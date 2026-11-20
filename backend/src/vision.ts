// inspectProduct = look at the camera + judge personal fit (ONE fast LLM call)
// + price check and verdict maths (plain code, instant).
// Doing this in one tool instead of 3 separate LLM steps saves several seconds per reply.
import { fastCompletion } from './llm.js';
import { findProduct, loadProfile, registerWebProduct, type Product } from './data.js';
import { searchWebPrices, webSearchEnabled, type WebPrices } from './webprice.js';
import { state, addStatus, addCard, type Scan, type Verdict } from './state.js';

const FRESH_MS = 15_000;

function visionPrompt(description: string | undefined) {
  return `You help a shopper in an Indian street market.
${description ? `The shopper says: "${description}".` : ''}
Identify the product and judge if it suits THIS shopper.
${description ? `IMPORTANT: if the shopper's words name a product (e.g. "tofu block", "these earphones"), THAT is the product, even if the image shows something else (the camera may be pointing at the shopper's own clothes). Use the image only for extra details when it clearly shows that same product. If their words name no product ("check this", "scan now"), identify the product from the image.` : 'Identify the main product being held up or shown in the image.'}
Shopper profile: ${JSON.stringify(loadProfile())}

How to judge fit, by category (use ONLY the parts of the profile that matter for this kind of item; ignore the rest):
- clothing / accessories: their style, favourite and avoided colours, what they already own (avoid duplicates).
- food / health: their health goals only (e.g. protein, sugar). Never mention clothing or style.
- electronics / home / other: usefulness for their lifestyle and budget. Never mention clothing or style.
If the profile says nothing relevant for this category, use "ok_fit" and a neutral note.
Never comment on body, skin or looks.
Write fit_note addressed to the shopper as "you" (never "he", "his" or "the user"), max 15 words, e.g. "High protein, good for your gym goal."

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
  // Real MRP is only known for our own catalog items; web items are compared with online prices.
  if (p.price_type === 'fixed_mrp' && !p.id.startsWith('web-')) return 'fixed_mrp';
  if (asked == null) return 'unknown';
  const [low, high] = p.local_fair;
  if (asked < low) return 'good_deal';
  if (asked <= high) return 'fair';
  if (asked <= high * 1.2) return 'slightly_high';
  return 'overpriced';
}

/** Way below the genuine online price usually means a copy, not a bargain. */
const suspiciouslyCheap = (p: Product | null, asked: number | null) => Boolean(p && asked && asked < p.online_price * 0.5);

function recommendation(p: Product | null, pv: Verdict['price_verdict'], counter: number | null, fit: string, asked: number | null): string {
  if (!p) return 'Not in our price list, so treat any number as a rough estimate.';
  if (suspiciouslyCheap(p, asked)) {
    return `Too cheap to be genuine (real one is about ₹${p.online_price} online). Likely a copy: only buy it as a copy, or order the original online.`;
  }
  if (fit === 'poor_fit' && pv !== 'good_deal') return 'Does not match your taste or goals. Skip it.';
  const isWeb = p.id.startsWith('web-');
  if (isWeb && p.category === 'food') {
    // Packaged food: we don't know this pack's printed MRP, so compare with online and remind about MRP.
    const vs = pv === 'overpriced' || pv === 'slightly_high' ? 'more than' : 'in line with';
    return `That's ${vs} online (about ₹${p.online_price}). Check the printed MRP: never pay above it.`;
  }
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
  const parse = (t: string) => {
    try {
      return JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    } catch {
      return {};
    }
  };
  let parsed: any = parse(await fastCompletion([{ role: 'user', content }]));
  // The camera saw nothing useful, but the user named the product: identify it from their words alone.
  const unclear = !parsed.item || /nothing clear|unknown|unclear/i.test(String(parsed.item));
  if (unclear && frame && description) {
    parsed = parse(await fastCompletion([{ role: 'user', content: [{ type: 'text', text: visionPrompt(description) }] }]));
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
    return { error: 'Nothing clear in the camera. Ask the user to hold the item closer or say what it is.' };
  }
  state.lastScan = scan;
  console.log(`[tool] saw: ${scan.item}${scan.brand ? ` (${scan.brand})` : ''}`);

  // 2) Real prices from the web (Google Shopping, ~1 s). No made-up catalog prices.
  //    The small catalog is only used if web search is not configured.
  const withBrand = (text: string) =>
    scan.brand && !text.toLowerCase().includes(scan.brand.toLowerCase()) ? `${scan.brand} ${text}` : text;
  let product: Product | null = null;
  let priceSource: 'catalog' | 'web' | 'none' = 'none';
  let web: WebPrices | null = null;
  if (webSearchEnabled()) {
    const query = withBrand(scan.search_query || scan.item);
    addStatus(`Checking online prices for ${withBrand(scan.item)}…`);
    web = await searchWebPrices(query);
    if (web) {
      product = {
        id: `web-${query.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
        name: withBrand(scan.item),
        category: scan.category,
        keywords: [],
        price_type: 'negotiable',
        local_fair: [web.fair_low, web.fair_high],
        // Typical (median) online price, not the single cheapest listing (often a smaller pack).
        online_price: web.online_median,
        online_seller: web.offers.find((o) => o.price === web!.online_median)?.source || web.offers[0].source,
        mrp: 0, // unknown for web items: never claim an MRP we don't have
        notes: '',
      };
      registerWebProduct(product);
      priceSource = 'web';
    }
  } else {
    product = findProduct(`${scan.search_query} ${scan.item} ${description ?? ''}`);
    if (product) priceSource = 'catalog';
  }
  state.lastProductId = product?.id ?? null;

  const asked = typeof args.asked_price === 'number' ? args.asked_price : null;
  const pv = priceVerdict(product, asked);
  const counter = product && product.price_type === 'negotiable'
    ? round10(product.local_fair[0] + (product.local_fair[1] - product.local_fair[0]) * 0.3)
    : null;
  const fit = (['great_fit', 'ok_fit', 'poor_fit'].includes(parsed.fit_verdict) ? parsed.fit_verdict : 'unknown') as Verdict['fit_verdict'];
  const quality = [scan.quality_notes, scan.authenticity_flags && `Watch out: ${scan.authenticity_flags}`].filter(Boolean).join(' ');
  const likelyCopy = suspiciouslyCheap(product, asked);

  state.verdict = {
    item: product?.name ?? withBrand(scan.item),
    category: scan.category,
    asked_price: asked,
    fair_low: product?.local_fair[0] ?? null,
    fair_high: product?.local_fair[1] ?? null,
    online_price: product?.online_price ?? null,
    price_verdict: pv,
    counter_offer: pv === 'slightly_high' || pv === 'overpriced' ? counter : null,
    fit_verdict: fit,
    fit_note: String(parsed.fit_note ?? ''),
    quality_note: quality,
    recommendation: recommendation(product, pv, counter, fit, asked),
    likely_copy: likelyCopy,
    price_source: priceSource,
    sources: web?.offers.map((o) => ({ source: o.source, price: o.price, link: o.link })) ?? [],
    at: Date.now(),
  };
  // A new item ends any previous bargaining.
  if (state.bargain && state.bargain.item !== state.verdict.item) {
    state.bargain = null;
    state.bargainCardId = null;
  }
  if (!product) addStatus(`Couldn't find reliable online prices for ${withBrand(scan.item)}.`);
  addCard('verdict', state.verdict);
  console.log(`[tool] price (${priceSource}) ${product?.name ?? scan.item}: fair ${product?.local_fair.join('-') ?? '?'}, online ${product?.online_price ?? '?'}, asked ${asked ?? '?'} → ${pv}`);

  // 3) Everything the main LLM needs to speak the verdict.
  return {
    item: state.verdict.item,
    product_id: product?.id ?? null,
    price_source: priceSource,
    online_price: product?.online_price ?? null,
    online_seller: product?.online_seller ?? null,
    web_offers: web?.offers.map((o) => `${o.source}: ₹${o.price}`) ?? null,
    asked_price: asked,
    fair_local_range: product?.local_fair ?? null,
    price_verdict: pv,
    counter_offer: state.verdict.counter_offer,
    likely_fake_or_copy: likelyCopy,
    recommendation: state.verdict.recommendation,
    fit_verdict: fit,
    fit_note: state.verdict.fit_note,
    quality_note: quality || null,
    card_shown_on_screen: true,
  };
}
