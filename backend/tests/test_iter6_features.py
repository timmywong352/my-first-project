"""Iteration 6: queue, rate-limit, refresh, inactivity scheduler, least-busy routing."""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests

# Allow importing backend modules for direct DB / scheduler calls
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"


# ---- helpers ----
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@livechat.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def agent_token():
    r = requests.post(f"{API}/auth/login", json={"email": "agent@livechat.com", "password": "agent123"})
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["user"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- REFRESH ----------
class TestRefresh:
    def test_refresh_with_valid_token_returns_new_token(self):
        tok = admin_token()
        r = requests.post(f"{API}/auth/refresh", headers=_hdr(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and isinstance(body["token"], str) and len(body["token"]) > 20
        assert body["user"]["email"] == "admin@livechat.com"

    def test_refresh_without_token_returns_401(self):
        # Use a fresh session to avoid picking up cookies
        r = requests.post(f"{API}/auth/refresh")
        assert r.status_code == 401

    def test_refresh_with_invalid_signature_returns_401(self):
        # Tamper the last char of the signature
        tok = admin_token()
        bad = tok[:-2] + ("aa" if tok[-2:] != "aa" else "bb")
        r = requests.post(f"{API}/auth/refresh", headers=_hdr(bad))
        assert r.status_code == 401


# ---------- RATE LIMIT ----------
class TestRateLimit:
    def test_6th_session_from_same_ip_returns_429(self):
        # Purge sessions for the client IP the test server will observe (127.0.0.1).
        _run(_purge_by_ip("127.0.0.1"))
        codes = []
        for i in range(6):
            p = {"name": "RL", "email": f"TEST_rl_{uuid.uuid4().hex[:6]}@e.com", "subject": "rl"}
            r = requests.post(f"{API}/chat/session", json=p)
            codes.append(r.status_code)
        assert codes[-1] == 429, f"Expected last to be 429, got {codes}"
        assert sum(1 for c in codes[:5] if c == 200) >= 4, codes
        _run(_purge_by_ip("127.0.0.1"))


# ---------- QUEUE + LEAST-BUSY ----------
class TestQueueAndRouting:
    def test_queue_when_no_agent_online_and_least_busy_when_agents_available(self):
        # Set up: exactly one agent online, and ensure they're at cap so queue triggers
        agent_tok, agent_user = agent_token()
        aid = agent_user["id"]
        # Mark agent online
        _run(_db_call(lambda db: db.users.update_one({"id": aid}, {"$set": {"status": "online", "auto_busy": False}})))
        # Also ensure admin (which is also an "agent" role match) is offline for a clean test
        _run(_db_call(lambda db: db.users.update_one({"email": "admin@livechat.com"}, {"$set": {"status": "offline"}})))

        # Push agent to cap = 20 open sessions
        MAX = 20
        session_ids = _run(_bulk_open_sessions(aid, MAX))
        try:
            # 21st via direct insert (bypass rate-limit) — should go to queue
            queued_id = _run(_create_session_via_route(email=f"TEST_q_{uuid.uuid4().hex[:6]}@e.com"))
            queued = _run(_db_get_session(queued_id))
            assert queued["status"] == "queued", queued
            assert queued["queue_position"] == 1

            # Least-busy: bring up a second agent with fewer active chats.
            # Create a TEST_ agent user directly.
            other_agent_id = _run(_create_test_agent("TEST_a2"))
            _run(_db_call(lambda db: db.users.update_one({"id": other_agent_id}, {"$set": {"status": "online", "auto_busy": False}})))
            # Give other_agent 3 open sessions (they should still be least-busy vs 20 primary agent)
            _run(_bulk_open_sessions(other_agent_id, 3))

            # A new session via routing should be assigned to other_agent (3 chats) not primary (20)
            new_id = _run(_create_session_via_route(email=f"TEST_lb_{uuid.uuid4().hex[:6]}@e.com"))
            got = _run(_db_get_session(new_id))
            assert got["status"] == "open"
            assert got["assigned_agent_id"] == other_agent_id, got

            # Auto-promote: close one of primary agent's OPEN sessions, queue #1 should be promoted
            # Close via API using admin token
            adm = admin_token()
            # Pick any open session belonging to primary agent
            to_close = session_ids[0]
            rr = requests.post(f"{API}/chat/sessions/{to_close}/close", headers=_hdr(adm))
            assert rr.status_code == 200, rr.text
            # give server a moment
            import time; time.sleep(1)
            after = _run(_db_get_session(queued_id))
            assert after["status"] == "open", after
            assert after.get("assigned_agent_id") in (aid, other_agent_id)

            # GET /api/chat/sessions should surface queue_position/status
            rr = requests.get(f"{API}/chat/sessions", headers=_hdr(adm))
            assert rr.status_code == 200
            # No assertion on specific position now (was promoted), just structure check
            fields = rr.json()[0].keys() if rr.json() else set()
            assert "status" in fields
        finally:
            _run(_cleanup_agent(other_agent_id))
            _run(_cleanup_sessions_prefix("TEST_"))


# ---------- INACTIVITY SCHEDULER ----------
class TestInactivityScheduler:
    def test_settings_patch_and_scheduler_tick_sends_auto_message_and_closes(self):
        adm = admin_token()
        # Patch settings
        r = requests.patch(f"{API}/admin/settings", headers=_hdr(adm), json={
            "inactivity_first_response_minutes": 1,
            "inactivity_auto_transfer": False,
            "inactivity_auto_message": "TEST_nudge_msg",
            "inactivity_close_minutes": 2,
        })
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["inactivity_auto_message"] == "TEST_nudge_msg"
        assert s["inactivity_close_minutes"] == 2

        # Create session, then manipulate created_at to 90s in past so first_response fires
        sid = _run(_create_session_via_route(email=f"TEST_inact_{uuid.uuid4().hex[:6]}@e.com"))
        old_created = (datetime.now(timezone.utc) - timedelta(seconds=90)).isoformat()
        _run(_db_call(lambda db: db.sessions.update_one(
            {"id": sid},
            {"$set": {"created_at": old_created, "last_message_at": old_created, "auto_msg_sent": False, "status": "open"}}
        )))
        # Invoke scheduler tick directly
        from scheduler import _tick
        _run(_tick())
        sess = _run(_db_get_session(sid))
        assert sess.get("auto_msg_sent") is True, sess
        msgs = _run(_db_get_messages(sid))
        assert any(m.get("content") == "TEST_nudge_msg" and m.get("sender_type") == "system" for m in msgs), msgs

        # Now push last_message_at back 3 min to trigger auto-close (close_min=2)
        old_last = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
        _run(_db_call(lambda db: db.sessions.update_one({"id": sid}, {"$set": {"last_message_at": old_last}})))
        _run(_tick())
        sess = _run(_db_get_session(sid))
        assert sess["status"] == "closed"
        assert sess.get("closed_reason") == "inactivity"

        # Cleanup
        _run(_cleanup_sessions_prefix("TEST_"))


# ---------------- DB HELPERS ----------------
_LOOP = None
def _run(coro):
    global _LOOP
    if _LOOP is None or _LOOP.is_closed():
        _LOOP = asyncio.new_event_loop()
        asyncio.set_event_loop(_LOOP)
    return _LOOP.run_until_complete(coro)


async def _db_call(fn):
    from config import db
    res = fn(db)
    if asyncio.iscoroutine(res):
        return await res
    return await res if hasattr(res, "__await__") else res


async def _db_get_session(sid):
    from config import db
    s = await db.sessions.find_one({"id": sid})
    if s:
        s.pop("_id", None)
    return s


async def _db_get_messages(sid):
    from config import db
    out = []
    async for m in db.messages.find({"session_id": sid}):
        m.pop("_id", None)
        out.append(m)
    return out


async def _bulk_open_sessions(agent_id, n):
    from config import db
    from utils import now_iso
    ids = []
    for i in range(n):
        sid = str(uuid.uuid4())
        doc = {
            "id": sid,
            "session_token": str(uuid.uuid4()),
            "customer_name": f"TEST_bulk_{i}",
            "customer_email": f"TEST_bulk_{uuid.uuid4().hex[:6]}@e.com",
            "subject": "bulk",
            "page": "",
            "location": "",
            "creator_ip": "10.0.0.99",  # bypass real IP rate-limit path
            "assigned_agent_id": agent_id,
            "status": "open",
            "queue_position": None,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "last_message_at": now_iso(),
            "csat_rating": None,
            "summary": None,
            "auto_msg_sent": False,
        }
        await db.sessions.insert_one(doc)
        ids.append(sid)
    return ids


async def _create_session_via_route(email):
    """Directly call route_new_session + insert to bypass HTTP rate-limit."""
    from config import db
    from services import route_new_session
    from utils import now_iso
    sid = str(uuid.uuid4())
    doc = {
        "id": sid,
        "session_token": str(uuid.uuid4()),
        "customer_name": "TEST_r",
        "customer_email": email,
        "subject": "r",
        "page": "",
        "location": "",
        "creator_ip": f"10.0.0.{uuid.uuid4().int % 250}",
        "assigned_agent_id": None,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "last_message_at": now_iso(),
        "csat_rating": None,
        "summary": None,
        "auto_msg_sent": False,
    }
    await route_new_session(doc)
    doc.pop("_assigned_agent", None)
    await db.sessions.insert_one(doc)
    return sid


async def _create_test_agent(prefix):
    from config import db
    from utils import now_iso, hash_password
    uid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": uid,
        "email": f"{prefix}_{uuid.uuid4().hex[:6]}@test.com",
        "name": f"{prefix}",
        "password_hash": hash_password("pw"),
        "role": "agent",
        "status": "offline",
        "auto_busy": False,
        "created_at": now_iso(),
    })
    return uid


async def _cleanup_agent(uid):
    from config import db
    await db.users.delete_one({"id": uid})
    await db.sessions.delete_many({"assigned_agent_id": uid})


async def _cleanup_sessions_prefix(prefix):
    from config import db
    await db.sessions.delete_many({"customer_email": {"$regex": f"^{prefix}", "$options": "i"}})
    await db.messages.delete_many({"content": "TEST_nudge_msg"})


async def _purge_by_ip(ip):
    from config import db
    q = {"creator_ip": ip} if ip else {"customer_email": {"$regex": "^TEST_", "$options": "i"}}
    await db.sessions.delete_many(q)
    return True
