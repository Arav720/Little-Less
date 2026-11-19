// The "hands" of the agent. The LLM decides WHEN to call these; the code here does the real work.
import type OpenAI from 'openai';
import { scanLatestFrame } from './vision.js';
import { findProduct, getProduct, loadCatalog } from './data.js';
import { state, addLog, type Verdict, type Order } from './state.js';

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Tool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const toolDefinitions: Tool[] = [
  fn('look_at_camera', 'Look at the live camera to identify the product the user is showing. Call this whenever the user says "check this", "see this", mentions a product in front of them, or tells you a shopkeeper\'s price.'),
  fn(
    'check_price',
    'Look up fair local market price, online price and MRP for a product. Call after look_at_camera (or when the user names a product).',
    {
      product: { type: 'string', description: 'Product description or search query, e.g. "plain cotton t-shirt"' },
      asked_price: { type: 'number', description: 'Price the shopkeeper is asking, in rupees, if the user said it' },
    },
    ['product'],
  ),
  fn(
    'show_verdict',
    'Show the verdict scorecard on the user\'s screen. Call once you know the price check and personal fit, BEFORE speaking the verdict.',
    {
      item: { type: 'string' },
      asked_price: { type: 'number' },
      fair_low: { type: 'number' },
      fair_high: { type: 'number' },
      online_price: { type: 'number' },
      price_verdict: { type: 'string', enum: ['fair', 'slightly_high', 'overpriced', 'good_deal', 'fixed_mrp', 'unknown'] },
      counter_offer: { type: 'number', description: 'Suggested price to offer the shopkeeper' },
      fit_verdict: { type: 'string', enum: ['great_fit', 'ok_fit', 'poor_fit', 'unknown'] },
      fit_note: { type: 'string', description: 'One line: why it does / does not suit the user\'s stated style, colours, wardrobe or goals' },
      quality_note: { type: 'string', description: 'One line on quality / authenticity' },
      recommendation: { type: 'string', description: 'One line: what the user should do' },
    },
    ['item', 'price_verdict', 'fit_verdict', 'fit_note', 'recommendation'],
  ),
  fn(
    'add_to_cart',
    'Add a product to the online cart (or record a shop purchase). Only after the user agrees.',
    {
      product_id: { type: 'string', description: 'Catalog product id from check_price' },
      source: { type: 'string', enum: ['online', 'shop'], description: 'online = order online; shop = user bought it at the shop' },
      price: { type: 'number', description: 'For source=shop: the final negotiated price' },
      qty: { type: 'number' },
    },
    ['product_id', 'source'],
  ),
  fn('apply_coupon', 'Apply a discount coupon to the online cart. Use the user\'s saved coupons.', { code: { type: 'string' } }, ['code']),
  fn('view_cart', 'Get the current cart contents and total.'),
  fn(
    'checkout',
    'Place the online order (sandbox). You MUST first tell the user the total and get a clear yes. Pass confirmed=true only after that yes.',
    { confirmed: { type: 'boolean' } },
    ['confirmed'],
  ),
  fn('track_order', 'Get delivery status of the latest (or a given) order.', { order_id: { type: 'string' } }),
  fn(
    'start_return',
    'Start a return/replacement for an order (e.g. damaged, wrong size).',
    { order_id: { type: 'string' }, reason: { type: 'string' } },
    ['reason'],
  ),
];

const round10 = (n: number) => Math.round(n / 10) * 10;

function cartTotals() {
  const subtotal = state.cart.filter((c) => c.source === 'online').reduce((s, c) => s + c.price * c.qty, 0);
  const discount = state.coupon ? Math.round((subtotal * state.coupon.percent) / 100) : 0;
  return { subtotal, discount, total: subtotal - discount };
}

