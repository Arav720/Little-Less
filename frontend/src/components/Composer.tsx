import { useEffect, useRef, useState } from 'react';
import type { useVoice } from '../useVoice';
import { CameraIcon, KeyboardIcon, MicIcon, MicOffIcon, PhoneOffIcon, SendIcon } from '../icons';

type Voice = ReturnType<typeof useVoice>;

type Props = {
  voice: Voice;
  cameraOn: boolean;
  onToggleCamera: () => void;
  onSend: (text: string) => void;
  sending: boolean;
  holdToTalk: boolean;
  setHoldToTalk: (v: boolean) => void;
};

/** Five bars that rise with your voice. */
/** Live voice wave: bars move with the real audio level (yours in green, Little Less's in amber). */
const SHAPE = [0.35, 0.6, 0.85, 1, 0.85, 0.6, 0.35];
function Wave({ level, tone }: { level: number; tone: 'you' | 'agent' | 'idle' }) {
  const amp = Math.min(1, level * 3.5);
  const color = tone === 'agent' ? 'bg-marigold' : tone === 'you' ? 'bg-leaf-soft' : 'bg-paper/30';
  return (
    <span className="flex h-6 items-center gap-[3px]" aria-hidden>
      {SHAPE.map((s, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full transition-[height] duration-100 ${color}`}
          style={{ height: `${Math.max(14, Math.round((0.15 + amp * s) * 100))}%` }}
        />
      ))}
    </span>
  );
}

/** Three bouncing dots while Little Less works out the reply. */
function Thinking() {
  return (
    <span className="flex h-6 items-center gap-1" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-paper/80" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

type Phase = 'muted' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'silent-mic';

/**
 * Voice state for the call bar, from the real audio levels:
 * hearing you → (you stop) → "Got it, thinking…" → Little Less speaking → listening again.
 * Also warns when the mic is open but no sound at all has reached it for a while.
 */
function useVoicePhase(voice: Voice): Phase {
  const heardAt = useRef(0); // last moment your voice was loud enough
  const soundAt = useRef(Date.now()); // last moment ANY sound reached the mic
  const waiting = useRef(false); // you spoke, reply not started yet
  const now = Date.now();
  if (voice.micLevel > 0.02) soundAt.current = now;
  if (voice.youTalking) {
    heardAt.current = now;
    waiting.current = true;
  }
  if (voice.agentTalking) waiting.current = false;
  useEffect(() => {
    if (voice.muted) soundAt.current = Date.now();
  }, [voice.muted]);

  if (voice.agentTalking) return 'speaking';
  if (voice.muted) return waiting.current && now - heardAt.current < 12_000 ? 'thinking' : 'muted';
  if (voice.youTalking || now - heardAt.current < 700) return 'hearing';
  if (waiting.current && now - heardAt.current < 12_000) return 'thinking';
  waiting.current = false;
  if (now - soundAt.current > 8_000) return 'silent-mic';
  return 'listening';
}

export function Composer({ voice, cameraOn, onToggleCamera, onSend, sending, holdToTalk, setHoldToTalk }: Props) {
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const live = voice.status === 'live';
  const phase = useVoicePhase(voice);
  const busy = voice.status === 'connecting' || voice.status === 'ending';

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    onSend(t);
    setText('');
  }

  const textBox = (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-card pl-4 pr-1.5 text-ink focus-within:border-ink">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={live ? 'Type instead…' : 'Message Little Less…'}
        className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] text-ink caret-ink outline-none placeholder:text-muted"
        enterKeyHint="send"
      />
      {text.trim() && (
        <button
          type="submit"
          disabled={sending}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-paper disabled:opacity-40"
          aria-label="Send"
        >
          <SendIcon size={16} />
        </button>
      )}
    </form>
  );

  const cameraBtn = (
    <button
      onClick={onToggleCamera}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors ${
        cameraOn ? 'border-ink bg-ink text-paper' : 'border-line bg-card text-ink hover:border-ink'
      }`}
      aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
      aria-pressed={cameraOn}
    >
      <CameraIcon />
    </button>
  );

  // ---------- Not in a call: camera · text · talk ----------
  if (!live) {
    return (
      <div className="space-y-2">
        {voice.error && <p className="px-1 text-center text-xs text-chilli">{voice.error}</p>}
        <div className="flex items-center gap-2">
          {cameraBtn}
          {textBox}
          <button
            onClick={() => voice.start(holdToTalk)}
            disabled={busy}
            className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-marigold px-4 font-semibold text-ink transition-transform active:scale-95 disabled:opacity-60"
            aria-label="Start voice conversation"
          >
            <MicIcon size={18} />
            <span className="text-sm">{voice.status === 'connecting' ? 'Connecting…' : 'Talk'}</span>
          </button>
        </div>
      </div>
    );
  }

  // ---------- In a call: status · mic control · end ----------
  const STATUS: Record<Phase, string> = {
    muted: holdToTalk ? 'Hold the button to speak' : 'Mic is off',
    listening: 'Listening, go ahead',
    hearing: 'Hearing you…',
    thinking: 'Got it, thinking…',
    speaking: 'Little Less is speaking…',
    'silent-mic': "Can't hear your mic. Speak closer or check the mic",
  };
  const dot: Record<Phase, string> = {
    muted: 'bg-paper/40',
    listening: 'bg-leaf animate-pulse',
    hearing: 'bg-leaf',
    thinking: 'bg-paper animate-pulse',
    speaking: 'bg-marigold',
    'silent-mic': 'bg-chilli animate-pulse',
  };

  return (
    <div className="space-y-2 rounded-3xl bg-ink p-2.5 text-paper">
      <div className="flex items-center gap-2.5 px-2 pt-0.5" role="status" aria-live="polite">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot[phase]}`} />
        <p className={`min-w-0 flex-1 truncate text-sm font-medium ${phase === 'silent-mic' ? 'text-marigold' : ''}`}>{STATUS[phase]}</p>
        {phase === 'thinking' ? (
          <Thinking />
        ) : (
          <Wave
            level={phase === 'speaking' ? voice.agentLevel : voice.muted ? 0 : voice.micLevel}
            tone={phase === 'speaking' ? 'agent' : phase === 'hearing' ? 'you' : 'idle'}
          />
        )}
        {phase === 'speaking' && (
          <button
            onClick={voice.stopAgentSpeech}
            className="shrink-0 rounded-full bg-paper px-2.5 py-1 text-[11px] font-bold text-ink"
            aria-label="Stop Little Less talking"
          >
            Stop
          </button>
        )}
        <button
          onClick={() => setHoldToTalk(!holdToTalk)}
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            holdToTalk ? 'bg-marigold text-ink' : 'bg-paper/10 text-paper/80'
          }`}
          aria-pressed={holdToTalk}
          title="In a noisy place, the mic only listens while you hold the button"
        >
          Noisy room
        </button>
      </div>

      {typing && <div className="flex">{textBox}</div>}

      <div className="flex items-center gap-2">
        {cameraBtn}
        {holdToTalk ? (
          <button
            onPointerDown={() => {
              if (voice.agentTalking) voice.stopAgentSpeech(); // pressing to talk = interrupt
              voice.setMicOpen(true);
            }}
            onPointerUp={() => voice.setMicOpen(false, 600)}
            onPointerLeave={() => !voice.muted && voice.setMicOpen(false, 600)}
            onPointerCancel={() => voice.setMicOpen(false, 600)}
            className={`flex h-11 flex-1 touch-none select-none items-center justify-center gap-2 rounded-full text-sm font-bold transition-colors ${
              voice.muted ? 'bg-paper text-ink' : 'bg-marigold text-ink'
            }`}
          >
            <MicIcon size={18} />
            {voice.muted ? 'Hold to speak' : 'Release to send'}
          </button>
        ) : (
          <button
            onClick={voice.toggleMute}
            className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold ${
              voice.muted ? 'bg-chilli text-paper' : 'bg-paper/10 text-paper'
            }`}
            aria-pressed={voice.muted}
          >
            {voice.muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
            {voice.muted ? 'Unmute' : 'Mute'}
          </button>
        )}
        <button
          onClick={() => setTyping(!typing)}
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${typing ? 'bg-paper text-ink' : 'bg-paper/10'}`}
          aria-label="Type a message"
        >
          <KeyboardIcon />
        </button>
        <button
          onClick={voice.stop}
          className="grid h-11 w-14 shrink-0 place-items-center rounded-full bg-chilli text-paper"
          aria-label="End conversation"
        >
          <PhoneOffIcon size={22} />
        </button>
      </div>
    </div>
  );
}
