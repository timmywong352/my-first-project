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

## Update — Feb 2026 (iteration 7 — Lily AI concierge)
- ✅ **Lily 数字客服** — dual-brain (情商 + 智商) AI concierge using Claude Sonnet 4.6 via Emergent LLM Key. Detects Chinese emotion (`angry / anxious / confused / neutral / happy`) with confidence, prioritises comfort before problem-solving on negative sentiment, and proposes quick-action option buttons (`query_recharge / query_withdrawal / view_promotions / query_ticket`).
- ✅ **Long-term memory** (`db.customer_memory`) keyed by lowercased email — persists name, past_issues, past_complaints, emotion_history, session_count. Returning customers get personalised greetings. Data is per-customer only.
- ✅ **SVG animated avatar** (`LilyAvatar.jsx`) — expression changes with emotion (eyebrows/mouth/blush), CSS lip-sync animation while TTS plays.
- ✅ **Browser TTS** — `speechSynthesis` with `zh-CN` female voice (`XiaoxiaoNeural` if available). Free, offline, no API key.
- ✅ **Handoff to human** — customer can click 转人工 or say "转人工"; Lily also sets `escalate=true` when it judges it cannot answer. Handoff routes through existing least-busy/queue system.
- ✅ **Emotion tag broadcast** — agents receive `emotion_update` WS events; session list shows an emotion badge; right sidebar shows a `CustomerMemoryPanel` with visit count, past issues, complaints, emotion distribution.
- ✅ **Admin toggle** — `lily_enabled` in global settings + a UI switch. When disabled, widget bypasses Lily and behaves as before.
- ✅ Zero regressions to queue / cap / archive / dark mode / rate limit / refresh. 12/12 iter-7 tests + 100% frontend flows pass.

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
