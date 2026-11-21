// Talks to Agora: makes RTC tokens and starts/stops the Conversational AI agent.
// Docs: https://docs.agora.io/en/ai/build/start-stop-agent
import agoraToken from 'agora-token';
import { config } from './config.js';
import { state, addLog } from './state.js';
import { loadProfile } from './data.js';
import { voiceprintUrl } from './voiceprint.js';

const { RtcTokenBuilder, RtcRole, ConvoAITokenBuilder } = agoraToken as any;

export const USER_UID = 1002; // the person using the app
export const AGENT_UID = 1001; // the AI agent
const TOKEN_TTL = 3600; // 1 hour

/** Token that lets the browser join the voice channel. */
export function userToken(channel: string) {
  return RtcTokenBuilder.buildTokenWithUid(
    config.agora.appId,
    config.agora.appCertificate,
    channel,
    USER_UID,
    RtcRole.PUBLISHER,
    TOKEN_TTL,
    TOKEN_TTL,
  ) as string;
}

/** Token for the AI agent (RTC + RTM privileges, as Agora's ConvoAI expects). */
function agentToken(channel: string) {
  return ConvoAITokenBuilder.buildToken(
    config.agora.appId,
    config.agora.appCertificate,
    channel,
    String(AGENT_UID),
    TOKEN_TTL,
    TOKEN_TTL,
  ) as string;
}

function authHeader(channel: string) {
  const { customerId, customerSecret } = config.agora;
  if (customerId && customerSecret) {
    return 'Basic ' + Buffer.from(`${customerId}:${customerSecret}`).toString('base64');
  }
  // Fallback: token-based auth (built from App ID + certificate).
  return `agora token="${agentToken(channel)}"`;
}

const SPEAKING_RULES = 'You are Little Less, a voice shopping buddy.';

/**
 * Which languages the speech-to-text listens for. English alone is the most accurate: Agora's
 * smart end-of-speech detection only works with a single English locale (with 2+ languages it
 * falls back to plain silence detection, which chops and merges sentences). So we add at most
 * ONE extra language, and only if the user chose "I'll also talk to Little Less in …".
 */
const ASR_CODES: Record<string, string> = { hindi: 'hi-IN', kannada: 'kn-IN', tamil: 'ta-IN', telugu: 'te-IN' };
function asrLanguages() {
  const extra = ASR_CODES[String(loadProfile().voice_language ?? '').toLowerCase()];
  return extra ? `en-IN,${extra}` : 'en-IN';
}

// Words the speech-to-text should expect (brands, shop words, product names): fewer mishearings.
const ASR_KEYWORDS = [
  'Little Less', 'rupees', 'shopkeeper', 'negotiate', 'bargain', 'final price', 'MRP', 'discount', 'online', 'Amazon', 'Flipkart',
  'Myntra', 'Meesho', 'Ajio', 'boAt', 'Rockerz', 'Airdopes', 'Noise', 'JBL', 'Sony', 'Samsung', 'Redmi', 'Realme', 'OnePlus',
  'iPhone', 'Nike', 'Adidas', 'Puma', 'Levis', 'Allen Solly', 'Peter England', 'T-shirt', 'kurta', 'jeans', 'sneakers',
  'earphones', 'earbuds', 'power bank', 'charger', 'protein bar', 'Commercial Street', 'Chickpet', 'Kannada', 'Hindi', 'Tamil', 'Telugu',
];

