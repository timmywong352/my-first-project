"""Comprehensive backend API tests for the LiveChat application."""
import os
import io
import json
import time
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://live-chat-hub-28.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api"

ADMIN = {"email": "admin@livechat.com", "password": "admin123"}
AGENT = {"email": "agent@livechat.com", "password": "agent123"}


# ---------------- Fixtures ----------------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def agent_token():
    r = requests.post(f"{API}/auth/login", json=AGENT, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def chat_session():
    r = requests.post(f"{API}/chat/session", json={
        "name": "TEST_Customer", "email": "test_customer@example.com",
        "subject": "TEST subject", "page": "/pricing"
    }, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- Auth ----------------
class TestAuth:
    def test_admin_login(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and isinstance(data["token"], str)
        assert data["user"]["email"] == ADMIN["email"]
        assert data["user"]["role"] == "admin"

    def test_agent_login(self):
        r = requests.post(f"{API}/auth/login", json=AGENT, timeout=30)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "agent"

    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": ADMIN["email"], "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_me(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_hdr(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN["email"]

    def test_me_no_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401


# ---------------- Chat sessions ----------------
class TestChatSessions:
    def test_create_session_public(self, chat_session):
        assert "session_id" in chat_session
        assert "session_token" in chat_session

    def test_list_sessions_requires_auth(self):
        r = requests.get(f"{API}/chat/sessions", timeout=30)
        assert r.status_code == 401

    def test_list_sessions(self, agent_token, chat_session):
        r = requests.get(f"{API}/chat/sessions", headers=_hdr(agent_token), timeout=30)
        assert r.status_code == 200
        sids = [s["id"] for s in r.json()]
        assert chat_session["session_id"] in sids

    def test_get_session(self, agent_token, chat_session):
        r = requests.get(f"{API}/chat/sessions/{chat_session['session_id']}",
                         headers=_hdr(agent_token), timeout=30)
        assert r.status_code == 200
        assert "session_token" not in r.json()  # never exposed


# ---------------- WebSocket messaging ----------------
class TestWebSocket:
    def test_ws_agent_and_customer_bidirectional(self, agent_token, chat_session):
        async def run():
            sid = chat_session["session_id"]
            stok = chat_session["session_token"]
            agent_url = f"{WS_BASE}/ws/agent?token={agent_token}"
            cust_url = f"{WS_BASE}/ws/customer?session_id={sid}&session_token={stok}"
            async with websockets.connect(agent_url) as aws, \
                    websockets.connect(cust_url) as cws:
                # customer sends -> agent receives
                await cws.send(json.dumps({"type": "message", "content": "hello from customer"}))
                got_agent = None
                for _ in range(10):
                    try:
                        msg = json.loads(await asyncio.wait_for(aws.recv(), timeout=5))
                    except asyncio.TimeoutError:
                        break
                    if msg.get("type") == "message" and msg["message"]["content"] == "hello from customer":
                        got_agent = msg
                        break
                assert got_agent is not None, "Agent didn't receive customer message"

                # agent sends -> customer receives
                await aws.send(json.dumps({"type": "message", "session_id": sid, "content": "hello from agent"}))
                got_cust = None
                for _ in range(10):
                    try:
                        msg = json.loads(await asyncio.wait_for(cws.recv(), timeout=5))
                    except asyncio.TimeoutError:
                        break
                    if msg.get("type") == "message" and msg["message"]["content"] == "hello from agent":
                        got_cust = msg
                        break
                assert got_cust is not None, "Customer didn't receive agent message"

        asyncio.run(run())

    def test_ws_customer_invalid_token(self, chat_session):
        async def run():
            sid = chat_session["session_id"]
            url = f"{WS_BASE}/ws/customer?session_id={sid}&session_token=bad"
            try:
                async with websockets.connect(url) as ws:
                    await asyncio.wait_for(ws.recv(), timeout=3)
                    return False
            except Exception:
                return True
        assert asyncio.run(run())


# ---------------- File Upload ----------------
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xdc\xccY\xe7"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestUpload:
    def test_upload_as_agent(self, agent_token):
        files = {"file": ("test.png", PNG_BYTES, "image/png")}
        r = requests.post(f"{API}/upload", headers=_hdr(agent_token), files=files, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data and data["url"].startswith("/api/files/")
        # Download
        r2 = requests.get(f"{BASE_URL}{data['url']}", headers=_hdr(agent_token), timeout=60)
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("image/png")

    def test_upload_as_customer(self, chat_session):
        files = {"file": ("cust.png", PNG_BYTES, "image/png")}
        data = {"session_id": chat_session["session_id"], "session_token": chat_session["session_token"]}
        r = requests.post(f"{API}/upload", files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        fid = r.json()["id"]
        r2 = requests.get(f"{API}/files/{fid}",
                          params={"session_id": chat_session["session_id"],
                                  "session_token": chat_session["session_token"]},
                          timeout=60)
        assert r2.status_code == 200

    def test_upload_disallowed_ext(self, agent_token):
        files = {"file": ("bad.exe", b"MZ\x00\x00", "application/octet-stream")}
        r = requests.post(f"{API}/upload", headers=_hdr(agent_token), files=files, timeout=30)
        assert r.status_code == 400

    def test_upload_no_auth(self):
        files = {"file": ("t.png", PNG_BYTES, "image/png")}
        r = requests.post(f"{API}/upload", files=files, timeout=30)
        assert r.status_code == 401


# ---------------- Messages edit/delete ----------------
class TestMessageOps:
    @pytest.fixture(scope="class")
    def agent_msg(self, agent_token, chat_session):
        """Send a message via agent WS and return its id."""
        async def run():
            sid = chat_session["session_id"]
            url = f"{WS_BASE}/ws/agent?token={agent_token}"
            async with websockets.connect(url) as ws:
                await ws.send(json.dumps({"type": "message", "session_id": sid, "content": "orig content"}))
                for _ in range(10):
                    try:
                        msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                    except asyncio.TimeoutError:
                        break
                    if msg.get("type") == "message" and msg["message"]["content"] == "orig content":
                        return msg["message"]
            return None
        m = asyncio.run(run())
        assert m is not None
        return m

    def test_edit_own_message(self, agent_token, agent_msg):
        r = requests.patch(f"{API}/chat/messages/{agent_msg['id']}",
                           json={"content": "edited"}, headers=_hdr(agent_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["content"] == "edited"
        assert r.json()["edited"] is True

    def test_edit_others_message_forbidden(self, admin_token, agent_msg):
        r = requests.patch(f"{API}/chat/messages/{agent_msg['id']}",
                           json={"content": "hax"}, headers=_hdr(admin_token), timeout=30)
        assert r.status_code == 403

    def test_delete_own_message(self, agent_token, agent_msg):
        r = requests.delete(f"{API}/chat/messages/{agent_msg['id']}",
                            headers=_hdr(agent_token), timeout=30)
        assert r.status_code == 200


# ---------------- AI ----------------
class TestAI:
    def test_ai_suggest(self, agent_token, chat_session):
        r = requests.post(f"{API}/ai/suggest/{chat_session['session_id']}",
                          headers=_hdr(agent_token), timeout=90)
        assert r.status_code == 200
        assert "suggestions" in r.json()
        assert isinstance(r.json()["suggestions"], list)

    def test_ai_summarize(self, agent_token, chat_session):
        r = requests.post(f"{API}/ai/summarize/{chat_session['session_id']}",
                          headers=_hdr(agent_token), timeout=90)
        assert r.status_code == 200
        assert "summary" in r.json()


# ---------------- Close session ----------------
class TestCloseAndCsat:
    def test_close_session_and_csat(self, admin_token):
        # New session for closure
        r = requests.post(f"{API}/chat/session", json={
            "name": "TEST_close", "email": "close_test@example.com", "subject": "close"
        }, timeout=30)
        sess = r.json()
        r2 = requests.post(f"{API}/chat/sessions/{sess['session_id']}/close",
                           headers=_hdr(admin_token), timeout=90)
        assert r2.status_code == 200
        assert "summary" in r2.json()
        # CSAT
        r3 = requests.post(f"{API}/chat/public/{sess['session_id']}/csat",
                           params={"session_token": sess["session_token"]},
                           json={"rating": 5}, timeout=30)
        assert r3.status_code == 200
        # invalid rating
        r4 = requests.post(f"{API}/chat/public/{sess['session_id']}/csat",
                           params={"session_token": sess["session_token"]},
                           json={"rating": 9}, timeout=30)
        assert r4.status_code == 400


# ---------------- Quick replies ----------------
class TestQuickReplies:
    def test_list_seeded(self, agent_token):
        r = requests.get(f"{API}/quick-replies", headers=_hdr(agent_token), timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_create_and_delete(self, agent_token):
        r = requests.post(f"{API}/quick-replies", headers=_hdr(agent_token),
                          json={"title": "TEST_QR", "content": "hello"}, timeout=30)
        assert r.status_code == 200
        qid = r.json()["id"]
        r2 = requests.delete(f"{API}/quick-replies/{qid}", headers=_hdr(agent_token), timeout=30)
        assert r2.status_code == 200


# ---------------- Agents ----------------
class TestAgents:
    def test_list_agents(self, agent_token):
        r = requests.get(f"{API}/agents", headers=_hdr(agent_token), timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 2

    def test_create_delete_by_admin(self, admin_token):
        payload = {"email": f"test_new_{int(time.time())}@example.com",
                   "password": "pw12345", "name": "TEST_New Agent", "role": "agent"}
        r = requests.post(f"{API}/agents", headers=_hdr(admin_token), json=payload, timeout=30)
        assert r.status_code == 200
        aid = r.json()["id"]
        r2 = requests.delete(f"{API}/agents/{aid}", headers=_hdr(admin_token), timeout=30)
        assert r2.status_code == 200

    def test_create_by_non_admin_forbidden(self, agent_token):
        r = requests.post(f"{API}/agents", headers=_hdr(agent_token),
                          json={"email": "nope@ex.com", "password": "x", "name": "n"}, timeout=30)
        assert r.status_code == 403

    def test_update_status(self, agent_token):
        r = requests.post(f"{API}/agents/status", headers=_hdr(agent_token),
                          json={"status": "busy"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "busy"


# ---------------- Admin metrics/settings ----------------
class TestAdmin:
    def test_metrics_admin(self, admin_token):
        r = requests.get(f"{API}/admin/metrics", headers=_hdr(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("chats_today", "open_chats", "avg_response_seconds", "csat_average", "daily_chats"):
            assert k in d
        assert isinstance(d["daily_chats"], list) and len(d["daily_chats"]) == 7

    def test_metrics_forbidden_for_agent(self, agent_token):
        r = requests.get(f"{API}/admin/metrics", headers=_hdr(agent_token), timeout=30)
        assert r.status_code == 403

    def test_settings_get(self, admin_token):
        r = requests.get(f"{API}/admin/settings", headers=_hdr(admin_token), timeout=30)
        assert r.status_code == 200

    def test_settings_patch(self, admin_token):
        r = requests.patch(f"{API}/admin/settings", headers=_hdr(admin_token),
                           json={"widget_color": "#123456", "welcome_message": "TEST hello"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["widget_color"] == "#123456"

    def test_public_settings(self):
        r = requests.get(f"{API}/public/settings", timeout=30)
        assert r.status_code == 200
        assert "widget_color" in r.json()
