// Voiceprint for Agora's speaker lock (SAL "personalized" mode): the user records ~12 s of their
// voice once; Agora downloads it at the start of each call and locks onto that voice, ignoring
// louder people nearby (announcers, other shoppers).
// Agora needs: 16 kHz, 16-bit, mono raw PCM, ".pcm" file, 10-15 s (>= 8 s of speech), <= 2 MB.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { loadProfile, patchProfile } from './data.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'voiceprints');
mkdirSync(dir, { recursive: true });

const SAMPLE_RATE = 16_000;
const fileFor = (id: string) => path.join(dir, `${id}.pcm`);
const isId = (id: string) => /^[a-f0-9]{24}$/.test(id);

/** Seconds of audio louder than a quiet-room level (rough "effective speech" measure). */
function speechSeconds(pcm: Buffer) {
  const frame = SAMPLE_RATE / 10; // 100 ms frames
  let loud = 0;
  for (let off = 0; off + frame * 2 <= pcm.length; off += frame * 2) {
    let sum = 0;
    for (let i = 0; i < frame; i++) {
      const s = pcm.readInt16LE(off + i * 2) / 32768;
      sum += s * s;
    }
    if (Math.sqrt(sum / frame) > 0.02) loud++;
  }
  return loud / 10;
}

export function voiceprintStatus() {
  const id = String(loadProfile().voiceprint_id ?? '');
  const ok = isId(id) && existsSync(fileFor(id));
  return { exists: ok, seconds: ok ? Number(loadProfile().voiceprint_seconds ?? 0) : 0 };
}

export function saveVoiceprint(pcm: Buffer) {
  const seconds = pcm.length / 2 / SAMPLE_RATE;
  if (seconds < 8 || seconds > 16) return { ok: false as const, error: `Recording must be 8-15 seconds (got ${seconds.toFixed(1)} s).` };
  const speech = speechSeconds(pcm);
  if (speech < 5) return { ok: false as const, error: 'I could barely hear you. Hold the phone closer and keep talking for the whole time.' };
  deleteVoiceprint();
  const id = randomBytes(12).toString('hex');
  writeFileSync(fileFor(id), pcm);
  patchProfile({ voiceprint_id: id, voiceprint_seconds: Math.round(seconds) });
  return { ok: true as const, seconds: Math.round(seconds), speech: Math.round(speech) };
}

export function deleteVoiceprint() {
  const id = String(loadProfile().voiceprint_id ?? '');
  if (isId(id) && existsSync(fileFor(id))) unlinkSync(fileFor(id));
  if (id) patchProfile({}, ['voiceprint_id', 'voiceprint_seconds']);
}

/** Public URL Agora downloads the voiceprint from (null if the user hasn't recorded one). */
export function voiceprintUrl(): string | null {
  const id = String(loadProfile().voiceprint_id ?? '');
  if (!config.publicUrl || !isId(id) || !existsSync(fileFor(id))) return null;
  return `${config.publicUrl}/api/voiceprint/file/${id}.pcm`;
}

export function readVoiceprintFile(id: string): Buffer | null {
  return isId(id) && existsSync(fileFor(id)) ? readFileSync(fileFor(id)) : null;
}
