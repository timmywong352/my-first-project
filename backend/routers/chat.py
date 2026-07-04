import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from config import db
from deps import get_current_user
from llm import ai_summarize, ai_suggest_replies
from models import CsatBody, EditMessageBody, PreChatBody
from services import (
    clean_session,
    promote_from_queue,
    recompute_queue_positions,
    route_new_session,
    sync_agent_capacity,
)
from utils import now_iso
from ws_manager import manager

router = APIRouter(prefix="/chat", tags=["chat"])

RATE_LIMIT_PER_HOUR = 5


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
    client_ip = request.client.host if request.client else ""
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
            from services import agent_active_count  # local to avoid cycle
            active = await agent_active_count(assigned_agent["id"])
            from config import MAX_ACTIVE_CHATS_PER_AGENT
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
    async for m in cur:
        m.pop("_id", None)
        out.append(m)
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
        out.append(m)
    return out


@router.get("/history/{email}")
async def customer_history(email: str, user: dict = Depends(get_current_user)):
    cur = db.sessions.find({"customer_email": email.lower()}).sort("created_at", -1).limit(50)
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
    await db.messages.update_one(
        {"id": msg_id},
        {"$set": {"content": body.content, "edited": True, "edited_at": now_iso()}},
    )
    updated = await db.messages.find_one({"id": msg_id})
    updated.pop("_id", None)
    await manager.broadcast_to_session(msg["session_id"], {"type": "message_edited", "message": updated})
    return updated


@router.delete("/messages/{msg_id}")
async def delete_message(msg_id: str, user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"id": msg_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("sender_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your message")
    await db.messages.update_one({"id": msg_id}, {"$set": {"deleted": True, "deleted_at": now_iso()}})
    await manager.broadcast_to_session(msg["session_id"], {"type": "message_deleted", "message_id": msg_id})
    return {"ok": True}


# ---------- Close + Archive ----------
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
