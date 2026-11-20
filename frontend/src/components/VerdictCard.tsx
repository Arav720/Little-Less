import { useState } from 'react';
import { rupees, type Verdict } from '../api';
import { StoreIcon, TagIcon } from '../icons';

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

const PRICE: Record<Verdict['price_verdict'], { text: string; tone: Tone }> = {
  good_deal: { text: 'Good deal', tone: 'good' },
  fair: { text: 'Fair price', tone: 'good' },
  slightly_high: { text: 'A little high', tone: 'warn' },
  overpriced: { text: 'Overpriced', tone: 'bad' },
  fixed_mrp: { text: 'Fixed MRP', tone: 'neutral' },
  unknown: { text: 'Price unclear', tone: 'neutral' },
};

const FIT: Record<Verdict['fit_verdict'], { text: string; tone: Tone }> = {
  great_fit: { text: 'Suits you', tone: 'good' },
  ok_fit: { text: 'Okay for you', tone: 'neutral' },
  poor_fit: { text: 'Not for you', tone: 'bad' },
  unknown: { text: '', tone: 'neutral' },
};

const TONE: Record<Tone, string> = {
  good: 'bg-leaf-soft text-leaf',
  warn: 'bg-amber-100 text-amber-800',
  bad: 'bg-chilli-soft text-chilli',
  neutral: 'bg-paper text-muted',
};

/** Ruler: fair band, plus markers for what the shop asks and the online price. */
function PriceRuler({ v }: { v: Verdict }) {
  const pts = [v.asked_price, v.fair_low, v.fair_high, v.online_price].filter((n): n is number => typeof n === 'number' && n > 0);
  if (pts.length < 2) return null;
  const min = Math.min(...pts) * 0.8;
  const max = Math.max(...pts) * 1.1;
  const pos = (n: number) => `${Math.max(2, Math.min(98, ((n - min) / (max - min)) * 100))}%`;
  return (
    <div className="relative mb-7 mt-8 h-2 rounded-full bg-line" role="img" aria-label="Price comparison">
      {v.fair_low != null && v.fair_high != null && (
        <div
          className="absolute inset-y-0 rounded-full bg-leaf/60"
          style={{ left: pos(v.fair_low), width: `calc(${pos(v.fair_high)} - ${pos(v.fair_low)} + 6px)` }}
        />
      )}
      {v.online_price != null && (
        <Marker at={pos(v.online_price)} color="bg-sky" label={`Online ${rupees(v.online_price)}`} cls="text-sky top-4" />
      )}
      {v.asked_price != null && (
        <Marker at={pos(v.asked_price)} color="bg-chilli" label={`Shop ${rupees(v.asked_price)}`} cls="text-chilli -top-6" />
      )}
    </div>
  );
}

