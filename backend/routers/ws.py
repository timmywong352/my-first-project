import logging
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from config import MAX_ACTIVE_CHATS_PER_AGENT, db
from services import agent_active_count, save_message
from utils import decode_token
from ws_manager import manager

router = APIRouter(tags=["ws"])
logger = logging.getLogger("livechat.ws.routes")


@router.websocket("/ws/agent")
async def ws_agent(websocket: WebSocket, token: str = Query(...)):
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        await websocket.close(code=1008)
        return
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        await websocket.close(code=1008)
        return
    agent_id = user["id"]
    agent_name = user["name"]
    await manager.connect_agent(agent_id, websocket)

    # Preserve auto_busy state on reconnect
    active_now = await agent_active_count(agent_id)
    if user.get("auto_busy") and active_now >= MAX_ACTIVE_CHATS_PER_AGENT:
        await db.users.update_one(
            {"id": agent_id},
            {"$set": {"status": "busy", "auto_busy": True}},
        )
        await manager.send_to_agents({"type": "agent_status", "agent_id": agent_id, "status": "busy"})
    else:
        await db.users.update_one(
            {"id": agent_id},
            {"$set": {"status": "online", "auto_busy": False}},
        )
        await manager.send_to_agents({"type": "agent_status", "agent_id": agent_id, "status": "online"})

    try:
        while True:
            data = await websocket.receive_json()
            t = data.get("type")
            if t == "message":
                session_id = data.get("session_id")
                content = data.get("content", "")
                attachments = data.get("attachments") or []
                if not session_id or (not content.strip() and not attachments):
                    continue
                sess = await db.sessions.find_one({"id": session_id})
                if not sess or sess.get("status") == "closed":
                    await websocket.send_json({
                        "type": "error", "code": "session_closed",
                        "message": "This chat has been closed.",
                    })
                    continue
                if not sess.get("assigned_agent_id"):
                    active = await agent_active_count(agent_id)
                    if active < MAX_ACTIVE_CHATS_PER_AGENT:
                        await db.sessions.update_one(
                            {"id": session_id, "assigned_agent_id": None},
                            {"$set": {"assigned_agent_id": agent_id}},
                        )
                        if active + 1 >= MAX_ACTIVE_CHATS_PER_AGENT:
                            await db.users.update_one(
                                {"id": agent_id},
                                {"$set": {"status": "busy", "auto_busy": True}},
                            )
                            await manager.send_to_agents({
                                "type": "agent_status", "agent_id": agent_id, "status": "busy",
                            })
                msg = await save_message(session_id, "agent", agent_id, agent_name, content, attachments)
                await manager.broadcast_to_session(session_id, {"type": "message", "message": msg})
            elif t == "typing":
                session_id = data.get("session_id")
                is_typing = bool(data.get("is_typing"))
                preview_text = (data.get("content", "") or "")[:500]
                await manager.send_to_customer(session_id, {
                    "type": "typing",
                    "sender_type": "agent",
                    "is_typing": is_typing,
                    "name": agent_name,
                    "preview": preview_text if is_typing else "",
                })
            elif t == "read":
                session_id = data.get("session_id")
                await db.messages.update_many(
                    {"session_id": session_id, "sender_type": "customer", "status": {"$ne": "read"}},
                    {"$set": {"status": "read"}},
                )
                await manager.send_to_customer(session_id, {"type": "read_receipt", "session_id": session_id})
            elif t == "sync":
                # Agent-side replay for a specific session.
                session_id = data.get("session_id")
                since_id = data.get("since_id")
                if not session_id:
                    continue
                cursor_ts = None
                if since_id:
                    anchor = await db.messages.find_one({"id": since_id})
                    if anchor:
                        cursor_ts = anchor.get("created_at")
                query = {"session_id": session_id}
                if cursor_ts:
                    query["created_at"] = {"$gt": cursor_ts}
                async for m in db.messages.find(query).sort("created_at", 1):
                    m.pop("_id", None)
                    if m.get("id") == since_id:
                        continue
                    await websocket.send_json({"type": "message", "message": m})
            elif t == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Agent WS error: {e}")
    finally:
        manager.disconnect_agent(agent_id, websocket)
        if agent_id not in manager.agent_conns:
            u = await db.users.find_one({"id": agent_id})
            active_left = await agent_active_count(agent_id)
            if u and u.get("auto_busy") and active_left >= MAX_ACTIVE_CHATS_PER_AGENT:
                pass  # preserve busy
            else:
                await db.users.update_one({"id": agent_id}, {"$set": {"status": "offline"}})
                await manager.send_to_agents({
                    "type": "agent_status", "agent_id": agent_id, "status": "offline",
                })


@router.websocket("/ws/customer")
async def ws_customer(
    websocket: WebSocket,
    session_id: str = Query(...),
    session_token: str = Query(...),
):
    s = await db.sessions.find_one({"id": session_id})
    if not s or s.get("session_token") != session_token:
        await websocket.close(code=1008)
        return
    customer_name = s.get("customer_name", "Customer")
    await manager.connect_customer(session_id, websocket)
    if s.get("status") == "closed":
        try:
            await websocket.send_json({
                "type": "session_closed",
                "session_id": session_id,
                "summary": s.get("summary", ""),
            })
        except Exception:
            pass
    try:
        while True:
            data = await websocket.receive_json()
            t = data.get("type")
            if t == "message":
                content = data.get("content", "")
                attachments = data.get("attachments") or []
                if not content.strip() and not attachments:
                    continue
                sess = await db.sessions.find_one({"id": session_id})
                if not sess or sess.get("status") == "closed":
                    await websocket.send_json({
                        "type": "error", "code": "session_closed",
                        "message": "This chat has ended. Start a new chat to continue.",
                    })
                    continue
                msg = await save_message(session_id, "customer", session_id, customer_name, content, attachments)
                await manager.broadcast_to_session(session_id, {"type": "message", "message": msg})
            elif t == "typing":
                is_typing = bool(data.get("is_typing"))
                preview_text = (data.get("content", "") or "")[:500]
                await manager.send_to_agents({
                    "type": "typing",
                    "session_id": session_id,
                    "sender_type": "customer",
                    "is_typing": is_typing,
                    "name": customer_name,
                    "preview": preview_text if is_typing else "",
                })
            elif t == "read":
                await db.messages.update_many(
                    {"session_id": session_id, "sender_type": "agent", "status": {"$ne": "read"}},
                    {"$set": {"status": "read"}},
                )
                await manager.send_to_agents({"type": "read_receipt", "session_id": session_id})
            elif t == "sync":
                # Replay any messages this customer missed while disconnected.
                since_id = data.get("since_id")
                cursor_ts = None
                if since_id:
                    anchor = await db.messages.find_one({"id": since_id})
                    if anchor:
                        cursor_ts = anchor.get("created_at")
                query = {"session_id": session_id}
                if cursor_ts:
                    query["created_at"] = {"$gt": cursor_ts}
                async for m in db.messages.find(query).sort("created_at", 1):
                    m.pop("_id", None)
                    if m.get("id") == since_id:
                        continue
                    await websocket.send_json({"type": "message", "message": m})
            elif t == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Customer WS error: {e}")
    finally:
        manager.disconnect_customer(session_id, websocket)
