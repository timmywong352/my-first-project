"""Iter16 sprint bundle backend tests.

Covers:
  F-C: Pending flow (happy path, timeout+reassignment, only-offered-agent
       may accept).
  F-A: Attachment audit trail on delete + on edit.
"""
import io
import os
import time
import uuid
import pytest
import requests
from pymongo import MongoClient

def _read_env(path, key):
    try:
        for ln in open(path):
            if ln.strip().startswith(key + "="):
                return ln.strip().split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or _read_env("/app/frontend/.env", "REACT_APP_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = (os.environ.get("MONGO_URL")
             or _read_env("/app/backend/.env", "MONGO_URL") or "mongodb://localhost:27017")
DB_NAME = (os.environ.get("DB_NAME")
           or _read_env("/app/backend/.env", "DB_NAME") or "test_database")

ADMIN = {"email": "admin@livechat.com", "password": "admin123"}
AGENT = {"email": "agent@livechat.com", "password": "agent123"}


# ---------- helpers ----------
def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()


def _set_status(token, status):
    r = requests.post(
        f"{API}/agents/status",
        json={"status": status},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    assert r.status_code == 200, r.text


def _create_anon_session(client_id=None):
    r = requests.post(
        f"{API}/chat/session/anonymous",
        json={"client_id": client_id or f"iter16_{uuid.uuid4().hex[:8]}", "language": "en"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    return c[DB_NAME]


@pytest.fixture(scope="module")
def admin_ctx():
    """Admin logged in AND online. Agent taken OFFLINE so pending offers go to admin."""
    admin = _login(ADMIN)
    agent = _login(AGENT)
    _set_status(agent["token"], "offline")
    _set_status(admin["token"], "online")
    yield {"admin": admin, "agent": agent}


# ============================================================
# F-C Pending flow — Happy path
# ============================================================
def test_fc_pending_happy_path(admin_ctx):
    admin = admin_ctx["admin"]
    admin_id = admin["user"]["id"]
    admin_h = {"Authorization": f"Bearer {admin['token']}"}

    s = _create_anon_session()
    sid = s["session_id"]
    assert s["status"] == "pending", f"expected pending, got {s}"

    got = requests.get(f"{API}/chat/sessions/{sid}", headers=admin_h, timeout=10).json()
    assert got["status"] == "pending"
    assert got.get("pending_agent_id") == admin_id
    assert got.get("pending_expires_at"), "pending_expires_at missing"

    # Accept
    r = requests.post(f"{API}/chat/sessions/{sid}/accept", headers=admin_h, timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "open"
    assert body["assigned_agent_id"] == admin_id
    assert not body.get("pending_agent_id"), "pending_agent_id should be unset"

    # Verify persistence
    got2 = requests.get(f"{API}/chat/sessions/{sid}", headers=admin_h, timeout=10).json()
    assert got2["status"] == "open"
    assert got2["assigned_agent_id"] == admin_id


# ============================================================
# F-C Timeout & reassignment (manual expiry + scheduler tick)
# ============================================================
def test_fc_timeout_reassignment(admin_ctx, db):
    admin = admin_ctx["admin"]
    admin_id = admin["user"]["id"]
    admin_h = {"Authorization": f"Bearer {admin['token']}"}

    s = _create_anon_session()
    sid = s["session_id"]
    assert s["status"] == "pending"

    # Force expiry now
    db.sessions.update_one(
        {"id": sid},
        {"$set": {"pending_expires_at": "2000-01-01T00:00:00+00:00"}},
    )

    # Pending scheduler runs every 5s → wait ~7s
    time.sleep(7)

    doc = db.sessions.find_one({"id": sid})
    assert doc is not None
    declined = doc.get("pending_declined_by") or []
    assert admin_id in declined, f"admin should be in pending_declined_by, got {declined}"
    # With only admin online (agent is offline), no other agent → queued.
    assert doc["status"] in ("queued", "pending"), f"unexpected status {doc['status']}"
    if doc["status"] == "queued":
        assert doc.get("queue_position", 0) >= 1
        assert not doc.get("pending_agent_id")


# ============================================================
# F-C Only offered agent may Accept
# ============================================================
def test_fc_wrong_agent_accept_forbidden(admin_ctx, db):
    admin = admin_ctx["admin"]
    agent = admin_ctx["agent"]
    admin_h = {"Authorization": f"Bearer {admin['token']}"}
    agent_h = {"Authorization": f"Bearer {agent['token']}"}

    # Keep agent OFFLINE so admin is the sole online agent → gets the pending offer.
    s = _create_anon_session()
    sid = s["session_id"]
    assert s["status"] == "pending"

    # Bring the other agent online so they exist (but they weren't the offeree).
    _set_status(agent["token"], "online")
    try:
        r = requests.post(f"{API}/chat/sessions/{sid}/accept", headers=agent_h, timeout=10)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        assert "another agent" in r.text.lower()

        # Correct agent (admin) can accept.
        r2 = requests.post(f"{API}/chat/sessions/{sid}/accept", headers=admin_h, timeout=10)
        assert r2.status_code == 200
        assert r2.json()["status"] == "open"
    finally:
        _set_status(agent["token"], "offline")


# ============================================================
# F-A Attachment audit trail on DELETE
# ============================================================
def _accept_pending(sid, admin_h, admin_id, db):
    """Ensure a session becomes open and assigned to admin, robust to pending state."""
    doc = db.sessions.find_one({"id": sid})
    if doc and doc.get("status") == "pending" and doc.get("pending_agent_id") == admin_id:
        r = requests.post(f"{API}/chat/sessions/{sid}/accept", headers=admin_h, timeout=10)
        assert r.status_code == 200, r.text


def _upload(admin_token, sid):
    fake_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
        b"\x00\x00\x00\x03\x00\x01\xdd\xcc\xdb\xdb\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    r = requests.post(
        f"{API}/upload",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"file": ("audit.png", io.BytesIO(fake_png), "image/png")},
        data={"session_id": sid},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_fa_attachment_audit_on_delete(admin_ctx, db):
    admin = admin_ctx["admin"]
    admin_id = admin["user"]["id"]
    admin_h = {"Authorization": f"Bearer {admin['token']}"}

    s = _create_anon_session()
    sid = s["session_id"]
    stoken = s["session_token"]
    _accept_pending(sid, admin_h, admin_id, db)

    up = _upload(admin["token"], sid)
    att = {"id": up["id"], "filename": up["filename"], "content_type": up["content_type"]}

    # Inject a message directly with an attachment via the DB (simulates agent send;
    # the WS path is the same save_message helper). We use the messages coll.
    # But cleaner: send via WS is heavy; instead insert via save_message-like doc.
    from datetime import datetime, timezone
    mid = str(uuid.uuid4())
    db.messages.insert_one({
        "id": mid,
        "session_id": sid,
        "sender_type": "agent",
        "sender_id": admin_id,
        "sender_name": admin["user"]["name"],
        "content": "here is a file",
        "attachments": [att],
        "status": "sent",
        "edited": False,
        "deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # DELETE
    r = requests.delete(f"{API}/chat/messages/{mid}", headers=admin_h, timeout=10)
    assert r.status_code == 200, r.text

    # Audit log
    a = requests.get(f"{API}/admin/audit/edits?session_id={sid}", headers=admin_h, timeout=10)
    assert a.status_code == 200
    rows = [m for m in a.json() if m["id"] == mid]
    assert rows, "deleted message missing from audit"
    row = rows[0]
    assert row.get("deleted") is True
    assert row.get("deleted_by_name")
    orig = row.get("original_attachments") or []
    assert len(orig) == 1
    assert orig[0]["id"] == att["id"]
    assert orig[0]["filename"] == att["filename"]

    # Customer public view must NOT include the deleted message
    pub = requests.get(
        f"{API}/chat/public/{sid}/messages",
        params={"session_token": stoken},
        timeout=10,
    ).json()
    assert not any(m["id"] == mid for m in pub), "deleted msg leaked to customer"


# ============================================================
# F-A Attachment audit trail on EDIT (add attachment)
# ============================================================
def test_fa_attachment_audit_on_edit(admin_ctx, db):
    admin = admin_ctx["admin"]
    agent = admin_ctx["agent"]
    admin_id = admin["user"]["id"]
    agent_id = agent["user"]["id"]
    admin_h = {"Authorization": f"Bearer {admin['token']}"}
    agent_h = {"Authorization": f"Bearer {agent['token']}"}

    s = _create_anon_session()
    sid = s["session_id"]
    stoken = s["session_token"]
    _accept_pending(sid, admin_h, admin_id, db)

    # Insert message with NO attachment, sender = agent user (non-admin)
    from datetime import datetime, timezone
    mid = str(uuid.uuid4())
    db.messages.insert_one({
        "id": mid,
        "session_id": sid,
        "sender_type": "agent",
        "sender_id": agent_id,
        "sender_name": agent["user"]["name"],
        "content": "before edit",
        "attachments": [],
        "status": "sent",
        "edited": False,
        "deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    new_att = {"id": "new-att-1", "filename": "file.pdf", "content_type": "application/pdf"}
    r = requests.patch(
        f"{API}/chat/messages/{mid}",
        headers=agent_h,
        json={"content": "text", "attachments": [new_att]},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Agent response strips audit fields
    assert "previous_versions" not in body
    assert "original_content" not in body
    assert "original_attachments" not in body
    assert body["attachments"][0]["id"] == "new-att-1"
    assert body["edited"] is True

    # Admin audit shows full history
    a = requests.get(f"{API}/admin/audit/edits?session_id={sid}", headers=admin_h, timeout=10).json()
    row = next((m for m in a if m["id"] == mid), None)
    assert row, "edited msg missing from audit"
    pv = row.get("previous_versions") or []
    assert len(pv) >= 1
    assert pv[0].get("attachments") == []
    assert row.get("attachments") == [new_att]
    assert row.get("original_attachments") == []

    # Customer view: only final attachments, no edited flag
    pub = requests.get(
        f"{API}/chat/public/{sid}/messages",
        params={"session_token": stoken},
        timeout=10,
    ).json()
    m_pub = next((m for m in pub if m["id"] == mid), None)
    assert m_pub, "message missing from public view"
    assert m_pub["attachments"][0]["id"] == "new-att-1"
    assert "edited" not in m_pub
    assert "previous_versions" not in m_pub


# ============================================================
# Regression: FRONTEND_TEST_MSG absent & no Email UI hints
# ============================================================
def test_regression_no_frontend_test_msg():
    r = requests.get(f"{API}/settings/public", timeout=10)
    if r.status_code == 200:
        assert "FRONTEND_TEST_MSG" not in r.text
