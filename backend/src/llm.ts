// Talks to the AI models. We use two providers (both OpenAI-compatible):
//   Groq   – very fast (~0.5 s), used first.
//   Gemini – backup if Groq is rate-limited, slow or down.
// Each call tries the list in order: on an error, rate limit or timeout it moves to the next.
import OpenAI from 'openai';
import { config } from './config.js';

type Target = { label: string; client: OpenAI; model: string; extra: Record<string, unknown> };

const gemini = config.llm.apiKey
  ? new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl, maxRetries: 0 })
  : null;
const groq = config.groq.apiKey
  ? new OpenAI({ apiKey: config.groq.apiKey, baseURL: config.groq.baseUrl, maxRetries: 0 })
  : null;

const isGoogle = config.llm.baseUrl.includes('googleapis');

function geminiTargets(): Target[] {
  if (!gemini) return [];
  const list: Target[] = [
    // "Thinking" adds latency; the main Gemini model accepts turning it off.
    { label: 'gemini', client: gemini, model: config.llm.model, extra: isGoogle ? { reasoning_effort: 'none' } : {} },
  ];
  if (config.llm.fallbackModel && config.llm.fallbackModel !== config.llm.model) {
    list.push({ label: 'gemini', client: gemini, model: config.llm.fallbackModel, extra: {} });
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
const visionTargets = [...groqTargets(config.groq.visionModels), ...geminiTargets()];

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

export async function chat(params: Params, purpose: 'brain' | 'vision' = 'brain') {
  const targets = purpose === 'vision' ? visionTargets : brainTargets;
  if (!targets.length) throw new Error('No LLM key set. Add GROQ_API_KEY or LLM_API_KEY to backend/.env');
  let lastErr: unknown;
  for (const t of targets) {
    const started = Date.now();
    try {
      const messages = t.label === 'gemini' ? flattenToolHistory(params.messages) : params.messages;
      const res = await t.client.chat.completions.create(
        { ...t.extra, ...params, messages, model: t.model },
        { timeout: config.llm.timeoutMs },
      );
      console.log(`[llm] ${purpose} ${t.model} ${Date.now() - started}ms (${res.usage?.prompt_tokens ?? '?'} in / ${res.usage?.completion_tokens ?? '?'} out tokens)`);
      return res;
    } catch (err) {
      lastErr = err;
      console.warn(`[llm] ${purpose} ${t.model} failed after ${Date.now() - started}ms: ${(err as Error).message.slice(0, 100)}`);
    }
  }
  throw lastErr;
}

/** Plain text completion for the camera/vision call. */
export async function fastCompletion(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  const res = await chat({ messages }, 'vision');
  return res.choices[0]?.message?.content ?? '';
}
