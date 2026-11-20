import { rupees, type Order } from '../api';
import { CheckIcon } from '../icons';

const STEPS = ['Order placed', 'Packed', 'Shipped', 'Out for delivery'];

export function OrderCard({ o }: { o: Order }) {
  const returning = Boolean(o.return_requested);
  const step = Math.max(0, STEPS.indexOf(o.status));
  return (
    <article className="w-full rounded-2xl border border-leaf/25 bg-leaf-soft/50 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-leaf text-paper">
          <CheckIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold text-leaf">{returning ? 'Return booked' : 'Order confirmed'}</p>
          <p className="text-xs text-leaf/80">#{o.order_id} · Little Less Store</p>
        </div>
        <p className="font-display text-lg font-extrabold text-ink">{rupees(o.total)}</p>
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        {o.items.map((it, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="min-w-0 truncate capitalize">{it.name}</span>
            <span className="shrink-0 text-muted">{rupees(it.price * it.qty)}</span>
          </li>
        ))}
        {o.discount > 0 && (
          <li className="flex justify-between text-leaf">
            <span>Coupon {o.coupon}</span>
            <span>−{rupees(o.discount)}</span>
          </li>
        )}
      </ul>

      {returning ? (
        <p className="mt-3 text-sm text-ink/80">Pickup tomorrow, 10 AM – 1 PM. Refund of {rupees(o.total)} after pickup.</p>
      ) : (
        <div className="mt-3">
          <div className="flex gap-1">
            {STEPS.map((s, i) => (
              <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-leaf' : 'bg-leaf/15'}`} />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-leaf">
            {o.status} · arrives {o.eta.toLowerCase()}
          </p>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">Sandbox payment · demo order</p>
    </article>
  );
}
