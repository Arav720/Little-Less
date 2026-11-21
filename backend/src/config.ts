// Reads all settings from backend/.env so no key is ever hard-coded.
import 'dotenv/config';

const env = (key: string, fallback = '') => (process.env[key] ?? fallback).trim();

export const config = {
  port: Number(env('PORT', '8000')),
  publicUrl: env('PUBLIC_URL').replace(/\/$/, ''),
  brainSecret: env('BRAIN_SECRET', 'little-less-dev'),
  asrLanguage: env('ASR_LANGUAGE', 'en-IN'),
  serperKey: env('SERPER_API_KEY'),
  agora: {
    appId: env('AGORA_APP_ID'),
    appCertificate: env('AGORA_APP_CERTIFICATE'),
    customerId: env('AGORA_CUSTOMER_ID'),
    customerSecret: env('AGORA_CUSTOMER_SECRET'),
  },
  murf: {
    apiKey: env('MURF_API_KEY'),
    voiceId: env('MURF_VOICE_ID'),
    locale: env('MURF_LOCALE', 'en-IN'),
  },
  llm: {
    apiKey: env('LLM_API_KEY'),
    baseUrl: env('LLM_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai/'),
    model: env('LLM_MODEL', 'gemini-3.1-flash-lite'),
    // Used once if the main model times out / errors. Empty = retry the same model.
    fallbackModel: env('LLM_FALLBACK_MODEL'),
    // Product scanning: the full Flash model reads labels, logos and model numbers best.
    visionModel: env('LLM_VISION_MODEL', 'gemini-3.5-flash'),
    timeoutMs: Number(env('LLM_TIMEOUT_MS', '5000')),
  },
  // Groq: very fast. Each model has its own free rate limit, so we list several and
  // move to the next one instantly if one is busy.
  groq: {
    apiKey: env('GROQ_API_KEY'),
    baseUrl: 'https://api.groq.com/openai/v1',
    brainModels: env('GROQ_BRAIN_MODELS', 'openai/gpt-oss-120b,openai/gpt-oss-20b').split(',').map((s) => s.trim()).filter(Boolean),
    visionModels: env('GROQ_VISION_MODELS', 'qwen/qwen3.8-27b').split(',').map((s) => s.trim()).filter(Boolean),
  },
};

/** Which settings are filled in — shown on the app's setup screen (never the values). */
export function configStatus() {
  return {
    publicUrl: Boolean(config.publicUrl),
    agoraAppId: Boolean(config.agora.appId),
    agoraCertificate: Boolean(config.agora.appCertificate),
    agoraRestKey: Boolean(config.agora.customerId && config.agora.customerSecret),
    murfKey: Boolean(config.murf.apiKey),
    murfVoice: Boolean(config.murf.voiceId),
    llmKey: Boolean(config.llm.apiKey || config.groq.apiKey),
    webSearch: Boolean(config.serperKey),
    llmModel: config.llm.model,
    asrLanguage: config.asrLanguage,
  };
}
