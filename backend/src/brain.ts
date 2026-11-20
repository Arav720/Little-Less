// The "brain": Agora sends what the user said here (OpenAI chat format).
// We run the LLM + tools in a loop, then stream the final spoken reply back as SSE.
// Docs: https://docs.agora.io/en/ai/build/custom-model-integration/custom-llm
import type { Request, Response } from 'express';
import type OpenAI from 'openai';
import { chat, MODEL } from './llm.js';
import { toolDefinitions, runTool } from './tools.js';
import { loadProfile, saveProfile } from './data.js';
import { state, addUser, addAgent, addFeedError, addStatus } from './state.js';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

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
    '"ನಮಸ್ಕಾರ ಅಣ್ಣ!" / "ಅಣ್ಣ, ಇದು ತುಂಬಾ ಜಾಸ್ತಿ ಆಯ್ತು." / "ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಇದು 399 ರೂಪಾಯಿಗೆ ಸಿಗುತ್ತೆ." / "380ಕ್ಕೆ ಕೊಡಿ ಅಣ್ಣ." / "ನಾನು ನಿಮ್ಮ ರೆಗ್ಯುಲರ್ ಕಸ್ಟಮರ್, ಸ್ವಲ್ಪ ಕಮ್ಮಿ ಮಾಡಿ." / "ಈಗಲೇ ಕ್ಯಾಶ್ ಕೊಡ್ತೀನಿ." / "420 ಫೈನಲ್ ಅಣ್ಣ, ಇದಕ್ಕಿಂತ ಜಾಸ್ತಿ ಆಗಲ್ಲ." / "ಸರಿ ಅಣ್ಣ, ಬೇಡ ಬಿಡಿ, ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ತಗೋತೀನಿ." / "ಸರಿ ಅಣ್ಣ, ಡೀಲ್!"',
  hindi:
    '"नमस्ते भैया!" / "भैया, ये तो बहुत ज़्यादा है।" / "ऑनलाइन यही 399 का मिल रहा है।" / "380 में दे दो भैया।" / "रेगुलर कस्टमर हूँ, थोड़ा कम करो।" / "अभी कैश देता हूँ।" / "420 फाइनल भैया, इससे ज़्यादा नहीं।" / "रहने दो भैया, ऑनलाइन ले लूँगा।" / "ठीक है भैया, डील पक्की!"',
  tamil:
    '"வணக்கம் அண்ணா!" / "அண்ணா, இது ரொம்ப ஜாஸ்தி." / "ஆன்லைன்ல இது 399க்கு கிடைக்குது." / "380க்கு குடுங்க அண்ணா." / "நான் ரெகுலர் கஸ்டமர், கொஞ்சம் கம்மி பண்ணுங்க." / "420 ஃபைனல் அண்ணா." / "வேண்டாம் அண்ணா, ஆன்லைன்ல வாங்கிக்கிறேன்." / "சரி அண்ணா, டீல்!"',
};
const phraseBank = (lang: string) => PHRASES[lang.toLowerCase()] ?? PHRASES.hindi;

function systemPrompt() {
  const profile = loadProfile();
  return `You are "Little Less", a friendly, witty voice shopping buddy for Indian street markets and online shopping.
Your job: stop the user from overpaying, tell them if a product suits THEM, help bargain, and complete the purchase online when that is the better deal.

USER PROFILE:
${JSON.stringify(profile)}
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
1. When the user shows something or mentions a shopkeeper's price: call inspect_product ONCE (pass description and asked_price if they said them). It looks at the camera, checks prices, judges fit, and already shows the verdict card on screen.
2. Speak the verdict briefly from its result: fair or not, suits them or not (use fit_note), what to do. Never comment on the user's body, skin or looks. For food/health items, compare nutrition with their goals and add "not medical advice" if you give a health opinion.
3. If SESSION MEMORY already has current_item, do NOT call inspect_product again for it (not for negotiating, not for ordering). Only call it again when the user shows or names a different item, or gives a new asked price.
4. BARGAINING (the star of the show; make it sound like a real, charming Indian market haggle):
   - If overpriced and negotiable, tell the user the counter offer and ask "Want me to talk to him?"
   - When they say yes / "you talk to him" / "negotiate": call bargain_step(action "start"). When they relay his reply ("he says 500", "he's not agreeing", "okay he agreed"), call bargain_step with shop_counter + shop_price, shop_refuses or shop_accepts.
   - Use ONLY the numbers bargain_step returns (our_offer). Never invent an offer, never go above walk_away_price.
   - Then speak DIRECTLY to the shopkeeper in ${String(profile.shopkeeper_language ?? 'Hindi')}, in its own script, following how_to_say_it. 1 or 2 short, warm, confident lines, like a regular local customer. Respectful, a little playful, never rude. No English translation, no brackets.
   - While negotiating (open / counter / final_offer), the WHOLE reply is spoken to the shopkeeper: do not add any English question or comment for the user. Do not greet him again after the first line.
   - Mix tactics across rounds instead of repeating yourself: friendly greeting, "too much", online price, regular customer, buying today/paying cash, final offer, polite walk-away.
   - Phrase ideas (adapt the numbers): ${phraseBank(String(profile.shopkeeper_language ?? "Hindi"))}
   - On a deal: one happy line to the shopkeeper, then one line to the user in English with how much they saved versus his first price.
   - On walk_away: one polite line to the shopkeeper, then ask the user in English if you should order it online now.
5. If the shop will not come down, or it is a fixed MRP item with a better or healthier option online, offer to order online. Use add_to_cart with current_item's product_id (it applies their saved coupon automatically), then tell the total and ASK for confirmation. Only call checkout with confirmed=true after a clear yes.
6. After ordering: give order id, delivery time, and offer tracking. Help with tracking and returns if asked.

RULES
- Never invent prices. If price_source is "web", mention it is the live online price and where (online_seller, e.g. "about 1,299 on Amazon"). If price_source is "none", say any number is only your estimate.
- Short replies like "yes", "ok", "haan" answer YOUR last question: if you just asked to confirm an order, call checkout with confirmed=true.
- If inspect_product returns an error, ask the user to show the item or say what it is.
- If the asked price is higher than online_price, say clearly that online is cheaper (never call it a good deal).
- If likely_fake_or_copy is true, do NOT call it a great deal: say it is too cheap to be genuine and is probably a copy, and offer the original online.
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
    .join(' ')
    .replace(/^\s*\((to the shopkeeper|to shopkeeper|shopkeeper)\)\s*/i, '') // leaked internal label
    .replace(/\([^)]*\)/g, '') // stage notes / translations in brackets are never spoken
    .replace(/["“”]/g, '')
    .replace(/[*#_`]+/g, '') // markdown would be read aloud
    .replace(/([.!?।])(?=\S)/g, '$1 ') // "today?Just" → "today? Just"
    .replace(/\s+/g, ' ')
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

