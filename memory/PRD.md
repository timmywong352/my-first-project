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

## Update — Feb 2026 (iteration 5)
- ✅ **Two-way typing preview** — both directions now stream partial text via WS `content` field. Customer sees an `[data-testid=agent-typing-preview]` bubble showing what the agent is typing; agents keep the existing `[data-testid=typing-preview]` bubble.
- ✅ **Backend split** — `server.py` is now a thin composition file. Modules: `config`, `utils`, `models`, `deps`, `ws_manager`, `services`, `storage`, `llm`, plus `routers/{auth,agents,chat,quick_replies,admin,files,ws}.py`. All existing endpoints keep the same paths.
- ✅ **Frontend hooks** — `useAgentSessions`, `useArchiveSearch`, `useAgentLoad`; `AgentDashboard.jsx` now composes them instead of holding all state locally.
- ✅ **Aggregation optimization** — `list_agents_with_load()` uses a single `$lookup + $arrayElemAt` MongoDB aggregation instead of N serial `count_documents` calls (was O(N+1) queries, now O(1)).
- ✅ 43/43 backend pytest pass; frontend Playwright 100% of tested flows (login, dashboard, tabs, dark mode, quick replies, send/edit/delete, archive search, two-way typing preview).

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
