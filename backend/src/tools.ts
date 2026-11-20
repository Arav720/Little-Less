// The "hands" of the agent. The LLM decides WHEN to call these; the code here does the real work.
import type OpenAI from 'openai';
import { inspectProduct } from './vision.js';
import { getProduct, loadCatalog, loadProfile } from './data.js';
import { state, addLog, type Order } from './state.js';

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Tool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const toolDefinitions: Tool[] = [
  fn(
    'inspect_product',
    'ONE call that looks at the live camera, identifies the product, checks fair/online price, judges if it suits the user, and shows the verdict card on screen. Call it whenever the user shows something, says "check this", or mentions a shopkeeper\'s price.',
    {
      description: { type: 'string', description: 'What the user said the product is, if they described it (e.g. "olive cotton t-shirt")' },
      asked_price: { type: 'number', description: 'Price the shopkeeper is asking, in rupees, if the user said it' },
    },
  ),
  fn(
    'add_to_cart',
    'Add a product to the online cart (or record a shop purchase). Only after the user agrees. The user\'s saved coupon is applied automatically.',
    {
      product_id: { type: 'string', description: 'Catalog product id (defaults to the item just inspected)' },
      source: { type: 'string', enum: ['online', 'shop'], description: 'online = order online; shop = user bought it at the shop' },
      price: { type: 'number', description: 'For source=shop: the final negotiated price' },
      qty: { type: 'number' },
    },
    ['source'],
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


function cartTotals() {
  const subtotal = state.cart.filter((c) => c.source === 'online').reduce((s, c) => s + c.price * c.qty, 0);
  const discount = state.coupon ? Math.round((subtotal * state.coupon.percent) / 100) : 0;
  return { subtotal, discount, total: subtotal - discount };
}

const handlers: Record<string, (args: any) => Promise<unknown> | unknown> = {
  inspect_product: (args: { description?: string; asked_price?: number }) => inspectProduct(args),

  add_to_cart: ({ product_id, source = 'online', price, qty }: { product_id?: string; source?: 'online' | 'shop'; price?: number; qty?: number }) => {
    // The model often forgets/mangles ids between turns, so fall back to the item just inspected.
    const p = (product_id && getProduct(product_id)) || (state.lastProductId && getProduct(state.lastProductId));
    if (!p) return { error: 'No product selected yet. Ask the user to show or name the item first.' };
    const existing = state.cart.find((c) => c.product_id === p.id && c.source === source);
    if (existing) return { already_in_cart: existing, cart: state.cart, ...cartTotals() };
    const item = {
      product_id: p.id,
      name: p.name,
      price: source === 'shop' && price ? price : p.online_price,
      qty: qty && qty > 0 ? qty : 1,
      source,
    };
    state.cart.push(item);
    addLog('tool', `Added to cart: ${item.name} ₹${item.price} (${source})`);
    // Save a round-trip: apply the user's saved coupon automatically.
    if (source === 'online' && !state.coupon) {
      const saved = (loadProfile().saved_coupons as string[] | undefined) ?? [];
      const c = loadCatalog().coupons.find((x) => saved.includes(x.code));
      if (c) {
        state.coupon = { code: c.code, percent: c.percent };
        addLog('tool', `Coupon ${c.code} applied (${c.percent}% off)`);
      }
    }
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
