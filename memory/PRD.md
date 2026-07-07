# Pulse — Live Chat + Lily AI Concierge

## Original Problem Statement
A live chat web application (React + FastAPI + MongoDB) with:
1. Customer chat widget (real-time WS, pre-chat form, typing indicators, attachments)
2. Agent Dashboard (up to 20 active chats, real-time messaging, quick replies, archive)
3. Admin (metrics, agent management, business hours)
4. AI "Lily" Digital Human — an emotionally intelligent frontline responder acting as
   a video-call-like receptionist. Options → immediate handoff to human agent.

## Current State (Feb 2026)
Fully functional live chat platform with an integrated **3D VRM digital human "Lily"**.
- Widget skips the pre-chat form; opens directly into the Lily stage.
- Lily is now rendered as a **real 3D anime girl** via three.js + @pixiv/three-vrm
  (`/models/lily.vrm`) with blink/lip-sync/emotion blend-shapes, head sway, breathing,
  and spring-bone hair physics. Automatic fallback to a 2.5D layered image renderer
  if the VRM asset fails to load.
- Voice: **OpenAI TTS (`tts-1`, voice `nova`)** streamed through backend
  `/api/lily/tts` using the Emergent Universal LLM Key.
- UI language currently English; backend already supports `en / zh / ms` via
  `?lang=` parameter (see `lily_service.opening_message` / `options_for_lang`).
- Anonymous session (localStorage `client_id`) + optional inline email capture
  so returning visitors keep their memory.
- Any option click or free text in Lily mode → immediate handoff to the human
  queue with the customer's context saved as the first message.

## Architecture
```
/app/
├── backend/
│   ├── routers/  (admin.py, agents.py, auth.py, chat.py, files.py,
│   │             lily.py [+ /tts + /handoff w/ customer_text + lang],
│   │             quick_replies.py, ws.py)
│   ├── lily_service.py   (opening_message, options_for_lang, handoff_line — i18n)
│   ├── server.py, config.py, deps.py, llm.py, models.py, services.py, ...
└── frontend/
    ├── public/models/lily.vrm         (10.7 MB — swap this file to change avatar)
    ├── src/components/
    │   ├── ChatWidget.jsx             (Lily-first flow, English UI, email capture)
    │   ├── LilyAvatar.jsx             (wrapper: 3D primary, 2.5D fallback)
    │   ├── LilyVrmAvatar.jsx          (three.js + @pixiv/three-vrm renderer)
    │   └── LilyLiveAvatar.jsx         (image + SVG overlay fallback)
    └── src/lib/tts.js                 (OpenAI TTS via /api/lily/tts)
```

## What's Been Implemented
- **2026-02-06**: Modular backend refactor (routers/services/ws_manager)
- **2026-02-06**: Agent limits (20 chats/agent), queue system, inactivity timeouts
- **2026-02-06**: Archive system, dark mode, live typing preview
- **2026-02-07**: AI Digital Human "Lily" v1 (Claude Sonnet 4.6 + browser TTS + SVG avatar)
- **2026-02-07**: Lily video-call-stage redesign
- **2026-02-07**: Skip prechat form → Lily-first flow with anonymous sessions
- **2026-02-07**: OpenAI TTS (nova voice) via Emergent LLM Key
- **2026-02-07**: English UI + i18n scaffolding (en/zh/ms)
- **2026-02-07**: Email capture (inline post-handoff + queue-view form)
- **2026-02-07**: Uploaded Lily anime portrait as circular avatar
- **2026-02-07**: Pseudo-3D overlay animations on portrait (blink/breath/tilt/mouth)
- **2026-02-07**: **REAL 3D VRM avatar** — three.js + @pixiv/three-vrm rendering
  the pixiv sample anime girl. Cute, long brown hair. Auto camera framing,
  blink FSM, emotion blend shapes, lip-sync, spring bones, transparent canvas.

## Roadmap (P0/P1/P2)

### P0 — Not started
- **Unified "Lily-style" agent workspace** — merge the `/agent` dashboard visual
  language with the customer widget (larger 3D Lily on the agent side, all
  ongoing conversations in one board).

### P1 — Not started
- File / image attachments end-to-end for customers + agents
  (backend router already exists; frontend wiring & agent side pending)
- Agent message management: resend / edit / delete
- Quick replies (canned responses) UI in agent workspace
- Sound notifications on new messages
- User-visible language switcher (en/zh/ms) in the widget header

### P2 — Not started
- Admin metrics dashboard (chats today, response times, CSAT)
- Business hours config + widget color customisation
- Swap `/models/lily.vrm` for user's own VRoid Studio export (when they build one)

## Key API Endpoints
- `POST /api/chat/session/anonymous`  create session w/o prechat form
- `POST /api/chat/session/{id}/contact`  save email/name mid-conversation
- `POST /api/lily/open?lang=en|zh|ms`  greeting + localised options
- `POST /api/lily/handoff?customer_text=...&lang=...`  route to queue
- `POST /api/lily/tts`  { text, voice, speed } → audio/mpeg bytes (OpenAI TTS)
- `GET  /api/lily/status?lang=en`  enabled + localised option labels

## Integrations
- **Claude Sonnet 4.6** — via Emergent Universal LLM Key (in `lily_service.py`)
- **OpenAI TTS (`tts-1`, nova voice)** — via Emergent Universal LLM Key
- **@pixiv/three-vrm 3.5.4 + three 0.185** — 3D avatar rendering

## Rate Limits & Ops Notes
- Session creation is rate-limited to 5/hour per IP.
  Purge `db.sessions` where `creator_ip='127.0.0.1'` during heavy testing.
- VRM file is 10.7 MB static asset served from `/models/lily.vrm`.
  Browser caches aggressively after first load.

## Test Credentials
See `/app/memory/test_credentials.md`.