export async function startAgent(channel: string) {
  const missing: string[] = [];
  if (!config.agora.appId || !config.agora.appCertificate) missing.push('AGORA_APP_ID / AGORA_APP_CERTIFICATE');
  if (!config.publicUrl) missing.push('PUBLIC_URL (your tunnel URL)');
  if (!config.murf.apiKey || !config.murf.voiceId) missing.push('MURF_API_KEY / MURF_VOICE_ID');
  if (!config.llm.apiKey) missing.push('LLM_API_KEY');
  if (missing.length) throw new Error(`Missing in backend/.env: ${missing.join(', ')}`);

  const body = {
    name: `little-less-${Date.now()}`,
    properties: {
      channel,
      token: agentToken(channel),
      agent_rtc_uid: String(AGENT_UID),
      remote_rtc_uids: [String(USER_UID)],
      enable_string_uid: false,
      idle_timeout: 60,
      asr: {
        vendor: 'ares',
        language: asrLanguages(),
        keywords: ASR_KEYWORDS,
      },
      llm: {
        vendor: 'custom',
        // ?sid= tells our brain which user this voice call belongs to.
        url: `${config.publicUrl}/api/brain/chat/completions?sid=${encodeURIComponent(state.id)}`,
        api_key: config.brainSecret,
        // The real instructions live in brain.ts; this is only a fallback.
        system_messages: [{ role: 'system', content: SPEAKING_RULES }],
        greeting_message: 'Hi! I am Little Less. Show me what you want to buy and tell me the price, I will tell you if it is worth it.',
        failure_message: 'Sorry, my network glitched. Can you say that again?',
        max_history: 20,
        params: { model: config.llm.model },
      },
      tts: {
        vendor: 'murf',
        params: {
          api_key: config.murf.apiKey,
          base_url: 'wss://global.api.murf.ai/v1/speech/stream-input',
          voiceId: config.murf.voiceId,
          locale: config.murf.locale,
          model: 'FALCON',
          sample_rate: 24000,
          rate: 0,
          pitch: 0,
        },
      },
    },
  };

  // Noisy-room settings (hackathon venues are loud):
  //  - SAL "locking": Agora locks onto the first clear speaker and blocks ~95% of other voices (Beta).
  //  - Higher speech_threshold + longer interrupt durations: short background sounds don't count as speech.
  const noiseSettings = {
    advanced_features: { enable_sal: true },
    sal: { sal_mode: 'locking' },
    turn_detection: {
      mode: 'default',
      config: {
        speech_threshold: 0.65,
        start_of_speech: {
          mode: 'vad',
          vad_config: { interrupt_duration_ms: 400, speaking_interrupt_duration_ms: 480, prefix_padding_ms: 800 },
        },
        end_of_speech: { mode: 'vad', vad_config: { silence_duration_ms: 700 } },
      },
    },
  };

  const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${config.agora.appId}/join`;
  const join = (extra: object) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(channel) },
      body: JSON.stringify({ ...body, name: `little-less-${Date.now()}`, properties: { ...body.properties, ...extra } }),
    });

  // Try the richest setup first, then fall back step by step so the call always starts.
  // SAL (Beta) sometimes fails with a transient 400 "ErrInternal", so it gets 3 tries before we give up on it.
  const { advanced_features: _a, sal: _s, ...thresholdsOnly } = noiseSettings;
  // With a recorded voiceprint, SAL locks onto THIS user's voice instead of the first loud voice it hears.
  const vp = voiceprintUrl();
  const voiceprintLock = vp ? { ...noiseSettings, sal: { sal_mode: 'locking', sample_urls: { speaker1: vp } } } : null;
  const attempts: { extra: object; label: string }[] = [
    ...(voiceprintLock
      ? [
          { extra: voiceprintLock, label: 'locked to your voice + noise filter' },
          { extra: voiceprintLock, label: 'locked to your voice + noise filter' },
        ]
      : []),
    { extra: noiseSettings, label: 'speaker lock + noise filter' },
    { extra: noiseSettings, label: 'speaker lock + noise filter' },
    { extra: noiseSettings, label: 'speaker lock + noise filter' },
    { extra: thresholdsOnly, label: 'noise filter only (speaker lock unavailable)' },
    { extra: {}, label: 'basic listening (no noise filter)' },
    { extra: { asr: { vendor: 'ares', language: config.asrLanguage || 'en-IN' } }, label: 'basic English listening' },
  ];
  let res!: Response;
  let text = '';
  let mode = '';
  for (const [i, a] of attempts.entries()) {
    res = await join(a.extra);
    text = await res.text();
    mode = a.label;
    if (res.ok || res.status >= 500) break;
    addLog('error', `Agora join attempt ${i + 1} rejected (${res.status}): ${text.slice(0, 200)}`);
    if (i < attempts.length - 3) await new Promise((r) => setTimeout(r, 400));
  }
  if (!res.ok) {
    addLog('error', `Agora start failed (${res.status}): ${text}`);
    throw new Error(`Agora start failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text) as { agent_id: string; status: string };
  state.agent = { agentId: data.agent_id, channel };
  addLog('system', `Call connected (${mode})`);
  return data;
}

export async function stopAgent() {
  if (!state.agent) return { stopped: false };
  const { agentId, channel } = state.agent;
  const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${config.agora.appId}/agents/${agentId}/leave`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: authHeader(channel) } });
  state.agent = null;
  addLog('system', 'Call ended');
  return { stopped: res.ok };
}
