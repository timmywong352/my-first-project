import uuid
from typing import Optional, List, Dict, Any

from config import db, MAX_ACTIVE_CHATS_PER_AGENT
from utils import now_iso
from ws_manager import manager


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
    return await db.sessions.count_documents({
        "assigned_agent_id": agent_id, "status": "open"
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