type ThinkResult = { text: string; toShopkeeper: boolean };

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
  const forcePriceCheck = isNewPriceQuote(lastUser);
  let emptyRetries = 0;
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
  const allowed = new Set<string>(['view_cart', 'track_order', 'start_return', 'apply_coupon']);
  if (/kannada|hindi|tamil|telugu|english|language|bhasha|speaks?|ಕನ್ನಡ|हिंदी|हिन्दी|தமிழ்/i.test(t)) allowed.add('set_shopkeeper_language');
  if (forcePriceCheck || !state.verdict || /\b(check|scan|look|see|this|these|that|another|new|what about|how about|price of)\b|dekho|ye\b/.test(t)) {
    allowed.add('inspect_product');
  }
  if (state.bargain || /talk to (him|her|them|the)|negotiate|bargain|haggle|you (tell|ask|speak)|tell him|ask him|baat karo|bolo|says|said|agree|refus|not reducing|won'?t|last price|final|बात कर|मोलभाव|बोल रह|कह रह|कम नहीं|मान गय|नहीं मान|फाइनल|ಮಾತಾಡ|ಹೇಳ್ತಿದ್ದಾರೆ/.test(t)) {
    allowed.add('bargain_step');
  }
  if (/order|buy|online|cart|bag|add|purchase|checkout|check out|book|yes|yeah|haan|sure|ok|okay|go ahead|confirm|place/.test(t)) {
    allowed.add('add_to_cart');
    allowed.add('checkout');
  }

  for (let step = 0; step < 5; step++) {
    const available = toolDefinitions.filter(
      (d) => d.type === 'function' && !used.has(d.function.name) && allowed.has(d.function.name),
    );
    const mustAnswer = step >= 3 || available.length === 0;
    const toolChoice =
      step === 0 && forcePriceCheck ? ({ type: 'function', function: { name: 'inspect_product' } } as const) : 'auto';
    const res = mustAnswer
      ? await chat({ messages: [...messages, { role: 'system', content: 'Now reply to the user in one or two sentences. No more tool calls.' }] })
      : await chat({ messages, tools: available, tool_choice: toolChoice });
    const msg = res.choices[0]?.message;
    if (!msg) break;

    // Ignore repeat calls to a tool that already ran this turn (and duplicates within one step).
    const seenNow = new Set<string>();
    const toolCalls = ((msg.tool_calls ?? []) as any[]).filter((c) => {
      if (c.type !== 'function' || used.has(c.function.name) || seenNow.has(c.function.name)) return false;
      seenNow.add(c.function.name);
      return true;
    });
    if (!toolCalls.length && (msg.tool_calls?.length ?? 0) > 0 && !msg.content) continue; // only repeats: ask again
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
        // A negotiation line MUST contain our offer; if the AI forgot it, add it in the shopkeeper's language.
        if (toShopkeeper && bargainOffer && !text.replace(/[,s]/g, '').includes(String(bargainOffer))) {
          return { text: `${text} ${offerLine(String(loadProfile().shopkeeper_language ?? "Hindi"), bargainOffer, bargainMove === 'final_offer')}`, toShopkeeper };
        }
        return { text, toShopkeeper };
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
async function converse(text: string, via: 'voice' | 'text', onFiller?: (t: string) => void) {
  // Agora sometimes re-sends the same sentence (even while we are still answering it).
  // Answer it once: duplicates get the same reply instead of a new one.
  const norm = (x: string) => x.toLowerCase().replace(/[^p{L}p{N}]+/gu, ' ').trim();
  const lt = state.lastTurn;
  if (norm(text) && norm(text) === norm(lt.text) && Date.now() - lt.at < 20_000) return lt.promise ?? lt.reply;
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
    const { text: reply, toShopkeeper } = await think(state.history.slice(-16), (filler) => {
      addAgent(filler);
      onFiller?.(filler);
    });
    addAgent(reply, toShopkeeper ? 'shop' : 'agent');
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
