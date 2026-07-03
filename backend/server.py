from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import json
import logging
import asyncio
import bcrypt
import jwt
import requests
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

from fastapi import (
    FastAPI, APIRouter, HTTPException, Depends, Request, Response,
    UploadFile, File, Form, Header, Query, WebSocket, WebSocketDisconnect, status
)
from fastapi.responses import StreamingResponse, Response as FastAPIResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

# --- Config ---
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 24  # 1 day for agent sessions
APP_NAME = os.environ.get("APP_NAME", "livechat")
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")

ALLOWED_MIME_EXT = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "mp4": "video/mp4",
    "zip": "application/zip",
}

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("livechat")

app = FastAPI()
api = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Utilities ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        return None


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    user.pop("password_hash", None)
    user.pop("_id", None)
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


# ---------- Emergent Object Storage ----------
storage_key: Optional[str] = None


def init_storage() -> Optional[str]:
    global storage_key
    if storage_key:
        return storage_key
    try:
        resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        resp.raise_for_status()
        storage_key = resp.json()["storage_key"]
        logger.info("Object storage initialized")
        return storage_key
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
        return None


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Storage unavailable")
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 403:
        # Refresh key once
        global storage_key
        storage_key = None
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    if not key:
        raise HTTPException(status_code=500, detail="Storage unavailable")
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    if resp.status_code == 403:
        global storage_key
        storage_key = None
        key = init_storage()
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------- WebSocket Manager ----------
class ConnectionManager:
    def __init__(self):
        # agent_id -> list of websockets (an agent could have multiple tabs)
        self.agent_conns: Dict[str, List[WebSocket]] = {}
        # session_id -> list of customer websockets
        self.customer_conns: Dict[str, List[WebSocket]] = {}

    async def connect_agent(self, agent_id: str, ws: WebSocket):
        await ws.accept()
        self.agent_conns.setdefault(agent_id, []).append(ws)

    async def connect_customer(self, session_id: str, ws: WebSocket):
        await ws.accept()
        self.customer_conns.setdefault(session_id, []).append(ws)

    def disconnect_agent(self, agent_id: str, ws: WebSocket):
        if agent_id in self.agent_conns:
            self.agent_conns[agent_id] = [w for w in self.agent_conns[agent_id] if w is not ws]
            if not self.agent_conns[agent_id]:
                self.agent_conns.pop(agent_id, None)

    def disconnect_customer(self, session_id: str, ws: WebSocket):
        if session_id in self.customer_conns:
            self.customer_conns[session_id] = [w for w in self.customer_conns[session_id] if w is not ws]
            if not self.customer_conns[session_id]:
                self.customer_conns.pop(session_id, None)

    async def _safe_send(self, ws: WebSocket, message: dict):
        try:
            await ws.send_json(message)
        except Exception as e:
            logger.warning(f"WS send failed: {e}")

    async def broadcast_to_session(self, session_id: str, message: dict, assigned_agent_id: Optional[str] = None):
        # Send to customer connections of session
        for ws in list(self.customer_conns.get(session_id, [])):
            await self._safe_send(ws, message)
        # Send to ALL online agents (so unassigned chats appear in inbox too)
        for agent_id, conns in list(self.agent_conns.items()):
            for ws in list(conns):
                await self._safe_send(ws, message)

    async def send_to_customer(self, session_id: str, message: dict):
        for ws in list(self.customer_conns.get(session_id, [])):
            await self._safe_send(ws, message)

    async def send_to_agents(self, message: dict):
        for agent_id, conns in list(self.agent_conns.items()):
            for ws in list(conns):
                await self._safe_send(ws, message)


manager = ConnectionManager()


# ---------- Models ----------
class LoginBody(BaseModel):
    email: EmailStr
    password: str


