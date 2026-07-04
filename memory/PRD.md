# Pulse — Live Chat Platform

## Original Problem Statement
Build a live chat web application with customer widget, agent dashboard, and admin panel. Features: floating chat launcher with pre-chat form, real-time messaging via WebSockets, file/image attachments (JPG/PNG/GIF/PDF/DOC/DOCX/XLS/MP4/ZIP), typing indicators, delivery status, agent edit/delete/resend/quick-replies/history/availability/sound notifications, admin metrics/agent management/branding/business hours. Tech: FastAPI + React + MongoDB, JWT auth, Emergent Universal LLM Key (Claude Sonnet 4.6) for AI reply suggestions + summaries, Emergent object storage.

## Architecture
- **Backend** (`/app/backend/server.py`): FastAPI monolith. JWT auth (email/password), MongoDB via motor, Emergent object storage for files, `emergentintegrations` LLM client, two WebSocket endpoints (`/api/ws/agent` and `/api/ws/customer`). All routes prefixed with `/api`.
- **Frontend** (`/app/frontend/src/`): React 19 + shadcn/ui + Tailwind. Routes: `/` and `/widget-demo` (public with floating widget), `/login`, `/dashboard` (agents), `/admin` (admin only). WebSocket hook with auto-reconnect. Bearer-token auth via localStorage.
- **DB collections**: users, sessions, messages, files, quick_replies, settings.

## User Personas
- **Visitor / Customer**: uses the floating widget to reach support.
- **Agent**: signs in to the dashboard, handles chats, uses AI suggestions and canned replies.
- **Admin**: manages agents, brand colors, business hours, canned responses; views metrics.

## Implemented (Feb 2026)
- ✅ Customer floating widget with pre-chat form, real-time WS messaging, typing indicator, sent/read receipts, file attachments (upload + preview), CSAT rating on close.
- ✅ Agent dashboard: session list w/ search, availability toggle (online/busy/offline), real-time messages, edit / delete / resend, sound notifications, quick replies, chat history dialog, AI reply suggestions (Claude), customer details panel.
- ✅ Admin dashboard: metrics (chats today, open chats, avg first-response, CSAT avg, 7-day chart), agent CRUD, widget branding preview, business hours, canned responses CRUD.
- ✅ Auth: JWT email/password, admin-seeded, admin RBAC, protected routes.
- ✅ File uploads via Emergent object storage (25MB limit, allowed extensions enforced).
- ✅ AI summary written to session on close.

## Update — Feb 2026 (iteration 6)
- ✅ **Typing preview throttled to 500ms** with a 2s idle stop event, sent via a new `useThrottledTyping` hook. Agent side shows `"Customer is typing: [text]"`, customer side shows `"Agent is typing: [text]"`. Backend truncates preview to 500 chars.
- ✅ **Queue system** — new session goes to the least-busy online agent (or queue if all full). Sessions returned with `status` + `queue_position`. Customer widget has a `[data-testid=queue-view]` phase. Closing an open chat auto-promotes the front of the queue and notifies the customer via `queue_promoted` WS event.
- ✅ **Inactivity scheduler** (runs every 60s): (a) first-response nudge auto-message + optional transfer after N minutes, (b) auto-close after M minutes of silence → session moves to archive. All 4 thresholds/toggles admin-configurable at `/admin` → Inactivity tab.
- ✅ **Rate limit** — POST `/api/chat/session` returns HTTP 429 after 5 sessions per IP per hour.
- ✅ **JWT refresh** — new `POST /api/auth/refresh` accepts tokens expired ≤30 days. Axios interceptor auto-refreshes on 401 and retries. `useWebSocket` hook now refreshes on WS close-code 1008 and reconnects.
- ✅ **shadcn Calendar + Popover** for the archive date filter (replaces native `<input type="date">`).
- ✅ 46/49 backend tests pass (3 legacy tests need to be updated to bypass the new 5/hr rate-limit in their setup; not app bugs). All 6 iter-6 new-feature tests + all frontend flows verified.

## Prioritized Backlog

### P1 (next iteration)
- Assign chats explicitly (currently first-agent-to-reply gets auto-assigned).
- Email notifications on new chat / unread messages.
- Multi-tenant workspaces (currently one org).
- Search past conversations.

### P2
- Team-based routing rules.
- Reporting exports (CSV).
- Slack/Teams outbound integration.
- Mobile app / PWA offline mode.
- Chat transcripts emailed to customer.

## Test Credentials (also in `/app/memory/test_credentials.md`)
- Admin: `admin@livechat.com` / `admin123`
- Agent: `agent@livechat.com` / `agent123`
