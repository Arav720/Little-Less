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

export function VerdictCard({ v }: { v: Verdict }) {
  const price = PRICE[v.price_verdict] ?? PRICE.unknown;
  const fit = FIT[v.fit_verdict] ?? FIT.unknown;
  const sources = (v.sources ?? []).slice(0, 4);

  return (
    <article className="w-full rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgba(29,26,22,0.04)]">
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
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[price.tone]}`}>{price.text}</span>
        )}
        {fit.text && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[fit.tone]}`}>{fit.text}</span>}
        {v.fair_low != null && v.fair_high != null && (
          <span className="rounded-full bg-paper px-2.5 py-1 text-xs text-muted">
            Fair {rupees(v.fair_low)}–{rupees(v.fair_high)}
          </span>
        )}
      </div>

      <PriceRuler v={v} />

      {v.fit_note && <p className="text-sm text-ink/80">{v.fit_note}</p>}
      {v.quality_note && <p className="mt-1 text-sm text-muted">{v.quality_note}</p>}

      <p className="mt-3 rounded-xl bg-ink px-3.5 py-2.5 text-sm font-medium text-paper">{v.recommendation}</p>

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
    </article>
  );
}
