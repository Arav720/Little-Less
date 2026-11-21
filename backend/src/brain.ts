// The "brain": Agora sends what the user said here (OpenAI chat format).
// We run the LLM + tools in a loop, then stream the final spoken reply back as SSE.
// Docs: https://docs.agora.io/en/ai/build/custom-model-integration/custom-llm
import type { Request, Response } from 'express';
import type OpenAI from 'openai';
import { chat, MODEL } from './llm.js';
import { toolDefinitions, runTool } from './tools.js';
import { loadProfile, saveProfile, profileForPrompt } from './data.js';
import { state, addUser, addAgent, addFeedError, addStatus } from './state.js';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Cheapest real store listing for the current item, e.g. "Flipkart at 299 rupees". */
function bestStore(v: { sources?: { source: string; price: number }[] } | null) {
  const best = [...(v?.sources ?? [])].filter((s) => s.source && s.price > 0).sort((a, b) => a.price - b.price)[0];
  return best ? `${best.source} at ${best.price} rupees` : null;
}

/** What has happened so far (tool results are not in Agora's history, so we restate them every turn). */
function sessionMemory() {
  const v = state.verdict;
  const online = state.cart.filter((c) => c.source === 'online');
  const subtotal = online.reduce((s, c) => s + c.price * c.qty, 0);
  const discount = state.coupon ? Math.round((subtotal * state.coupon.percent) / 100) : 0;
  const lastOrder = state.orders.at(-1);
  return JSON.stringify(
    {
      current_item: v
        ? {
            item: v.item,
            product_id: state.lastProductId,
            asked_price: v.asked_price,
            fair_range: v.fair_low != null ? [v.fair_low, v.fair_high] : null,
            online_price: v.online_price,
            best_store: bestStore(v),
            pack_deal: v.pack_deal ? `pack of ${v.pack_deal.count} for ${v.pack_deal.price} rupees on ${v.pack_deal.source} (${v.pack_deal.per_unit} each)` : null,
            price_verdict: v.price_verdict,
            counter_offer: v.counter_offer,
            fit: v.fit_verdict,
            fit_note: v.fit_note,
          }
        : null,
      cart: online.length ? { items: online.map((c) => `${c.name} ₹${c.price}`), coupon: state.coupon?.code ?? null, total: subtotal - discount } : 'empty',
      last_order: lastOrder ? { order_id: lastOrder.order_id, total: lastOrder.total, status: lastOrder.status, eta: lastOrder.eta } : null,
      bargaining: state.bargain
        ? {
            status: state.bargain.status,
            history: state.bargain.moves.map((m) => `${m.who === 'shop' ? 'Shop' : 'Us'} ₹${m.price}`).join(' → '),
            walk_away_price: state.bargain.walk_away,
            deal_price: state.bargain.deal_price,
          }
        : null,
    },
  );
}

// Only the shopkeeper language in use goes into the prompt (keeps it small = faster, fewer rate limits).
// Written in each language's own script: the Murf voice pronounces native script far better
// than romanised text (Hindi in Devanagari was clear in testing; romanised Kannada was not).
const PHRASES: Record<string, string> = {
  kannada:
    '"ಅಣ್ಣ, ಈ ರೇಟ್‌ಗೆ ಎರಡು ಬರುತ್ತೆ!" / "ನಾನು ಟೂರಿಸ್ಟ್ ಅಲ್ಲ ಅಣ್ಣ, ಇಲ್ಲೇ ಇರೋನು." / "ನಮಸ್ಕಾರ ಅಣ್ಣ!" / "ಅಣ್ಣ, ಇದು ತುಂಬಾ ಜಾಸ್ತಿ ಆಯ್ತು." / "ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಇದು 399 ರೂಪಾಯಿಗೆ ಸಿಗುತ್ತೆ." / "380ಕ್ಕೆ ಕೊಡಿ ಅಣ್ಣ." / "ನಾನು ನಿಮ್ಮ ರೆಗ್ಯುಲರ್ ಕಸ್ಟಮರ್, ಸ್ವಲ್ಪ ಕಮ್ಮಿ ಮಾಡಿ." / "ಈಗಲೇ ಕ್ಯಾಶ್ ಕೊಡ್ತೀನಿ." / "420 ಫೈನಲ್ ಅಣ್ಣ, ಇದಕ್ಕಿಂತ ಜಾಸ್ತಿ ಆಗಲ್ಲ." / "ಸರಿ ಅಣ್ಣ, ಬೇಡ ಬಿಡಿ, ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ತಗೋತೀನಿ." / "ಸರಿ ಅಣ್ಣ, ಡೀಲ್!"',
  hindi:
    '"भैया, इतने में तो दो आ जाएँगे!" / "भैया, मैं टूरिस्ट नहीं हूँ, यहीं का हूँ।" / "चलो भैया, ना आपका नुकसान ना मेरा।" / "नमस्ते भैया!" / "भैया, ये तो बहुत ज़्यादा है।" / "ऑनलाइन यही 399 का मिल रहा है।" / "380 में दे दो भैया।" / "रेगुलर कस्टमर हूँ, थोड़ा कम करो।" / "अभी कैश देता हूँ।" / "420 फाइनल भैया, इससे ज़्यादा नहीं।" / "रहने दो भैया, ऑनलाइन ले लूँगा।" / "ठीक है भैया, डील पक्की!"',
  tamil:
    '"அண்ணா, இந்த விலைக்கு ரெண்டு வாங்கலாம்!" / "நான் டூரிஸ்ட் இல்ல அண்ணா, இங்கேயே இருக்கேன்." / "வணக்கம் அண்ணா!" / "அண்ணா, இது ரொம்ப ஜாஸ்தி." / "ஆன்லைன்ல இது 399க்கு கிடைக்குது." / "380க்கு குடுங்க அண்ணா." / "நான் ரெகுலர் கஸ்டமர், கொஞ்சம் கம்மி பண்ணுங்க." / "420 ஃபைனல் அண்ணா." / "வேண்டாம் அண்ணா, ஆன்லைன்ல வாங்கிக்கிறேன்." / "சரி அண்ணா, டீல்!"',
};
const phraseBank = (lang: string) => PHRASES[lang.toLowerCase()] ?? PHRASES.hindi;

