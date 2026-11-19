import { useEffect, useRef, useState } from 'react';
import { api, type LogEntry } from '../api';

const STYLE: Record<LogEntry['kind'], string> = {
  user: 'self-end bg-ink text-paper',
  agent: 'self-start bg-paper text-ink',
  tool: 'self-center bg-transparent text-muted text-xs',
  system: 'self-center bg-transparent text-muted text-xs',
  error: 'self-center bg-chilli-soft text-chilli text-xs',
};

export function Conversation({ log }: { log: LogEntry[] }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    const msg = text;
    setText('');
    await api.post('/api/chat', { text: msg }).catch(() => {});
    setSending(false);
  }

  return (
    <section className="flex min-h-0 flex-col rounded-3xl border border-line bg-card p-5">
      <h3 className="font-display text-lg font-bold">Conversation</h3>
      <div className="mt-2 flex max-h-72 min-h-24 flex-col gap-1.5 overflow-y-auto pr-1">
        {log.length === 0 && <p className="text-sm text-muted">What you say and what the agent does shows up here.</p>}
        {log.map((l) => (
          <p key={l.id} className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm break-words ${STYLE[l.kind]}`}>
            {l.kind === 'tool' ? `→ ${l.text}` : l.text}
          </p>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Or type here (no voice minutes used)"
          className="min-w-0 flex-1 rounded-full border border-line bg-paper px-4 py-2 text-sm outline-none focus:border-ink"
        />
        <button disabled={sending} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50">
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
