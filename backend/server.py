"""Thin FastAPI entrypoint.

All business logic lives in submodules:
- config      env, constants, Mongo client
- utils       jwt, password, time
- models      Pydantic request bodies
- deps        auth dependencies
- ws_manager  ConnectionManager singleton
- services    domain functions used across routers
- storage     Emergent object storage helpers
- llm         AI (Claude) helpers
- routers/*   FastAPI routers (auth, agents, chat, quick_replies, admin, files, ws)
"""
import asyncio
import logging
import uuid

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from config import ADMIN_EMAIL, ADMIN_PASSWORD, client, db
from routers import admin as admin_router
from routers import agents as agents_router
from routers import auth as auth_router
from routers import chat as chat_router
from routers import files as files_router
from routers import lily as lily_router
from routers import quick_replies as qr_router
from routers import ws as ws_router
from scheduler import scheduler_loop
from storage import init_storage
from utils import hash_password, now_iso, verify_password

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("livechat")

app = FastAPI(title="Pulse Live Chat")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")
api.include_router(auth_router.router)
api.include_router(agents_router.router)
api.include_router(chat_router.router)
api.include_router(chat_router.ai_router)
api.include_router(qr_router.router)
api.include_router(admin_router.router)
api.include_router(files_router.router)
api.include_router(ws_router.router)
api.include_router(lily_router.router)


@api.get("/")
async def root():
    return {"service": "livechat", "status": "ok"}


app.include_router(api)


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
    admin_email = ADMIN_EMAIL.lower()
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(ADMIN_PASSWORD),
            "name": "Admin",
            "role": "admin",
            "status": "offline",
            "created_at": now_iso(),
        })
        logger.info(f"Seeded admin user: {admin_email}")
    elif not verify_password(ADMIN_PASSWORD, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(ADMIN_PASSWORD)}},
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
                "created_by": "system", "created_at": now_iso(),
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

    init_storage()

    # Kick off background inactivity scheduler
    asyncio.create_task(scheduler_loop(interval_seconds=60))


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