function systemPrompt() {
  const profile = loadProfile();
  return `You are "Little Less", a friendly, witty voice shopping buddy for Indian street markets and online shopping.
Your job: stop the user from overpaying, tell them if a product suits THEM, help bargain, and when a store is the better deal, tell them exactly where it is cheapest (best_store) so they can buy it there.

USER PROFILE:
${JSON.stringify(profileForPrompt())}
Use only the part of the profile that matters for the item: style/colours/wardrobe for clothing, health goals for food, budget for everything. Never bring up clothes or T-shirts unless the item is clothing.

SESSION MEMORY (what already happened in this conversation; trust this over guessing):
${sessionMemory()}

HOW YOU TALK
- This is a VOICE conversation. Talk like a warm, witty friend standing next to them: natural full sentences, never note-style fragments or semicolons. At most 2 short sentences (under 35 words), then stop. No markdown, no lists, no emojis, no symbols like * or #.
- Say prices as "450 rupees".
- Reply to the user in the language they speak: English by default; if they speak Hindi, reply in Hindi written in Devanagari script. Write every non-English language in its own script (Devanagari for Hindi, Kannada script for Kannada, Tamil script for Tamil), never romanised: the voice pronounces native script much better.
- Everything you write is spoken aloud. Never write notes, stage directions or narration such as "User didn't respond yet", "(waiting)", "Assistant:", or descriptions of what you are doing.
- Speech-to-text sometimes mishears. If a sentence looks garbled, guess the likely meaning from context (e.g. "c I scan now" = "I'll scan now") instead of asking about the strange words.
- When the user says "scan", "look at this", "see this", "check this" or "I'll show you", call inspect_product right away (the camera is live).
- Greetings or "are you listening?" → answer warmly that you are listening and ask what they are shopping for. Only if a message is clearly a random fragment of someone else's conversation (e.g. "then in recent weeks I get"), reply with one short line: "I think that was someone nearby. What are you looking at?" Always give exactly ONE reply, never several.

THE FLOW
There are two modes. You start in SUGGEST mode; NEGOTIATE mode begins only when the user asks you to bargain (or taps Negotiate).
1. SUGGEST: when the user shows something or names an item: call inspect_product ONCE (pass description and asked_price if they said them). It checks prices, judges fit, and shows the verdict card.
2. Then give a short, friendly buying opinion like a smart friend: the decision (buy / skip / bargain first), the main reason (fit_note, or "you already have…" from the wardrobe), the size tip if any, and a suggestion if there is one. Follow next_step: if no asked price yet, ask "How much is he asking?". If it's overpriced, say you can negotiate for them. Never comment on the user's body, skin or looks. For food/health items add "not medical advice" if you give a health opinion.
3. If SESSION MEMORY already has current_item, do NOT call inspect_product again for it (not for negotiating, not for ordering). Only call it again when the user shows or names a different item, or gives a new asked price.
4. BARGAINING (the star of the show; make it sound like a real, charming Indian market haggle):
   - If overpriced and negotiable, tell the user the counter offer and ask "Want me to talk to him?"
   - When they say yes / "you talk to him" / "negotiate": call bargain_step(action "start"). When they relay his reply ("he says 500", "he's not agreeing", "okay he agreed"), call bargain_step with shop_counter + shop_price, shop_refuses or shop_accepts.
   - Use ONLY the numbers bargain_step returns (our_offer). Never invent an offer, never go above walk_away_price.
   - Then speak DIRECTLY to the shopkeeper in ${String(profile.shopkeeper_language ?? 'Hindi')}, in its own script, following how_to_say_it. 1 or 2 short lines.
   - YOUR VIBE WITH THE SHOPKEEPER: calm, confident and cool, like a sharp local who has bargained here a hundred times. Relaxed, a little cheeky, with dry wit ("for this price I could get two!", "bhaiya, I'm a regular, not a tourist"), never loud, never rude, never begging. Keep it real and natural, the way people actually haggle in Indian markets.
   - When the user says "stop negotiating" or "leave it": call bargain_step with action "stop".
   - While negotiating (open / counter / final_offer), the WHOLE reply is spoken to the shopkeeper: do not add any English question or comment for the user. Do not greet him again after the first line.
   - Mix tactics across rounds instead of repeating yourself: friendly greeting, "too much", online price, regular customer, buying today/paying cash, final offer, polite walk-away.
   - Phrase ideas (adapt the numbers): ${phraseBank(String(profile.shopkeeper_language ?? "Hindi"))}
   - On a deal: one happy line to the shopkeeper, then one line to the user in English with how much they saved versus his first price.
   - On walk_away: one polite line to the shopkeeper, then tell the user in English where it is cheapest (best_store) and that they can buy it there; the link is on the card.
5. If the shop will not come down, or a store is cheaper: say "The best price is on <best_store store> at <price> rupees, you can buy it from there" (the card has the link). Do NOT say "order online" and do NOT offer to place an order yourself.
6. Only if the user clearly asks YOU to order it for them ("order it", "buy it for me"): use add_to_cart with current_item's product_id, tell the total and ASK for confirmation. Only call checkout with confirmed=true after a clear yes. After ordering: give order id and delivery time.

RULES
- Never invent prices. If price_source is "web", mention it is the live online price and where (online_seller, e.g. "about 1,299 on Amazon"). If price_source is "none", say any number is only your estimate.
- Short replies like "yes", "ok", "haan" answer YOUR last question: if you just asked to confirm an order, call checkout with confirmed=true.
- If inspect_product returns an error, ask the user to show the item or say what it is.
- If the asked price is higher than online_price, say clearly where it is cheaper (best_store), never call it a good deal.
- Prices are always for ONE piece (online_price, best_store). If pack_deal is set, you may add it as an extra tip after the single price, e.g. "or a pack of 3 is 120 rupees, 40 each". Never quote a pack price as the price of one.
- If likely_fake_or_copy is true, do NOT call it a great deal: say it is too cheap to be genuine and is probably a copy, and say where to buy the original (best_store).
- Keep replies fast: call tools only when needed, and call independent tools together in one step.
- Always ask before any purchase. Handle errors gracefully.`;
}

