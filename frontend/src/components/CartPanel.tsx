import { rupees, type AppState } from '../api';

export function CartPanel({ state }: { state: AppState }) {
  const online = state.cart.filter((c) => c.source === 'online');
  const subtotal = online.reduce((s, c) => s + c.price * c.qty, 0);
  const discount = state.coupon ? Math.round((subtotal * state.coupon.percent) / 100) : 0;
  const latest = state.orders.at(-1);

  return (
    <section className="rounded-3xl border border-line bg-card p-5">
      <h3 className="font-display text-lg font-bold">Cart</h3>
      {state.cart.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Empty. Little Less adds things here when you agree.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line text-sm">
          {state.cart.map((c, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="text-xs text-muted">{c.source === 'online' ? 'Online order' : 'Bought at shop'} · qty {c.qty}</span>
              </span>
              <span className="shrink-0 font-semibold">{rupees(c.price * c.qty)}</span>
            </li>
          ))}
          {online.length > 0 && (
            <li className="space-y-1 pt-2">
              {state.coupon && (
                <div className="flex justify-between text-leaf">
                  <span>Coupon {state.coupon.code}</span>
                  <span>−{rupees(discount)}</span>
                </div>
              )}
              <div className="flex justify-between font-display text-base font-bold">
                <span>To pay online</span>
                <span>{rupees(subtotal - discount)}</span>
              </div>
            </li>
          )}
        </ul>
      )}

      {latest && (
        <div className="mt-4 rounded-2xl bg-leaf-soft p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-display font-bold text-leaf">Order {latest.order_id}</span>
            <span className="font-semibold">{rupees(latest.total)}</span>
          </div>
          <p className="mt-1 text-leaf">
            {latest.status} · {latest.eta}
          </p>
          {latest.discount > 0 && <p className="text-xs text-leaf/80">You saved {rupees(latest.discount)} with {latest.coupon}</p>}
          {latest.return_requested && <p className="mt-1 text-xs">Return: {latest.return_requested}</p>}
          <p className="mt-1 text-xs text-leaf/70">Sandbox payment · demo only</p>
        </div>
      )}
    </section>
  );
}
