import { useEffect, useRef } from 'react';
import type { FeedEntry } from '../api';
import { MicIcon, SparkIcon, StoreIcon } from '../icons';
import { VerdictCard, type VerdictActions } from './VerdictCard';
import { BargainCard } from './BargainCard';
import { OrderCard } from './OrderCard';

const SUGGESTIONS = [
  'The shop is asking ₹800 for this. Is it worth it?',
  'Check what I’m holding',
];

type Props = {
  feed: FeedEntry[];
  thinking: boolean;
  shopLanguage: string;
  userName?: string;
  needsProfile: boolean;
  onSuggest: (text: string) => void;
  negotiating: boolean;
  demoProfile?: boolean;
  onOpenProfile: () => void;
  onUseDemo?: () => void;
};

export function Feed({ feed, thinking, shopLanguage, userName, needsProfile, onSuggest, onOpenProfile, onUseDemo, negotiating, demoProfile }: Props) {
  // Only the newest price card shows action buttons.
  const latestVerdictId = [...feed].reverse().find((e) => e.card?.type === 'verdict')?.id;
  const endRef = useRef<HTMLDivElement>(null);
  const last = feed.at(-1);

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [feed.length, last?.card ? JSON.stringify(last.card.data).length : 0, thinking]);

  if (feed.length === 0) {
    return (
      <div className="flex min-h-full flex-col justify-end gap-4 px-4 pb-4 pt-8 sm:px-6">
        <div>
          <p className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {userName ? `Hey ${userName},` : 'Hey there,'}
            <br />
            <span className="text-chilli">what are we buying?</span>
          </p>
          <p className="mt-3 max-w-md text-[15px] text-muted">
            Show me the item, tell me what the shopkeeper is asking, and I'll tell you if it's worth it, then bargain for
            you or find it cheaper online.
          </p>
        </div>

        {needsProfile && (
          <button
            onClick={onOpenProfile}
            className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3.5 text-left transition-colors hover:border-ink"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-marigold/20 text-amber-800">
              <SparkIcon size={20} />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{demoProfile ? 'Using a demo profile (Arav)' : 'Set up your shopping profile'}</span>
              <span className="block text-sm text-muted">{demoProfile ? 'Make it yours: style, sizes, what you own, goals.' : 'Your style, sizes and goals, so advice fits you. Takes 30 sec.'}</span>
            </span>
          </button>
        )}
        {needsProfile && !demoProfile && onUseDemo && (
          <button onClick={onUseDemo} className="-mt-2 self-start px-1 text-sm text-muted underline underline-offset-4 hover:text-ink">
            Just exploring? Try a demo profile
          </button>
        )}

        <div className="flex flex-col items-start gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onSuggest(s)}
              className="rounded-full border border-line bg-card px-4 py-2 text-left text-sm transition-colors hover:border-ink"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 px-4 py-4 sm:px-6">
      {feed.map((e, i) => (
        <Entry
          key={e.id}
          e={e}
          prev={feed[i - 1]}
          shopLanguage={shopLanguage}
          actions={e.id === latestVerdictId ? { onSend: onSuggest, negotiating } : undefined}
        />
      ))}
      {thinking && (
        <div className="flex items-center gap-1.5 self-start rounded-2xl rounded-bl-md bg-card px-4 py-3" aria-label="Little Less is thinking">
          {[0, 1, 2].map((d) => (
            <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${d * 120}ms` }} />
          ))}
        </div>
      )}
      <div ref={endRef} className="h-1" />
    </div>
  );
}

function Entry({ e, prev, shopLanguage, actions }: { e: FeedEntry; prev?: FeedEntry; shopLanguage: string; actions?: VerdictActions }) {
  switch (e.kind) {
    case 'user':
      return (
        <div className="flex max-w-[85%] flex-col items-end self-end">
          <p className="break-words rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] text-paper">{e.text}</p>
          {e.via === 'voice' && (
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
              <MicIcon size={11} /> said
            </span>
          )}
        </div>
      );
    case 'agent':
      return (
        <p className="max-w-[85%] self-start break-words rounded-2xl rounded-bl-md bg-card px-4 py-2.5 text-[15px] shadow-[0_1px_2px_rgba(29,26,22,0.05)]">
          {e.text}
        </p>
      );
    case 'shop':
      return (
        <div className="max-w-[88%] self-start">
          {prev?.kind !== 'shop' && (
            <span className="mb-1 ml-1 flex items-center gap-1 text-[11px] font-semibold text-amber-800">
              <StoreIcon size={12} /> To the shopkeeper · {shopLanguage}
            </span>
          )}
          <p className="break-words rounded-2xl rounded-bl-md border border-marigold/40 bg-marigold/15 px-4 py-2.5 text-[15px]">{e.text}</p>
        </div>
      );
    case 'status':
      return <p className="self-center px-2 text-center text-xs text-muted">{e.text}</p>;
    case 'system':
      return (
        <p className="self-center rounded-full bg-line/60 px-3 py-1 text-[11px] font-medium text-muted">{e.text}</p>
      );
    case 'error':
      return <p className="self-center rounded-full bg-chilli-soft px-3 py-1 text-xs text-chilli">{e.text}</p>;
    case 'card':
      if (!e.card) return null;
      return (
        <div className="w-full max-w-md self-start">
          {e.card.type === 'verdict' && <VerdictCard v={e.card.data} actions={actions} />}
          {e.card.type === 'bargain' && <BargainCard b={e.card.data} />}
          {e.card.type === 'order' && <OrderCard o={e.card.data} />}
        </div>
      );
    default:
      return null;
  }
}
