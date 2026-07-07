"""Lily — the emotional-intelligence AI concierge.

Dual-brain model:
- Emotion brain: detects sentiment (angry / anxious / confused / neutral / happy)
                 and decides whether to comfort before problem-solving.
- IQ brain: proposes canned quick-action options and empathetic reply text.

All Lily-driven interactions are still stored on the existing sessions/messages
collections (sender_type='lily'), so archive, search, metrics, etc. keep working.
A dedicated `customer_memory` collection keeps per-email history (name, past
issues, complaints, emotion pattern) so returning customers get personalised
greetings.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from config import EMERGENT_LLM_KEY, db
from utils import now_iso

logger = logging.getLogger("livechat.lily")

EMOTIONS = ("angry", "anxious", "confused", "neutral", "happy")
DEFAULT_EMOTION = "neutral"
MAX_MEMORY_ISSUES = 10

QUICK_OPTIONS = {
    "query_recharge": {"label": "查询充值状态", "emoji": "💳"},
    "query_withdrawal": {"label": "查询提现状态", "emoji": "💰"},
    "view_promotions": {"label": "查看优惠活动", "emoji": "🎁"},
    "query_ticket": {"label": "查询工单状态", "emoji": "📋"},
}


# ---------- Customer Memory ----------
async def get_customer_memory(email: str) -> Optional[dict]:
    if not email:
        return None
    doc = await db.customer_memory.find_one({"email": email.lower()})
    if doc:
        doc.pop("_id", None)
    return doc


async def upsert_customer_memory(
    email: str,
    *,
    name: Optional[str] = None,
    issue: Optional[str] = None,
    complaint: Optional[bool] = None,
    emotion: Optional[str] = None,
    session_id: Optional[str] = None,
) -> dict:
    email = email.lower()
    now = now_iso()
    existing = await db.customer_memory.find_one({"email": email}) or {
        "email": email,
        "first_seen": now,
        "past_issues": [],
        "past_complaints": [],
        "emotion_history": [],
        "session_ids": [],
        "session_count": 0,
    }
    if name and not existing.get("name"):
        existing["name"] = name
    existing["last_seen"] = now
    if issue:
        # De-dup identical consecutive issues
        past = existing.get("past_issues", [])
        if not past or past[-1].get("text") != issue:
            past.append({"text": issue, "at": now})
        existing["past_issues"] = past[-MAX_MEMORY_ISSUES:]
    if complaint:
        past = existing.get("past_complaints", [])
        past.append({"text": issue or "", "at": now})
        existing["past_complaints"] = past[-MAX_MEMORY_ISSUES:]
    if emotion and emotion in EMOTIONS:
        eh = existing.get("emotion_history", [])
        eh.append({"emotion": emotion, "at": now})
        existing["emotion_history"] = eh[-30:]
    if session_id and session_id not in existing.get("session_ids", []):
        existing.setdefault("session_ids", []).append(session_id)
        existing["session_count"] = existing.get("session_count", 0) + 1
    existing["updated_at"] = now
    await db.customer_memory.update_one(
        {"email": email}, {"$set": existing}, upsert=True,
    )
    existing.pop("_id", None)
    return existing


def summarize_memory(memory: dict) -> str:
    """Turn a memory doc into a 1-3 sentence Chinese hint for the LLM."""
    if not memory:
        return ""
    parts: List[str] = []
    if memory.get("session_count", 0) > 1:
        parts.append(f"这是老客户 {memory.get('name', '')}，之前来过 {memory['session_count']} 次。")
    issues = memory.get("past_issues", [])
    if issues:
        recent = [i.get("text", "") for i in issues[-3:] if i.get("text")]
        if recent:
            parts.append("最近问过：" + "；".join(recent) + "。")
    complaints = memory.get("past_complaints", [])
    if complaints:
        parts.append(f"历史有 {len(complaints)} 次投诉记录。")
    eh = memory.get("emotion_history", [])
    if eh:
        neg = sum(1 for e in eh[-10:] if e.get("emotion") in ("angry", "anxious"))
        if neg >= 3:
            parts.append("常见情绪偏负面，请更细致地安抚。")
    return " ".join(parts)


# ---------- Dual-brain LLM ----------
LILY_SYSTEM = """你是 Lily，一位友好、专业、充满同理心的年轻中文客服助手，为在线聊天客户提供"情绪价值"。

