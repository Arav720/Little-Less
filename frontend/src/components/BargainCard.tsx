import { rupees, type Bargain } from '../api';

const STATUS: Record<Bargain['status'], { text: string; cls: string }> = {
  negotiating: { text: 'Haggling', cls: 'bg-amber-100 text-amber-800' },
  final_offer: { text: 'Final offer', cls: 'bg-amber-100 text-amber-800' },
  deal: { text: 'Deal done', cls: 'bg-leaf-soft text-leaf' },
  walked_away: { text: 'Walked away', cls: 'bg-chilli-soft text-chilli' },
};

/** Live view of the negotiation, updated in place as it progresses. */
export function BargainCard({ b }: { b: Bargain }) {
  const s = STATUS[b.status];
  const firstAsk = b.moves.find((m) => m.who === 'shop')?.price;
  const saved = b.deal_price != null && firstAsk ? firstAsk - b.deal_price : null;
  return (
    <article className="w-full rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Bargaining · {b.item}</p>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>{s.text}</span>
      </div>
      <ol className="mt-3 flex flex-wrap items-center gap-1.5">
        {b.moves.map((m, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-xs text-muted">→</span>}
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                m.who === 'shop' ? 'bg-chilli-soft text-chilli' : 'bg-leaf-soft text-leaf'
              }`}
            >
              {m.who === 'shop' ? 'Shop' : 'You'} {rupees(m.price)}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2.5 text-xs text-muted">
        {saved != null && saved > 0
          ? `Deal at ${rupees(b.deal_price)}: you saved ${rupees(saved)} on the first ask.`
          : `Won't go above ${rupees(b.walk_away)}${b.online_price ? ` · online ${rupees(b.online_price)}` : ''}`}
      </p>
    </article>
  );
}
