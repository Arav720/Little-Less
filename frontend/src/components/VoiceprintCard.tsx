import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { CheckIcon, MicIcon } from '../icons';
import { recordVoice, type Recording } from '../voiceprint';

const SECONDS = 12;
const SCRIPT =
  'Hi Little Less, this is my voice. When I go shopping, listen to me and not to the people around me. ' +
  'I want a fair price, so check it online, tell me if it suits me, and help me bargain with the shopkeeper.';

type Status = { exists: boolean; seconds: number };

/** "Teach Little Less your voice": records ~12 s for Agora's speaker lock (voiceprint mode). */
export function VoiceprintCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recording | null>(null);

  useEffect(() => {
    api.get<Status>('/api/voiceprint').then(setStatus).catch(() => setStatus({ exists: false, seconds: 0 }));
    return () => rec.current?.stop();
  }, []);

  async function start() {
    setError(null);
    setElapsed(0);
    setPhase('recording');
    try {
      rec.current = recordVoice(SECONDS, (t, l) => {
        setElapsed(t);
        setLevel(l);
      });
      const pcm = await rec.current.done;
      rec.current = null;
      setPhase('saving');
      const r = await api.putBinary<{ seconds: number }>('/api/voiceprint', pcm);
      setStatus({ exists: true, seconds: r.seconds });
    } catch (err) {
      const msg = (err as Error).message;
      setError(/denied|NotAllowed/i.test(msg) ? 'Microphone permission is blocked. Allow it in the browser and try again.' : msg);
    } finally {
      setPhase('idle');
    }
  }

  async function remove() {
    await api.del('/api/voiceprint').catch(() => {});
    setStatus({ exists: false, seconds: 0 });
  }

  const pct = Math.round((elapsed / SECONDS) * 100);

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-card p-4">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${status?.exists ? 'bg-leaf/15 text-leaf' : 'bg-marigold/20 text-amber-800'}`}>
          {status?.exists ? <CheckIcon size={20} /> : <MicIcon size={20} />}
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{status?.exists ? 'Little Less knows your voice' : 'Teach Little Less your voice'}</p>
          <p className="text-sm text-muted">
            {status?.exists
              ? 'In calls it locks onto you and ignores louder people nearby, like announcers or other shoppers.'
              : `Record ${SECONDS} seconds once. In noisy places it will listen to you, not the people around you.`}
          </p>
        </div>
      </div>

      {phase === 'recording' && (
        <div className="space-y-2.5">
          <p className="rounded-xl bg-paper p-3 text-[15px] leading-relaxed">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Read this out loud, normally</span>
            {SCRIPT}
          </p>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-chilli transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-10 text-right text-sm tabular-nums text-muted">{Math.max(0, Math.ceil(SECONDS - elapsed))}s</span>
          </div>
          <p className={`text-xs ${level > 0.02 ? 'text-leaf' : 'text-muted'}`}>{level > 0.02 ? 'Hearing you, keep going…' : 'Start reading…'}</p>
        </div>
      )}

      {error && <p className="text-sm text-chilli">{error}</p>}

      {phase !== 'recording' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={start}
            disabled={phase === 'saving' || !status}
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50"
          >
            <MicIcon size={16} />
            {phase === 'saving' ? 'Saving…' : status?.exists ? 'Record again' : `Record my voice (${SECONDS}s)`}
          </button>
          {status?.exists && phase === 'idle' && (
            <button type="button" onClick={remove} className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink">
              Remove
            </button>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted">Stored only for your profile and used only to recognise you in calls. Takes effect from your next call.</p>
    </div>
  );
}
