// The "brain": Agora sends what the user said here (OpenAI chat format).
// We run the LLM + tools in a loop, then stream the final spoken reply back as SSE.
// Docs: https://docs.agora.io/en/ai/build/custom-model-integration/custom-llm
import type { Request, Response } from 'express';
import type OpenAI from 'openai';
import { chat, MODEL } from './llm.js';
import { toolDefinitions, runTool } from './tools.js';
import { loadProfile } from './data.js';
import { state, addLog } from './state.js';

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
    },
    null,
    2,
  );
}

function systemPrompt() {
  const profile = loadProfile();
  return `You are "Little Less", a friendly, witty voice shopping buddy for Indian street markets and online shopping.
Your job: stop the user from overpaying, tell them if a product suits THEM, help bargain, and complete the purchase online when that is the better deal.

USER PROFILE (use this to personalise everything):
${JSON.stringify(profile, null, 2)}

SESSION MEMORY (what already happened in this conversation; trust this over guessing):
${sessionMemory()}

HOW YOU TALK
- This is a VOICE conversation. Reply in at most 2 short sentences (under 35 words), then stop. Longer replies make the user wait. No markdown, no lists, no emojis, no symbols like * or #.
- Say prices as "rupees 450" or "450 rupees".
- Mirror the user's language: English, Hindi, Hinglish, Kannada, Tamil, Telugu are all fine.

THE FLOW
1. When the user shows something or mentions a shopkeeper's price: call inspect_product ONCE (pass description and asked_price if they said them). It looks at the camera, checks prices, judges fit, and already shows the verdict card on screen.
2. Speak the verdict briefly from its result: fair or not, suits them or not (use fit_note), what to do. Never comment on the user's body, skin or looks. For food/health items, compare nutrition with their goals and add "not medical advice" if you give a health opinion.
3. If SESSION MEMORY already has current_item, do NOT call inspect_product again for it (not for negotiating, not for ordering). Only call it again when the user shows or names a different item, or gives a new asked price.
4. If overpriced and negotiable: suggest the counter offer. If the user asks you to talk to the shopkeeper ("you tell him", "aap baat karo"), speak DIRECTLY to the shopkeeper in ${String(profile.shopkeeper_language ?? 'the local language')}, politely and warmly, mention the online price, and offer the counter price. Keep it respectful, never insult the seller. Say ONLY the words for the shopkeeper: no English translation, no brackets, no notes (everything you write is spoken aloud).
   If the user then tells you the shopkeeper's new price, compare it with the fair range: accept if it is within range, otherwise make one more offer or suggest ordering online.
5. If the shop will not come down, or it is a fixed MRP item with a better or healthier option online, offer to order online. Use add_to_cart with current_item's product_id (it applies their saved coupon automatically), then tell the total and ASK for confirmation. Only call checkout with confirmed=true after a clear yes.
6. After ordering: give order id, delivery time, and offer tracking. Help with tracking and returns if asked.

RULES
- Never invent catalog prices. If inspect_product says in_catalog is false, say any number is only an estimate.
- Short replies like "yes", "ok", "haan" answer YOUR last question: if you just asked to confirm an order, call checkout with confirmed=true.
- If inspect_product returns an error, ask the user to show the item or say what it is.
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
export async function think(history: Msg[], onFiller?: (text: string) => void): Promise<string> {
  const messages: Msg[] = [{ role: 'system', content: systemPrompt() }, ...history];
  let saidFiller = false;

  for (let step = 0; step < 8; step++) {
    const res = await chat({ messages, tools: toolDefinitions, tool_choice: 'auto' });
    const msg = res.choices[0]?.message;
    if (!msg) break;

    const toolCalls = (msg.tool_calls ?? []).filter((c: any) => c.type === 'function') as any[];
    if (!toolCalls.length) {
      const text = (msg.content ?? '').trim();
      if (text) return text;
      // Model returned nothing: ask once more for a spoken answer without tools.
      const retry = await chat({ messages: [...messages, { role: 'user', content: '(Reply to the user now in one or two short sentences.)' }] });
      return retry.choices[0]?.message?.content?.trim() || 'Sorry, can you say that once more?';
    }

    if (!saidFiller && onFiller) {
      const known = toolCalls.map((c) => FILLERS[c.function.name]).find(Boolean);
      onFiller(msg.content?.trim() || (known ? pick(known) : 'One moment.'));
      saidFiller = true;
    }

    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls });
    // Run this step's tools in parallel.
    const outputs = await Promise.all(toolCalls.map((call) => runTool(call.function.name, call.function.arguments)));
    toolCalls.forEach((call, i) => messages.push({ role: 'tool', tool_call_id: call.id, content: outputs[i] }));
  }
  return 'Sorry, I got a bit confused. Can you try once more?';
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

/** POST /api/brain/chat/completions — called by Agora's cloud agent. */
export async function brainHandler(req: Request, res: Response) {
  const history = cleanHistory(req.body?.messages);
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  if (lastUser) addLog('user', String(lastUser.content));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const id = `chatcmpl-${Date.now()}`;
  try {
    const reply = await think(history, (filler) => {
      addLog('agent', filler);
      sseChunk(res, id, filler + ' ');
    });
    addLog('agent', reply);
    sseChunk(res, id, reply);
  } catch (err) {
    addLog('error', `Brain error: ${(err as Error).message}`);
    sseChunk(res, id, 'Sorry, something went wrong on my side. Can you say that again?');
  }
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

/** POST /api/chat — typed chat from the app (for testing without using voice minutes). */
export async function textChatHandler(req: Request, res: Response) {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  addLog('user', text);
  state.textHistory.push({ role: 'user', content: text });
  try {
    const reply = await think(state.textHistory.slice(-20), (filler) => addLog('agent', filler));
    state.textHistory.push({ role: 'assistant', content: reply });
    addLog('agent', reply);
    res.json({ reply });
  } catch (err) {
    addLog('error', `Brain error: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
}
