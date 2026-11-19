import { rupees, type Verdict } from '../api';

const PRICE_LABEL: Record<Verdict['price_verdict'], { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  good_deal: { text: 'Good deal', tone: 'good' },
  fair: { text: 'Fair price', tone: 'good' },
  slightly_high: { text: 'A little high', tone: 'warn' },
  overpriced: { text: 'Overpriced', tone: 'bad' },
  fixed_mrp: { text: 'Fixed MRP', tone: 'neutral' },
  unknown: { text: 'Price unclear', tone: 'neutral' },
};

const FIT_LABEL: Record<Verdict['fit_verdict'], { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  great_fit: { text: 'Suits you', tone: 'good' },
  ok_fit: { text: 'Okay for you', tone: 'warn' },
  poor_fit: { text: 'Not for you', tone: 'bad' },
  unknown: { text: 'Fit unclear', tone: 'neutral' },
};

const TONE = {
  good: 'bg-leaf-soft text-leaf',
  warn: 'bg-amber-100 text-amber-800',
  bad: 'bg-chilli-soft text-chilli',
  neutral: 'bg-line/60 text-muted',
};

/** Horizontal price ruler: fair band + markers for asked / counter / online. */
function PriceRuler({ v }: { v: Verdict }) {
  const points = [v.asked_price, v.fair_low, v.fair_high, v.online_price, v.counter_offer].filter(
    (n): n is number => typeof n === 'number' && n > 0,
  );
  if (points.length < 2) return null;
  const min = Math.min(...points) * 0.85;
  const max = Math.max(...points) * 1.08;
  const pos = (n: number) => `${((n - min) / (max - min)) * 100}%`;

  const markers = [
    { value: v.online_price, label: 'Online', color: 'bg-sky', text: 'text-sky' },
    { value: v.counter_offer, label: 'Offer', color: 'bg-marigold', text: 'text-amber-700' },
    { value: v.asked_price, label: 'Asked', color: 'bg-chilli', text: 'text-chilli' },
  ].filter((m) => typeof m.value === 'number' && m.value > 0) as { value: number; label: string; color: string; text: string }[];

  return (
    <div className="mt-9 mb-9">
      <div className="relative h-2.5 rounded-full bg-line">
        {v.fair_low != null && v.fair_high != null && (
          <div
            className="absolute inset-y-0 rounded-full bg-leaf/70"
            style={{ left: pos(v.fair_low), width: `calc(${pos(v.fair_high)} - ${pos(v.fair_low)} + 4px)` }}
            title="Fair local price"
          />
        )}
        {markers.map((m, i) => (
          <div key={m.label} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: pos(m.value) }}>
            <div className={`h-5 w-1.5 rounded-full ${m.color} ring-2 ring-card`} />
            <div className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold ${m.text} ${i % 2 ? '-top-5' : 'top-6'}`}>
              {m.label} {rupees(m.value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function VerdictCard({ verdict, scanning }: { verdict: Verdict | null; scanning: string | null }) {
  if (!verdict) {
    return (
      <section className="rounded-3xl border border-dashed border-line bg-card/60 p-6">
        <p className="font-display text-xl font-bold">No verdict yet</p>
        <p className="mt-1 text-sm text-muted">
          {scanning
            ? `Looking at: ${scanning}`
            : 'Point the camera at something and say what the shopkeeper is asking. "Bhaiya says 800, is it worth it?"'}
        </p>
      </section>
    );
  }

  const price = PRICE_LABEL[verdict.price_verdict] ?? PRICE_LABEL.unknown;
  const fit = FIT_LABEL[verdict.fit_verdict] ?? FIT_LABEL.unknown;

  return (
    <section className="rounded-3xl border border-line bg-card p-5 shadow-[0_1px_0_#e4dac8]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">Verdict</p>
          <h2 className="font-display text-2xl font-bold leading-tight break-words">{verdict.item}</h2>
        </div>
        {verdict.asked_price != null && (
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted">Shop asks</p>
            <p className="font-display text-2xl font-extrabold text-chilli">{rupees(verdict.asked_price)}</p>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${TONE[price.tone]}`}>{price.text}</span>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${TONE[fit.tone]}`}>{fit.text}</span>
        {verdict.fair_low != null && (
          <span className="rounded-full bg-paper px-3 py-1 text-sm text-muted">
            Fair {rupees(verdict.fair_low)}–{rupees(verdict.fair_high)}
          </span>
        )}
      </div>

      <PriceRuler v={verdict} />

      <dl className="space-y-2.5 text-sm">
        <div>
          <dt className="font-semibold">For you</dt>
          <dd className="text-muted">{verdict.fit_note}</dd>
        </div>
        {verdict.quality_note && (
          <div>
            <dt className="font-semibold">Quality</dt>
            <dd className="text-muted">{verdict.quality_note}</dd>
          </div>
        )}
      </dl>

      <p className="mt-4 rounded-2xl bg-ink px-4 py-3 text-sm font-medium text-paper">{verdict.recommendation}</p>
    </section>
  );
}
