// The bargaining engine. Code decides the NUMBERS (so they're always sensible);
// the LLM only decides the WORDS.
//
// Strategy (classic market haggling):
//   1. Open low: a bit above the bottom of the fair range.
//   2. Each time the shop counters, come up in small steps (about a third of the gap).
//   3. Never go above the walk-away price (top of the fair range, or the online price if lower).
//   4. After 3 rounds, make a clear "final offer". If refused, walk away and order online.
import { state, addLog, addCard, updateCard, type Bargain } from './state.js';

const round10 = (n: number) => Math.round(n / 10) * 10;

type Action = 'start' | 'shop_counter' | 'shop_accepts' | 'shop_refuses' | 'stop';

export function bargainStep(args: { action?: Action; shop_price?: number }) {
  const v = state.verdict;
  if (!v || v.fair_low == null || v.fair_high == null) {
    return { error: 'No price check yet. Call inspect_product first.' };
  }
  let action: Action = args.action ?? (state.bargain ? 'shop_counter' : 'start');
  const online = v.online_price;
  const sameItemOngoing =
    state.bargain && state.bargain.item === v.item && (state.bargain.status === 'negotiating' || state.bargain.status === 'final_offer');

  // "start" again for the same item must NOT restart the haggle (models do this a lot):
  // if the shop gave a new price, treat it as their counter; otherwise repeat our current offer.
  if (action === 'start' && sameItemOngoing) {
    const b = state.bargain!;
    const lastShop = [...b.moves].reverse().find((m) => m.who === 'shop')?.price;
    if (args.shop_price && args.shop_price !== lastShop) action = 'shop_counter';
    else {
      const ours = [...b.moves].reverse().find((m) => m.who === 'you')?.price ?? b.opening_offer;
      return summary(b, b.status === 'final_offer' ? 'final_offer' : 'counter', ours);
    }
  }

  // Start a new negotiation (or restart for a different item).
  if (action === 'start' || !state.bargain || state.bargain.item !== v.item) {
    const walk = online ? Math.min(v.fair_high, Math.max(v.fair_low, online)) : v.fair_high;
    const opening = Math.min(walk, round10(v.fair_low + (v.fair_high - v.fair_low) * 0.15));
    const shop = args.shop_price ?? v.asked_price;
    state.bargain = {
      item: v.item,
      opening_offer: opening,
      walk_away: walk,
      online_price: online,
      moves: [...(shop ? [{ who: 'shop' as const, price: shop }] : []), { who: 'you' as const, price: opening }],
      status: 'negotiating',
      deal_price: null,
    };
    addLog('tool', `Bargain started: shop ₹${shop ?? '?'} → we offer ₹${opening} (walk away above ₹${walk})`);
    return summary(state.bargain, 'open', opening);
  }

  const b = state.bargain;

  // The user ended the negotiation themselves.
  if (action === 'stop') {
    b.status = 'walked_away';
    addLog('tool', 'Negotiation stopped by user');
    return summary(b, 'walk_away', null);
  }
  const lastOurs = [...b.moves].reverse().find((m) => m.who === 'you')?.price ?? b.opening_offer;
  const ourRounds = b.moves.filter((m) => m.who === 'you').length;

  if (action === 'shop_accepts') {
    b.status = 'deal';
    b.deal_price = args.shop_price ?? lastOurs;
    addLog('tool', `Deal at ₹${b.deal_price}`);
    return summary(b, 'deal', b.deal_price);
  }

  const shopPrice = args.shop_price ?? [...b.moves].reverse().find((m) => m.who === 'shop')?.price ?? null;
  if (shopPrice != null && action === 'shop_counter') b.moves.push({ who: 'shop', price: shopPrice });

  // Shop came down to an acceptable price → take it.
  if (shopPrice != null && shopPrice <= b.walk_away) {
    b.status = 'deal';
    b.deal_price = shopPrice;
    addLog('tool', `Shop at ₹${shopPrice} is within walk-away ₹${b.walk_away} → accept`);
    return summary(b, 'accept', shopPrice);
  }

  // Already made a final offer and still refused → walk away.
  if (b.status === 'final_offer') {
    b.status = 'walked_away';
    addLog('tool', `Walk away (shop still at ₹${shopPrice ?? '?'})`);
    return summary(b, 'walk_away', null);
  }

  // Three-move plan: opening offer → one middle offer → final offer at the walk-away price.
  // (Tiny ₹10 steps sound weak; real hagglers move in a couple of confident jumps.)
  const step = Math.max(20, round10((b.walk_away - b.opening_offer) / 2));
  let next = Math.min(b.walk_away, lastOurs + step);
  if (ourRounds >= 2 || next >= b.walk_away || action === 'shop_refuses') {
    next = b.walk_away;
    b.status = 'final_offer';
  }
  b.moves.push({ who: 'you', price: next });
  addLog('tool', `Shop ₹${shopPrice ?? '?'} → we offer ₹${next}${b.status === 'final_offer' ? ' (final)' : ''}`);
  return summary(b, b.status === 'final_offer' ? 'final_offer' : 'counter', next);
}

/** Show (or refresh) the live bargaining card in the conversation. */
function syncCard(b: Bargain) {
  const data = { ...b, moves: [...b.moves] };
  if (!updateCard(state.bargainCardId, data)) state.bargainCardId = addCard('bargain', data).id;
}

function summary(b: Bargain, move: 'open' | 'counter' | 'final_offer' | 'accept' | 'deal' | 'walk_away', price: number | null) {
  const noDeal = ' There is NO deal yet: do not say "deal", "okay" or "sari/theek hai" as if agreed.';
  // The online price is only an argument if it's actually LOWER than what the shop is asking.
  const firstAsk = b.moves.find((m) => m.who === 'shop')?.price ?? null;
  const onlineCheaper = b.online_price != null && firstAsk != null && b.online_price < firstAsk;
  const say: Record<typeof move, string> = {
    open: onlineCheaper
      ? 'Greet the shopkeeper warmly, say the price is too high, mention the online price, and offer our_offer.' + noDeal
      : 'Greet the shopkeeper warmly and offer our_offer. Do NOT mention the online price (it is higher than his, so it is no argument). Use a reason like buying right now, paying cash, or coming back to his shop.' + noDeal,
    counter: 'Acknowledge him, use ONE new reason you have not used yet (regular customer / buying today / paying cash), and offer our_offer.' + noDeal,
    final_offer: onlineCheaper
      ? 'Say our_offer is your final price, friendly but firm, and that otherwise you will buy online.' + noDeal
      : 'Say our_offer is your final price, friendly but firm, and that otherwise you will check the next shop.' + noDeal,
    accept: 'Happily accept the shop price and close the deal. Then tell the user (in their language) the deal and how much they saved.',
    deal: 'Close the deal happily. Then tell the user the saving.',
    walk_away: onlineCheaper
      ? 'Politely thank him and say you will buy it elsewhere. Then tell the user (in their language) where it is cheapest (best store and price) and that they can buy it there.'
      : 'Politely thank him and say you will look around. Then tell the user his price was still above what you were willing to pay.',
  };
  syncCard(b);
  return {
    move,
    our_offer: price,
    shop_price: [...b.moves].reverse().find((m) => m.who === 'shop')?.price ?? null,
    online_price: b.online_price,
    walk_away_price: b.walk_away,
    history: b.moves.map((m) => `${m.who === 'shop' ? 'Shop' : 'Us'} ₹${m.price}`).join(' → '),
    how_to_say_it: say[move],
  };
}
