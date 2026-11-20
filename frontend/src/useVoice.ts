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

  const start = useCallback(async () => {
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
      await client.publish(mic);

      // Live levels (10x per second) for the mic meter and "who is speaking".
      levelTimer.current = window.setInterval(() => {
        const you = micRef.current?.enabled ? micRef.current.getVolumeLevel() : 0;
        const agent = Math.max(0, ...client.remoteUsers.map((u) => u.audioTrack?.getVolumeLevel() ?? 0));
        setMicLevel(you);
        setYouTalking(you > 0.08);
        setAgentTalking(agent > 0.05);
      }, 100);

      await api.post('/api/agent/start', { channel: session.channel });
      setMuted(false);
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

  const toggleMute = useCallback(async () => {
    if (!micRef.current) return;
    await micRef.current.setEnabled(muted);
    setMuted(!muted);
  }, [muted]);

  return { status, start, stop, muted, toggleMute, agentTalking, youTalking, micLevel, error };
}
