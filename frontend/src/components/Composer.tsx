import { useState } from 'react';
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
function Level({ level, active }: { level: number; active: boolean }) {
  const lit = active ? Math.min(5, Math.round(level * 8)) : 0;
  return (
    <span className="flex h-5 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full transition-all duration-100 ${i < lit ? 'bg-marigold' : 'bg-paper/25'}`}
          style={{ height: `${35 + i * 16}%` }}
        />
      ))}
    </span>
  );
}

export function Composer({ voice, cameraOn, onToggleCamera, onSend, sending, holdToTalk, setHoldToTalk }: Props) {
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const live = voice.status === 'live';
  const busy = voice.status === 'connecting' || voice.status === 'ending';

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    onSend(t);
    setText('');
  }

  const textBox = (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-card pl-4 pr-1.5 focus-within:border-ink">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={live ? 'Type instead…' : 'Message Little Less…'}
        className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] outline-none placeholder:text-muted"
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
            onClick={voice.start}
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
  const status = voice.muted
    ? holdToTalk
      ? 'Hold the button to speak'
      : 'Mic is off'
    : voice.agentTalking
      ? 'Little Less is speaking…'
      : voice.youTalking
        ? 'Hearing you…'
        : 'Listening, go ahead';

  return (
    <div className="space-y-2 rounded-3xl bg-ink p-2.5 text-paper">
      <div className="flex items-center gap-2.5 px-2 pt-0.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${voice.agentTalking ? 'bg-marigold' : 'bg-leaf'} animate-pulse`} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{status}</p>
        <Level level={voice.micLevel} active={!voice.muted} />
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
            onPointerDown={() => voice.setMicOpen(true)}
            onPointerUp={() => voice.setMicOpen(false)}
            onPointerLeave={() => voice.setMicOpen(false)}
            onPointerCancel={() => voice.setMicOpen(false)}
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
