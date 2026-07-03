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

## Update — Feb 2026 (iteration 2-4)
- ✅ **BUG FIX**: Closed chats reject new customer messages both server-side (WS `error` event) and client-side (banner + hidden input). WS reconnect to a closed session immediately notifies the customer.
- ✅ **Archive system**: Active / Archived tabs in agent dashboard; `archived_at` set on close; new `/api/chat/archive/search` endpoint with keyword + date range; read-only view for archived chats; enriched with duration, message_count, agent name.
- ✅ **Live typing preview**: Customer typing events carry `content`; agents see a "Live preview" bubble showing the actual text being typed (persists 2s after pause, disappears on send).
- ✅ **Dark mode**: `ThemeProvider` with localStorage persistence (`pulse_theme`); dark palette uses #1a1a2e range; toggle in agent dashboard header.
- ✅ **Agent 20-chat cap**: `active_chat_count` in `/api/agents` and `/api/agents/me/load`; visual counter with warning at 18 and lock at 20; auto-flip to busy at cap, restore to online on session close; state persists across WS reconnects.

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
