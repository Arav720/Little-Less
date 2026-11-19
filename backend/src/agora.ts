// Talks to Agora: makes RTC tokens and starts/stops the Conversational AI agent.
// Docs: https://docs.agora.io/en/ai/build/start-stop-agent
import agoraToken from 'agora-token';
import { config } from './config.js';
import { state, addLog } from './state.js';

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
        language: config.asrLanguage,
      },
      llm: {
        vendor: 'custom',
        url: `${config.publicUrl}/api/brain/chat/completions`,
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

  const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${config.agora.appId}/join`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(channel) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    addLog('error', `Agora start failed (${res.status}): ${text}`);
    throw new Error(`Agora start failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text) as { agent_id: string; status: string };
  state.agent = { agentId: data.agent_id, channel };
  addLog('system', `Agent joined (${data.status})`);
  return data;
}

export async function stopAgent() {
  if (!state.agent) return { stopped: false };
  const { agentId, channel } = state.agent;
  const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${config.agora.appId}/agents/${agentId}/leave`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: authHeader(channel) } });
  state.agent = null;
  addLog('system', `Agent left (${res.status})`);
  return { stopped: res.ok };
}
