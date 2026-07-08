"""Iteration 12: LiveChat-style scroll-back — GET /api/chat/threads/{session_id}.

Coverage:
- auth guard (401/403 without token)
- 404 on non-existent session_id
- returns [{session, messages}] chronological (oldest→newest); anchor is last
- 2 anon sessions with same client_id both appear; last item is the anchor
- soft-deleted messages excluded
- real customer_email links sessions by email (not client_id)
- Regression: /api/chat/public/{sid}/close still works
"""
import os
import uuid
import time
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

_client = MongoClient(MONGO_URL)
_db = _client[DB_NAME]


@pytest.fixture(scope="module")
def agent_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "agent@livechat.com", "password": "agent123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(agent_token):
    return {"Authorization": f"Bearer {agent_token}"}


@pytest.fixture(autouse=True)
def _purge():
    _db.sessions.delete_many({"customer_email": {"$regex": "^iter12_"}})
    _db.sessions.delete_many({"client_id": {"$regex": "^iter12_"}})
    _db.messages.delete_many({"content": {"$regex": "^ITER12_"}})
    yield


def _mk_anon(client_id):
    r = requests.post(f"{API}/chat/session/anonymous",
                      json={"client_id": client_id, "page": "/", "location": "test"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Auth guard ----------
def test_threads_requires_auth():
    r = requests.get(f"{API}/chat/threads/nonexistent-sid", timeout=15)
    assert r.status_code in (401, 403), r.text


# ---------- 404 for non-existent session ----------
def test_threads_404_for_unknown_session(auth_headers):
    r = requests.get(f"{API}/chat/threads/does-not-exist-{uuid.uuid4()}",
                     headers=auth_headers, timeout=15)
    assert r.status_code == 404


# ---------- Two anon sessions same client_id ----------
def test_threads_returns_both_anon_sessions_by_client_id(auth_headers):
    cid = f"iter12_{uuid.uuid4().hex[:8]}"
    s1 = _mk_anon(cid)
    time.sleep(0.05)
    s2 = _mk_anon(cid)

    # Anchor: s2 (the "current" session)
    r = requests.get(f"{API}/chat/threads/{s2['session_id']}",
                     headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    ids = [t["session"]["id"] for t in data]
    assert s1["session_id"] in ids and s2["session_id"] in ids, f"Both sessions expected: {ids}"

    # Chronological: oldest first, anchor last
    assert ids[-1] == s2["session_id"], f"Anchor must be last: {ids}"
    assert ids[0] == s1["session_id"], f"Oldest must be first: {ids}"

    # Structure
    for t in data:
        assert "session" in t and "messages" in t
        assert isinstance(t["messages"], list)


# ---------- Soft-deleted messages excluded ----------
def test_threads_excludes_soft_deleted_messages(auth_headers):
    cid = f"iter12_{uuid.uuid4().hex[:8]}"
    s = _mk_anon(cid)
    sid = s["session_id"]

    # Insert 2 messages directly, one soft-deleted
    _db.messages.insert_many([
        {"id": str(uuid.uuid4()), "session_id": sid, "sender_type": "customer",
         "sender_name": "Guest", "content": "ITER12_visible",
         "created_at": "2026-01-01T10:00:00+00:00"},
        {"id": str(uuid.uuid4()), "session_id": sid, "sender_type": "customer",
         "sender_name": "Guest", "content": "ITER12_deleted",
         "created_at": "2026-01-01T10:01:00+00:00", "deleted": True},
    ])

    r = requests.get(f"{API}/chat/threads/{sid}", headers=auth_headers, timeout=15)
    assert r.status_code == 200
    data = r.json()
    all_msgs = [m for t in data for m in t["messages"]]
    contents = [m.get("content") for m in all_msgs]
    assert "ITER12_visible" in contents
    assert "ITER12_deleted" not in contents


# ---------- Real email linkage (no client_id) ----------
def test_threads_links_by_customer_email_when_no_client_id(auth_headers):
    email = f"iter12_{uuid.uuid4().hex[:8]}@example.com"

    def _mk_pre():
        body = {"name": "Test", "email": email, "subject": "hi",
                "page": "/", "location": "test"}
        r = requests.post(f"{API}/chat/session", json=body, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    a = _mk_pre()
    time.sleep(0.05)
    b = _mk_pre()

    r = requests.get(f"{API}/chat/threads/{b['session_id']}",
                     headers=auth_headers, timeout=15)
    assert r.status_code == 200
    data = r.json()
    ids = [t["session"]["id"] for t in data]
    assert a["session_id"] in ids and b["session_id"] in ids
    assert ids[-1] == b["session_id"], "Anchor last"


# ---------- Regression: public customer close ----------
def test_regression_public_close(auth_headers):
    cid = f"iter12_{uuid.uuid4().hex[:8]}"
    s = _mk_anon(cid)
    r = requests.post(f"{API}/chat/public/{s['session_id']}/close",
                      params={"session_token": s["session_token"]}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True

    # Verify status is closed via threads
    r = requests.get(f"{API}/chat/threads/{s['session_id']}",
                     headers=auth_headers, timeout=15)
    assert r.status_code == 200
    ses = r.json()[-1]["session"]
    assert ses["status"] == "closed"
    assert ses.get("closed_reason") == "customer_closed"