/** Keep only plain user/assistant text from incoming history (Agora adds extra fields). */
function cleanHistory(messages: any[]): Msg[] {
  return (messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
}

// Short lines spoken while tools run, so the user never hears dead silence.
const FILLERS: Record<string, string[]> = {
  inspect_product: ['One second, let me take a look.', 'Hmm, let me check this.', 'Okay, checking the price.'],
  bargain_step: [],
  set_shopkeeper_language: [],
  add_to_cart: ['Sure, adding it now.', 'Okay, doing that.'],
  checkout: ['Placing your order.', 'Okay, ordering it now.'],
  track_order: ['Let me check.'],
  start_return: ['Sure, starting the return.'],
};
const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Runs the LLM with tools until it produces a final answer.
 * onFiller is called once if we need a moment (e.g. looking at the camera) so the user hears something.
 */
/**
 * "Bhaiya is asking 800 for this…", "he wants 1500 for the JBL…" → a NEW price quote.
 * Models sometimes answer these from memory (made-up prices), so code forces a real price check.
 * Counter-offers during bargaining ("he says 500, not less") are excluded.
 */
function isNewPriceQuote(text: string) {
  const t = text.toLowerCase();
  const hasNumber = /\d|hundred|thousand|lakh|sau|hazaar|लाख|हज़ार|हजार|सौ|ಸಾವಿರ|ಲಕ್ಷ/.test(t);
  const quoting =
    /\b(ask|asking|asks|wants|quoting|quoted|selling|costs?|price|charging|bol raha|maang|bata raha|keemat|daam)\b|मांग|माँग|बता रह|कीमत|क़ीमत|दाम|का है|ಕೇಳ್ತಿದ್ದಾರೆ|ಬೆಲೆ/.test(t);
  const bargaining =
    /\b(says|said|reduc|not less|last price|final|down to|come down|agree|offer)\b|कह रह|बोल रह|बोला|कम नहीं|फाइनल|आखिरी|मान गय/.test(t);
  return hasNumber && quoting && !bargaining;
}

/**
 * Safety net for what gets spoken:
 *  - drop tool calls written out as text,
 *  - drop repeated sentences (models sometimes emit several replies glued together),
 *  - keep at most 3 sentences so the voice never rambles.
 */
function cleanSpoken(text: string) {
  const flat = text
    .split('\n')
    .filter((line) => !/^\s*\[?\s*(I called:|inspect_product|bargain_step|add_to_cart|apply_coupon|view_cart|checkout|track_order|start_return)\b/.test(line))
    // List items ("- Online price: 999") become spoken sentences.
    .map((line) => {
      const l = line.replace(/^\s*(?:[-•–]|\d+[.)])\s+/, '').trim();
      return l && !/[.!?।:]$/.test(l) && l !== line.trim() ? `${l}.` : l;
    })
    .join(' ')
    .replace(/\s+[-•–]\s+(?=\p{Lu})/gu, '. ') // inline bullets: "sneakers. - Fair price" → "sneakers. Fair price"
    .replace(/\s+([.,!?।])/g, '$1') // "sneakers ." → "sneakers."
    .replace(/([.!?।])\s*\./g, '$1')
    .replace(/^\s*\((to the shopkeeper|to shopkeeper|shopkeeper)\)\s*/i, '') // leaked internal label
    .replace(/\([^)]*\)/g, '') // stage notes / translations in brackets are never spoken
    .replace(/["“”]/g, '')
    .replace(/[*#_`]+/g, '') // markdown would be read aloud
    .replace(/([.!?।])(?=\S)/g, '$1 ') // "today?Just" → "today? Just"
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?।])/g, '$1') // removing "(Amazon)" can leave "online ." → "online."
    .trim();
  // Split on . ! ? and the Hindi full stop । (works for every script).
  const sentences = flat.match(/[^.!?।]+[.!?।]+|[^.!?।]+$/g) ?? [flat];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const s of sentences) {
    // Leaked internal notes like "User didn't respond yet." are never spoken.
    if (/\b(user|customer)\s+(didn'?t|did not|has ?n'?t|is not|isn'?t)\s+(respond|reply|answer|speak)/i.test(s)) continue;
    if (/^\s*\(.*\)\s*$/.test(s)) continue; // "(waiting for reply)"
    const key = s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(s.trim());
    if (kept.length === 3) break;
  }
  return kept.join(' ');
}

/** Which language the user just spoke, decided in code (models are unreliable at this). */
function userLanguage(text: string): 'Hindi' | 'Kannada' | 'Tamil' | 'English' {
  if (/[ऀ-ॿ]/.test(text)) return 'Hindi';
  if (/[ಀ-೿]/.test(text)) return 'Kannada';
  if (/[஀-௿]/.test(text)) return 'Tamil';
  // Romanised Hindi ("bhaiya kitne ka hai") — reply in Hindi too.
  if (/\b(bhaiya|kitna|kitne|hai|kya|nahi|haan|thoda|zyada|bol raha|karo|accha|theek)\b/i.test(text)) return 'Hindi';
  return 'English';
}

type ThinkResult = { text: string; toShopkeeper: boolean; shopLine?: string; userLine?: string };

const INDIC = /[ऀ-ॿ஀-௿ఀ-౿ಀ-೿]/;
const NON_DEVANAGARI_INDIC = /[஀-௿ఀ-౿ಀ-೿]/;

/** Runs the LLM with tools until it produces the final spoken reply. */
/** Detects "shopkeeper speaks Hindi" / "उनसे हिंदी में बात करो" style requests. */
function shopLanguageRequest(text: string): string | null {
  const t = text.toLowerCase();
  const aboutShop = /shopkeeper|seller|vendor|bhaiya|anna|uncle|\bhim\b|\bher\b|\bthem\b|दुकानदार|भैया|उनसे|उससे|ಅಂಗಡಿ|ಅಣ್ಣ/.test(t);
  if (!aboutShop) return null;
  if (/hindi|हिंदी|हिन्दी/.test(t)) return 'Hindi';
  if (/kannada|ಕನ್ನಡ|कन्नड़/.test(t)) return 'Kannada';
  if (/tamil|தமிழ்|तमिल/.test(t)) return 'Tamil';
  if (/telugu|తెలుగు|तेलुगु/.test(t)) return 'Telugu';
  if (/\benglish\b|अंग्रेज़ी|इंग्लिश/.test(t)) return 'English';
  return null;
}

export async function think(history: Msg[], onFiller?: (text: string) => void): Promise<ThinkResult> {
  const lastUser = String([...history].reverse().find((m) => m.role === 'user')?.content ?? '');
  const lang = userLanguage(lastUser);
  // "The shopkeeper speaks Hindi" → switch the bargaining language in code (don't rely on the AI).
  const switchTo = shopLanguageRequest(lastUser);
  if (switchTo && switchTo !== String(loadProfile().shopkeeper_language)) {
    saveProfile({ ...loadProfile(), shopkeeper_language: switchTo });
    addStatus(`Talking to the shopkeeper in ${switchTo} now`);
  }
  const shopLang = String(loadProfile().shopkeeper_language ?? 'Hindi');
  const messages: Msg[] = [
    { role: 'system', content: systemPrompt() },
    ...history,
    {
      role: 'system',
      content:
        `LANGUAGE FOR THIS REPLY: speak to the user in ${lang}` +
        (lang === 'English' ? '' : ` (${lang} script)`) +
        `. Lines spoken to the shopkeeper are in ${shopLang} script. Never mix other languages into a sentence.`,
    },
  ];
  let saidFiller = false;
  // A bare number ("20000", "1.5k", "₹800") right after we asked "How much is he asking?" IS the shop's price.
  const bareNumber = lastUser.replace(/,/g, '').match(/^\D{0,25}?(\d+(?:\.\d+)?)\s*(k|thousand|हज़ार|हजार)?\D{0,25}$/i);
  const answeredPrice =
    state.verdict && state.verdict.asked_price == null && !(state.bargain && ['negotiating', 'final_offer'].includes(state.bargain.status)) && bareNumber
      ? Math.round(Number(bareNumber[1]) * (bareNumber[2] ? 1000 : 1))
      : null;
  const forcePriceCheck = isNewPriceQuote(lastUser) || (answeredPrice != null && answeredPrice >= 10);
  let emptyRetries = 0;
  let wrongLangRetries = 0;
  let bargainMove: string | null = null;
  let bargainOffer: number | null = null;
  // Each tool may run at most once per turn (stops models looping on the same call),
  // and after 3 tool rounds the model must answer.
  const used = new Set<string>();
  let orderPlaced = false;
  let pendingTotal: number | null = null;

  // Tools are only OFFERED when the user's words call for them. Weaker models otherwise
  // re-check prices every turn, start bargaining unasked, or add things to the bag.
  const t = lastUser.toLowerCase();
  const allowed = new Set<string>(['view_cart', 'apply_coupon']);
  if (/order|deliver|track|parcel|package|return|refund|replace|damaged|broken|wrong size|kab aayega|कब आएगा|ऑर्डर/.test(t)) {
    allowed.add('track_order');
    allowed.add('start_return');
  }
  if (/kannada|hindi|tamil|telugu|english|language|bhasha|speaks?|ಕನ್ನಡ|हिंदी|हिन्दी|தமிழ்/i.test(t)) allowed.add('set_shopkeeper_language');
  if (forcePriceCheck || !state.verdict || /\b(check|scan|look|see|this|these|that|another|new|what about|how about|price of)\b|dekho|ye\b/.test(t)) {
    allowed.add('inspect_product');
  }
  // Bargaining only when the user asks for it, or while a negotiation for the CURRENT item is live.
  const asksToBargain = /talk to (him|her|them|the)|negotiate|bargain|haggle|you (tell|ask|speak)|tell him|ask him|baat karo|bolo|बात कर|मोलभाव|ಮಾತಾಡ/.test(t);
  const relaysShop = /says|said|agree|refus|not reducing|won'?t|last price|final|बोल रह|कह रह|कम नहीं|मान गय|नहीं मान|फाइनल|ಹೇಳ್ತಿದ್ದಾರೆ|stop|leave it|forget it|chhodo|रहने दो|छोड़ो/.test(t);
  const liveBargain =
    state.bargain && state.verdict && state.bargain.item === state.verdict.item && ['negotiating', 'final_offer'].includes(state.bargain.status);
  if (asksToBargain || (liveBargain && relaysShop)) allowed.add('bargain_step');
  // "Yeah" / "ok" only means "buy it" when our last message actually offered to buy or place the order.
  const lastAgent = String([...history].reverse().find((m) => m.role === 'assistant')?.content ?? '').toLowerCase();
  const offeredToBuy = /order|buy it|purchase|add it|place it|shall i|should i get|want me to get/.test(lastAgent);
  if (/\b(order|buy|purchase|cart|checkout|check out|place (it|the order))\b/.test(t) || (offeredToBuy && /\b(yes|yeah|haan|sure|ok|okay|go ahead|confirm|do it)\b|हाँ|हां/.test(t))) {
    allowed.add('add_to_cart');
    allowed.add('checkout');
  }

  // During a live negotiation, clear updates ("he says 500", "he agreed", "he refused", "stop")
  // are applied by CODE right away. The AI then only has to say the line, not decide the move.
  if (liveBargain) {
    const said = t.match(/(?:says|said|asking|wants|bol rah[ae]|कह रह[ेा]|बोल रह[ेा])\D{0,12}(\d[\d,]*)/);
    const action: Record<string, unknown> | null = /\b(stop|leave it|forget it|chhodo)\b|रहने दो|छोड़ो/.test(t)
      ? { action: 'stop' }
      : /\b(agreed|agrees|ok(ay)? (he|done)|deal)\b|मान गय/.test(t)
        ? { action: 'shop_accepts' }
        : said
          ? { action: 'shop_counter', shop_price: Number(said[1].replace(/,/g, '')) }
          : /refus|not reducing|won'?t|nahi maan|नहीं मान|कम नहीं/.test(t)
            ? { action: 'shop_refuses' }
            : null;
    if (action) {
      const id = `auto-bargain-${Date.now()}`;
      const output = await runTool('bargain_step', JSON.stringify(action));
      messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'bargain_step', arguments: JSON.stringify(action) } }] });
      messages.push({ role: 'tool', tool_call_id: id, content: output });
      used.add('bargain_step');
      try {
        const out = JSON.parse(output);
        bargainMove = out.move ?? null;
        bargainOffer = typeof out.our_offer === 'number' ? out.our_offer : null;
      } catch {
        /* ignore */
      }
    }
  }

  for (let step = 0; step < 5; step++) {
    // Every unused tool is OFFERED (Groq rejects the whole request if the model calls a tool that
    // isn't in the list), but only the ALLOWED ones actually run; others are dropped below.
    const available = toolDefinitions.filter((d) => d.type === 'function' && !used.has(d.function.name));
    const mustAnswer = step >= 3 || ![...allowed].some((n) => !used.has(n));
    const toolChoice =
      step === 0 && forcePriceCheck ? ({ type: 'function', function: { name: 'inspect_product' } } as const) : 'auto';
    const res = mustAnswer
      ? await chat({ messages: [...messages, { role: 'system', content: 'Now reply to the user in one or two sentences. No more tool calls.' }] })
      : await chat({ messages, tools: available, tool_choice: toolChoice });
    const msg = res.choices[0]?.message;
    if (!msg) break;

    // Ignore repeat calls to a tool that already ran this turn (and duplicates within one step).
    const seenNow = new Set<string>();
    const blocked: string[] = [];
    const toolCalls = ((msg.tool_calls ?? []) as any[]).filter((c) => {
      if (c.type !== 'function' || used.has(c.function.name) || seenNow.has(c.function.name)) return false;
      if (!allowed.has(c.function.name)) {
        blocked.push(c.function.name);
        return false;
      }
      seenNow.add(c.function.name);
      return true;
    });
    if (!toolCalls.length && (msg.tool_calls?.length ?? 0) > 0 && !msg.content) {
      // Only repeats / tools the user didn't ask for: tell the model to just answer.
      if (blocked.length) messages.push({ role: 'system', content: `Don't use ${blocked.join(', ')} now (the user didn't ask for that). Reply to the user directly.` });
      blocked.forEach((n) => used.add(n));
      continue;
    }
    if (!toolCalls.length) {
      const text = cleanSpoken(msg.content ?? '');
      if (text) {
        // Never let the AI claim an order that wasn't actually placed.
        const claimsOrder = /order (has been |is |was )?(placed|confirmed)|successfully (ordered|placed)|i('ve| have) (placed|ordered)|ordered (it|them) for you/i.test(text);
        if (claimsOrder && !orderPlaced) {
          const total = pendingTotal ?? cartTotalNow();
          return {
            text: total ? `Your total is ${total} rupees with your coupon. Shall I place the order?` : 'Shall I place the order?',
            toShopkeeper: false,
          };
        }
        // Pure negotiation lines (open / counter / final offer) are spoken to the shopkeeper.
        const toShopkeeper = bargainMove === 'open' || bargainMove === 'counter' || bargainMove === 'final_offer';
        // A line for the shopkeeper written in English (no Indian script at all): ask once more, explicitly.
        const shopLangForLine = String(loadProfile().shopkeeper_language ?? 'Hindi');
        if (toShopkeeper && shopLangForLine !== 'English' && !INDIC.test(text) && wrongLangRetries++ < 1) {
          messages.push({
            role: 'system',
            content: `That line is for the SHOPKEEPER: rewrite it entirely in ${shopLangForLine}, written in ${shopLangForLine} script, 1-2 short lines, and offer ${bargainOffer ?? 'our_offer'}. No English.`,
          });
          continue;
        }
        // A negotiation line MUST contain our offer; if the AI forgot it, add it in the shopkeeper's language.
        if (toShopkeeper && bargainOffer && !text.replace(/[,\s]/g, '').includes(String(bargainOffer))) {
          return { text: `${text} ${offerLine(String(loadProfile().shopkeeper_language ?? 'Hindi'), bargainOffer, bargainMove === 'final_offer')}`, toShopkeeper };
        }
        if (toShopkeeper) {
          // A line for the shopkeeper is ONLY in his language: drop English asides like "Let's counter with 940."
          const shopLangNow = String(loadProfile().shopkeeper_language ?? 'Hindi');
          if (shopLangNow !== 'English' && INDIC.test(text)) {
            const parts = text.match(/[^.!?।]+[.!?।]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
            const native = parts.filter((s) => INDIC.test(s)).join(' ');
            if (native) return { text: native, toShopkeeper };
          }
          return { text, toShopkeeper };
        }

        // Talking to the USER: sentences in a script the user didn't speak are lines meant for the
        // shopkeeper. On a deal / walk-away they become their own "to the shopkeeper" bubble;
        // otherwise they don't belong in the reply at all.
        const sentences = text.match(/[^.!?।]+[.!?।]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
        const foreign = (s: string) => (lang === 'Hindi' ? NON_DEVANAGARI_INDIC.test(s) : INDIC.test(s));
        const shopPart = sentences.filter(foreign).join(' ');
        const userPart = sentences.filter((s) => !foreign(s)).join(' ');
        if (shopPart && (bargainMove === 'accept' || bargainMove === 'deal' || bargainMove === 'walk_away')) {
          return { text, toShopkeeper: false, shopLine: shopPart, userLine: userPart };
        }
        if (shopPart && !userPart) {
          if (wrongLangRetries++ < 1) {
            messages.push({ role: 'system', content: `Reply to the user in ${lang} only.` });
            continue;
          }
          return { text: lang === 'English' ? 'Sorry, could you say that again?' : text, toShopkeeper: false };
        }
        let reply = userPart || text;
        // Suggest mode: if we still don't know the shop's price, always ask for it.
        if (used.has('inspect_product') && state.verdict?.asked_price == null && !reply.includes('?') && lang === 'English') {
          reply += ' How much is he asking for it?';
        }
        return { text: reply, toShopkeeper: false };
      }
      if (emptyRetries++ < 1) continue;
      return { text: 'Sorry, can you say that once more?', toShopkeeper: false };
    }

    // Speak a short filler while slow tools run (not before bargaining lines).
    const onlyInstant = toolCalls.every((c) => FILLERS[c.function.name]?.length === 0);
    if (!saidFiller && onFiller && !onlyInstant) {
      const known = toolCalls.map((c) => FILLERS[c.function.name]).find((a) => a?.length);
      onFiller(cleanSpoken(msg.content ?? '') || (known ? pick(known) : 'One moment.'));
      saidFiller = true;
    }

    // If the model forgot to say what the product is, give inspect_product the user's own words.
    for (const call of toolCalls) {
      if (call.function.name !== 'inspect_product') continue;
      let a: Record<string, unknown> = {};
      try {
        a = JSON.parse(call.function.arguments || '{}');
      } catch {
        /* keep empty */
      }
      if (answeredPrice != null) {
        // "20000" answers our question about the CURRENT item: keep the item, set the price.
        a.asked_price = answeredPrice;
        if (!a.description || /^\D*\d[\d,.]*\D*$/.test(String(a.description))) a.description = state.verdict?.item ?? '';
      } else if (a.description) {
        // The model must not INVENT what the product is ("Check this photo" → "handbag"): the scanner
        // trusts the description over the image. Keep it only if it shares a word with what the user said.
        const sig = (x: string) => x.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
        const userWords = new Set(sig(lastUser));
        if (!sig(String(a.description)).some((w) => userWords.has(w))) a.description = lastUser;
      }
      if (typeof a.asked_price === 'string') a.asked_price = Number(String(a.asked_price).replace(/[^\d.]/g, '')) || undefined;
      if (a.asked_price === null) delete a.asked_price;
      if (!a.description && lastUser) a.description = lastUser;
      call.function.arguments = JSON.stringify(a);
    }

    toolCalls.forEach((c) => used.add(c.function.name));
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls });
    const outputs = await Promise.all(toolCalls.map((call) => runTool(call.function.name, call.function.arguments)));
    toolCalls.forEach((call, i) => {
      messages.push({ role: 'tool', tool_call_id: call.id, content: outputs[i] });
      let out: any = {};
      try {
        out = JSON.parse(outputs[i]);
      } catch {
        /* ignore */
      }
      if (call.function.name === 'bargain_step') {
        bargainMove = out.move ?? null;
        bargainOffer = typeof out.our_offer === 'number' ? out.our_offer : null;
      }
      if (call.function.name === 'checkout' && out.order) orderPlaced = true;
      if ((call.function.name === 'checkout' || call.function.name === 'add_to_cart') && typeof out.total === 'number') pendingTotal = out.total;
    });
  }
  return { text: 'Sorry, I got a bit confused. Can you try once more?', toShopkeeper: false };
}

