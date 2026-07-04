"""Background scheduler: inactivity auto-message, auto-transfer, auto-close."""
import asyncio
import logging
from datetime import datetime, timezone, timedelta

from config import db, MAX_ACTIVE_CHATS_PER_AGENT
from services import (
    agent_active_count,
    least_busy_online_agent,
    promote_from_queue,
    save_message,
)
from utils import now_iso
from ws_manager import manager

logger = logging.getLogger("livechat.scheduler")

DEFAULT_FIRST_RESPONSE_MINUTES = 3
DEFAULT_CLOSE_MINUTES = 10
DEFAULT_AUTO_MSG = (
    "Thanks for waiting — we're a bit busy right now, but we'll get back to you as soon as we can. "
    "Appreciate your patience! 😊"
)


async def _get_settings() -> dict:
    s = await db.settings.find_one({"id": "global"}) or {}
    return {
        "first_response_min": int(s.get("inactivity_first_response_minutes") or DEFAULT_FIRST_RESPONSE_MINUTES),
        "auto_transfer": bool(s.get("inactivity_auto_transfer", False)),
        "auto_message": s.get("inactivity_auto_message") or DEFAULT_AUTO_MSG,
        "close_min": int(s.get("inactivity_close_minutes") or DEFAULT_CLOSE_MINUTES),
    }


async def _handle_first_response(session: dict, cfg: dict) -> bool:
    """If no agent has replied within N minutes, send the auto-message and try transfer.
    Only applies once (auto_msg_sent flag). Returns True if we sent it.
    """
    if session.get("auto_msg_sent"):
        return False
    try:
        created = datetime.fromisoformat(session["created_at"])
    except Exception:
        return False
    age = (datetime.now(timezone.utc) - created).total_seconds() / 60.0
    if age < cfg["first_response_min"]:
        return False
    # Check that no agent has replied yet
    has_agent_msg = await db.messages.find_one({
        "session_id": session["id"], "sender_type": "agent", "deleted": {"$ne": True},
    })
    if has_agent_msg:
        # Mark as done so we don't check again
        await db.sessions.update_one({"id": session["id"]}, {"$set": {"auto_msg_sent": True}})
        return False
    # Send system auto-message
    msg = await save_message(
        session["id"], "system", "system", "System",
        cfg["auto_message"], attachments=None,
    )
    await manager.broadcast_to_session(session["id"], {"type": "message", "message": msg})
    updates = {"auto_msg_sent": True, "auto_msg_at": now_iso()}
    # Auto-transfer
    if cfg["auto_transfer"]:
        best = await least_busy_online_agent()
        current_id = session.get("assigned_agent_id")
        if best and best["id"] != current_id:
            updates["assigned_agent_id"] = best["id"]
            updates["transferred_from"] = current_id
            updates["transferred_at"] = now_iso()
            await manager.send_to_agents({
                "type": "session_transferred",
                "session_id": session["id"],
                "to_agent_id": best["id"],
                "to_agent_name": best.get("name"),
            })
    await db.sessions.update_one({"id": session["id"]}, {"$set": updates})
    return True


async def _handle_auto_close(session: dict, cfg: dict) -> bool:
    """If session has no messages in the last N minutes, auto-close it."""
    try:
        last = datetime.fromisoformat(session.get("last_message_at", session["created_at"]))
    except Exception:
        return False
    silent_min = (datetime.now(timezone.utc) - last).total_seconds() / 60.0
    if silent_min < cfg["close_min"]:
        return False
    closed_at = now_iso()
    await db.sessions.update_one(
        {"id": session["id"]},
        {"$set": {
            "status": "closed",
            "closed_at": closed_at,
            "archived_at": closed_at,
            "closed_by": "system",
            "closed_reason": "inactivity",
            "updated_at": closed_at,
            "summary": (session.get("summary") or "")
                       + f" [Auto-closed after {cfg['close_min']} min of inactivity.]",
        }},
    )
    await manager.broadcast_to_session(session["id"], {
        "type": "session_closed",
        "session_id": session["id"],
        "reason": "inactivity",
    })
    # Free the agent's cap slot
    if session.get("assigned_agent_id"):
        active = await agent_active_count(session["assigned_agent_id"])
        u = await db.users.find_one({"id": session["assigned_agent_id"]})
        if u and u.get("auto_busy") and active < MAX_ACTIVE_CHATS_PER_AGENT:
            await db.users.update_one(
                {"id": session["assigned_agent_id"]},
                {"$set": {"status": "online", "auto_busy": False}},
            )
            await manager.send_to_agents({
                "type": "agent_status", "agent_id": session["assigned_agent_id"], "status": "online",
            })
    return True


async def _tick() -> None:
    cfg = await _get_settings()
    cur = db.sessions.find({"status": "open"})
    open_sessions = []
    async for s in cur:
        open_sessions.append(s)
    for s in open_sessions:
        try:
            closed = await _handle_auto_close(s, cfg)
            if not closed:
                await _handle_first_response(s, cfg)
        except Exception as e:
            logger.warning(f"scheduler session {s.get('id')} error: {e}")
    # After any closes, promote queue
    if open_sessions:
        try:
            await promote_from_queue()
        except Exception as e:
            logger.warning(f"scheduler promote error: {e}")


async def scheduler_loop(interval_seconds: int = 60):
    logger.info("Inactivity scheduler started")
    while True:
        try:
            await _tick()
        except Exception as e:
            logger.error(f"scheduler tick failed: {e}")
        await asyncio.sleep(interval_seconds)
