// Joins the Agora voice channel with your mic, then asks the backend to send the AI agent in.
import { useCallback, useRef, useState } from 'react';
import AgoraRTC, { type IAgoraRTCClient, type IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import { api } from './api';

AgoraRTC.setLogLevel(3); // warnings and errors only

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'ending';

export function useVoice() {
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const micRef = useRef<IMicrophoneAudioTrack | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [muted, setMuted] = useState(false);
  const [agentTalking, setAgentTalking] = useState(false);
  const [youTalking, setYouTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [agentLevel, setAgentLevel] = useState(0);
  const levelTimer = useRef<number | null>(null);

  const cleanup = useCallback(async () => {
    if (levelTimer.current) window.clearInterval(levelTimer.current);
    levelTimer.current = null;
    setMicLevel(0);
    micRef.current?.close();
    micRef.current = null;
    await clientRef.current?.leave().catch(() => {});
    clientRef.current = null;
    setAgentTalking(false);
    setYouTalking(false);
  }, []);

  const releaseTimer = useRef<number | null>(null);

  /** startMuted: hold-to-talk mode, so the mic must stay silent until the button is held
   * (otherwise Agora's speaker lock may latch onto a loud voice in the room while the call connects). */
  const start = useCallback(async (startMuted = false) => {
    setError(null);
    setStatus('connecting');
    try {
      const session = await api.post<{ appId: string; channel: string; uid: number; token: string }>('/api/session');

      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      clientRef.current = client;

      // Play the agent's voice as soon as it publishes audio.
      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType);
        if (mediaType === 'audio') user.audioTrack?.play();
      });

      await client.join(session.appId, session.channel, session.token, session.uid);
      const mic = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true });
      micRef.current = mic;
      if (startMuted) mic.setVolume(0);
      await client.publish(mic);

      // Live levels (10x per second) for the mic meter and "who is speaking".
      levelTimer.current = window.setInterval(() => {
        const you = micRef.current?.enabled ? micRef.current.getVolumeLevel() : 0;
        const agent = Math.max(0, ...client.remoteUsers.map((u) => u.audioTrack?.getVolumeLevel() ?? 0));
        setMicLevel(you);
        setAgentLevel(agent);
        setYouTalking(you > 0.08);
        setAgentTalking(agent > 0.05);
      }, 100);

      await api.post('/api/agent/start', { channel: session.channel });
      setMuted(startMuted);
      setStatus('live');
    } catch (err) {
      setError((err as Error).message);
      await cleanup();
      setStatus('idle');
    }
  }, [cleanup]);

  const stop = useCallback(async () => {
    setStatus('ending');
    await api.post('/api/agent/stop').catch(() => {});
    await cleanup();
    setStatus('idle');
  }, [cleanup]);

  // Muting uses volume 0 (not unpublishing), so unmuting is instant — needed for hold-to-talk.
  // tailMs: keep the mic open a moment after the button is released so the last word isn't cut off.
  const setMicOpen = useCallback((open: boolean, tailMs = 0) => {
    if (releaseTimer.current) window.clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
    if (!open && tailMs > 0) {
      releaseTimer.current = window.setTimeout(() => {
        micRef.current?.setVolume(0);
        setMuted(true);
      }, tailMs);
      return;
    }
    micRef.current?.setVolume(open ? 100 : 0);
    setMuted(!open);
  }, []);

  const toggleMute = useCallback(() => setMicOpen(muted), [muted, setMicOpen]);

  return { status, start, stop, muted, toggleMute, setMicOpen, agentTalking, youTalking, micLevel, agentLevel, error };
}