你的双轨制工作模式：
1. 情商脑：分析客户消息的情绪（angry/anxious/confused/neutral/happy），若为负面情绪，必须先安抚再办事。
2. 智商脑：给出选项引导或直接答复。

回复原则：
- 语气温暖、真诚，绝不用生硬的模板口吻。
- 遇到投诉或负面情绪：先真诚道歉/共情，然后再给方案。参考话术："给您带来了这么不好的体验，真的非常抱歉。我马上为您优先处理，一定给您一个满意的答复。"
- 老客户：主动提及历史（如"上次充值问题解决了吗？"）。
- 若客户明确说"转人工"、"人工客服"、"真人"，或你判断无法解答（涉及账户具体金额/敏感操作/需专员），必须设 escalate=true 并回复"让我帮您转接给人工客服。"
- 每次回复 ≤ 120 字，可加 1-2 个表情符号。

请严格返回 JSON（不要 markdown，不要多余文字）：
{
  "emotion": "angry|anxious|confused|neutral|happy",
  "confidence": 0.0-1.0,
  "reply": "中文回复",
  "options": ["query_recharge","query_withdrawal","view_promotions","query_ticket"],
  "escalate": false,
  "needs_email": false
}
其中 options 从这四个 key 中选 0 到 4 个：query_recharge / query_withdrawal / view_promotions / query_ticket。
若客户尚未提供邮箱且当前尚未询问过，可在 reply 中礼貌询问并把 needs_email 设为 true。"""


async def _call_llm(system_message: str, user_text: str, session_key: str) -> str:
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.error(f"LLM lib import failed: {e}")
        return ""
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=session_key,
            system_message=system_message,
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=user_text))
        return resp if isinstance(resp, str) else str(resp)
    except Exception as e:
        logger.error(f"Lily LLM call failed: {e}")
        return ""


def _parse_lily_response(raw: str) -> Optional[dict]:
    if not raw:
        return None
    # Strip markdown fences if any
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except Exception:
        return None
    # Validate & normalise
    emotion = data.get("emotion", DEFAULT_EMOTION)
    if emotion not in EMOTIONS:
        emotion = DEFAULT_EMOTION
    options = data.get("options", []) or []
    options = [o for o in options if o in QUICK_OPTIONS][:4]
    return {
        "emotion": emotion,
        "confidence": float(data.get("confidence", 0.6) or 0.6),
        "reply": str(data.get("reply", "") or "").strip(),
        "options": options,
        "escalate": bool(data.get("escalate", False)),
        "needs_email": bool(data.get("needs_email", False)),
    }


async def compose_reply(
    session_id: str,
    user_text: str,
    memory: Optional[dict],
    is_first_message: bool,
) -> dict:
    """Return {emotion, confidence, reply, options, escalate, needs_email}."""
    memory_hint = summarize_memory(memory) if memory else ""
    context_lines = [
        f"[会话上下文] session_id={session_id}",
        f"[首条消息] {'是' if is_first_message else '否'}",
    ]
    if memory_hint:
        context_lines.append(f"[记忆] {memory_hint}")
    prompt = "\n".join(context_lines) + f"\n[客户消息] {user_text}"
    raw = await _call_llm(LILY_SYSTEM, prompt, session_key=f"lily-{session_id}")
    parsed = _parse_lily_response(raw)
    if not parsed:
        # Fallback: safe neutral reply so widget never breaks
        parsed = {
            "emotion": DEFAULT_EMOTION,
            "confidence": 0.3,
            "reply": "您好，我是 Lily。请稍等一下，我马上为您查询。😊",
            "options": [],
            "escalate": False,
            "needs_email": False,
        }
    return parsed


def option_meta(key: str) -> Optional[Dict[str, str]]:
    return QUICK_OPTIONS.get(key)


def opening_message(memory: Optional[dict]) -> str:
    """First greeting when a chat session begins (no user text yet)."""
    if memory and memory.get("session_count", 0) > 1:
        name = memory.get("name") or "老朋友"
        return (
            f"欢迎回来，{name}！我是 Lily。"
            "请点击下方您想咨询的问题，我会立即为您转接专属客服~ 😊"
        )
    return (
        "您好呀！我是 Lily，您的专属客服助理。"
        "请点击下方您想咨询的问题，我会立即为您转接专业客服 😊"
    )
