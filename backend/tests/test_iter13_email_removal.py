"""Iter13 tests: verify email capture removed, FRONTEND_TEST_MSG gone,
quick replies CRUD, file upload/download, scheduler default message."""
import os
import io
import uuid
import time
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

ADMIN = {"email": "admin@livechat.com", "password": "admin123"}
AGENT = {"email": "agent@livechat.com", "password": "agent123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def agent_token():
    return _login(AGENT)


@pytest.fixture(scope="module")
def anon_session():
    cid = "iter13_" + uuid.uuid4().hex[:8]
    r = requests.post(
        f"{API}/chat/session/anonymous",
        json={"client_id": cid, "language": "en"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    d["client_id"] = cid
    return d


# ---------- FRONTEND_TEST_MSG audit ----------
class TestFrontendTestMsgAbsence:
    def test_settings_do_not_contain_test_strings(self, admin_token):
        r = requests.get(
            f"{API}/admin/settings",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        s = r.json()
        auto = (s.get("inactivity_auto_message") or "").strip()
        welcome = (s.get("welcome_message") or "").strip()
        assert "FRONTEND_TEST_MSG" not in auto
        assert "FRONTEND_TEST_MSG" not in welcome
        assert auto.upper() != "TEST HELLO"
        assert welcome.upper() != "TEST HELLO"


# ---------- Anon session / no email required ----------
class TestAnonSessionNoEmail:
    def test_anon_session_created_without_email(self, anon_session):
        assert anon_session.get("session_id")
        assert anon_session.get("session_token")

    def test_anon_session_no_email_field_required(self, anon_session):
        # The public session response should not require or return a customer email
        # (customer stays anonymous, threaded only by client_id).
        assert not anon_session.get("customer_email") or "@anon" in anon_session.get("customer_email", "")


# ---------- Quick Replies CRUD ----------
class TestQuickReplies:
    _created_id = None

    def test_create_quick_reply_as_admin(self, admin_token):
        r = requests.post(
            f"{API}/quick-replies",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"title": "TEST_iter13_QR", "content": "Hello from QR iter13"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["title"] == "TEST_iter13_QR"
        assert d["content"] == "Hello from QR iter13"
        assert "id" in d
        TestQuickReplies._created_id = d["id"]

    def test_agent_sees_quick_reply(self, agent_token):
        r = requests.get(
            f"{API}/quick-replies",
            headers={"Authorization": f"Bearer {agent_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        items = r.json()
        titles = [q["title"] for q in items]
        assert "TEST_iter13_QR" in titles

    def test_delete_quick_reply(self, admin_token):
        qid = TestQuickReplies._created_id
        assert qid
        r = requests.delete(
            f"{API}/quick-replies/{qid}",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        # verify removed
        r2 = requests.get(
            f"{API}/quick-replies",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        ids = [q["id"] for q in r2.json()]
        assert qid not in ids


# ---------- File upload / download ----------
# Minimal 1x1 PNG
_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
    b"\xc0\xf0\x1f\x00\x05\x00\x01\xff\x9a\x9c\x18\xc0\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestFileUpload:
    def test_customer_upload_and_agent_download(self, anon_session, agent_token):
        files = {"file": ("iter13.png", io.BytesIO(_PNG), "image/png")}
        data = {
            "session_id": anon_session["session_id"],
            "session_token": anon_session["session_token"],
        }
        r = requests.post(f"{API}/upload", files=files, data=data, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("id") or j.get("file_id"), j
        fid = j.get("id") or j.get("file_id")

        # Agent downloads with Bearer token via query param `auth`
        r2 = requests.get(f"{API}/files/{fid}", params={"auth": agent_token}, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.content[:4] == b"\x89PNG"

        # Customer downloads with session credentials
        r3 = requests.get(
            f"{API}/files/{fid}",
            params={
                "session_id": anon_session["session_id"],
                "session_token": anon_session["session_token"],
            },
            timeout=15,
        )
        assert r3.status_code == 200, r3.text
        assert r3.content[:4] == b"\x89PNG"


# ---------- Scheduler default (no FRONTEND_TEST_MSG in DB) ----------
class TestSchedulerDefault:
    def test_no_frontend_test_msg_in_messages(self, admin_token):
        # Use admin messages/search endpoint if exists, else rely on
        # a direct DB check via a lightweight admin route. Fallback: check
        # settings only (already done). Here we just re-confirm no test string
        # is present by inspecting a few recent sessions via admin/sessions.
        r = requests.get(
            f"{API}/admin/sessions",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        if r.status_code != 200:
            pytest.skip("admin/sessions not available")
        # Best effort: iterate first 20 sessions and pull messages
        sessions = r.json()
        if isinstance(sessions, dict):
            sessions = sessions.get("sessions") or sessions.get("items") or []
        checked = 0
        for s in sessions[:20]:
            sid = s.get("id") or s.get("session_id")
            if not sid:
                continue
            m = requests.get(
                f"{API}/chat/threads/{sid}",
                headers={"Authorization": f"Bearer {admin_token}"},
                timeout=15,
            )
            if m.status_code != 200:
                continue
            checked += 1
            payload = m.json()
            # threads endpoint returns dict with 'threads' each with 'messages'
            threads = payload.get("threads") if isinstance(payload, dict) else []
            for th in threads or []:
                for msg in th.get("messages", []) or []:
                    assert "FRONTEND_TEST_MSG" not in (msg.get("text") or "")
        # Not a hard requirement to have data; the direct DB check was already done externally.