class CreateAgentBody(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "agent"  # agent or admin


class UpdateAgentStatusBody(BaseModel):
    status: str  # online, offline, busy


class PreChatBody(BaseModel):
    name: str
    email: EmailStr
    subject: str
    page: Optional[str] = None
    location: Optional[str] = None


class SendMessageBody(BaseModel):
    content: str = ""
    attachments: Optional[List[Dict[str, Any]]] = None


class EditMessageBody(BaseModel):
    content: str


class QuickReplyBody(BaseModel):
    title: str
    content: str


class SettingsBody(BaseModel):
    widget_color: Optional[str] = None
    widget_accent: Optional[str] = None
    welcome_message: Optional[str] = None
    business_hours_start: Optional[str] = None  # HH:MM
    business_hours_end: Optional[str] = None
    business_days: Optional[List[int]] = None  # 0=Mon


class CsatBody(BaseModel):
    rating: int  # 1-5


# ---------- Auth Endpoints ----------
@api.post("/auth/login")
async def login(body: LoginBody, response: Response):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], user["email"], user["role"])
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=False,
        samesite="lax", max_age=ACCESS_TOKEN_MINUTES * 60, path="/"
    )
    return {
        "token": token,
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"],
            "role": user["role"], "status": user.get("status", "offline"),
        },
    }


@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------- Agent Endpoints ----------
@api.post("/agents/status")
async def update_status(body: UpdateAgentStatusBody, user: dict = Depends(get_current_user)):
    if body.status not in ("online", "offline", "busy"):
        raise HTTPException(status_code=400, detail="Invalid status")
    await db.users.update_one({"id": user["id"]}, {"$set": {"status": body.status, "status_updated_at": now_iso()}})
    await manager.send_to_agents({"type": "agent_status", "agent_id": user["id"], "status": body.status})
    return {"ok": True, "status": body.status}


@api.get("/agents")
async def list_agents(user: dict = Depends(get_current_user)):
    cur = db.users.find({"role": {"$in": ["agent", "admin"]}})
    out = []
    async for u in cur:
        out.append({
            "id": u["id"], "email": u["email"], "name": u["name"],
            "role": u["role"], "status": u.get("status", "offline"),
            "created_at": u.get("created_at"),
        })
    return out


@api.post("/agents")
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


