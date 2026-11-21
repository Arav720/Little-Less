// Talks to the AI models. We use two providers (both OpenAI-compatible):
//   Groq   – very fast (~0.5 s), used first.
//   Gemini – backup if Groq is rate-limited, slow or down.
// Each call tries the list in order: on an error, rate limit or timeout it moves to the next.
import OpenAI from 'openai';
import { config } from './config.js';

type Target = { label: string; client: OpenAI; model: string; extra: Record<string, unknown>; timeoutMs?: number };

const gemini = config.llm.apiKey
  ? new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl, maxRetries: 0 })
  : null;
const groq = config.groq.apiKey
  ? new OpenAI({ apiKey: config.groq.apiKey, baseURL: config.groq.baseUrl, maxRetries: 0 })
  : null;

const isGoogle = config.llm.baseUrl.includes('googleapis');

/**
 * "Thinking" adds seconds, so keep it as low as each model allows (measured):
 *  - full Flash (3.5+): "minimal" (~1.4 s with a photo; default thinking ~3 s)
 *  - 3.1 Flash-Lite: "none"
 *  - 3.5 Flash-Lite: rejects the setting, so send nothing.
 */
function thinkingFor(model: string): Record<string, unknown> {
  if (!isGoogle) return {};
  if (/flash-lite/.test(model)) return /3\.1/.test(model) ? { reasoning_effort: 'none' } : {};
  if (/flash/.test(model)) return { reasoning_effort: 'minimal' };
  return {};
}

function geminiTargets(): Target[] {
  if (!gemini) return [];
  const list: Target[] = [{ label: 'gemini', client: gemini, model: config.llm.model, extra: thinkingFor(config.llm.model) }];
  if (config.llm.fallbackModel && config.llm.fallbackModel !== config.llm.model) {
    list.push({ label: 'gemini', client: gemini, model: config.llm.fallbackModel, extra: thinkingFor(config.llm.fallbackModel) });
  }
  return list;
}

function groqTargets(models: string[]): Target[] {
  if (!groq) return [];
  return models.map((model) => ({
    label: 'groq',
    client: groq,
    model,
    // gpt-oss models "think" first; keep it short for voice.
    extra: model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {},
  }));
}

// Order matters for quality: the big Groq model first, then Gemini (smarter than the small
// Groq model, a bit slower), and the small Groq model only as the last resort.
const [bestGroq, ...otherGroq] = config.groq.brainModels;
const brainTargets = [
  ...groqTargets(bestGroq ? [bestGroq] : []),
  ...geminiTargets(),
  ...groqTargets(otherGroq),
];
// Vision: Gemini first. It reads labels, logos and model numbers better than the Groq vision
// model (about 1 s slower). Groq stays as the backup if Gemini is slow, busy or rate-limited.
// The image call gets more time (8 s): a photo plus a careful read is slower than a chat reply.
const visionTargets = [
  ...(gemini && config.llm.visionModel ? [{ label: 'gemini', client: gemini, model: config.llm.visionModel, extra: thinkingFor(config.llm.visionModel), timeoutMs: 8000 } as Target] : []),
  ...geminiTargets(),
  ...groqTargets(config.groq.visionModels),
];

export const MODEL = brainTargets[0]?.model ?? config.llm.model;

type Params = Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, 'model'>;

/**
 * Gemini refuses tool-call history that another model produced (it wants its own "thought signatures").
 * So before sending to Gemini, rewrite earlier tool calls/results in this turn as plain text.
 */
function flattenToolHistory(messages: Params['messages']): Params['messages'] {
  const out = messages.map((m: any) => {
    // Plain-language notes, so Gemini doesn't copy a "function(...)" format into its spoken reply.
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return { role: 'assistant', content: m.content || 'Let me check that.' };
    }
    if (m.role === 'tool') {
      return { role: 'user', content: `(Background facts from the shop system. Use them, but do not read this note out: ${m.content})` };
    }
    return m;
  });
  // Gemini rejects a conversation that ends with the assistant speaking ("ends with a model turn").
  if ((out.at(-1) as any)?.role === 'assistant') out.push({ role: 'user', content: '(Continue.)' });
  return out;
}

