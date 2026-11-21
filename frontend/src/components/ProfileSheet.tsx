import { useEffect, useState, type ReactNode } from 'react';
import { api, type Profile } from '../api';
import { CheckIcon } from '../icons';
import { Sheet } from './Sheet';
import { VoiceprintCard } from './VoiceprintCard';

const LANGS = ['English', 'Hindi', 'Kannada', 'Tamil', 'Telugu', 'Malayalam', 'Marathi', 'Bengali'];
const VOICE_LANGS = ['Hindi', 'Kannada', 'Tamil', 'Telugu'];
const SHOP_LANGS = ['Kannada', 'Hindi', 'Tamil', 'Telugu'];
const STYLES = ['Minimal', 'Casual', 'Streetwear', 'Ethnic', 'Formal', 'Sporty', 'Smart casual', 'Vintage'];
const FITS = ['Slim', 'Regular', 'Relaxed', 'Oversized'];
const COLOURS: { name: string; hex: string }[] = [
  { name: 'black', hex: '#1d1a16' },
  { name: 'white', hex: '#f8f6f1' },
  { name: 'grey', hex: '#8d8a84' },
  { name: 'navy', hex: '#24345c' },
  { name: 'blue', hex: '#3d6fb6' },
  { name: 'olive', hex: '#6b7036' },
  { name: 'green', hex: '#2f7d4f' },
  { name: 'beige', hex: '#d9c7a6' },
  { name: 'brown', hex: '#7a5230' },
  { name: 'maroon', hex: '#6d1f2a' },
  { name: 'red', hex: '#c8352e' },
  { name: 'pink', hex: '#e58fae' },
  { name: 'yellow', hex: '#e9c13b' },
  { name: 'pastels', hex: '#f2c6d4' },
  { name: 'neon', hex: '#b6ff2e' },
];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const WAISTS = ['28', '30', '32', '34', '36', '38', '40'];
const SHOES = ['UK 5', 'UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11', 'UK 12'];
const DIETS = ['Vegetarian', 'Eggetarian', 'Non-veg', 'Vegan', 'Jain'];
const GOALS = ['More protein', 'Less sugar', 'Weight loss', 'Muscle gain', 'Low sodium', 'Gluten-free', 'Low budget snacks'];
const BUDGET = [
  { id: 'saver', label: 'Saver', hint: 'Lowest price, happy to wait' },
  { id: 'balanced', label: 'Balanced', hint: 'Good value for money' },
  { id: 'quality', label: 'Quality first', hint: 'Pays more for genuine & lasting' },
];
const ITEMS = ['T-shirt', 'Shirt', 'Jeans', 'Trousers', 'Shorts', 'Kurta', 'Hoodie', 'Jacket', 'Sneakers', 'Sandals', 'Earphones', 'Watch', 'Bag', 'Sunglasses', 'Phone', 'Power bank'];