/** "Give it to me for ₹X" in the shopkeeper's language (used when the AI forgets to say the offer). */
function offerLine(lang: string, price: number, final: boolean) {
  const n = price.toLocaleString('en-IN');
  switch (lang.toLowerCase()) {
    case 'kannada':
      return final ? `${n} ಫೈನಲ್ ಅಣ್ಣ, ಇದಕ್ಕಿಂತ ಜಾಸ್ತಿ ಆಗಲ್ಲ.` : `${n}ಕ್ಕೆ ಕೊಡಿ ಅಣ್ಣ.`;
    case 'tamil':
      return final ? `${n} ஃபைனல் அண்ணா.` : `${n}க்கு குடுங்க அண்ணா.`;
    case 'telugu':
      return final ? `${n} ఫైనల్ అన్నా.` : `${n}కి ఇవ్వండి అన్నా.`;
    case 'english':
      return final ? `${n} is my final offer.` : `Can you do ${n}?`;
    default:
      return final ? `${n} फाइनल भैया, इससे ज़्यादा नहीं।` : `${n} में दे दो भैया।`;
  }
}

function cartTotalNow() {
  const sub = state.cart.filter((c) => c.source === 'online').reduce((s, c) => s + c.price * c.qty, 0);
  return sub ? sub - (state.coupon ? Math.round((sub * state.coupon.percent) / 100) : 0) : null;
}