// Cool-down: a model that just hit a rate limit or timed out is skipped for a while, instead of
// making every turn wait for it to fail again (e.g. Groq's daily token quota running out).
const coolUntil = new Map<string, number>();
function coolDown(t: Target, err: unknown) {
  const msg = String((err as Error)?.message ?? '');
  const status = (err as { status?: number })?.status;
  let ms = 0;
  if (status === 429 || /rate limit/i.test(msg)) {
    const m = msg.match(/try again in (?:(\d+)m)?([\d.]+)s/i);
    ms = m ? (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000 : 60_000;
    ms = Math.min(Math.max(ms, 20_000), 15 * 60_000);
  } else if (/timed? ?out/i.test(msg) || (status ?? 0) >= 500) {
    ms = 45_000;
  }
  if (ms) coolUntil.set(`${t.label}:${t.model}`, Date.now() + ms);
}

export async function chat(params: Params, purpose: 'brain' | 'vision' = 'brain') {
  const all = purpose === 'vision' ? visionTargets : brainTargets;
  if (!all.length) throw new Error('No LLM key set. Add GROQ_API_KEY or LLM_API_KEY to backend/.env');
  // Skip models in cool-down (but if everything is cooling down, try them all anyway).
  const ready = all.filter((t) => (coolUntil.get(`${t.label}:${t.model}`) ?? 0) < Date.now());
  const targets = ready.length ? ready : all;
  let lastErr: unknown;
  for (const t of targets) {
    const started = Date.now();
    try {
      const messages = t.label === 'gemini' ? flattenToolHistory(params.messages) : params.messages;
      const res = await t.client.chat.completions.create(
        { ...t.extra, ...params, messages, model: t.model },
        { timeout: t.timeoutMs ?? config.llm.timeoutMs },
      );
      console.log(`[llm] ${purpose} ${t.model} ${Date.now() - started}ms (${res.usage?.prompt_tokens ?? '?'} in / ${res.usage?.completion_tokens ?? '?'} out tokens)`);
      return res;
    } catch (err) {
      // Groq rejects a tool call whose arguments break the schema (e.g. asked_price: null), but it
      // returns what the model tried. Recover that call instead of failing the turn; the brain cleans the arguments.
      const recovered = recoverToolCall(err, params);
      if (recovered) {
        console.log(`[llm] ${purpose} ${t.model} recovered a rejected tool call (${(recovered.choices[0].message.tool_calls![0] as any).function.name})`);
        return recovered;
      }
      lastErr = err;
      coolDown(t, err);
      console.warn(`[llm] ${purpose} ${t.model} failed after ${Date.now() - started}ms: ${(err as Error).message.slice(0, 400)}`);
    }
  }
  throw lastErr;
}

function recoverToolCall(err: unknown, params: Params): OpenAI.Chat.Completions.ChatCompletion | null {
  const e = err as { error?: { code?: string; failed_generation?: string }; code?: string };
  const failed = e?.error?.failed_generation;
  if ((e?.error?.code ?? e?.code) !== 'tool_use_failed' || !failed) return null;
  try {
    const raw = JSON.parse(failed);
    const call = Array.isArray(raw) ? raw[0] : raw;
    const name = String(call?.name ?? '');
    const known = (params.tools ?? []).some((tl: any) => tl.function?.name === name);
    if (!known) return null;
    const args = Object.fromEntries(Object.entries(call.arguments ?? call.parameters ?? {}).filter(([, v]) => v !== null));
    return {
      id: `recovered-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'recovered',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          logprobs: null,
          message: {
            role: 'assistant',
            content: '',
            refusal: null,
            tool_calls: [{ id: `call_${Date.now()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
          },
        },
      ],
    } as OpenAI.Chat.Completions.ChatCompletion;
  } catch {
    return null;
  }
}

/** Plain text completion for the camera/vision call. */
export async function fastCompletion(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  const res = await chat({ messages }, 'vision');
  return res.choices[0]?.message?.content ?? '';
}
