from fastapi import APIRouter, Depends, HTTPException
import uuid

from config import db, MAX_ACTIVE_CHATS_PER_AGENT
from deps import get_current_user, require_admin
from models import CreateAgentBody, UpdateAgentStatusBody
from utils import hash_password, now_iso
from ws_manager import manager
from services import agent_active_count, list_agents_with_load, promote_from_queue

router = APIRouter(prefix="/agents", tags=["agents"])


@router.post("/status")
async def update_status(body: UpdateAgentStatusBody, user: dict = Depends(get_current_user)):
    if body.status not in ("online", "offline", "busy"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"status": body.status, "status_updated_at": now_iso(), "auto_busy": False}},
    )
    await manager.send_to_agents({"type": "agent_status", "agent_id": user["id"], "status": body.status})
    # Bug 1 fix — when an agent becomes available, drain the queue immediately.
    if body.status == "online":
        await promote_from_queue()
    return {"ok": True, "status": body.status}


@router.get("")
async def list_agents(user: dict = Depends(get_current_user)):
    return await list_agents_with_load()


@router.get("/me/load")
async def get_my_load(user: dict = Depends(get_current_user)):
    count = await agent_active_count(user["id"])
    return {
        "active_chat_count": count,
        "max_active_chats": MAX_ACTIVE_CHATS_PER_AGENT,
        "at_capacity": count >= MAX_ACTIVE_CHATS_PER_AGENT,
    }


@router.post("")
async def create_agent(body: CreateAgentBody, admin: dict = Depends(require_admin)):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    if body.role not in ("agent", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    uid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": uid, "email": email, "password_hash": hash_password(body.password),
        "name": body.name, "role": body.role, "status": "offline",
        "created_at": now_iso(),
    })
    return {"id": uid, "email": email, "name": body.name, "role": body.role, "status": "offline"}


@router.delete("/{agent_id}")
async def delete_agent(agent_id: str, admin: dict = Depends(require_admin)):
    if agent_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    res = await db.users.delete_one({"id": agent_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"ok": True}
