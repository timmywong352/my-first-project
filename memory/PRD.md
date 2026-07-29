# Pulse — Live Chat + Lily AI Concierge

## Original Problem Statement
A live chat web application (React + FastAPI + MongoDB) with:
1. Customer chat widget (real-time WS, pre-chat form, typing indicators, attachments)
2. Agent Dashboard (up to 20 active chats, real-time messaging, quick replies, archive)
3. Admin (metrics, agent management, business hours)
4. AI "Lily" Digital Human — an emotionally intelligent frontline responder acting as
   a video-call-like receptionist. Options → immediate handoff to human agent.

## Current State (Feb 2026)
Fully functional live chat platform with an integrated **realistic AI-generated
digital human "Lily"**.

- Widget skips the pre-chat form; opens directly into the Lily stage.
- **Lily portrait is AI-generated via Nano Banana** (`gemini-3.1-flash-image-preview`
  through the Emergent Universal LLM Key) — cute blue robot mascot (Wall-E / EVE
  inspired), 1000×1000, chassis `#3953E8` blue, cyan eye lights `#34F6FF`.
  Served as `/lily_robot.png` from the frontend `public/` folder.
  Realistic-human portrait `/lily_realistic.png` also kept as an alternate.
- Rendered via the **2.5D animation layer** (`LilyLiveAvatar.jsx`): SVG-overlay
  blinks (with 20 % double / 5 % triple clusters), CSS breathing, multi-sine
  head tilt, mouth-close feedback while speaking, click pulse.
- Widget switched to **dark theme** (slate-950 header / slate-900 body / blue
  primary buttons) after boss feedback on the previous pink/amber palette.
- Voice: **OpenAI TTS (`tts-1`, voice `nova`)** streamed through backend
  `/api/lily/tts` using the Emergent Universal LLM Key.
- Clicking Lily's avatar plays a NEW random English greeting from a 5-entry
  pool with `exclude` filter so consecutive greetings never repeat. Ignored
  while she's currently speaking.
- Anonymous session (localStorage `client_id`). **Email capture UI removed
  entirely** (2026-02-09) — client_id threading is sufficient for return-visitor
  identity, so we no longer show the "Save your history" card in queued view or
  the inline email prompt above the chat input.
- Any option click or free text in Lily mode → immediate handoff to the human
  queue with the customer's context saved as the first message.
- 3D VRM path (`@pixiv/three-vrm`) remains available as `mode="3d"` in
  `LilyAvatar`; the default `vrmUrl` is `/models/lily.vrm` (10.7 MB pixiv
  sample). Ready Player Me was considered but shut down on 2026-01-31.

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
- **2026-02-09**: **"Start over" header button** (iter22, 9/9 acceptance criteria PASS). New `RotateCcw` icon button in the customer widget header (between language switcher and sound-toggle) that resets the widget UI to the Lily frontdesk (fresh anonymous session + 4-option greeting). In Lily/deposit/promo phases it resets immediately; in active `chat`/`queued` phases it shows an AlertDialog confirmation first to avoid accidentally dropping a live agent chat. Fully localized in EN/BM/中文 (button tooltip + confirm title/body/buttons). Backend session data intentionally untouched — old server sessions are orphaned by design.
- **2026-02-09**: **Promotions flow (self-contained state machine)** (iter21) Clicking the Promotions quick-option now opens a client-side state machine (Choose method → Pick a Promo dropdown OR View Promotion Page → Detail card with numbered How-to-claim + Terms → Claim now instructions OR View others). Post-detail typing is routed through a keyword matcher (`ok/thanks` → acknowledge; `claim for me` / `check my bonus` → Yes/No handoff confirm; `problem/issue/not working` → instant handoff) with a fallback to the default handoff carrying promo context (`Promotions: <title> — <text>`). 3 hardcoded promotions (2 placeholder, 1 verified spec content). Fully self-contained: NO changes to `/api/lily/handoff`, `compose_reply`, emotion detection, or memory. Testing agent caught + fixed a critical TDZ crash mid-flight (`promoT` declared before `lang` state). Widget close+reopen properly resets promo state to the 4-option frontdesk.
- **2026-02-09**: **Deposit-status two-step confirm gate** (iter19) Tapping the "Deposit status" (`query_recharge`) quick-option now shows a two-line Lily confirmation ("Let me connect you…" + "You'll be now redirected…") with **Yes, proceed** / **No, cancel** buttons before firing the handoff. The 3 other quick-options (withdrawal, promotions, ticket) still hand off immediately — behavior unchanged. Cancel returns to the frontdesk with **zero network calls**; Yes fires `POST /api/lily/handoff` exactly once. Fully localized in EN/BM/中文 via a new `DEPOSIT_CONFIRM_I18N` dict in `lily_service.py` and a `deposit_confirm(lang)` helper exposed on `GET /api/lily/status`. Lily's LLM logic (compose_reply, memory, emotion) is untouched per user scope.
- **2026-02-09**: **Reverted Pending Accept flow — auto-assign restored** (iter18) User feedback: they don't want to click Accept, chats should auto-drop into the active list. `route_new_session` + `promote_from_queue` now set `status='open'` directly (no `pending` intermediate); Lily handoff broadcasts `new_session` (not `pending_offer`); customer widget flows Lily→chat directly (no `waiting_agent` phase); agent-side `new_session` handler still plays the distinct incoming chime for audio recognition. Verified auto-assign visible in **408ms** end-to-end. Also cleaned 37 stale iter16/17 test sessions from the DB.
- **2026-02-09**: **UX bugs sprint: lazy history + Lily-only session hiding + instant close** (iter17)
  - **Bug 1 fixed — Lazy history load**: On session select, ONLY current session messages render. Prior threads no longer auto-load. A "↑ Load N previous chats" button (or auto-trigger on scrollTop≤4) surfaces the historical threads.
  - **Bug 2 fixed — Sessions hidden during Lily phase**: New sessions are created with `status='lily'` and are excluded from the default agent GET /sessions and from WS broadcasts. Only after POST /api/lily/handoff does the session flip to pending/queued and become visible on the agent dashboard.
  - **Bug 3 fixed — Instant close (<1s)**: Both customer and agent close flows now do optimistic UI updates FIRST, then fire the API call in the background. Verified 62ms (agent) / 194ms (customer) end-to-end.
  - **Regression caught & fixed by testing agent**: my Bug 2 refactor accidentally dropped the `@router.get('/sessions')` decorator on list_sessions — that would have taken down the entire agent dashboard listing. Restored.
