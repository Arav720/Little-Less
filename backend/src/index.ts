// Little Less backend — all HTTP routes in one place.
import express from 'express';
import cors from 'cors';
import { config, configStatus } from './config.js';
import { state, addLog, publicState, resetShopping, addUser, addAgent, addStatus, addCard, updateCard, sessionContext, getSession, isValidSessionId } from './state.js';
import { userToken, USER_UID, startAgent, stopAgent } from './agora.js';
import { brainHandler, textChatHandler } from './brain.js';
import { inspectProduct } from './vision.js';
import { loadProfile, saveProfile } from './data.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // camera frames are sent as base64 JPEG

// Every request runs inside its user's own session (see state.ts).
// The browser sends "x-session-id"; Agora's agent calls back with "?sid=".
app.use((req, _res, next) => {
  const sid = req.header('x-session-id') ?? (typeof req.query.sid === 'string' ? req.query.sid : undefined);
  sessionContext.run(getSession(isValidSessionId(sid) ? sid : 'default'), next);
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/config', (_req, res) => res.json(configStatus()));

// 1. Browser asks for a channel + token to join the voice room.
app.post('/api/session', (_req, res) => {
  if (!config.agora.appId || !config.agora.appCertificate) {
    return res.status(400).json({ error: 'Add AGORA_APP_ID and AGORA_APP_CERTIFICATE to backend/.env' });
  }
  const channel = `little-less-${Date.now().toString(36)}`;
  res.json({ appId: config.agora.appId, channel, uid: USER_UID, token: userToken(channel) });
});

// 2. Start / stop the AI agent in that room.
app.post('/api/agent/start', async (req, res) => {
  try {
    const channel = String(req.body?.channel ?? '');
    if (!channel) return res.status(400).json({ error: 'channel is required' });
    res.json(await startAgent(channel));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/agent/stop', async (_req, res) => {
  try {
    res.json(await stopAgent());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 3. Camera frames from the browser (we only keep the latest one).
app.post('/api/frame', (req, res) => {
  const image = String(req.body?.image ?? '');
  if (!image.startsWith('data:image/')) return res.status(400).json({ error: 'image must be a data URL' });
  state.latestFrame = { dataUrl: image, at: Date.now() };
  res.json({ ok: true });
});

// Manual "Scan now" button (useful to test vision without talking).
app.post('/api/scan', async (_req, res) => {
  try {
    res.json(await inspectProduct());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// 4. The brain: Agora's agent calls this; the app's text box calls /api/chat.
app.post('/api/brain/chat/completions', brainHandler);
app.post('/api/chat', textChatHandler);

// 5. UI state, profile, reset.
app.get('/api/state', (_req, res) => res.json(publicState()));
app.get('/api/profile', (_req, res) => res.json(loadProfile()));
app.put('/api/profile', (req, res) => {
  saveProfile(req.body ?? {});
  console.log('[system] profile updated');
  res.json({ ok: true });
});
app.post('/api/dev/sample', async (_req, res) => {
  // Fills the conversation with a realistic sample (UI rehearsal / screenshots, no AI calls).
  resetShopping();
  const v = {
    item: 'boAt Rockerz 255 neckband',
    category: 'electronics',
    asked_price: 1500,
    fair_low: 850,
    fair_high: 1200,
    online_price: 1199,
    price_verdict: 'overpriced' as const,
    counter_offer: 950,
    fit_verdict: 'great_fit' as const,
    fit_note: 'Sweat-resistant and light, good for your gym days.',
    quality_note: 'Genuine boAt logo and IPX rating printed on the box.',
    recommendation: 'Offer ₹950. Walk away above ₹1,199, or order online for ₹1,199.',
    price_source: 'web' as const,
    sources: [
      { source: 'Amazon.in', price: 1199, link: 'https://www.amazon.in' },
      { source: 'Flipkart', price: 1149, link: 'https://www.flipkart.com' },
      { source: 'Croma', price: 1299, link: 'https://www.croma.com' },
    ],
    at: Date.now(),
  };
  state.verdict = v;
  addUser('The shop is asking 1500 for these boAt Rockerz 255 neckband earphones. Worth it?', 'voice');
  addAgent('One second, let me take a look.');
  addStatus('Checking online prices for boAt Rockerz 255 neckband…');
  addCard('verdict', v);
  addAgent("1500 is too much. They're about 1,199 online, and they suit your gym days. Want me to talk to him?");
  addUser('Yes, you talk to him.', 'voice');
  const moves = [
    { who: 'shop' as const, price: 1500 },
    { who: 'you' as const, price: 900 },
  ];
  const card = addCard('bargain', { item: v.item, opening_offer: 900, walk_away: 1199, online_price: 1199, moves, status: 'negotiating', deal_price: null });
  addAgent('ನಮಸ್ಕಾರ ಅಣ್ಣ! ಇದು ತುಂಬಾ ಜಾಸ್ತಿ ಆಯ್ತು. ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಇದು 1199 ರೂಪಾಯಿಗೆ ಸಿಗುತ್ತೆ. 900ಕ್ಕೆ ಕೊಡಿ ಅಣ್ಣ.', 'shop');
  addUser('He says 1100.', 'voice');
  moves.push({ who: 'shop', price: 1100 });
  updateCard(card.id, { item: v.item, opening_offer: 900, walk_away: 1199, online_price: 1199, moves, status: 'deal', deal_price: 1100 });
  addAgent('ಸರಿ ಅಣ್ಣ, ಡೀಲ್!', 'shop');
  addAgent('Deal at 1,100. You saved 400 rupees on his first price.');
  res.json({ ok: true });
});
app.post('/api/reset', (_req, res) => {
  resetShopping();
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`\nLittle Less backend running on http://localhost:${config.port}`);
  console.log('Config:', configStatus());
});