function Marker({ at, color, label, cls }: { at: string; color: string; label: string; cls: string }) {
  return (
    <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: at }}>
      <div className={`h-4 w-1.5 rounded-full ring-2 ring-card ${color}`} />
      <span className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold ${cls}`}>{label}</span>
    </div>
  );
}

export type VerdictActions = {
  onSend: (text: string) => void;
  negotiating: boolean;
};

const DECISION_TONE: Record<string, string> = {
  good: 'bg-leaf text-paper',
  warn: 'bg-marigold text-ink',
  bad: 'bg-chilli text-paper',
  neutral: 'bg-ink text-paper',
};

/** Ask for the shop's price right on the card (suggest mode, when it isn't known yet). */
function AskPrice({ onSend }: { onSend: (t: string) => void }) {
  const [val, setVal] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = val.replace(/[^\d]/g, '');
        if (n) onSend(`The shop is asking ₹${n} for it.`);
      }}
      className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-paper p-1.5 pl-3"
    >
      <span className="text-sm text-muted">Shop asks ₹</span>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        inputMode="numeric"
        placeholder="price"
        className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
        aria-label="Price the shop is asking"
      />
      <button className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper">Check</button>
    </form>
  );
}

export function VerdictCard({ v, actions }: { v: Verdict; actions?: VerdictActions }) {
  const price = PRICE[v.price_verdict] ?? PRICE.unknown;
  const fit = FIT[v.fit_verdict] ?? FIT.unknown;
  const sources = (v.sources ?? []).slice(0, 4);
  const pricey = v.price_verdict === 'overpriced' || v.price_verdict === 'slightly_high';

  return (
    <article className="w-full overflow-hidden rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(29,26,22,0.04)]">
      {v.decision && (
        <div className={`flex items-center justify-between gap-2 px-4 py-2 text-sm font-bold ${DECISION_TONE[v.decision.tone]}`}>
          <span>{v.decision.label}</span>
          {v.counter_offer != null && pricey && <span className="text-xs font-semibold opacity-90">Target {rupees(v.counter_offer)}</span>}
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <TagIcon size={13} /> Price check
            </p>
            <h3 className="mt-0.5 break-words font-display text-lg font-bold capitalize leading-snug">{v.item}</h3>
          </div>
          {v.asked_price != null && (
            <div className="shrink-0 text-right">
              <p className="text-[11px] text-muted">Shop asks</p>
              <p className="font-display text-xl font-extrabold text-chilli">{rupees(v.asked_price)}</p>
            </div>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {v.likely_copy ? (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE.bad}`}>Likely a copy</span>
          ) : (
            v.price_verdict !== 'unknown' && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[price.tone]}`}>{price.text}</span>
          )}
          {fit.text && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[fit.tone]}`}>{fit.text}</span>}
          {v.fair_low != null && v.fair_high != null && (
            <span className="rounded-full bg-paper px-2.5 py-1 text-xs text-muted">
              Fair {rupees(v.fair_low)}–{rupees(v.fair_high)}
            </span>
          )}
        </div>

        <PriceRuler v={v} />

        <ul className="space-y-1.5 text-sm">
          {v.fit_note && <li className="text-ink/85">{v.fit_note}</li>}
          {v.size_tip && (
            <li className="flex gap-2">
              <span className="shrink-0 rounded-md bg-paper px-1.5 py-0.5 text-[11px] font-bold text-muted">SIZE</span>
              <span>{v.size_tip}</span>
            </li>
          )}
          {v.suggestion && (
            <li className="flex gap-2">
              <span className="shrink-0 rounded-md bg-marigold/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">TRY</span>
              <span>{v.suggestion}</span>
            </li>
          )}
          {v.quality_note && <li className="text-muted">{v.quality_note}</li>}
        </ul>

        {sources.length > 0 && (
          <div className="mt-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
              <StoreIcon size={13} /> Live prices online
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sources.map((s, i) => (
                <a
                  key={i}
                  href={s.link}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-line bg-paper px-2.5 py-1 text-xs transition-colors hover:border-ink"
                >
                  {s.source || 'Store'} · <span className="font-semibold">{rupees(s.price)}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Next steps (only on the latest price card) */}
        {actions && !actions.negotiating && (
          <>
            {v.asked_price == null && v.online_price != null && <AskPrice onSend={actions.onSend} />}
            {v.asked_price != null && (
              <div className="mt-3 flex flex-wrap gap-2">
                {pricey && (
                  <button
                    onClick={() => actions.onSend('Negotiate with the shopkeeper for me.')}
                    className="flex-1 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-transform active:scale-[0.98]"
                  >
                    Negotiate for me
                  </button>
                )}
                {v.online_price != null && (
                  <button
                    onClick={() => actions.onSend('Order it online instead.')}
                    className={`rounded-full border border-line px-4 py-2.5 text-sm font-semibold hover:border-ink ${pricey ? '' : 'flex-1'}`}
                  >
                    Buy online · {rupees(v.online_price)}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}
