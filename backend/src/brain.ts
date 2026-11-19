// The "brain": Agora sends what the user said here (OpenAI chat format).
// We run the LLM + tools in a loop, then stream the final spoken reply back as SSE.
// Docs: https://docs.agora.io/en/ai/build/custom-model-integration/custom-llm
import type { Request, Response } from 'express';
import type OpenAI from 'openai';
import { llm, MODEL } from './llm.js';
import { toolDefinitions, runTool } from './tools.js';
import { loadProfile } from './data.js';
import { state, addLog } from './state.js';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function systemPrompt() {
  const profile = loadProfile();
  return `You are "Little Less", a friendly, witty voice shopping buddy for Indian street markets and online shopping.
Your job: stop the user from overpaying, tell them if a product suits THEM, help bargain, and complete the purchase online when that is the better deal.

USER PROFILE (use this to personalise everything):
${JSON.stringify(profile, null, 2)}

HOW YOU TALK
- This is a VOICE conversation. Reply in 1-3 short sentences. No markdown, no lists, no emojis, no symbols like * or #.
- Say prices as "rupees 450" or "450 rupees".
- Mirror the user's language: English, Hindi, Hinglish, Kannada, Tamil, Telugu are all fine.

THE FLOW
1. When the user shows something or mentions a shopkeeper's price: call look_at_camera, then check_price (pass asked_price if they said one).
2. Judge personal fit using ONLY the profile: style, colours, wardrobe (avoid duplicates), goals (e.g. sugar), budget. For clothes, NEVER comment on the user's body, skin or looks; judge the item against their stated taste. For food/health items, compare label facts with their goals and add "not medical advice" if you give a health opinion.
3. Call show_verdict, then speak the verdict briefly: fair or not, fit or not, what to do.
4. If overpriced and negotiable: suggest a counter offer. If the user asks you to talk to the shopkeeper ("you tell him", "aap baat karo"), speak DIRECTLY to the shopkeeper in ${String(profile.shopkeeper_language ?? 'the local language')}, politely and warmly, mention the online price, and offer the counter price. Keep it respectful, never insult the seller.
5. If the shop will not come down, or it is a fixed MRP item with a better or healthier option online, offer to order online. Use add_to_cart, apply the user's saved coupon, then tell the total and ASK for confirmation. Only call checkout with confirmed=true after a clear yes.
6. After ordering: give order id, delivery time, and offer tracking. Help with tracking and returns if asked.

RULES
- Never invent catalog prices. If check_price says not found, say your number is only an estimate.
- If the camera sees nothing clear, ask the user to hold the item closer.
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

const SLOW_TOOLS = new Set(['look_at_camera']);

/**
 * Runs the LLM with tools until it produces a final answer.
 * onFiller is called once if we need a moment (e.g. looking at the camera) so the user hears something.
 */
export async function think(history: Msg[], onFiller?: (text: string) => void): Promise<string> {
  const messages: Msg[] = [{ role: 'system', content: systemPrompt() }, ...history];
  let saidFiller = false;

  for (let step = 0; step < 8; step++) {
    const res = await llm.chat.completions.create({
      model: MODEL,
      messages,
      tools: toolDefinitions,
      tool_choice: 'auto',
    });
    const msg = res.choices[0]?.message;
    if (!msg) break;

    const toolCalls = (msg.tool_calls ?? []).filter((c: any) => c.type === 'function') as any[];
    if (!toolCalls.length) return (msg.content ?? '').trim() || 'Hmm, can you say that again?';

    if (!saidFiller && onFiller && toolCalls.some((c) => SLOW_TOOLS.has(c.function.name))) {
      onFiller(msg.content?.trim() || 'One second, let me take a look.');
      saidFiller = true;
    }

    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls });
    for (const call of toolCalls) {
      const output = await runTool(call.function.name, call.function.arguments);
      messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
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
