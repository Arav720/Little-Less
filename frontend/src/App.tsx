import { useEffect, useRef, useState } from 'react';
import { api, type AppState, type ConfigStatus } from './api';
import { useCamera, uploadPhoto } from './useCamera';
import { useVoice } from './useVoice';
import { VerdictCard } from './components/VerdictCard';
import { CartPanel } from './components/CartPanel';
import { Conversation } from './components/Conversation';
import { ProfileDrawer } from './components/ProfileDrawer';

const EMPTY: AppState = {
  lastScan: null,
  verdict: null,
  cart: [],
  coupon: null,
  orders: [],
  log: [],
  agent: null,
  hasFrame: false,
  frameAgeMs: null,
};

const SETUP_LABELS: Record<string, string> = {
  agoraAppId: 'Agora App ID',
  agoraCertificate: 'Agora certificate',
  agoraRestKey: 'Agora REST key',
  murfKey: 'Murf key',
  murfVoice: 'Murf voice ID',
  llmKey: 'LLM key',
  publicUrl: 'Tunnel URL',
};

export default function App() {
  const camera = useCamera();
  const voice = useVoice();
  const [state, setState] = useState<AppState>(EMPTY);
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [backendDown, setBackendDown] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Poll the backend for verdict / cart / log.
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .get<AppState>('/api/state')
        .then((s) => {
          if (!alive) return;
          setState(s);
          setBackendDown(false);
        })
        .catch(() => alive && setBackendDown(true));
    tick();
    const id = setInterval(tick, 1000);
    api.get<ConfigStatus>('/api/config').then(setConfig).catch(() => {});
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const missing = config ? Object.keys(SETUP_LABELS).filter((k) => config[k] === false) : [];
  const live = voice.status === 'live';

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    camera.stop();
    setPhoto(await uploadPhoto(file));
    e.target.value = '';
  }

  async function scanNow() {
    setScanning(true);
    await api.post('/api/scan').catch(() => {});
    setScanning(false);
  }

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4 pb-10 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            Little <span className="text-chilli">Less</span>
          </h1>
          <p className="hidden text-sm text-muted sm:block">Pay a little less. Every time.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => api.post('/api/reset')} className="rounded-full border border-line px-3 py-1.5 text-sm font-medium hover:bg-card">
            Reset
          </button>
          <button onClick={() => setProfileOpen(true)} className="rounded-full border border-line px-3 py-1.5 text-sm font-medium hover:bg-card">
            Profile
          </button>
        </div>
      </header>

      {backendDown && (
        <p className="mb-4 rounded-2xl bg-chilli-soft px-4 py-3 text-sm text-chilli">
          Can't reach the backend. Start it with <code className="font-mono">npm run dev</code> in the backend folder.
        </p>
      )}
      {!backendDown && missing.length > 0 && (
        <p className="mb-4 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900">
          Setup needed in <code className="font-mono">backend/.env</code>: {missing.map((k) => SETUP_LABELS[k]).join(', ')}. Typed chat
          works once the LLM key is set.
        </p>
      )}

      <main className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* Left: camera + call */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-ink">
            <video ref={camera.videoRef} playsInline muted className={`h-full w-full object-cover ${camera.on ? '' : 'hidden'}`} />
            {!camera.on && photo && <img src={photo} alt="Uploaded product" className="h-full w-full object-contain" />}
            {!camera.on && !photo && (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-paper">
                <p className="font-display text-2xl font-bold">Show me what you're buying</p>
                <p className="max-w-xs text-sm text-paper/70">Turn on the camera or snap a photo. The agent looks when you ask it to.</p>
                <button onClick={() => camera.start()} className="mt-2 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink">
                  Turn on camera
                </button>
              </div>
            )}
            {state.lastScan && (
              <div className="absolute left-3 top-3 max-w-[70%] rounded-full bg-ink/75 px-3 py-1 text-xs font-medium text-paper backdrop-blur">
                Saw: {state.lastScan.item}
              </div>
            )}
            {camera.on && (
              <div className="absolute bottom-3 right-3 flex gap-2">
                <button onClick={camera.flip} className="rounded-full bg-paper/90 px-3 py-1.5 text-xs font-semibold text-ink">
                  Flip
                </button>
                <button onClick={camera.stop} className="rounded-full bg-paper/90 px-3 py-1.5 text-xs font-semibold text-ink">
                  Camera off
                </button>
              </div>
            )}
          </div>
          {camera.error && <p className="text-sm text-chilli">{camera.error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={scanNow}
              disabled={scanning || (!camera.on && !photo)}
              className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              {scanning ? 'Looking…' : 'Scan now'}
            </button>
            <button onClick={() => fileRef.current?.click()} className="rounded-full border border-line bg-card px-4 py-2 text-sm font-semibold">
              Snap / upload photo
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
          </div>

          {/* Call controls */}
          <div className="flex items-center gap-4 rounded-3xl bg-ink p-4 text-paper">
            <button
              onClick={live ? voice.stop : voice.start}
              disabled={voice.status === 'connecting' || voice.status === 'ending'}
              className={`relative isolate grid h-16 w-16 shrink-0 place-items-center rounded-full text-sm font-bold disabled:opacity-60 ${
                live ? 'bg-chilli text-paper' : 'bg-marigold text-ink'
              } ${voice.agentTalking ? 'ring text-marigold' : ''}`}
              aria-label={live ? 'End conversation' : 'Start talking'}
            >
              <span className={voice.agentTalking ? 'text-paper' : ''}>{live ? 'End' : voice.status === 'connecting' ? '…' : 'Talk'}</span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-bold">
                {voice.status === 'idle' && 'Tap Talk to start'}
                {voice.status === 'connecting' && 'Calling Little Less…'}
                {voice.status === 'ending' && 'Ending…'}
                {live && (voice.agentTalking ? 'Little Less is speaking' : voice.youTalking ? 'Listening to you…' : 'Go ahead, I\'m listening')}
              </p>
              <p className="truncate text-sm text-paper/60">
                {voice.error ?? 'Try: "Bhaiya is asking 800 for this, is it worth it?"'}
              </p>
            </div>
            {live && (
              <button onClick={voice.toggleMute} className="rounded-full border border-paper/30 px-3 py-1.5 text-xs font-semibold">
                {voice.muted ? 'Unmute' : 'Mute'}
              </button>
            )}
          </div>
        </div>

        {/* Right: verdict, cart, conversation */}
        <div className="flex min-w-0 flex-col gap-4">
          <VerdictCard verdict={state.verdict} scanning={state.lastScan?.item ?? null} />
          <CartPanel state={state} />
          <Conversation log={state.log} />
        </div>
      </main>

      <ProfileDrawer open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
