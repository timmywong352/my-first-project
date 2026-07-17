import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from config import MAX_ACTIVE_CHATS_PER_AGENT, db
from deps import get_current_user
from llm import ai_summarize, ai_suggest_replies
from models import AnonymousSessionBody, CsatBody, EditMessageBody, PreChatBody, UpdateContactBody
from services import (
    agent_active_count,
    clean_session,
    promote_from_queue,
    recompute_queue_positions,
    route_new_session,
    sync_agent_capacity,
)
from utils import get_real_client_ip, now_iso
from ws_manager import manager

# ---------- Audit-safe response helpers ----------
_AUDIT_FIELDS = ("previous_versions", "original_content", "deleted_by", "deleted_by_name", "edited_by_name")


def strip_audit(m: dict) -> dict:
    """Return a copy of a message safe to send to non-admin clients.

    Keeps the `edited`/`deleted` booleans and timestamps but hides the
    per-version content history and editor identities. Those live only in the
    admin audit endpoint.
    """
    if not isinstance(m, dict):
        return m
    out = {k: v for k, v in m.items() if k not in _AUDIT_FIELDS}
    return out


def strip_audit_for_customer(m: dict) -> dict:
    """Even stricter: also drop the `edited` flag so the customer sees a clean
    message (the boss wants the customer experience to be pristine)."""
    out = strip_audit(m)
    out.pop("edited", None)
    out.pop("edited_at", None)
    return out

router = APIRouter(prefix="/chat", tags=["chat"])

RATE_LIMIT_PER_HOUR = 60


# ---------- Session ----------
async def _rate_limit_check(ip: str) -> None:
    if not ip:
        return
    one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    recent = await db.sessions.count_documents({
        "creator_ip": ip,
        "created_at": {"$gte": one_hour_ago},
    })
    if recent >= RATE_LIMIT_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail=f"Too many chats started. Please wait a while and try again (limit: {RATE_LIMIT_PER_HOUR}/hour).",
        )


@router.post("/session")
async def create_chat_session(body: PreChatBody, request: Request):
    client_ip = get_real_client_ip(request)
    await _rate_limit_check(client_ip)

    session_id = str(uuid.uuid4())
    session_token = str(uuid.uuid4())
    doc = {
        "id": session_id,
        "session_token": session_token,
        "customer_name": body.name,
        "customer_email": body.email.lower(),
        "subject": body.subject,
        "page": body.page or "",
        "location": body.location or client_ip,
        "creator_ip": client_ip,
        "assigned_agent_id": None,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "last_message_at": now_iso(),
        "csat_rating": None,
        "summary": None,
        "auto_msg_sent": False,
    }

    # Route: assign least-busy agent OR queue
    await route_new_session(doc)
    assigned_agent = doc.pop("_assigned_agent", None)

    await db.sessions.insert_one(doc)

    if doc["status"] == "open":
        await manager.send_to_agents({"type": "new_session", "session": clean_session(doc)})
        # If this assignment tips the agent over the cap, flip to busy
        if assigned_agent:
            active = await agent_active_count(assigned_agent["id"])
            if active >= MAX_ACTIVE_CHATS_PER_AGENT:
                await db.users.update_one(
                    {"id": assigned_agent["id"]},
                    {"$set": {"status": "busy", "auto_busy": True}},
                )
                await manager.send_to_agents({
                    "type": "agent_status", "agent_id": assigned_agent["id"], "status": "busy",
                })

    return {
        "session_id": session_id,
        "session_token": session_token,
        "customer_name": body.name,
        "customer_email": body.email,
        "subject": body.subject,
        "status": doc["status"],
        "queue_position": doc.get("queue_position"),
    }


