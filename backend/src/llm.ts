// One OpenAI-compatible client. Works with Gemini (default) or OpenAI by changing .env only.
// Every call has a hard timeout; if the main model is slow or overloaded we retry once
// on a fallback model so the voice conversation never freezes.
import OpenAI from 'openai';
import { config } from './config.js';

export const llm = new OpenAI({
  apiKey: config.llm.apiKey || 'missing-key',
  baseURL: config.llm.baseUrl,
  maxRetries: 0, // we do our own fast retry below
});

export const MODEL = config.llm.model;
const FALLBACK = config.llm.fallbackModel;
const TIMEOUT_MS = config.llm.timeoutMs;
// Gemini "thinking" adds latency; turn it off for Gemini models.
const extra = config.llm.baseUrl.includes('googleapis') ? { reasoning_effort: 'none' as any } : {};

type Params = Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, 'model'>;

export async function chat(params: Params) {
  const models = FALLBACK && FALLBACK !== MODEL ? [MODEL, FALLBACK] : [MODEL, MODEL];
  let lastErr: unknown;
  for (const model of models) {
    const started = Date.now();
    try {
      const res = await llm.chat.completions.create({ ...extra, ...params, model }, { timeout: TIMEOUT_MS });
      console.log(`[llm] ${model} ${Date.now() - started}ms`);
      return res;
    } catch (err) {
      lastErr = err;
      console.warn(`[llm] ${model} failed after ${Date.now() - started}ms: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  throw lastErr;
}

/** Plain text completion (used for the vision + fit call). */
export async function fastCompletion(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  const res = await chat({ messages });
  return res.choices[0]?.message?.content ?? '';
}
