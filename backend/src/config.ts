// Reads all settings from backend/.env so no key is ever hard-coded.
import 'dotenv/config';

const env = (key: string, fallback = '') => (process.env[key] ?? fallback).trim();

export const config = {
  port: Number(env('PORT', '8000')),
  publicUrl: env('PUBLIC_URL').replace(/\/$/, ''),
  brainSecret: env('BRAIN_SECRET', 'little-less-dev'),
  asrLanguage: env('ASR_LANGUAGE', 'en-IN'),
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
    timeoutMs: Number(env('LLM_TIMEOUT_MS', '5000')),
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
    llmKey: Boolean(config.llm.apiKey),
    llmModel: config.llm.model,
    asrLanguage: config.asrLanguage,
  };
}