/**
 * One conversation turn, used by BOTH voice and typed chat so they share one memory.
 * Returns the reply text (already added to the feed and to history).
 */
// ---- Voice gate: in a noisy hall the mic also hears announcers and other people. ----
// Clearly-for-us speech goes straight through; unclear speech gets a quick AI check; background is ignored.
const FOR_ME =
  /\d|₹|\b(rs|rupees?|price|cost|asking|asks|buy|purchase|order|cart|check (this|it|that)|scan|look at (this|it)|see (this|these)|negotiat\w*|bargain\w*|cheap|expensive|discount|shopkeeper|seller|size|colou?r|brand|online|amazon|flipkart|worth it|skip it|return it|track|little less|he agreed|he refused|stop negotiating|hindi|kannada|tamil|telugu|protein)\b/i;
// Words an announcer / speaker uses: never let these skip the AI check.
const STAGE_TALK = /\b(everyone|everybody|guys|folks|audience|participants|mentors?|judges?|teams?|hackathon|stage|session|speaker|welcome|round of applause|lunch|break|registration|submission|minutes left)\b/i;
let lastIgnoredNote = 0;
const FOR_ME_NATIVE = /(दाम|कीमत|रुपय|रुपये|खरीद|ऑर्डर|बात कर|बोल|कितन|हाँ|हां|नहीं|ठीक|रुको|ಬೆಲೆ|ರೂಪಾಯಿ|ಹೌದು|ಬೇಡ|விலை|ரூபாய்|ஆமா|வேண்டாம்|ధర|రూపాయ)/;

