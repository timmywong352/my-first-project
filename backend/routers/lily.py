"""Lily REST endpoints — used by the customer widget."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from config import db
from deps import get_current_user
from lily_service import (
    QUICK_OPTIONS,
    compose_reply,
    get_customer_memory,
    opening_message,
    upsert_customer_memory,
)
from services import save_message
from utils import now_iso
from ws_manager import manager

router = APIRouter(prefix="/lily", tags=["lily"])
logger = logging.getLogger("livechat.lily.router")


async def _authorize(session_id: str, session_token: str) -> dict:
    s = await db.sessions.find_one({"id": session_id})
    if not s or s.get("session_token") != session_token:
        raise HTTPException(status_code=401, detail="Invalid session token")
    return s


async def _lily_enabled() -> bool:
    s = await db.settings.find_one({"id": "global"}) or {}
    # default: enabled
    return bool(s.get("lily_enabled", True))


@router.get("/status")
async def lily_status():
    return {"enabled": await _lily_enabled(), "options": QUICK_OPTIONS}


@router.post("/open")
async def lily_open(session_id: str = Query(...), session_token: str = Query(...)):
    """Called once when the widget enters the Lily phase — returns opening line + memory."""
    session = await _authorize(session_id, session_token)
    if not await _lily_enabled():
        return {"enabled": False}

    memory = await get_customer_memory(session["customer_email"])
    greeting = opening_message(memory)

    # Persist Lily's opening message so it shows in agent dashboard too
    msg = await save_message(
        session_id, "lily", "lily", "Lily", greeting, attachments=None,
    )
    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {"handled_by_lily": True, "current_emotion": "neutral"}},
    )
    # Broadcast to agents too (they can see Lily engaging)
    await manager.broadcast_to_session(session_id, {"type": "message", "message": msg})

    return {
        "enabled": True,
        "message": msg,
        "memory": memory,
        "options": [],
    }


@router.post("/reply")
async def lily_reply(
    text: str = Query(...),
    session_id: str = Query(...),
    session_token: str = Query(...),
):
    """Customer sends a text → Lily replies. Returns reply + emotion + options + escalate flag."""
    session = await _authorize(session_id, session_token)
    if session.get("status") == "closed":
        raise HTTPException(status_code=400, detail="Session closed")
    if not await _lily_enabled():
        raise HTTPException(status_code=400, detail="Lily is disabled")

    # 1) Persist the customer message
    cust_msg = await save_message(
        session_id, "customer", session_id, session.get("customer_name", "Customer"),
        text, attachments=None,
    )
    await manager.broadcast_to_session(session_id, {"type": "message", "message": cust_msg})

    # 2) Compose reply via dual-brain LLM
    memory = await get_customer_memory(session["customer_email"])
    prior_lily = await db.messages.count_documents(
        {"session_id": session_id, "sender_type": "lily", "deleted": {"$ne": True}}
    )
    result = await compose_reply(
        session_id=session_id,
        user_text=text,
        memory=memory,
        is_first_message=(prior_lily <= 1),  # <=1 because opening line already saved
    )

    # 3) Update session emotion + memory
    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {
            "current_emotion": result["emotion"],
            "handled_by_lily": True,
            "updated_at": now_iso(),
        }, "$push": {"emotion_history": {
            "emotion": result["emotion"],
            "confidence": result["confidence"],
            "at": now_iso(),
        }}},
    )
    is_complaint = result["emotion"] in ("angry", "anxious")
    await upsert_customer_memory(
        session["customer_email"],
        name=session.get("customer_name"),
        issue=text[:200],
        complaint=is_complaint,
        emotion=result["emotion"],
        session_id=session_id,
    )
    # Broadcast emotion change so agent UI updates in real time
    await manager.send_to_agents({
        "type": "emotion_update",
        "session_id": session_id,
        "emotion": result["emotion"],
        "confidence": result["confidence"],
    })

    # 4) Save Lily's reply as a message
    lily_msg = await save_message(
        session_id, "lily", "lily", "Lily", result["reply"],
        attachments=None,
    )
    # Attach metadata for the widget (options + escalate) without persisting into messages
    payload = {
        "message": lily_msg,
        "emotion": result["emotion"],
        "confidence": result["confidence"],
        "options": [
            {"key": k, **QUICK_OPTIONS[k]} for k in result["options"]
        ],
        "escalate": result["escalate"],
        "needs_email": result["needs_email"],
    }
    await manager.broadcast_to_session(session_id, {"type": "message", "message": lily_msg})
    return payload


@router.post("/handoff")
async def lily_handoff(session_id: str = Query(...), session_token: str = Query(...)):
    """Transfer from Lily to the human queue system."""
    session = await _authorize(session_id, session_token)
    from services import route_new_session, agent_active_count, clean_session
    from config import MAX_ACTIVE_CHATS_PER_AGENT

    # Post a system-visible transition line so agent sees the handoff
    handoff_msg = await save_message(
        session_id, "lily", "lily", "Lily",
        "让我帮您转接给人工客服。感谢您的耐心！🙏", attachments=None,
    )
    await manager.broadcast_to_session(session_id, {"type": "message", "message": handoff_msg})

    # Route: least-busy or queue
    doc = dict(session)
    await route_new_session(doc)
    assigned_agent = doc.pop("_assigned_agent", None)
    updates = {
        "status": doc["status"],
        "assigned_agent_id": doc.get("assigned_agent_id"),
        "queue_position": doc.get("queue_position"),
        "handled_by_lily": False,
        "handoff_at": now_iso(),
        "last_message_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.sessions.update_one({"id": session_id}, {"$set": updates})
    updated = await db.sessions.find_one({"id": session_id})
    if doc["status"] == "open":
        await manager.send_to_agents({"type": "new_session", "session": clean_session(updated)})
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
    else:
        await manager.send_to_customer(session_id, {
            "type": "queue_update", "session_id": session_id, "position": doc.get("queue_position"),
        })
    return {
        "status": doc["status"],
        "queue_position": doc.get("queue_position"),
    }


@router.get("/memory")
async def get_memory(email: str, user: dict = Depends(get_current_user)):
    """Agent-only: fetch a customer's memory record."""
    mem = await get_customer_memory(email)
    return mem or {}
