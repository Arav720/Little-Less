import { useEffect, useState, type ReactNode } from 'react';
import { api, type Profile } from '../api';
import { CheckIcon } from '../icons';
import { Sheet } from './Sheet';

const LANGS = ['English', 'Hindi', 'Kannada', 'Tamil', 'Telugu'];
const SHOP_LANGS = ['Kannada', 'Hindi', 'Tamil'];
const STYLES = ['Minimal', 'Casual', 'Streetwear', 'Ethnic', 'Formal', 'Sporty'];
const COLOURS: { name: string; hex: string }[] = [
  { name: 'black', hex: '#1d1a16' },
  { name: 'white', hex: '#f8f6f1' },
  { name: 'navy', hex: '#24345c' },
  { name: 'olive', hex: '#6b7036' },
  { name: 'beige', hex: '#d9c7a6' },
  { name: 'maroon', hex: '#6d1f2a' },
  { name: 'grey', hex: '#8d8a84' },
  { name: 'pastels', hex: '#f2c6d4' },
  { name: 'neon', hex: '#b6ff2e' },
];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const GOALS = ['More protein', 'Less sugar', 'Vegetarian', 'Vegan', 'Weight loss', 'Low budget snacks'];
const BUDGET = [
  { id: 'saver', label: 'Saver', hint: 'Lowest price, happy to wait' },
  { id: 'balanced', label: 'Balanced', hint: 'Good value for money' },
  { id: 'quality', label: 'Quality first', hint: 'Pays more for genuine & lasting' },
];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
        on ? 'border-ink bg-ink text-paper' : 'border-line bg-card hover:border-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold">{label}</legend>
      {hint && <p className="-mt-1 text-xs text-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}

type WardrobeItem = { item: string; colour: string; count: number };
const ITEMS = ['T-shirt', 'Shirt', 'Jeans', 'Trousers', 'Kurta', 'Jacket', 'Sneakers', 'Earphones', 'Watch', 'Bag'];

/** Small editor: "3× black T-shirt" chips plus an add row. */
function Wardrobe({ items, onChange }: { items: WardrobeItem[]; onChange: (w: WardrobeItem[]) => void }) {
  const [item, setItem] = useState(ITEMS[0]);
  const [colour, setColour] = useState('black');
  const [count, setCount] = useState(1);
  const add = () => {
    const i = items.findIndex((w) => w.item === item && w.colour === colour);
    if (i >= 0) onChange(items.map((w, j) => (j === i ? { ...w, count: w.count + count } : w)));
    else onChange([...items, { item, colour, count }]);
  };
  const select = 'rounded-lg border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-ink';
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 && <p className="text-sm text-muted">Nothing added yet.</p>}
        {items.map((w, i) => (
          <span key={`${w.item}-${w.colour}`} className="flex items-center gap-1 rounded-full border border-line bg-card py-1 pl-3 pr-1 text-sm">
            {w.count}× <span className="capitalize">{w.colour}</span> {w.item}
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-paper hover:text-ink"
              aria-label={`Remove ${w.colour} ${w.item}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={count} onChange={(e) => setCount(Number(e.target.value))} className={select} aria-label="How many">
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}×
            </option>
          ))}
        </select>
        <select value={colour} onChange={(e) => setColour(e.target.value)} className={select} aria-label="Colour">
          {COLOURS.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
          <option value="blue">blue</option>
          <option value="light blue">light blue</option>
        </select>
        <select value={item} onChange={(e) => setItem(e.target.value)} className={select} aria-label="Item">
          {ITEMS.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <button type="button" onClick={add} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper">
          Add
        </button>
      </div>
    </div>
  );
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function ProfileSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (p: Profile) => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) api.get<Profile>('/api/profile').then(setP).catch(() => setP({}));
  }, [open]);

  if (!p) return <Sheet open={open} onClose={onClose} title="Your profile"><p className="py-8 text-center text-muted">Loading…</p></Sheet>;

  const clothing = p.clothing ?? {};
  const speaks = (p.speaks ?? 'English').split(/,| and /).map((s) => s.trim()).filter(Boolean);
  const style = (clothing.style ?? '').split(',').map((s) => s.trim()).filter((s) => STYLES.includes(s));
  const fav = clothing.favourite_colours ?? [];
  const avoid = clothing.avoid_colours ?? [];
  const goals = p.health_goals ?? [];

  const set = (patch: Partial<Profile>) => setP({ ...p, ...patch });
  const setClothing = (patch: Partial<NonNullable<Profile['clothing']>>) => set({ clothing: { ...clothing, ...patch } });

  async function save() {
    if (!p) return;
    setSaving(true);
    const next = { ...p, onboarded: true };
    await api.put('/api/profile', next).catch(() => {});
    setSaving(false);
    onSaved(next);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your profile"
      footer={
        <button onClick={save} disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3 font-semibold text-paper disabled:opacity-60">
          <CheckIcon size={18} /> {saving ? 'Saving…' : 'Save profile'}
        </button>
      }
    >
      <p className="mb-5 text-sm text-muted">Little Less uses this to tell you if something suits you. It never comments on how you look.</p>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-sm font-semibold">Name</span>
            <input
              value={p.name ?? ''}
              onChange={(e) => set({ name: e.target.value })}
              className="w-full rounded-xl border border-line bg-card px-3 py-2 outline-none focus:border-ink"
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-semibold">City</span>
            <input
              value={p.city ?? ''}
              onChange={(e) => set({ city: e.target.value })}
              className="w-full rounded-xl border border-line bg-card px-3 py-2 outline-none focus:border-ink"
            />
          </label>
        </div>

        <Field label="Languages you speak">
          <div className="flex flex-wrap gap-2">
            {LANGS.map((l) => (
              <Chip key={l} on={speaks.includes(l)} onClick={() => set({ speaks: toggle(speaks, l).join(', ') || 'English' })}>
                {l}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Bargain with shopkeepers in" hint="Little Less speaks to the seller in this language.">
          <div className="flex flex-wrap gap-2">
            {SHOP_LANGS.map((l) => (
              <Chip key={l} on={p.shopkeeper_language === l} onClick={() => set({ shopkeeper_language: l })}>
                {l}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Your style">
          <div className="flex flex-wrap gap-2">
            {STYLES.map((s) => (
              <Chip key={s} on={style.includes(s)} onClick={() => setClothing({ style: toggle(style, s).join(', ') })}>
                {s}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="Colours you love" hint="Tap once to love, twice to avoid, again to clear.">
          <div className="flex flex-wrap gap-2.5">
            {COLOURS.map((c) => {
              const state = fav.includes(c.name) ? 'love' : avoid.includes(c.name) ? 'avoid' : 'none';
              const next = () => {
                if (state === 'none') setClothing({ favourite_colours: [...fav, c.name] });
                else if (state === 'love') setClothing({ favourite_colours: fav.filter((x) => x !== c.name), avoid_colours: [...avoid, c.name] });
                else setClothing({ avoid_colours: avoid.filter((x) => x !== c.name) });
              };
              return (
                <button key={c.name} type="button" onClick={next} className="flex flex-col items-center gap-1" aria-label={`${c.name}: ${state}`}>
                  <span
                    className={`relative grid h-9 w-9 place-items-center rounded-full border ${state === 'love' ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : ''} ${state === 'avoid' ? 'opacity-40' : ''}`}
                    style={{ background: c.hex, borderColor: '#e4dac8' }}
                  >
                    {state === 'avoid' && <span className="absolute h-0.5 w-10 rotate-45 bg-chilli" />}
                  </span>
                  <span className="text-[11px] capitalize text-muted">{c.name}</span>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="T-shirt size">
          <div className="flex flex-wrap gap-2">
            {SIZES.map((s) => (
              <Chip key={s} on={clothing.sizes?.tshirt === s} onClick={() => setClothing({ sizes: { ...clothing.sizes, tshirt: s } })}>
                {s}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="What you already own" hint="So Little Less can say “you already have 3 black tees, try olive”.">
          <Wardrobe items={p.wardrobe ?? []} onChange={(wardrobe) => set({ wardrobe })} />
        </Field>

        <Field label="Health goals" hint="Used only for food and health products.">
          <div className="flex flex-wrap gap-2">
            {GOALS.map((g) => (
              <Chip key={g} on={goals.includes(g)} onClick={() => set({ health_goals: toggle(goals, g) })}>
                {g}
              </Chip>
            ))}
          </div>
        </Field>

        <Field label="How you shop">
          <div className="grid gap-2">
            {BUDGET.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => set({ budget_style: `${b.label}: ${b.hint}` })}
                className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left ${
                  p.budget_style?.startsWith(b.label) ? 'border-ink bg-card' : 'border-line'
                }`}
              >
                <span>
                  <span className="block font-semibold">{b.label}</span>
                  <span className="block text-xs text-muted">{b.hint}</span>
                </span>
                {p.budget_style?.startsWith(b.label) && <CheckIcon />}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Sheet>
  );
}