@router.post("/session/anonymous")
async def create_anonymous_session(body: AnonymousSessionBody, request: Request):
    """Create a chat session WITHOUT a prechat form.

    Used by the Lily-first customer widget. A stable ``client_id`` (persisted
    in browser localStorage) lets returning visitors reuse their identity so
    Lily's memory and their session history keep working.
    """
    client_ip = get_real_client_ip(request)
    await _rate_limit_check(client_ip)

    session_id = str(uuid.uuid4())
    session_token = str(uuid.uuid4())
    client_id = (body.client_id or f"anon_{session_id[:8]}").strip()
    # Use client_id as the placeholder email so memory works across sessions.
    placeholder_email = f"{client_id}@anon.pulse.local".lower()

    doc = {
        "id": session_id,
        "session_token": session_token,
        "customer_name": "Guest",
        "customer_email": placeholder_email,
        "client_id": client_id,
        "subject": "New chat",
        "page": body.page or "",
        "location": body.location or client_ip,
        "creator_ip": client_ip,
        "language": (body.language or "en").lower(),
        "assigned_agent_id": None,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "last_message_at": now_iso(),
        "csat_rating": None,
        "summary": None,
        "auto_msg_sent": False,
        "anonymous": True,
    }

    await route_new_session(doc)
    assigned_agent = doc.pop("_assigned_agent", None)
    await db.sessions.insert_one(doc)

    if doc["status"] == "open":
        await manager.send_to_agents({"type": "new_session", "session": clean_session(doc)})
        if assigned_agent:
            active = await agent_active_count(assigned_agent["id"])
            if active >= MAX_ACTIVE_CHATS_PER_AGENT:
                await db.users.update_one(
                    {"id": assigned_agent["id"]},
                    {"$set": {"status": "busy", "auto_busy": True}},
                )
                await manager.send_to_agents({
                    "type": "agent_status", "agent_id": assigned_agent["id"], "status": "busy",
                })

    return {
        "session_id": session_id,
        "session_token": session_token,
        "client_id": client_id,
        "customer_name": doc["customer_name"],
        "customer_email": doc["customer_email"],
        "anonymous": True,
        "status": doc["status"],
        "queue_position": doc.get("queue_position"),
    }


@router.post("/session/{session_id}/contact")
async def update_session_contact(session_id: str, body: UpdateContactBody):
    """Customer supplies their name / email after chatting with Lily.

    This is the public-facing counterpart to the prechat form: Lily may ask
    for the customer's email during the conversation and it is saved here.
    """
    s = await db.sessions.find_one({"id": session_id})
    if not s or s.get("session_token") != body.session_token:
        raise HTTPException(status_code=401, detail="Invalid session token")

    updates: Dict[str, Any] = {"updated_at": now_iso()}
    if body.name and body.name.strip():
        updates["customer_name"] = body.name.strip()
    if body.email:
        updates["customer_email"] = body.email.lower()
        updates["anonymous"] = False
    if len(updates) == 1:  # only updated_at
        return {"ok": True, "updated": False}

    await db.sessions.update_one({"id": session_id}, {"$set": updates})
    updated = await db.sessions.find_one({"id": session_id})
    # Broadcast so agent dashboard sees the identity change live
    await manager.send_to_agents({
        "type": "session_updated", "session": clean_session(updated),
    })
    return {"ok": True, "updated": True, "session": clean_session(updated)}


@router.get("/sessions")
async def list_sessions(status_filter: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if status_filter:
        q["status"] = status_filter
    cur = db.sessions.find(q).sort("last_message_at", -1).limit(200)
    out = []
    async for s in cur:
        last = await db.messages.find_one({"session_id": s["id"]}, sort=[("created_at", -1)])
        c = clean_session(s)
        c["last_message"] = None
        c["unread_count"] = 0
        if last:
            c["last_message"] = {
                "content": last.get("content", ""),
                "sender_type": last.get("sender_type"),
                "created_at": last.get("created_at"),
                "has_attachments": bool(last.get("attachments")),
            }
        out.append(c)
    return out


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, user: dict = Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return clean_session(s)


@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str, user: dict = Depends(get_current_user)):
    cur = db.messages.find({"session_id": session_id, "deleted": {"$ne": True}}).sort("created_at", 1)
    out = []
    is_admin = user.get("role") == "admin"
    async for m in cur:
        m.pop("_id", None)
        out.append(m if is_admin else strip_audit(m))
    return out


@router.get("/public/{session_id}/messages")
async def public_get_messages(session_id: str, session_token: str = Query(...)):
    s = await db.sessions.find_one({"id": session_id})
    if not s or s.get("session_token") != session_token:
        raise HTTPException(status_code=401, detail="Invalid session token")
    cur = db.messages.find({"session_id": session_id, "deleted": {"$ne": True}}).sort("created_at", 1)
    out = []
    async for m in cur:
        m.pop("_id", None)
        out.append(strip_audit_for_customer(m))
    return out