async function isForAssistant(text: string): Promise<boolean> {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!STAGE_TALK.test(text) && (words.length <= 4 || FOR_ME.test(text) || FOR_ME_NATIVE.test(text))) return true;
  const lastReply = [...state.history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  const prompt =
    `A shopping voice assistant ("Little Less") is listening through a phone mic in a noisy public place. ` +
    `The mic also picks up announcers, speeches and nearby people. Decide if this transcript is the USER talking to the assistant ` +
    `(about shopping, prices, an item, the shopkeeper, or replying to the assistant), or BACKGROUND speech not meant for it.\n` +
    `Assistant's last line: "${String(lastReply).slice(0, 200)}"\nTranscript: "${text.slice(0, 300)}"\nAnswer with exactly one word: USER or BACKGROUND.`;
  try {
    const res = await Promise.race([
      chat({ messages: [{ role: 'user', content: prompt }], max_tokens: 400 }),
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ]);
    const verdict = String(res?.choices[0]?.message?.content ?? '').toUpperCase();
    // When unsure (timeout / odd answer), answer rather than ignore the user.
    return !verdict.includes('BACKGROUND');
  } catch {
    return true;
  }
}

async function converse(text: string, via: 'voice' | 'text', onFiller?: (t: string) => void) {
  // Agora sometimes re-sends the same sentence (even while we are still answering it).
  // Answer it once: duplicates get the same reply instead of a new one.
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const lt = state.lastTurn;
  if (norm(text) && norm(text) === norm(lt.text) && Date.now() - lt.at < 20_000) return lt.promise ?? lt.reply;
  // If the user talks over a reply, Agora sends "<previous sentence> <new sentence>": keep only the new part.
  if (via === 'voice' && lt.text && Date.now() - lt.at < 60_000 && norm(text).startsWith(norm(lt.text) + ' ')) {
    const prevWords = norm(lt.text).split(' ').length;
    text = text.trim().split(/\s+/).slice(prevWords).join(' ');
  }
  // Hold-to-talk: the user pressed the button, so it's definitely them; skip the background check.
  if (via === 'voice' && !state.holdToTalk && !(await isForAssistant(text))) {
    console.log(`[voice] ignored background speech: ${text}`);
    if (Date.now() - lastIgnoredNote > 20_000) {
      lastIgnoredNote = Date.now();
      addStatus(`Ignored background voice: “${text.length > 60 ? text.slice(0, 57) + '…' : text}”`);
    }
    state.lastTurn = { text, at: Date.now(), reply: '', promise: null };
    return '';
  }
  const turn = { text, at: Date.now(), reply: '', promise: null as Promise<string> | null };
  state.lastTurn = turn;
  turn.promise = answer(text, via, onFiller).then((r) => (turn.reply = r));
  return turn.promise;
}

