import type { RefObject } from 'react';
import { CloseIcon, FlipIcon, ImageIcon, ScanIcon } from '../icons';

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  on: boolean;
  photo: string | null;
  error: string | null;
  scanning: boolean;
  onStart: () => void;
  onStop: () => void;
  onFlip: () => void;
  onScan: () => void;
  onPickPhoto: () => void;
  compact?: boolean;
};

/** Live viewfinder. The agent only "looks" when asked (Scan, or "check this" in conversation). */
export function CameraPanel({ videoRef, on, photo, error, scanning, onStart, onStop, onFlip, onScan, onPickPhoto, compact }: Props) {
  const showing = on || Boolean(photo);
  return (
    <div className={`relative overflow-hidden rounded-3xl bg-ink ${compact ? 'aspect-[16/10] sm:aspect-[4/3]' : 'aspect-[3/4]'}`}>
      <video ref={videoRef} playsInline muted className={`h-full w-full object-cover ${on ? '' : 'hidden'}`} />
      {!on && photo && <img src={photo} alt="Your photo" className="h-full w-full object-contain" />}

      {!showing && (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-paper">
          <p className="font-display text-xl font-bold">Point at what you're buying</p>
          <p className="max-w-[16rem] text-sm text-paper/65">I look only when you ask, like "check this".</p>
          <div className="mt-1 flex gap-2">
            <button onClick={onStart} className="rounded-full bg-paper px-4 py-2 text-sm font-semibold text-ink">
              Open camera
            </button>
            <button onClick={onPickPhoto} className="flex items-center gap-1.5 rounded-full bg-paper/10 px-4 py-2 text-sm font-semibold">
              <ImageIcon size={16} /> Photo
            </button>
          </div>
          {error && <p className="max-w-xs text-xs text-chilli-soft">{error}</p>}
        </div>
      )}

      {showing && (
        <>
          {/* Viewfinder corners */}
          <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-paper/25" />
          <div className="absolute right-3 top-3 flex gap-2">
            {on && (
              <button onClick={onFlip} className="grid h-9 w-9 place-items-center rounded-full bg-ink/60 text-paper backdrop-blur" aria-label="Flip camera">
                <FlipIcon size={18} />
              </button>
            )}
            <button onClick={onStop} className="grid h-9 w-9 place-items-center rounded-full bg-ink/60 text-paper backdrop-blur" aria-label="Close camera">
              <CloseIcon size={18} />
            </button>
          </div>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
            <button
              onClick={onScan}
              disabled={scanning}
              className="flex items-center gap-2 rounded-full bg-paper px-5 py-2.5 text-sm font-bold text-ink shadow-lg transition-transform active:scale-95 disabled:opacity-70"
            >
              <ScanIcon size={18} />
              {scanning ? 'Checking…' : 'Check this'}
            </button>
            <button onClick={onPickPhoto} className="grid h-10 w-10 place-items-center rounded-full bg-ink/60 text-paper backdrop-blur" aria-label="Pick a photo">
              <ImageIcon size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