@router.get("/threads/{session_id}")
async def session_threads(session_id: str, user: dict = Depends(get_current_user)):
    """Return all sessions belonging to the same customer as ``session_id`` —
    each with its messages — so the agent can scroll back through prior
    threads (LiveChat-style thread history).

    Sessions are linked by ``client_id`` for anon visitors, otherwise by
    ``customer_email``. Ordered oldest → newest; the last item is the
    currently-selected session so the composer stays aligned with it.
    """
    anchor = await db.sessions.find_one({"id": session_id})
    if not anchor:
        raise HTTPException(status_code=404, detail="Session not found")

    query: Dict[str, Any]
    if anchor.get("client_id"):
        query = {"client_id": anchor["client_id"]}
    else:
        query = {"customer_email": (anchor.get("customer_email") or "").lower()}

    cur = db.sessions.find(query).sort("created_at", 1).limit(20)
    threads = []
    async for s in cur:
        msgs = await db.messages.find(
            {"session_id": s["id"], "deleted": {"$ne": True}},
        ).sort("created_at", 1).to_list(1000)
        for m in msgs:
            m.pop("_id", None)
        threads.append({"session": clean_session(s), "messages": msgs})
    return threads


@router.get("/history/{email}")
async def customer_history(email: str, user: dict = Depends(get_current_user)):
    """Return past sessions for a customer.

    Same-device anonymous visitors all reuse a stable localStorage ``client_id``
    (persisted in ``session.client_id``). Their placeholder emails follow the
    pattern ``anon_<client_id_short>@anon.pulse.local``. When the incoming
    email matches that pattern we look up sessions by the underlying
    ``client_id`` so the agent sees the ENTIRE history for the device, not
    just for one arbitrary anon email.
    """
    email = email.lower()
    query: Dict[str, Any] = {"customer_email": email}
    # Detect anon placeholder → widen to all sessions with that client_id
    if email.endswith("@anon.pulse.local"):
        s = await db.sessions.find_one({"customer_email": email})
        if s and s.get("client_id"):
            query = {"client_id": s["client_id"]}
    cur = db.sessions.find(query).sort("created_at", -1).limit(50)
    out = []
    async for s in cur:
        out.append(clean_session(s))
    return out


# ---------- Message edit / delete ----------
@router.patch("/messages/{msg_id}")
async def edit_message(msg_id: str, body: EditMessageBody, user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"id": msg_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("sender_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your message")
    if msg.get("content") == body.content:
        # No-op edit — don't pollute the audit trail.
        msg.pop("_id", None)
        return strip_audit(msg) if user.get("role") != "admin" else msg
    # Preserve the CURRENT content as a historical version before overwriting.
    prev_version = {
        "content": msg.get("content", ""),
        "edited_by": user["id"],
        "edited_by_name": user.get("name") or user.get("email"),
        "edited_at": now_iso(),
    }
    update = {
        "$set": {
            "content": body.content,
            "edited": True,
            "edited_at": now_iso(),
        },
        "$push": {"previous_versions": prev_version},
    }
    # Only stamp original_content the first time we edit.
    if not msg.get("original_content"):
        update["$set"]["original_content"] = msg.get("content", "")
    await db.messages.update_one({"id": msg_id}, update)
    updated = await db.messages.find_one({"id": msg_id})
    updated.pop("_id", None)
    # Broadcast a lean copy — customers get a completely-clean payload
    # (no `edited` flag), agents get the audit-stripped message.
    for ws in list(manager.customer_conns.get(msg["session_id"], [])):
        await manager._safe_send(ws, {"type": "message_edited", "message": strip_audit_for_customer(updated)})
    for agent_id, conns in list(manager.agent_conns.items()):
        for ws in list(conns):
            await manager._safe_send(ws, {"type": "message_edited", "message": strip_audit(updated)})
    return strip_audit(updated) if user.get("role") != "admin" else updated


@router.delete("/messages/{msg_id}")
async def delete_message(msg_id: str, user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"id": msg_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("sender_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your message")
    update = {
        "$set": {
            "deleted": True,
            "deleted_at": now_iso(),
            "deleted_by": user["id"],
            "deleted_by_name": user.get("name") or user.get("email"),
        },
    }
    # Preserve the last content for the audit trail even after deletion.
    if not msg.get("original_content"):
        update["$set"]["original_content"] = msg.get("content", "")
    await db.messages.update_one({"id": msg_id}, update)
    await manager.broadcast_to_session(msg["session_id"], {"type": "message_deleted", "message_id": msg_id})
    return {"ok": True}


# ---------- Close + Archive ----------
@router.post("/public/{session_id}/close")
async def customer_close_session(
    session_id: str,
    session_token: str = Query(...),
):
    """Customer-initiated close (no agent auth). Authorises via session_token
    and mirrors the agent-side close: broadcasts session_closed, syncs the
    assigned agent's capacity, and promotes the next queued session.
    """
    s = await db.sessions.find_one({"id": session_id})
    if not s or s.get("session_token") != session_token:
        raise HTTPException(status_code=401, detail="Invalid session token")
    if s.get("status") == "closed":
        return {"ok": True, "already_closed": True}

    summary = await ai_summarize(session_id)
    closed_at = now_iso()
    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {
            "status": "closed",
            "closed_at": closed_at,
            "archived_at": closed_at,
            "closed_by": "customer",
            "closed_reason": "customer_closed",
            "summary": summary,
            "updated_at": closed_at,
        }},
    )
    await manager.broadcast_to_session(
        session_id,
        {"type": "session_closed", "session_id": session_id,
         "summary": summary, "reason": "customer_closed"},
    )
    if s.get("assigned_agent_id"):
        await sync_agent_capacity(s["assigned_agent_id"])
    await promote_from_queue()
    return {"ok": True}