const input = 'w-full rounded-xl border border-line bg-card px-3 py-2 outline-none focus:border-ink';
const select = 'rounded-lg border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-ink';

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${on ? 'border-ink bg-ink text-paper' : 'border-line bg-card hover:border-ink'}`}
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-5 border-t border-line pt-5 first:border-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** One-tap chips; tap the selected one again to clear it. */
function Pick({ options, value, onChange }: { options: string[]; value?: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Chip key={o} on={value === o} onClick={() => onChange(value === o ? '' : o)}>
          {o}
        </Chip>
      ))}
    </div>
  );
}

type WardrobeItem = { item: string; colour: string; count: number };

/** "3× black T-shirt" chips plus an add row; item and colour accept anything you type. */
function Wardrobe({ items, onChange }: { items: WardrobeItem[]; onChange: (w: WardrobeItem[]) => void }) {
  const [item, setItem] = useState('');
  const [colour, setColour] = useState('');
  const [count, setCount] = useState(1);
  const add = () => {
    const it = item.trim();
    const co = colour.trim().toLowerCase();
    if (!it) return;
    const i = items.findIndex((w) => w.item.toLowerCase() === it.toLowerCase() && w.colour === co);
    if (i >= 0) onChange(items.map((w, j) => (j === i ? { ...w, count: w.count + count } : w)));
    else onChange([...items, { item: it, colour: co, count }]);
    setItem('');
    setColour('');
    setCount(1);
  };
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 && <p className="text-sm text-muted">Nothing added yet.</p>}
        {items.map((w, i) => (
          <span key={`${w.item}-${w.colour}-${i}`} className="flex items-center gap-1 rounded-full border border-line bg-card py-1 pl-3 pr-1 text-sm">
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
          {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
            <option key={n} value={n}>
              {n}×
            </option>
          ))}
        </select>
        <input list="ll-colours" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="Colour" className={`${select} w-24`} aria-label="Colour" />
        <input
          list="ll-items"
          value={item}
          onChange={(e) => setItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="Item, e.g. Shirt"
          className={`${select} min-w-0 flex-1`}
          aria-label="Item"
        />
        <button type="button" onClick={add} disabled={!item.trim()} className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-paper disabled:opacity-40">
          Add
        </button>
        <datalist id="ll-colours">
          {COLOURS.map((c) => (
            <option key={c.name} value={c.name} />
          ))}
          <option value="light blue" />
        </datalist>
        <datalist id="ll-items">
          {ITEMS.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function ProfileSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (p: Profile) => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmReset(false);
      api.get<Profile>('/api/profile').then(setP).catch(() => setP({}));
    }
  }, [open]);

  if (!p)
    return (
      <Sheet open={open} onClose={onClose} title="Your profile">
        <p className="py-8 text-center text-muted">Loading…</p>
      </Sheet>
    );

  const clothing = p.clothing ?? {};
  const sizes = clothing.sizes ?? {};
  const speaks = (p.speaks ?? 'English').split(/,| and /).map((s) => s.trim()).filter(Boolean);
  const style = (clothing.style ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const fav = clothing.favourite_colours ?? [];
  const avoid = clothing.avoid_colours ?? [];
  const goals = p.health_goals ?? [];

  const set = (patch: Partial<Profile>) => setP({ ...p, ...patch });
  const setClothing = (patch: Partial<NonNullable<Profile['clothing']>>) => set({ clothing: { ...clothing, ...patch } });
  const setSize = (k: keyof typeof sizes, v: string) => setClothing({ sizes: { ...sizes, [k]: v } });

  async function save() {
    if (!p) return;
    setSaving(true);
    const next = { ...p, onboarded: true, demo: false };
    await api.put('/api/profile', next).catch(() => {});
    setSaving(false);
    onSaved(next);
    onClose();
  }

  async function reset(kind: 'demo' | 'blank') {
    const next = await api.post<Profile>('/api/profile/reset', { kind }).catch(() => null);
    if (next) {
      setP(next);
      onSaved(next);
    }
    setConfirmReset(false);
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
      <p className="mb-4 text-sm text-muted">
        This profile is only for you, on this device. Little Less uses it to tell you if something suits you. Fill in as much or as little as you like; it never comments
        on how you look.
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-card p-3 text-sm">
        <span className="mr-auto text-muted">{p.demo ? 'Showing the demo profile (Arav).' : 'Need a quick start?'}</span>
        {!p.demo && (
          <button type="button" onClick={() => reset('demo')} className="rounded-full border border-line px-3 py-1.5 font-semibold hover:border-ink">
            Use demo profile
          </button>
        )}
        {confirmReset ? (
          <>
            <button type="button" onClick={() => reset('blank')} className="rounded-full bg-chilli px-3 py-1.5 font-semibold text-white">
              Yes, clear it
            </button>
            <button type="button" onClick={() => setConfirmReset(false)} className="rounded-full px-3 py-1.5 text-muted">
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)} className="rounded-full border border-line px-3 py-1.5 hover:border-ink">
            Start fresh
          </button>
        )}
      </div>

      <div className="space-y-7">
        <Section title="About you">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-sm font-semibold">Name</span>
              <input value={p.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="What should I call you?" className={input} />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-semibold">City</span>
              <input value={p.city ?? ''} onChange={(e) => set({ city: e.target.value })} className={input} />
            </label>
          </div>
        </Section>

        <Section title="Voice & languages">
          <VoiceprintCard />
          <Field label="Languages you speak">
            <div className="flex flex-wrap gap-2">
              {LANGS.map((l) => (
                <Chip key={l} on={speaks.includes(l)} onClick={() => set({ speaks: toggle(speaks, l).join(', ') || 'English' })}>
                  {l}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="I'll talk to Little Less in" hint="English only gives the most accurate voice, especially in noisy places. Add a second language only if you'll actually speak it.">
            <div className="flex flex-wrap gap-2">
              <Chip on={!p.voice_language} onClick={() => set({ voice_language: '' })}>
                English only
              </Chip>
              {VOICE_LANGS.map((l) => (
                <Chip key={l} on={p.voice_language === l} onClick={() => set({ voice_language: l })}>
                  English + {l}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="Bargain with shopkeepers in" hint="Little Less speaks to the seller in this language. You can also switch it mid-chat.">
            <div className="flex flex-wrap gap-2">
              {SHOP_LANGS.map((l) => (
                <Chip key={l} on={p.shopkeeper_language === l} onClick={() => set({ shopkeeper_language: l })}>
                  {l}
                </Chip>
              ))}
            </div>
          </Field>
        </Section>

        <Section title="Clothes">
          <Field label="Your style" hint="Pick any that fit.">
            <div className="flex flex-wrap gap-2">
              {STYLES.map((s) => (
                <Chip key={s} on={style.includes(s)} onClick={() => setClothing({ style: toggle(style, s).join(', ') })}>
                  {s}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="How you like clothes to fit">
            <Pick options={FITS} value={clothing.fit} onChange={(fit) => setClothing({ fit })} />
          </Field>
          <Field label="Colours" hint="Tap once to love, twice to avoid, again to clear.">
            <div className="flex flex-wrap gap-2.5">
              {COLOURS.map((c) => {
                const state = fav.includes(c.name) ? 'love' : avoid.includes(c.name) ? 'avoid' : 'none';
                const next = () => {
                  if (state === 'none') setClothing({ favourite_colours: [...fav, c.name] });
                  else if (state === 'love') setClothing({ favourite_colours: fav.filter((x) => x !== c.name), avoid_colours: [...avoid, c.name] });
                  else setClothing({ avoid_colours: avoid.filter((x) => x !== c.name) });
                };
                return (
                  <button key={c.name} type="button" onClick={next} className="flex w-11 flex-col items-center gap-1" aria-label={`${c.name}: ${state}`}>
                    <span
                      className={`relative grid h-9 w-9 place-items-center overflow-hidden rounded-full border ${state === 'love' ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : ''} ${state === 'avoid' ? 'opacity-40' : ''}`}
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
            <Pick options={SIZES} value={sizes.tshirt} onChange={(v) => setSize('tshirt', v)} />
          </Field>
          <Field label="Shirt size">
            <Pick options={SIZES} value={sizes.shirt} onChange={(v) => setSize('shirt', v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-sm font-semibold">Jeans waist</span>
              <select value={sizes.jeans_waist ?? ''} onChange={(e) => setSize('jeans_waist', e.target.value)} className={`${select} w-full py-2`}>
                <option value="">Not set</option>
                {WAISTS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-semibold">Shoe size</span>
              <select value={sizes.shoes ?? ''} onChange={(e) => setSize('shoes', e.target.value)} className={`${select} w-full py-2`}>
                <option value="">Not set</option>
                {SHOES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Field label="What you already own" hint="So Little Less can say “you already have 3 black tees, try olive”. Type any item or colour.">
            <Wardrobe items={p.wardrobe ?? []} onChange={(wardrobe) => set({ wardrobe })} />
          </Field>
        </Section>

        <Section title="Food & health">
          <Field label="Diet">
            <Pick options={DIETS} value={p.diet} onChange={(diet) => set({ diet })} />
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
        </Section>

        <Section title="Money & gadgets">
          <Field label="How you shop">
            <div className="grid gap-2">
              {BUDGET.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => set({ budget_style: `${b.label}: ${b.hint}` })}
                  className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left ${p.budget_style?.startsWith(b.label) ? 'border-ink bg-card' : 'border-line'}`}
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
          <label className="block space-y-1">
            <span className="text-sm font-semibold">I usually spend up to (per item)</span>
            <div className="flex items-center gap-2">
              <span className="text-muted">₹</span>
              <input
                inputMode="numeric"
                value={p.usual_max_spend ?? ''}
                onChange={(e) => set({ usual_max_spend: e.target.value.replace(/[^0-9]/g, '') })}
                placeholder="e.g. 1500"
                className={input}
              />
            </div>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Gadgets you use / care about</span>
            <input value={p.tech ?? ''} onChange={(e) => set({ tech: e.target.value })} placeholder="e.g. Android phone, battery and warranty matter most" className={input} />
          </label>
        </Section>

        <Section title="Anything else">
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Things Little Less should know</span>
            <textarea
              rows={3}
              value={p.notes ?? ''}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="e.g. I prefer cotton, I don't wear logos, I'm buying gifts for my sister this month"
              className={`${input} resize-none`}
            />
          </label>
        </Section>
      </div>
    </Sheet>
  );
}