const handlers: Record<string, (args: any) => Promise<unknown> | unknown> = {
  look_at_camera: () => scanLatestFrame(),

  check_price: ({ product, asked_price }: { product: string; asked_price?: number }) => {
    const p = findProduct(product);
    if (!p) {
      addLog('tool', `Price check: "${product}" not in catalog`);
      return {
        found: false,
        message: 'Not in our price database. Give a rough estimate from general knowledge and clearly say it is only an estimate.',
      };
    }
    const [low, high] = p.local_fair;
    const asked = typeof asked_price === 'number' ? asked_price : null;
    const overBy = asked ? Math.round(((asked - high) / high) * 100) : null;
    const result = {
      found: true,
      product_id: p.id,
      name: p.name,
      category: p.category,
      price_type: p.price_type,
      fair_local_range: [low, high],
      online_price: p.online_price,
      online_seller: p.online_seller,
      mrp: p.mrp,
      asked_price: asked,
      percent_above_fair_high: overBy,
      suggested_counter_offer: p.price_type === 'negotiable' ? round10(low + (high - low) * 0.3) : null,
      walk_away_above: p.price_type === 'negotiable' ? high : null,
      nutrition: p.nutrition ?? null,
      healthier_alternative: p.healthier_alternative ?? null,
      notes: p.notes ?? '',
      rule: p.price_type === 'fixed_mrp' ? 'Packaged good: no bargaining, but selling above MRP is illegal in India.' : 'Negotiable.',
    };
    addLog('tool', `Price check: ${p.name} fair ₹${low}-${high}, online ₹${p.online_price}${asked ? `, asked ₹${asked}` : ''}`);
    return result;
  },

  show_verdict: (args: Omit<Verdict, 'at'>) => {
    state.verdict = {
      item: args.item,
      asked_price: args.asked_price ?? null,
      fair_low: args.fair_low ?? null,
      fair_high: args.fair_high ?? null,
      online_price: args.online_price ?? null,
      price_verdict: args.price_verdict ?? 'unknown',
      counter_offer: args.counter_offer ?? null,
      fit_verdict: args.fit_verdict ?? 'unknown',
      fit_note: args.fit_note ?? '',
      quality_note: args.quality_note ?? '',
      recommendation: args.recommendation ?? '',
      at: Date.now(),
    };
    addLog('tool', `Verdict shown: ${args.price_verdict} / ${args.fit_verdict}`);
    return { shown: true };
  },

  add_to_cart: ({ product_id, source, price, qty }: { product_id: string; source: 'online' | 'shop'; price?: number; qty?: number }) => {
    const p = getProduct(product_id);
    if (!p) return { error: `Unknown product_id ${product_id}` };
    const item = {
      product_id: p.id,
      name: p.name,
      price: source === 'shop' && price ? price : p.online_price,
      qty: qty && qty > 0 ? qty : 1,
      source,
    };
    state.cart.push(item);
    addLog('tool', `Added to cart: ${item.name} ₹${item.price} (${source})`);
    return { added: item, cart: state.cart, ...cartTotals() };
  },

  apply_coupon: ({ code }: { code: string }) => {
    const c = loadCatalog().coupons.find((x) => x.code.toLowerCase() === String(code).toLowerCase());
    if (!c) return { error: `Coupon ${code} is not valid` };
    state.coupon = { code: c.code, percent: c.percent };
    addLog('tool', `Coupon ${c.code} applied (${c.percent}% off)`);
    return { applied: c, ...cartTotals() };
  },

  view_cart: () => ({ cart: state.cart, coupon: state.coupon, ...cartTotals() }),

  checkout: ({ confirmed }: { confirmed: boolean }) => {
    const online = state.cart.filter((c) => c.source === 'online');
    if (!online.length) return { error: 'Online cart is empty.' };
    const totals = cartTotals();
    if (!confirmed) return { needs_confirmation: true, ...totals, message: 'Tell the user the total and ask for a clear yes.' };
    const order: Order = {
      order_id: `LL${Math.floor(100000 + Math.random() * 900000)}`,
      items: online,
      ...totals,
      coupon: state.coupon?.code ?? null,
      placed_at: Date.now(),
      eta: 'Tomorrow by 8 PM',
      status: 'Order placed',
    };
    state.orders.push(order);
    state.cart = state.cart.filter((c) => c.source !== 'online');
    state.coupon = null;
    addLog('tool', `Order ${order.order_id} placed: ₹${order.total} (sandbox payment)`);
    return { order, payment: 'sandbox payment successful' };
  },

  track_order: ({ order_id }: { order_id?: string }) => {
    const order = order_id ? state.orders.find((o) => o.order_id === order_id) : state.orders.at(-1);
    if (!order) return { error: 'No orders yet.' };
    // Fake progress based on minutes since order so the demo shows movement.
    const mins = (Date.now() - order.placed_at) / 60_000;
    order.status = mins < 1 ? 'Order placed' : mins < 3 ? 'Packed' : mins < 6 ? 'Shipped' : 'Out for delivery';
    addLog('tool', `Tracking ${order.order_id}: ${order.status}`);
    return order;
  },

  start_return: ({ order_id, reason }: { order_id?: string; reason: string }) => {
    const order = order_id ? state.orders.find((o) => o.order_id === order_id) : state.orders.at(-1);
    if (!order) return { error: 'No order to return.' };
    order.return_requested = reason;
    order.status = 'Return pickup scheduled';
    addLog('tool', `Return started for ${order.order_id}: ${reason}`);
    return { order_id: order.order_id, pickup: 'Tomorrow 10 AM - 1 PM', refund: `₹${order.total} to original payment method` };
  },
};

export async function runTool(name: string, rawArgs: string): Promise<string> {
  const handler = handlers[name];
  if (!handler) return JSON.stringify({ error: `Unknown tool ${name}` });
  try {
    const args = rawArgs ? JSON.parse(rawArgs) : {};
    return JSON.stringify(await handler(args));
  } catch (err) {
    addLog('error', `Tool ${name} failed: ${(err as Error).message}`);
    return JSON.stringify({ error: (err as Error).message });
  }
}
