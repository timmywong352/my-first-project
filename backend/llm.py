import json
import logging
import re
from typing import List

from config import db, EMERGENT_LLM_KEY

logger = logging.getLogger("livechat.llm")


async def _transcript(session_id: str, limit: int = 10, order: int = -1) -> str:
    cur = db.messages.find({"session_id": session_id, "deleted": {"$ne": True}}).sort("created_at", order).limit(limit)
    msgs = []
    async for m in cur:
        msgs.append(m)
    if order == -1:
        msgs.reverse()
    return "\n".join(
        f"{'Customer' if m.get('sender_type') == 'customer' else 'Agent'}: {m.get('content', '')}"
        for m in msgs
    )


async def ai_suggest_replies(session_id: str) -> List[str]:
    """Generate 3 quick reply suggestions using Claude via Emergent LLM key."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.error(f"LLM lib import failed: {e}")
        return []
    transcript = await _transcript(session_id, limit=10, order=-1)
    if not transcript:
        return []
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"suggest-{session_id}",
            system_message=(
                "You are a helpful customer support assistant. Given a chat transcript, generate exactly 3 "
                "short reply suggestions (each under 20 words) that a support agent could send next. "
                "Return ONLY a JSON array of 3 strings, no other text. "
                "Example: [\"Thanks for reaching out!\", \"Let me look into that.\", \"Can you share more details?\"]"
            ),
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=f"Transcript:\n{transcript}\n\nGenerate 3 reply suggestions."))
        text = resp if isinstance(resp, str) else str(resp)
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
    transcript = await _transcript(session_id, limit=500, order=1)
    if not transcript:
        return ""
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"summary-{session_id}",
            system_message="You are a helpful assistant that summarizes customer support chats in 2-3 concise sentences.",
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=f"Summarize this chat:\n{transcript}"))
        return resp if isinstance(resp, str) else str(resp)
    except Exception as e:
        logger.error(f"AI summarize failed: {e}")
        return ""