async function answer(text: string, via: 'voice' | 'text', onFiller?: (t: string) => void): Promise<string> {

  addUser(text, via);
  state.turn += 1;
  state.lastUserText = text;
  state.history.push({ role: 'user', content: text });
  try {
    const { text: reply, toShopkeeper, shopLine, userLine } = await think(state.history.slice(-16), (filler) => {
      addAgent(filler);
      onFiller?.(filler);
    });
    if (shopLine) {
      // Deal / walk-away: show the line to the shopkeeper and the line to the user as two bubbles.
      addAgent(shopLine, 'shop');
      if (userLine) addAgent(userLine, 'agent');
    } else addAgent(reply, toShopkeeper ? 'shop' : 'agent');
    state.history.push({ role: 'assistant', content: reply });
    if (state.history.length > 40) state.history.splice(0, state.history.length - 40);
    return reply;
  } catch (err) {
    console.error('[brain] error', err);
    const sorry = 'Sorry, my connection dropped for a second. Can you say that again?';
    addFeedError("Couldn't reach the AI just now. Try again in a moment.");
    return sorry;
  }
}

function sseChunk(res: Response, id: string, content: string) {
  const chunk = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

/** POST /api/brain/chat/completions — called by Agora's cloud agent for every voice turn. */
export async function brainHandler(req: Request, res: Response) {
  // We keep our own memory (shared with typed chat), so from Agora we only need the newest user sentence.
  const incoming = cleanHistory(req.body?.messages);
  const lastUser = String([...incoming].reverse().find((m) => m.role === 'user')?.content ?? '').trim();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const id = `chatcmpl-${Date.now()}`;
  if (lastUser) {
    const reply = await converse(lastUser, 'voice', (filler) => sseChunk(res, id, filler + ' '));
    sseChunk(res, id, reply);
  }
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

/** POST /api/chat — typed message from the app. */
export async function textChatHandler(req: Request, res: Response) {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  const reply = await converse(text, 'text');
  res.json({ reply });
}
