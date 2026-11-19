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

  const cleanup = useCallback(async () => {
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

      // Show who is speaking.
      client.enableAudioVolumeIndicator();
      client.on('volume-indicator', (volumes) => {
        let agent = false;
        let you = false;
        for (const v of volumes) {
          if (String(v.uid) === String(session.uid)) you = v.level > 8;
          else agent = agent || v.level > 8;
        }
        setAgentTalking(agent);
        setYouTalking(you);
      });

      await client.join(session.appId, session.channel, session.token, session.uid);
      const mic = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true });
      micRef.current = mic;
      await client.publish(mic);

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

  return { status, start, stop, muted, toggleMute, agentTalking, youTalking, error };
}