@api.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str, admin: dict = Depends(require_admin)):
    if agent_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    res = await db.users.delete_one({"id": agent_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"ok": True}


# ---------- Chat Endpoints ----------
@api.post("/chat/session")
async def create_chat_session(body: PreChatBody, request: Request):
    session_id = str(uuid.uuid4())
    # Session token to authorize customer WebSocket
    session_token = str(uuid.uuid4())
    client_ip = request.client.host if request.client else ""
    doc = {
        "id": session_id,
        "session_token": session_token,
        "customer_name": body.name,
        "customer_email": body.email.lower(),
        "subject": body.subject,
        "page": body.page or "",
        "location": body.location or client_ip,
        "status": "open",
        "assigned_agent_id": None,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "last_message_at": now_iso(),
        "csat_rating": None,
        "summary": None,
    }
    await db.sessions.insert_one(doc)
    # Notify agents
    await manager.send_to_agents({"type": "new_session", "session": _clean_session(doc)})
    return {
        "session_id": session_id,
        "session_token": session_token,
        "customer_name": body.name,
        "customer_email": body.email,
        "subject": body.subject,
    }


def _clean_session(s: dict) -> dict:
    s = dict(s)
    s.pop("_id", None)
    s.pop("session_token", None)  # never expose token to agents
    return s


@api.get("/chat/sessions")
async def list_sessions(status_filter: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if status_filter:
        q["status"] = status_filter
    cur = db.sessions.find(q).sort("last_message_at", -1).limit(200)
    out = []
    async for s in cur:
        # Enrich with last message
        last = await db.messages.find_one({"session_id": s["id"]}, sort=[("created_at", -1)])
        clean = _clean_session(s)
        clean["last_message"] = None
        clean["unread_count"] = 0
        if last:
            clean["last_message"] = {
                "content": last.get("content", ""),
                "sender_type": last.get("sender_type"),
                "created_at": last.get("created_at"),
                "has_attachments": bool(last.get("attachments")),
            }
        out.append(clean)
    return out


@api.get("/chat/sessions/{session_id}")
async def get_session(session_id: str, user: dict = Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return _clean_session(s)


@api.get("/chat/sessions/{session_id}/messages")
async def get_messages(session_id: str, user: dict = Depends(get_current_user)):
    cur = db.messages.find({"session_id": session_id, "deleted": {"$ne": True}}).sort("created_at", 1)
    out = []
    async for m in cur:
        m.pop("_id", None)
        out.append(m)
    return out


# Public endpoint - customer can fetch messages using session_token
@api.get("/chat/public/{session_id}/messages")
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


# History: past sessions for a given customer email
@api.get("/chat/history/{email}")
async def customer_history(email: str, user: dict = Depends(get_current_user)):
    cur = db.sessions.find({"customer_email": email.lower()}).sort("created_at", -1).limit(50)
    out = []
    async for s in cur:
        out.append(_clean_session(s))
    return out


@api.patch("/chat/messages/{msg_id}")
async def edit_message(msg_id: str, body: EditMessageBody, user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"id": msg_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("sender_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your message")
    await db.messages.update_one(
        {"id": msg_id},
        {"$set": {"content": body.content, "edited": True, "edited_at": now_iso()}}
    )
    updated = await db.messages.find_one({"id": msg_id})
    updated.pop("_id", None)
    await manager.broadcast_to_session(msg["session_id"], {"type": "message_edited", "message": updated})
    return updated


@api.delete("/chat/messages/{msg_id}")
async def delete_message(msg_id: str, user: dict = Depends(get_current_user)):
    msg = await db.messages.find_one({"id": msg_id})
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.get("sender_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your message")
    await db.messages.update_one({"id": msg_id}, {"$set": {"deleted": True, "deleted_at": now_iso()}})
    await manager.broadcast_to_session(msg["session_id"], {"type": "message_deleted", "message_id": msg_id})
    return {"ok": True}


@api.post("/chat/sessions/{session_id}/close")
async def close_session(session_id: str, user: dict = Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    # AI summary (best-effort)
    summary = await ai_summarize(session_id)
    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {"status": "closed", "closed_at": now_iso(), "summary": summary, "updated_at": now_iso()}}
    )
    await manager.broadcast_to_session(session_id, {"type": "session_closed", "session_id": session_id, "summary": summary})
    return {"ok": True, "summary": summary}


@api.post("/chat/public/{session_id}/csat")
async def submit_csat(session_id: str, body: CsatBody, session_token: str = Query(...)):
    s = await db.sessions.find_one({"id": session_id})
    if not s or s.get("session_token") != session_token:
        raise HTTPException(status_code=401, detail="Invalid session token")
    if body.rating < 1 or body.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be 1-5")
    await db.sessions.update_one({"id": session_id}, {"$set": {"csat_rating": body.rating}})
    return {"ok": True}


# ---------- Quick Replies ----------
@api.get("/quick-replies")
async def list_quick_replies(user: dict = Depends(get_current_user)):
    cur = db.quick_replies.find().sort("created_at", -1)
    out = []
    async for q in cur:
        q.pop("_id", None)
        out.append(q)
    return out


@api.post("/quick-replies")
async def create_quick_reply(body: QuickReplyBody, user: dict = Depends(get_current_user)):
    q = {"id": str(uuid.uuid4()), "title": body.title, "content": body.content,
         "created_by": user["id"], "created_at": now_iso()}
    await db.quick_replies.insert_one(q)
    q.pop("_id", None)
    return q


@api.delete("/quick-replies/{qid}")
async def delete_quick_reply(qid: str, user: dict = Depends(get_current_user)):
    await db.quick_replies.delete_one({"id": qid})
    return {"ok": True}


# ---------- File Upload / Download ----------
async def _authorize_upload(request: Request, session_id: Optional[str], session_token: Optional[str]) -> str:
    """Returns uploader identity string. Either agent user id or 'customer:<session_id>'."""
    # Try agent auth
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if token:
        payload = decode_token(token)
        if payload and payload.get("type") == "access":
            return f"agent:{payload['sub']}"
    # Fallback: customer session token
    if session_id and session_token:
        s = await db.sessions.find_one({"id": session_id})
        if s and s.get("session_token") == session_token:
            return f"customer:{session_id}"
    raise HTTPException(status_code=401, detail="Not authorized to upload")


@api.post("/upload")
async def upload(
    request: Request,
    file: UploadFile = File(...),
    session_id: Optional[str] = Form(None),
    session_token: Optional[str] = Form(None),
):
    identity = await _authorize_upload(request, session_id, session_token)
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename required")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_MIME_EXT:
        raise HTTPException(status_code=400, detail=f"File type .{ext} not allowed")
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:  # 25MB
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")
    content_type = ALLOWED_MIME_EXT[ext]
    file_id = str(uuid.uuid4())
    safe_identity = identity.replace(":", "_")
    path = f"{APP_NAME}/uploads/{safe_identity}/{file_id}.{ext}"
    result = put_object(path, data, content_type)
    record = {
        "id": file_id,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "uploaded_by": identity,
        "is_deleted": False,
        "created_at": now_iso(),
    }
    await db.files.insert_one(record)
    record.pop("_id", None)
    return {
        "id": file_id,
        "url": f"/api/files/{file_id}",
        "filename": file.filename,
        "content_type": content_type,
        "size": record["size"],
        "ext": ext,
    }


@api.get("/files/{file_id}")
async def download_file(
    file_id: str,
    request: Request,
    auth: Optional[str] = Query(None),
    session_token: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
):
    # Auth: prefer agent token; fallback to session_token
    authorized = False
    # Bearer / cookie / query auth token
    token = request.cookies.get("access_token")
    if not token:
        hdr = request.headers.get("Authorization", "")
        if hdr.startswith("Bearer "):
            token = hdr[7:]
    if not token and auth:
        token = auth
    if token:
        payload = decode_token(token)
        if payload and payload.get("type") == "access":
            authorized = True
    if not authorized and session_id and session_token:
        s = await db.sessions.find_one({"id": session_id})
        if s and s.get("session_token") == session_token:
            authorized = True
    if not authorized:
        raise HTTPException(status_code=401, detail="Not authorized")

    record = await db.files.find_one({"id": file_id, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    content, ct = get_object(record["storage_path"])
    return FastAPIResponse(
        content=content,
        media_type=record.get("content_type") or ct,
        headers={"Content-Disposition": f'inline; filename="{record["original_filename"]}"'},
    )


# ---------- AI (LLM) ----------
async def ai_suggest_replies(session_id: str) -> List[str]:
    """Generate 3 quick reply suggestions using Claude via Emergent LLM key."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.error(f"LLM lib import failed: {e}")
        return []
    # Get last N messages
    cur = db.messages.find({"session_id": session_id, "deleted": {"$ne": True}}).sort("created_at", -1).limit(10)
    msgs = []
    async for m in cur:
        msgs.append(m)
    msgs.reverse()
    if not msgs:
        return []
    transcript = "\n".join(
        f"{'Customer' if m.get('sender_type') == 'customer' else 'Agent'}: {m.get('content', '')}"
        for m in msgs
    )
    try:
        chat = LlmChat(
            api_key=EMERGENT_KEY,
            session_id=f"suggest-{session_id}",
            system_message=(
                "You are a helpful customer support assistant. Given a chat transcript, generate exactly 3 "
                "short reply suggestions (each under 20 words) that a support agent could send next. "
                "Return ONLY a JSON array of 3 strings, no other text. Example: [\"Thanks for reaching out!\", \"Let me look into that.\", \"Can you share more details?\"]"
            ),
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=f"Transcript:\n{transcript}\n\nGenerate 3 reply suggestions."))
        text = resp if isinstance(resp, str) else str(resp)
        # Extract JSON array
        import re
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            arr = json.loads(match.group(0))
            return [str(x) for x in arr[:3]]
    except Exception as e:
        logger.error(f"AI suggest failed: {e}")
    return []


async def ai_summarize(session_id: str) -> str:
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.error(f"LLM lib import failed: {e}")
        return ""
    cur = db.messages.find({"session_id": session_id, "deleted": {"$ne": True}}).sort("created_at", 1)
    msgs = []
    async for m in cur:
        msgs.append(m)
    if not msgs:
        return ""
    transcript = "\n".join(
        f"{'Customer' if m.get('sender_type') == 'customer' else 'Agent'}: {m.get('content', '')}"
        for m in msgs
    )
    try:
        chat = LlmChat(
            api_key=EMERGENT_KEY,
            session_id=f"summary-{session_id}",
            system_message="You are a helpful assistant that summarizes customer support chats in 2-3 concise sentences.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=f"Summarize this chat:\n{transcript}"))
        return resp if isinstance(resp, str) else str(resp)
    except Exception as e:
        logger.error(f"AI summarize failed: {e}")
        return ""


@api.post("/ai/suggest/{session_id}")
async def ai_suggest_endpoint(session_id: str, user: dict = Depends(get_current_user)):
    suggestions = await ai_suggest_replies(session_id)
    return {"suggestions": suggestions}


@api.post("/ai/summarize/{session_id}")
async def ai_summarize_endpoint(session_id: str, user: dict = Depends(get_current_user)):
    summary = await ai_summarize(session_id)
    return {"summary": summary}


# ---------- Admin ----------
@api.get("/admin/metrics")
async def admin_metrics(admin: dict = Depends(require_admin)):
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    total_today = await db.sessions.count_documents({"created_at": {"$gte": today_start}})
    open_count = await db.sessions.count_documents({"status": "open"})
    closed_today = await db.sessions.count_documents({"status": "closed", "created_at": {"$gte": today_start}})

    # Avg first response time (in seconds): time between session creation and first agent message
    pipeline_sessions = db.sessions.find({"created_at": {"$gte": today_start}})
    resp_times = []
    async for s in pipeline_sessions:
        first_agent_msg = await db.messages.find_one(
            {"session_id": s["id"], "sender_type": "agent"},
            sort=[("created_at", 1)]
        )
        if first_agent_msg:
            try:
                t0 = datetime.fromisoformat(s["created_at"])
                t1 = datetime.fromisoformat(first_agent_msg["created_at"])
                resp_times.append((t1 - t0).total_seconds())
            except Exception:
                pass
    avg_response = sum(resp_times) / len(resp_times) if resp_times else 0

    # CSAT
    csat_docs = await db.sessions.find({"csat_rating": {"$ne": None}}).to_list(1000)
    csat_avg = sum(s["csat_rating"] for s in csat_docs) / len(csat_docs) if csat_docs else 0

    agent_online = await db.users.count_documents({"status": "online", "role": {"$in": ["agent", "admin"]}})

    # Per-day chats last 7 days
    daily = []
    for i in range(6, -1, -1):
        day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=i)
        day_end = day + timedelta(days=1)
        cnt = await db.sessions.count_documents({
            "created_at": {"$gte": day.isoformat(), "$lt": day_end.isoformat()}
        })
        daily.append({"date": day.strftime("%a"), "count": cnt})

    return {
        "chats_today": total_today,
        "open_chats": open_count,
        "closed_today": closed_today,
        "avg_response_seconds": round(avg_response, 1),
        "csat_average": round(csat_avg, 2),
        "csat_count": len(csat_docs),
        "agents_online": agent_online,
        "daily_chats": daily,
    }


@api.get("/admin/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"id": "global"})
    if not s:
        s = {
            "id": "global",
            "widget_color": "#0057FF",
            "widget_accent": "#FFFFFF",
            "welcome_message": "Hi there! 👋 How can we help you today?",
            "business_hours_start": "09:00",
            "business_hours_end": "18:00",
            "business_days": [0, 1, 2, 3, 4],
        }
    s.pop("_id", None)
    return s


@api.get("/public/settings")
async def public_settings():
    s = await db.settings.find_one({"id": "global"})
    if not s:
        s = {
            "widget_color": "#0057FF",
            "widget_accent": "#FFFFFF",
            "welcome_message": "Hi there! 👋 How can we help you today?",
            "business_hours_start": "09:00",
            "business_hours_end": "18:00",
            "business_days": [0, 1, 2, 3, 4],
        }
    s.pop("_id", None)
    s.pop("id", None)
    return s


@api.patch("/admin/settings")
async def update_settings(body: SettingsBody, admin: dict = Depends(require_admin)):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    update["updated_at"] = now_iso()
    await db.settings.update_one({"id": "global"}, {"$set": update}, upsert=True)
    s = await db.settings.find_one({"id": "global"})
    s.pop("_id", None)
    return s


# ---------- WebSockets ----------
async def _save_message(session_id: str, sender_type: str, sender_id: str, sender_name: str,
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


@app.websocket("/api/ws/agent")
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
    # Mark online
    await db.users.update_one({"id": agent_id}, {"$set": {"status": "online"}})
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
                # Auto-assign agent to session if unassigned
                await db.sessions.update_one(
                    {"id": session_id, "assigned_agent_id": None},
                    {"$set": {"assigned_agent_id": agent_id}}
                )
                msg = await _save_message(session_id, "agent", agent_id, agent_name, content, attachments)
                await manager.broadcast_to_session(session_id, {"type": "message", "message": msg})
            elif t == "typing":
                session_id = data.get("session_id")
                is_typing = bool(data.get("is_typing"))
                await manager.send_to_customer(session_id, {
                    "type": "typing", "sender_type": "agent", "is_typing": is_typing, "name": agent_name
                })
            elif t == "read":
                session_id = data.get("session_id")
                # Mark all customer messages as read
                await db.messages.update_many(
                    {"session_id": session_id, "sender_type": "customer", "status": {"$ne": "read"}},
                    {"$set": {"status": "read"}}
                )
                await manager.send_to_customer(session_id, {"type": "read_receipt", "session_id": session_id})
            elif t == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Agent WS error: {e}")
    finally:
        manager.disconnect_agent(agent_id, websocket)
        # If no more sockets for agent, mark offline
        if agent_id not in manager.agent_conns:
            await db.users.update_one({"id": agent_id}, {"$set": {"status": "offline"}})
            await manager.send_to_agents({"type": "agent_status", "agent_id": agent_id, "status": "offline"})


@app.websocket("/api/ws/customer")
async def ws_customer(websocket: WebSocket, session_id: str = Query(...), session_token: str = Query(...)):
    s = await db.sessions.find_one({"id": session_id})
    if not s or s.get("session_token") != session_token:
        await websocket.close(code=1008)
        return
    customer_name = s.get("customer_name", "Customer")
    await manager.connect_customer(session_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            t = data.get("type")
            if t == "message":
                content = data.get("content", "")
                attachments = data.get("attachments") or []
                if not content.strip() and not attachments:
                    continue
                msg = await _save_message(session_id, "customer", session_id, customer_name, content, attachments)
                await manager.broadcast_to_session(session_id, {"type": "message", "message": msg})
            elif t == "typing":
                is_typing = bool(data.get("is_typing"))
                await manager.send_to_agents({
                    "type": "typing", "session_id": session_id, "sender_type": "customer",
                    "is_typing": is_typing, "name": customer_name
                })
            elif t == "read":
                await db.messages.update_many(
                    {"session_id": session_id, "sender_type": "agent", "status": {"$ne": "read"}},
                    {"$set": {"status": "read"}}
                )
                await manager.send_to_agents({"type": "read_receipt", "session_id": session_id})
            elif t == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Customer WS error: {e}")
    finally:
        manager.disconnect_customer(session_id, websocket)


# ---------- Startup ----------
@app.on_event("startup")
async def startup_event():
    # Indexes
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        await db.sessions.create_index("id", unique=True)
        await db.sessions.create_index("customer_email")
        await db.sessions.create_index("last_message_at")
        await db.messages.create_index("session_id")
        await db.messages.create_index("id", unique=True)
        await db.files.create_index("id", unique=True)
        await db.quick_replies.create_index("id", unique=True)
    except Exception as e:
        logger.warning(f"Index creation warning: {e}")

    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@livechat.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "status": "offline",
            "created_at": now_iso(),
        })
        logger.info(f"Seeded admin user: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}}
        )
        logger.info(f"Reset admin password: {admin_email}")

    # Seed sample agent
    agent_email = "agent@livechat.com"
    if not await db.users.find_one({"email": agent_email}):
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": agent_email,
            "password_hash": hash_password("agent123"),
            "name": "Sarah Agent",
            "role": "agent",
            "status": "offline",
            "created_at": now_iso(),
        })

    # Seed default quick replies if empty
    if await db.quick_replies.count_documents({}) == 0:
        defaults = [
            {"title": "Greeting", "content": "Hi there! Thanks for reaching out. How can I help you today?"},
            {"title": "Investigating", "content": "Let me look into this for you. One moment please."},
            {"title": "Refund policy", "content": "Our refund policy allows returns within 30 days of purchase. Would you like me to start the process?"},
            {"title": "Thanks", "content": "Thanks for your patience! Is there anything else I can help with?"},
            {"title": "Closing", "content": "Glad I could help! Feel free to reach out anytime. Have a great day!"},
        ]
        for d in defaults:
            await db.quick_replies.insert_one({
                "id": str(uuid.uuid4()), **d,
                "created_by": "system", "created_at": now_iso()
            })

    # Seed default settings
    if not await db.settings.find_one({"id": "global"}):
        await db.settings.insert_one({
            "id": "global",
            "widget_color": "#0057FF",
            "widget_accent": "#FFFFFF",
            "welcome_message": "Hi there! 👋 How can we help you today?",
            "business_hours_start": "09:00",
            "business_hours_end": "18:00",
            "business_days": [0, 1, 2, 3, 4],
            "created_at": now_iso(),
        })

    # Init object storage
    init_storage()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


@api.get("/")
async def root():
    return {"service": "livechat", "status": "ok"}


app.include_router(api)
