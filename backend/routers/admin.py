from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends

from config import db
from deps import get_current_user, require_admin
from models import SettingsBody
from utils import now_iso

router = APIRouter(tags=["admin"])
_admin = APIRouter(prefix="/admin")
_public = APIRouter(prefix="/public")


@_admin.get("/metrics")
async def admin_metrics(admin: dict = Depends(require_admin)):
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    total_today = await db.sessions.count_documents({"created_at": {"$gte": today_start}})
    open_count = await db.sessions.count_documents({"status": "open"})
    closed_today = await db.sessions.count_documents({"status": "closed", "created_at": {"$gte": today_start}})

    resp_times = []
    async for s in db.sessions.find({"created_at": {"$gte": today_start}}):
        first_agent_msg = await db.messages.find_one(
            {"session_id": s["id"], "sender_type": "agent"},
            sort=[("created_at", 1)],
        )
        if first_agent_msg:
            try:
                t0 = datetime.fromisoformat(s["created_at"])
                t1 = datetime.fromisoformat(first_agent_msg["created_at"])
                resp_times.append((t1 - t0).total_seconds())
            except Exception:
                pass
    avg_response = sum(resp_times) / len(resp_times) if resp_times else 0

    csat_docs = await db.sessions.find({"csat_rating": {"$ne": None}}).to_list(1000)
    csat_avg = sum(s["csat_rating"] for s in csat_docs) / len(csat_docs) if csat_docs else 0

    agent_online = await db.users.count_documents({"status": "online", "role": {"$in": ["agent", "admin"]}})

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


DEFAULT_SETTINGS = {
    "id": "global",
    "widget_color": "#0057FF",
    "widget_accent": "#FFFFFF",
    "welcome_message": "Hi there! 👋 How can we help you today?",
    "business_hours_start": "09:00",
    "business_hours_end": "18:00",
    "business_days": [0, 1, 2, 3, 4],
    "lily_enabled": True,
}


@_admin.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"id": "global"})
    if not s:
        s = dict(DEFAULT_SETTINGS)
    s.pop("_id", None)
    return s


@_public.get("/settings")
async def public_settings():
    s = await db.settings.find_one({"id": "global"})
    if not s:
        s = dict(DEFAULT_SETTINGS)
    s.pop("_id", None)
    s.pop("id", None)
    return s


@_admin.patch("/settings")
async def update_settings(body: SettingsBody, admin: dict = Depends(require_admin)):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    update["updated_at"] = now_iso()
    await db.settings.update_one({"id": "global"}, {"$set": update}, upsert=True)
    s = await db.settings.find_one({"id": "global"})
    s.pop("_id", None)
    return s


router.include_router(_admin)
router.include_router(_public)
