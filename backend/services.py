import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

from config import db, MAX_ACTIVE_CHATS_PER_AGENT
from utils import now_iso
from ws_manager import manager


# ---------- Pending-offer flow ----------
PENDING_TIMEOUT_SECONDS = 30


def _pending_expires_iso() -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=PENDING_TIMEOUT_SECONDS)).isoformat()


def clean_session(s: dict) -> dict:
    s = dict(s)
    s.pop("_id", None)
    s.pop("session_token", None)
    return s


async def save_message(session_id: str, sender_type: str, sender_id: str, sender_name: str,
                       content: str, attachments: Optional[list] = None) -> dict:
    msg = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "sender_type": sender_type,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "content": content,
        "attachments": attachments or [],
        "status": "sent",
        "edited": False,
        "deleted": False,
        "created_at": now_iso(),
    }
    await db.messages.insert_one(msg)
    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {"last_message_at": msg["created_at"], "updated_at": msg["created_at"]}}
    )
    msg.pop("_id", None)
    return msg


async def agent_active_count(agent_id: str) -> int:
    """Count both accepted (open) AND offered-but-not-accepted (pending) sessions."""
    return await db.sessions.count_documents({
        "$or": [
            {"assigned_agent_id": agent_id, "status": "open"},
            {"pending_agent_id": agent_id, "status": "pending"},
        ],
    })


async def sync_agent_capacity(agent_id: str) -> None:
    """If an auto-busy agent has dropped below the cap, restore them to online."""
    user = await db.users.find_one({"id": agent_id})
    if not user:
        return
    active = await agent_active_count(agent_id)
    if user.get("auto_busy") and active < MAX_ACTIVE_CHATS_PER_AGENT:
        await db.users.update_one({"id": agent_id}, {"$set": {"status": "online", "auto_busy": False}})
        await manager.send_to_agents({"type": "agent_status", "agent_id": agent_id, "status": "online"})


async def list_agents_with_load() -> List[Dict[str, Any]]:
    """Single aggregation: agents + their open-session count."""
    pipeline = [
        {"$match": {"role": {"$in": ["agent", "admin"]}}},
        {"$lookup": {
            "from": "sessions",
            "let": {"uid": "$id"},
            "pipeline": [
                {"$match": {"$expr": {"$and": [
                    {"$eq": ["$assigned_agent_id", "$$uid"]},
                    {"$eq": ["$status", "open"]},
                ]}}},
                {"$count": "n"},
            ],
            "as": "_load",
        }},
        {"$project": {
            "_id": 0,
            "id": 1, "email": 1, "name": 1, "role": 1,
            "status": 1, "created_at": 1,
            "active_chat_count": {"$ifNull": [{"$arrayElemAt": ["$_load.n", 0]}, 0]},
        }},
    ]
    out = []
    async for doc in db.users.aggregate(pipeline):
        doc["max_active_chats"] = MAX_ACTIVE_CHATS_PER_AGENT
        out.append(doc)
    return out


async def least_busy_online_agent(exclude: Optional[List[str]] = None) -> Optional[dict]:
    """Return the online agent with the fewest active chats, if any has capacity.

    "active" here includes BOTH open (accepted) AND pending (offered but not yet
    accepted) sessions, so we don't flood a single agent with offers.

    exclude: list of agent_ids to skip (used when reassigning after a timeout so
    we don't offer the same chat back to the agent that just let it lapse).
    """
    match: Dict[str, Any] = {"role": {"$in": ["agent", "admin"]}, "status": "online"}
    if exclude:
        match["id"] = {"$nin": exclude}
    pipeline = [
        {"$match": match},
        {"$lookup": {
            "from": "sessions",
            "let": {"uid": "$id"},
            "pipeline": [
                {"$match": {"$expr": {"$and": [
                    {"$or": [
                        {"$eq": ["$assigned_agent_id", "$$uid"]},
                        {"$eq": ["$pending_agent_id", "$$uid"]},
                    ]},
                    {"$in": ["$status", ["open", "pending"]]},
                ]}}},
                {"$count": "n"},
            ],
            "as": "_load",
        }},
        {"$addFields": {
            "active_chat_count": {"$ifNull": [{"$arrayElemAt": ["$_load.n", 0]}, 0]},
        }},
        {"$match": {"active_chat_count": {"$lt": MAX_ACTIVE_CHATS_PER_AGENT}}},
        {"$sort": {"active_chat_count": 1}},
        {"$limit": 1},
    ]
    async for a in db.users.aggregate(pipeline):
        a.pop("_id", None)
        a.pop("_load", None)
        return a
    return None


async def recompute_queue_positions() -> None:
    """Re-number all queued sessions in creation order and notify each customer."""
    cur = db.sessions.find({"status": "queued"}).sort("created_at", 1)
    idx = 0
    async for s in cur:
        idx += 1
        await db.sessions.update_one({"id": s["id"]}, {"$set": {"queue_position": idx}})
        await manager.send_to_customer(s["id"], {
            "type": "queue_update", "session_id": s["id"], "position": idx,
        })


async def promote_from_queue() -> None:
    """Promote as many queued sessions to accepted (open) as capacity allows.

    Assignment is automatic — no pending Accept step.
    """
    while True:
        agent = await least_busy_online_agent()
        if not agent:
            break
        s = await db.sessions.find_one({"status": "queued"}, sort=[("created_at", 1)])
        if not s:
            break
        promoted_at = now_iso()
        await db.sessions.update_one(
            {"id": s["id"]},
            {"$set": {
                "status": "open",
                "assigned_agent_id": agent["id"],
                "queue_position": None,
                "promoted_at": promoted_at,
                "last_message_at": promoted_at,
                "updated_at": promoted_at,
            }, "$unset": {"pending_agent_id": "", "pending_expires_at": ""}},
        )
        await manager.send_to_customer(s["id"], {
            "type": "queue_promoted",
            "session_id": s["id"],
            "agent_name": agent.get("name"),
        })
        s2 = await db.sessions.find_one({"id": s["id"]})
        await manager.send_to_agents({"type": "new_session", "session": clean_session(s2)})
        active = await agent_active_count(agent["id"])
        if active >= MAX_ACTIVE_CHATS_PER_AGENT:
            await db.users.update_one(
                {"id": agent["id"]},
                {"$set": {"status": "busy", "auto_busy": True}},
            )
            await manager.send_to_agents({
                "type": "agent_status", "agent_id": agent["id"], "status": "busy",
            })
    await recompute_queue_positions()


async def expire_pending_offers() -> None:
    """No-op — pending offers were removed. Kept as a stub so the scheduler
    task doesn't need to be torn down."""
    return None


async def route_new_session(session_doc: dict) -> dict:
    """Assign new session to least-busy agent OR queue if none free.

    Sessions go DIRECTLY to status="open" (no manual Accept step) so agents
    see them immediately in their active list.
    """
    agent = await least_busy_online_agent()
    if agent:
        session_doc["status"] = "open"
        session_doc["assigned_agent_id"] = agent["id"]
        session_doc["pending_agent_id"] = None
        session_doc["pending_expires_at"] = None
        session_doc["queue_position"] = None
        session_doc["_assigned_agent"] = agent
    else:
        pos = await db.sessions.count_documents({"status": "queued"}) + 1
        session_doc["status"] = "queued"
        session_doc["assigned_agent_id"] = None
        session_doc["queue_position"] = pos
    return session_doc
