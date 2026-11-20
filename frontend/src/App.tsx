import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AppState, type ConfigStatus, type Profile } from './api';
import { useCamera, uploadPhoto } from './useCamera';
import { useVoice } from './useVoice';
import { Feed } from './components/Feed';
import { Composer } from './components/Composer';
import { CameraPanel } from './components/CameraPanel';
import { ProfileSheet } from './components/ProfileSheet';
import { UserIcon } from './icons';

const EMPTY: AppState = { feed: [], cart: [], coupon: null, orders: [], agent: null, hasFrame: false };

const SETUP_LABELS: Record<string, string> = {
  agoraAppId: 'Agora App ID',
  agoraCertificate: 'Agora certificate',
  murfKey: 'Murf key',
  murfVoice: 'Murf voice',
  llmKey: 'AI model key',
  publicUrl: 'tunnel URL',
};

function readPref(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writePref(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

export default function App() {
  const camera = useCamera();
  const voice = useVoice();
  const [state, setState] = useState<AppState>(EMPTY);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [sending, setSending] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [holdToTalk, setHoldToTalkState] = useState(() => readPref('ll-hold-to-talk'));
  const fileRef = useRef<HTMLInputElement>(null);
  const live = voice.status === 'live';

  // ---- Data: poll the conversation + load profile/config once ----
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .get<AppState>('/api/state')
        .then((s) => {
          if (!alive) return;
          setState(s);
          setOffline(false);
        })
        .catch(() => alive && setOffline(true));
    tick();
    const id = setInterval(tick, 1000);
    api.get<Profile>('/api/profile').then(setProfile).catch(() => {});
    api.get<ConfigStatus>('/api/config').then(setConfig).catch(() => {});
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // ---- Hold-to-talk (noisy rooms): mic only open while holding the button or Space ----
  const setHoldToTalk = useCallback((on: boolean) => {
    setHoldToTalkState(on);
    writePref('ll-hold-to-talk', on);
  }, []);
  useEffect(() => {
    if (live) voice.setMicOpen(!holdToTalk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdToTalk, live]);
  useEffect(() => {
    if (!live || !holdToTalk) return;
    const typing = (e: KeyboardEvent) => ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !typing(e)) {
        e.preventDefault();
        voice.setMicOpen(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && !typing(e) && voice.setMicOpen(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, holdToTalk]);

  // ---- Actions ----
  const send = useCallback(async (text: string) => {
    setSending(true);
    await api.post('/api/chat', { text }).catch(() => {});
    setSending(false);
  }, []);

  async function checkThis() {
    setScanning(true);
    await send(photo && !camera.on ? 'Check this photo.' : "Check what I'm showing you on the camera.");
    setScanning(false);
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    camera.stop();
    setPhoto(await uploadPhoto(file));
  }

  function toggleCamera() {
    if (camera.on) camera.stop();
    else {
      setPhoto(null);
      camera.start();
    }
  }

  // "Thinking" dots: after the user's last message until Little Less answers.
  const last = state.feed.at(-1);
  const thinking = sending || (last?.kind === 'user' && Date.now() - last.at < 25_000) || (last?.kind === 'status' && Date.now() - last.at < 25_000);

  const missing = config ? Object.keys(SETUP_LABELS).filter((k) => config[k] === false) : [];
  const cameraVisible = camera.on || Boolean(photo);
  const shopLanguage = state.shopLanguage ?? profile?.shopkeeper_language ?? 'Kannada';

  const cameraPanel = (compact: boolean) => (
    <CameraPanel
      videoRef={camera.videoRef}
      on={camera.on}
      photo={photo}
      error={camera.error}
      scanning={scanning}
      compact={compact}
      onStart={() => {
        setPhoto(null);
        camera.start();
      }}
      onStop={() => {
        camera.stop();
        setPhoto(null);
      }}
      onFlip={camera.flip}
      onScan={checkThis}
      onPickPhoto={() => fileRef.current?.click()}
    />
  );

  return (
    <div className="flex h-[100dvh] flex-col">
      {/* Header */}
      <header className="z-10 flex shrink-0 items-center justify-between border-b border-line/70 bg-paper/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-ink font-display text-sm font-extrabold text-marigold">LL</span>
          <div className="leading-tight">
            <h1 className="font-display text-lg font-extrabold tracking-tight">
              Little <span className="text-chilli">Less</span>
            </h1>
            <p className="hidden text-[11px] text-muted sm:block">Pay a little less. Every time.</p>
          </div>
          {live && (
            <span className="ml-1 flex items-center gap-1.5 rounded-full bg-leaf-soft px-2.5 py-1 text-[11px] font-semibold text-leaf">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-leaf" /> Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setProfileOpen(true)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-card" aria-label="Your profile">
            <UserIcon />
          </button>
          <button
            onClick={() => api.post('/api/reset')}
            className="ml-1 hidden rounded-full border border-line px-3 py-1.5 text-xs font-medium hover:bg-card sm:block"
          >
            New chat
          </button>
        </div>
      </header>

      {(offline || missing.length > 0) && (
        <p className={`shrink-0 px-4 py-2 text-center text-xs ${offline ? 'bg-chilli-soft text-chilli' : 'bg-amber-100 text-amber-900'}`}>
          {offline ? "Can't reach the Little Less server. Is the backend running?" : `Setup needed in backend/.env: ${missing.map((k) => SETUP_LABELS[k]).join(', ')}`}
        </p>
      )}

      {/* Body: camera (side on desktop, top on phone) + one conversation */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-6 lg:px-6 lg:py-5">
        <aside className="hidden w-[360px] shrink-0 flex-col gap-3 lg:flex">
          {cameraPanel(false)}
          <p className="px-1 text-xs text-muted">
            Tip: hold the item close and say <span className="font-medium text-ink">"check this"</span>, or tap Check this.
          </p>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-hidden lg:rounded-3xl lg:border lg:border-line lg:bg-card/40">
          {cameraVisible && <div className="shrink-0 px-4 pt-3 lg:hidden">{cameraPanel(true)}</div>}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <Feed
              feed={state.feed}
              thinking={thinking}
              shopLanguage={shopLanguage}
              userName={profile?.name}
              needsProfile={!profile?.onboarded}
              onSuggest={send}
              onOpenProfile={() => setProfileOpen(true)}
            />
          </div>

          <div className="shrink-0 border-t border-line/70 bg-paper/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4 lg:bg-transparent">
            <Composer
              voice={voice}
              cameraOn={cameraVisible}
              onToggleCamera={toggleCamera}
              onSend={send}
              sending={sending}
              holdToTalk={holdToTalk}
              setHoldToTalk={setHoldToTalk}
            />
          </div>
        </main>
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} onSaved={setProfile} />
    </div>
  );
}
