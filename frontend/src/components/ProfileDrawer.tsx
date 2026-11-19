import { useEffect, useState } from 'react';
import { api } from '../api';

/** Simple JSON editor for the shopper profile (style, colours, goals, language...). */
export function ProfileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) api.get('/api/profile').then((p) => setText(JSON.stringify(p, null, 2)));
  }, [open]);

  if (!open) return null;

  async function save() {
    try {
      await api.put('/api/profile', JSON.parse(text));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-xl rounded-3xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl font-bold">Your shopping profile</h2>
        <p className="text-sm text-muted">Little Less uses this to judge if something suits you.</p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          spellCheck={false}
          className="mt-3 h-80 w-full rounded-2xl border border-line bg-paper p-3 font-mono text-xs outline-none focus:border-ink"
        />
        {error && <p className="mt-2 text-sm text-chilli">Invalid JSON: {error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm font-semibold">
            Cancel
          </button>
          <button onClick={save} className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-paper">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