- **2026-02-09**: **Sprint bundle: audit attachments + auto-scroll + Pending Accept flow** (iter16)
  - **Extended audit trail (F-A)**: PATCH now also tracks attachment changes (empty → new file, replace, etc). DELETE stamps `original_attachments`. Admin Audit Log tab renders attachments (📎 icon + filename) inside FINAL / ORIGINAL / EDIT HISTORY blocks.
  - **Auto-scroll (F-B)**: Agent dashboard scrolls **instantly** to bottom on session switch, **smoothly** on new incoming messages. Customer widget scrolls instantly on phase transitions (Lily → connecting → chat) and smoothly on incoming messages.
  - **Pending Accept flow (F-C)**: new sessions and Lily→human handoffs now become `status='pending'` with `pending_agent_id` + `pending_expires_at=now+30s`. Agent must click Accept (POST `/api/chat/sessions/{id}/accept`). Distinct **rising 2-tone chime** on offer arrival. Timeout scheduler (5s tick) auto-reassigns to next agent (excludes those who let it lapse) or pushes back to queue. WS events: `pending_offer`, `pending_offer_expired`, `session_accepted`, `chat_accepted`, `reassigning`. Customer sees "Connecting you to the next available agent…" during pending phase.
- **2026-02-09**: **Sprint bundle: sync replay + sound + language + audit trail** (iter15)
  - **since_id WS replay**: customer and agent WS now handle `{type:'sync', since_id, session_id?}` → server replays missed messages after that anchor id. Frontend keeps `lastMsgIdRef`, sends sync on reconnect. Full REST fetch is now only a first-connect fallback.
  - **Sound notifications**: customer widget plays a synthesized Web Audio ping on incoming agent/lily messages. Bell/BellOff toggle in header persists to localStorage (`pulse_sound_on`).
  - **Language switcher (EN/BM/中文)**: globe icon in widget header opens popover with the three languages. Choice persists to localStorage (`pulse_lang`). Lily's greetings + option labels come back localized from the backend (`/api/lily/status?lang=`, `/api/lily/open?lang=`, `/api/lily/regreet?lang=`).
  - **Audit trail on message edit/delete**: PATCH pushes prior content into `previous_versions[]` with `edited_by_name`/`edited_at`. First edit stamps `original_content`. DELETE preserves final content + `deleted_by_name`. Admin-only `GET /api/admin/audit/edits` returns full history joined with customer name. Customer responses have `edited`/`edited_at`/`previous_versions`/`original_content` all stripped — customer sees only the final version, no indication anything was edited. Agent responses keep the `edited` flag but no history. New Admin Dashboard "Audit Log" tab renders FINAL / ORIGINAL / EDIT HISTORY blocks.
- **2026-02-09**: **Heal-on-reconnect for WebSocket** (iter14)
- **2026-02-09**: **Auto-expanding composer + rich-text paste preservation** —
  new `useAutoResizeTextarea` hook powers both the customer widget and the
  agent dashboard composer. Grows with content up to 180px (customer) / 200px
  (agent), then scrolls. `onPaste` intercepts `text/plain` (falls back to a
  minimal HTML→newline conversion) so bullet lists and paragraphs survive the
  paste. Message bubbles on both sides render with `whitespace-pre-wrap` so
  newlines are visible in sent messages.
- **2026-02-09**: **Removed email capture UI** — no more "Share your email
  (optional)" input, Save button, X dismiss, or "Save your history" card.
  Anonymous client_id (localStorage) is the sole customer identifier.
- **2026-02-09**: **Fixed FRONTEND_TEST_MSG artifact** — testing agent had
  written `FRONTEND_TEST_MSG` into `settings.global.inactivity_auto_message`
  (and `welcome_message` → `TEST hello`). Reset to defaults, deleted 3
  leftover system messages, cleared `auto_msg_sent` flags on open sessions.
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
- Agent message management: resend / edit / delete
- Sound notifications on new messages
- User-visible language switcher (en/zh/ms) in the widget header

### P1 — Done
- File / image attachments end-to-end (Emergent Object Storage; upload
  via POST /api/upload, retrieval via GET /api/files/{id} with agent JWT or
  session_id+session_token). Verified iter13.
- Quick replies UI: admin CRUD (`/admin` → Quick Replies tab), agent-side
  chips above composer prefill textarea on click.

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