@router.post("/sessions/{session_id}/close")
async def close_session(session_id: str, user: dict = Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    if s.get("status") == "closed":
        return {"ok": True, "summary": s.get("summary", ""), "already_closed": True}
    summary = await ai_summarize(session_id)
    closed_at = now_iso()
    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {
            "status": "closed",
            "closed_at": closed_at,
            "archived_at": closed_at,
            "closed_by": user["id"],
            "summary": summary,
            "updated_at": closed_at,
        }},
    )
    await manager.broadcast_to_session(
        session_id,
        {"type": "session_closed", "session_id": session_id, "summary": summary},
    )
    if s.get("assigned_agent_id"):
        await sync_agent_capacity(s["assigned_agent_id"])
    # Promote next queued sessions to freed capacity
    await promote_from_queue()
    return {"ok": True, "summary": summary}


@router.get("/archive/search")
async def archive_search(
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    session_query: Dict[str, Any] = {"status": "closed"}
    if date_from:
        session_query.setdefault("created_at", {})["$gte"] = date_from
    if date_to:
        session_query.setdefault("created_at", {})["$lte"] = date_to
    if q:
        q_regex = {"$regex": q, "$options": "i"}
        or_clauses = [
            {"customer_name": q_regex},
            {"customer_email": q_regex},
            {"subject": q_regex},
            {"summary": q_regex},
        ]
        msg_cur = db.messages.find({"content": q_regex, "deleted": {"$ne": True}}, {"session_id": 1})
        msg_ids = set()
        async for m in msg_cur:
            msg_ids.add(m["session_id"])
        if msg_ids:
            or_clauses.append({"id": {"$in": list(msg_ids)}})
        session_query["$or"] = or_clauses
    cur = db.sessions.find(session_query).sort("closed_at", -1).limit(int(limit))
    out = []
    async for s in cur:
        c = clean_session(s)
        try:
            t0 = datetime.fromisoformat(s.get("created_at", ""))
            t1 = datetime.fromisoformat(s.get("closed_at", s.get("created_at", "")))
            c["duration_seconds"] = int((t1 - t0).total_seconds())
        except Exception:
            c["duration_seconds"] = None
        if s.get("assigned_agent_id"):
            ag = await db.users.find_one({"id": s["assigned_agent_id"]})
            c["agent_name"] = ag.get("name") if ag else None
        c["message_count"] = await db.messages.count_documents(
            {"session_id": s["id"], "deleted": {"$ne": True}}
        )
        out.append(c)
    return out


@router.post("/public/{session_id}/csat")
async def submit_csat(session_id: str, body: CsatBody, session_token: str = Query(...)):
    s = await db.sessions.find_one({"id": session_id})
    if not s or s.get("session_token") != session_token:
        raise HTTPException(status_code=401, detail="Invalid session token")
    if body.rating < 1 or body.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be 1-5")
    await db.sessions.update_one({"id": session_id}, {"$set": {"csat_rating": body.rating}})
    return {"ok": True}


# ---------- AI helpers ----------
ai_router = APIRouter(prefix="/ai", tags=["ai"])


@ai_router.post("/suggest/{session_id}")
async def ai_suggest_endpoint(session_id: str, user: dict = Depends(get_current_user)):
    suggestions = await ai_suggest_replies(session_id)
    return {"suggestions": suggestions}


@ai_router.post("/summarize/{session_id}")
async def ai_summarize_endpoint(session_id: str, user: dict = Depends(get_current_user)):
    summary = await ai_summarize(session_id)
    return {"summary": summary}
