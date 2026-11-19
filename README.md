# Little Less

**Pay a little less. Every time.**

Little Less is a voice shopping buddy for street markets. Point your phone at a product and say what the shopkeeper is asking. It tells you if the price is fair and if the item suits *you*. It bargains for you in the shopkeeper's language. If the shop won't come down, it orders the item online instead.

Built for *Build with Agora – Bengaluru 2026* (VibeCart: Shop by Talking).

## How it works

```
Phone/laptop browser ──mic──► Agora RTC ──► Agora Conversational AI
       │                                        │ speech-to-text (ARES)
       │ camera frame every 1.5 s               ▼
       └──────────► our backend  ◄──── "brain" (/api/brain/chat/completions)
                    (Node/Express)       LLM + tools: look_at_camera, check_price,
                                         show_verdict, add_to_cart, apply_coupon,
                                         checkout, track_order, start_return
                                                │ reply text
                                                ▼
                               Murf Falcon TTS (voice) ──► Agora ──► your speaker
```

| Folder | What's inside |
|---|---|
| `backend/src/index.ts` | All HTTP routes |
| `backend/src/agora.ts` | RTC tokens + start/stop the AI agent (Murf configured here) |
| `backend/src/brain.ts` | System prompt + LLM/tool loop + SSE streaming back to Agora |
| `backend/src/tools.ts` | The agent's actions (price check, cart, coupon, checkout, tracking, returns) |
| `backend/src/vision.ts` | Reads the latest camera frame with the vision LLM |
| `backend/data/catalog.json` | **Mock prices. Edit these to match the items you'll demo** |
| `backend/data/profile.json` | The shopper's style, colours, goals and language (also editable in the app) |
| `frontend/src/App.tsx` | Main screen: camera, Talk button, verdict, cart, conversation |

## 1. Fill in keys

Open `backend/.env` and fill it in. Each line has a comment saying where the value comes from. **Restart the backend after editing `.env`.**

## 2. Run (two terminals)

```powershell
cd "C:\Users\CEPL\Desktop\Little less\backend"; npm run dev
```

```powershell
cd "C:\Users\CEPL\Desktop\Little less\frontend"; npm run dev
```

Open http://localhost:5173. Typed chat works as soon as `LLM_API_KEY` is set, and it doesn't use Agora minutes.

## 3. Tunnel (needed for voice and for the phone)

Agora's agent runs in the cloud, so it must reach your laptop over HTTPS. One tunnel to the **frontend port** covers everything: Vite forwards `/api` to the backend.

```powershell
winget install --id Cloudflare.cloudflared
```

```powershell
cloudflared tunnel --url http://localhost:5173
```

Copy the `https://….trycloudflare.com` URL into `PUBLIC_URL` in `backend/.env` and restart the backend. Open the same URL on your phone to use the back camera.

> The quick-tunnel URL changes every time you restart cloudflared, so update `PUBLIC_URL` each time.

## Demo script (about 3 minutes)

1. **Before:** open Profile and show the saved style, colours, wardrobe, goals and coupon.
2. Tap **Talk**. Hold up the olive T-shirt: *"Bhaiya is asking 800 for this. Is it worth it?"*
3. The agent looks, checks the price, and the scorecard appears: overpriced, suits you, offer ₹380.
4. *"You talk to him."* The agent speaks to the shopkeeper in Kannada with the online price and a counter offer.
5. *"He's not agreeing."* It offers to order online, adds to cart, applies LITTLE10, and asks you to confirm ₹359.
6. *"Yes."* It places a sandbox order and reads out the order ID and delivery time.
7. **After:** *"Where's my order?"*, then *"It came in the wrong size."* It tracks the order and starts a return.
8. Optional: show a protein bar. It's fixed MRP, so no bargaining. It's high sugar against your goal, so the agent suggests a better bar online.

## Testing without voice

- **Typed chat:** use the box under Conversation.
- **Scan now:** runs the vision step on the current camera frame.
- `POST /api/dev/sample` fills the screen with a sample verdict and cart, for UI rehearsal. `POST /api/reset` clears it, as does the Reset button.

## Troubleshooting

| Problem | Check |
|---|---|
| Banner says setup needed | Fill `backend/.env`, then restart the backend |
| "Agora start failed (401/403)" | `AGORA_CUSTOMER_ID` / `AGORA_CUSTOMER_SECRET` (RESTful API key) and that Conversational AI is enabled on the project |
| Agent joins but never answers | `PUBLIC_URL` is wrong or the tunnel is down. Open `PUBLIC_URL/api/health` in a browser; you should see `{"ok":true}` |
| Agent answers but no voice | Murf key or voice ID; check `MURF_LOCALE` matches the voice |
| Camera won't open on phone | It must be the https tunnel URL, not `http://192.168…` |
| Brain error 400 from LLM | Wrong `LLM_API_KEY`, or `LLM_MODEL` name not available on your account |

## Open questions for mentors

- Which ASR languages work with ConvoAI's default ASR (`kn-IN`, `ta-IN`)? Set `ASR_LANGUAGE` accordingly.
- Confirm the Murf TTS params (`voiceId`, `locale`, `model: FALCON`) for the hackathon voices.
