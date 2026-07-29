"""Lily REST endpoints — used by the customer widget."""
import base64
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from config import EMERGENT_LLM_KEY, db
from deps import get_current_user
from lily_service import (
    QUICK_OPTIONS,
    compose_reply,
    deposit_confirm,
    get_customer_memory,
    handoff_line,
    opening_message,
    options_for_lang,
    random_greeting,
    upsert_customer_memory,
)
from services import save_message
from utils import now_iso
from ws_manager import manager

router = APIRouter(prefix="/lily", tags=["lily"])
logger = logging.getLogger("livechat.lily.router")


# ---------- TTS ----------
class TTSBody(BaseModel):
    text: str = Field(..., max_length=1500)
    voice: str = Field("nova", pattern="^(alloy|ash|coral|echo|fable|nova|onyx|sage|shimmer)$")
    speed: float = Field(1.0, ge=0.5, le=2.0)


_tts_client = None


def _get_tts_client():
    global _tts_client
    if _tts_client is None:
        from emergentintegrations.llm.openai import OpenAITextToSpeech
        _tts_client = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
    return _tts_client


@router.post("/tts")
async def lily_tts(body: TTSBody):
    """Generate MP3 audio for a short piece of text using OpenAI TTS (nova).

    Returns raw ``audio/mpeg`` bytes so the frontend can drop the URL into an
    ``<audio>`` element or ``URL.createObjectURL(blob)``.
    """
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")
    try:
        client = _get_tts_client()
        audio_bytes = await client.generate_speech(
            text=text[:1500],
            model="tts-1",
            voice=body.voice,
            speed=body.speed,
            response_format="mp3",
        )
    except Exception as e:
        logger.error(f"TTS generation failed: {e}")
        raise HTTPException(status_code=502, detail="TTS unavailable")
    return Response(content=audio_bytes, media_type="audio/mpeg", headers={
        "Cache-Control": "public, max-age=3600",
    })


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
async def lily_status(lang: str = Query("en")):
    opts = options_for_lang(lang)
    return {
        "enabled": await _lily_enabled(),
        "options": opts,
        "language": lang,
        "deposit_confirm": deposit_confirm(lang),
    }


@router.post("/open")
async def lily_open(
    session_id: str = Query(...),
    session_token: str = Query(...),
    lang: str = Query("en"),
):
    """Called once when the widget enters the Lily phase — returns opening line + memory."""
    session = await _authorize(session_id, session_token)
    if not await _lily_enabled():
        return {"enabled": False}

    memory = await get_customer_memory(session["customer_email"])
    greeting = opening_message(memory, lang=lang)

    # Persist Lily's opening message so it shows in agent dashboard too
    msg = await save_message(
        session_id, "lily", "lily", "Lily", greeting, attachments=None,
    )
    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {
            "handled_by_lily": True,
            "current_emotion": "neutral",
            "language": (lang or "en").lower(),
        }},
    )
    # Broadcast to agents too (they can see Lily engaging)
    await manager.broadcast_to_session(session_id, {"type": "message", "message": msg})

    return {
        "enabled": True,
        "message": msg,
        "memory": memory,
        "options": [
            {"key": k, **v} for k, v in options_for_lang(lang).items()
        ],
        "language": lang,
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


@router.post("/regreet")
async def lily_regreet(
    session_id: str = Query(...),
    session_token: str = Query(...),
    lang: str = Query("en"),
    exclude: Optional[str] = Query(None),
):
    """Play a new (different) random greeting from the pool.

    Called when the customer clicks Lily's avatar to hear another
    variation. The picked line is persisted as a Lily message and
    broadcast to any listening agents.
    """
    session = await _authorize(session_id, session_token)
    if not await _lily_enabled():
        raise HTTPException(status_code=404, detail="Lily disabled")

    memory = await get_customer_memory(session.get("customer_email") or "")
    text = random_greeting(lang=lang, memory=memory, exclude=exclude)

    msg = await save_message(
        session_id, "lily", "lily", "Lily", text, attachments=None,
    )
    await manager.broadcast_to_session(session_id, {"type": "message", "message": msg})
    return {"message": msg}


@router.post("/handoff")
async def lily_handoff(
    session_id: str = Query(...),
    session_token: str = Query(...),
    customer_text: Optional[str] = Query(None),
    lang: str = Query("en"),
):
    """Transfer from Lily to the human queue system.

    If `customer_text` is provided (e.g. the option label or free text the
    customer typed), it is first saved as a customer message so the human
    agent immediately sees why the transfer happened.
    """
    session = await _authorize(session_id, session_token)
    from services import route_new_session, agent_active_count, clean_session
    from config import MAX_ACTIVE_CHATS_PER_AGENT

    # 1) Persist customer's context message first (if provided) so the agent
    #    knows exactly what the customer wanted before Lily handed off.
    if customer_text and customer_text.strip():
        cust_msg = await save_message(
            session_id, "customer", session_id,
            session.get("customer_name", "Customer"),
            customer_text.strip(), attachments=None,
        )
        await manager.broadcast_to_session(
            session_id, {"type": "message", "message": cust_msg},
        )

    # 2) Post Lily's transition line
    handoff_msg = await save_message(
        session_id, "lily", "lily", "Lily",
        handoff_line(lang), attachments=None,
    )
    await manager.broadcast_to_session(session_id, {"type": "message", "message": handoff_msg})

    # Route: least-busy or queue
    doc = dict(session)
    await route_new_session(doc)
    assigned_agent = doc.pop("_assigned_agent", None)
    updates = {
        "status": doc["status"],
        "assigned_agent_id": doc.get("assigned_agent_id"),
        "pending_agent_id": doc.get("pending_agent_id"),
        "pending_expires_at": doc.get("pending_expires_at"),
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
