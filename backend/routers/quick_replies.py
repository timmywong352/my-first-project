import uuid
from fastapi import APIRouter, Depends

from config import db
from deps import get_current_user
from models import QuickReplyBody
from utils import now_iso

router = APIRouter(prefix="/quick-replies", tags=["quick_replies"])


@router.get("")
async def list_quick_replies(user: dict = Depends(get_current_user)):
    cur = db.quick_replies.find().sort("created_at", -1)
    out = []
    async for q in cur:
        q.pop("_id", None)
        out.append(q)
    return out


@router.post("")
async def create_quick_reply(body: QuickReplyBody, user: dict = Depends(get_current_user)):
    q = {
        "id": str(uuid.uuid4()),
        "title": body.title,
        "content": body.content,
        "created_by": user["id"],
        "created_at": now_iso(),
    }
    await db.quick_replies.insert_one(q)
    q.pop("_id", None)
    return q


@router.delete("/{qid}")
async def delete_quick_reply(qid: str, user: dict = Depends(get_current_user)):
    await db.quick_replies.delete_one({"id": qid})
    return {"ok": True}
