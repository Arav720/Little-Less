import { useState } from 'react';
import { rupees, type Bargain } from '../api';
import { CheckIcon, CloseIcon, StoreIcon } from '../icons';

const LANGS = ['Kannada', 'Hindi', 'Tamil'];

/**
 * Shown while Little Less is negotiating: what the shop says now, quick replies,
 * language switch and a way out. Everything goes through the same conversation.
 */
export function NegotiationBar({ bargain, language, onSend }: { bargain: Bargain; language: string; onSend: (t: string) => void }) {
  const [price, setPrice] = useState('');
  const ours = [...bargain.moves].reverse().find((m) => m.who === 'you')?.price;
  const theirs = [...bargain.moves].reverse().find((m) => m.who === 'shop')?.price;

  function sendPrice(e: React.FormEvent) {
    e.preventDefault();
    const n = price.replace(/[^\d]/g, '');
    if (!n) return;
    onSend(`He says ${n}.`);
    setPrice('');
  }

  return (
    <div className="mb-2 rounded-2xl border border-marigold/50 bg-marigold/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
          <StoreIcon size={16} /> Negotiating
          {bargain.status === 'final_offer' && <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[11px]">final offer made</span>}
        </p>
        <div className="flex items-center gap-1" role="group" aria-label="Shopkeeper language">
          {LANGS.map((l) => (
            <button
              key={l}
              onClick={() => l !== language && onSend(`The shopkeeper speaks ${l}, talk to him in ${l}.`)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${l === language ? 'bg-ink text-paper' : 'bg-paper/70 text-ink/70 hover:bg-paper'}`}
              aria-pressed={l === language}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-1 text-xs text-amber-900/80">
        Shop {rupees(theirs)} · your offer {rupees(ours)} · won't go above {rupees(bargain.walk_away)}
      </p>

      <form onSubmit={sendPrice} className="mt-2.5 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full border border-line bg-card pl-3 pr-1 focus-within:border-ink">
          <span className="shrink-0 text-sm text-muted">He says ₹</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="numeric"
            placeholder="new price"
            className="min-w-0 flex-1 bg-transparent py-2 text-[15px] font-semibold outline-none"
            aria-label="Shopkeeper's new price"
          />
          {price && <button className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper">Send</button>}
        </div>
      </form>

      <div className="mt-2 flex gap-2">
        <button
          onClick={() => onSend('He agreed to our price.')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-leaf px-3 py-2 text-sm font-semibold text-paper"
        >
          <CheckIcon size={16} /> He agreed
        </button>
        <button onClick={() => onSend("He's refusing, not reducing at all.")} className="flex-1 rounded-full border border-line bg-card px-3 py-2 text-sm font-semibold">
          He refused
        </button>
        <button
          onClick={() => onSend('Stop negotiating, leave it.')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-card"
          aria-label="Stop negotiating"
          title="Stop negotiating"
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  );
}
