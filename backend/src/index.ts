// Little Less backend — all HTTP routes in one place.
import express from 'express';
import cors from 'cors';
import { config, configStatus } from './config.js';
import { state, addLog, publicState, resetShopping } from './state.js';
import { userToken, USER_UID, startAgent, stopAgent } from './agora.js';
import { brainHandler, textChatHandler } from './brain.js';
import { scanLatestFrame } from './vision.js';
import { loadProfile, saveProfile } from './data.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // camera frames are sent as base64 JPEG

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
    res.json(await scanLatestFrame());
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
  addLog('system', 'Profile updated');
  res.json({ ok: true });
});
app.post('/api/dev/sample', async (_req, res) => {
  const { runTool } = await import('./tools.js');
  await runTool('show_verdict', JSON.stringify({ item: 'Olive cotton T-shirt', asked_price: 800, fair_low: 350, fair_high: 450, online_price: 399, price_verdict: 'overpriced', counter_offer: 380, fit_verdict: 'great_fit', fit_note: 'Olive is in your palette and you only own black and white tees.', quality_note: 'Stitching looks even; decent 180 GSM cotton.', recommendation: 'Offer ₹380. If he won’t go below ₹450, order it online for ₹359 with LITTLE10.' }));
  await runTool('add_to_cart', JSON.stringify({ product_id: 'tee-olive-plain', source: 'online' }));
  await runTool('apply_coupon', JSON.stringify({ code: 'LITTLE10' }));
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
