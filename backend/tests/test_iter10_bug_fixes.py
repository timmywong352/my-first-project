"""Iteration 10 - Testing 3 bug fixes:
Bug 1: Queue auto-assign on agent online / on close
Bug 2: Real client IP from X-Forwarded-For / X-Real-IP
Bug 3: Public customer close endpoint
"""
import os
import time
import pytest
import requests
from pymongo import MongoClient

def _load_frontend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if url:
        return url
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""

BASE_URL = _load_frontend_url().rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

ADMIN_EMAIL = "admin@livechat.com"
ADMIN_PASSWORD = "admin123"


def _purge():
    db.sessions.delete_many({})
    db.messages.delete_many({})
    db.users.update_many({"role": {"$in": ["agent", "admin"]}}, {"$set": {"status": "offline", "auto_busy": False}})


@pytest.fixture(scope="module", autouse=True)
def cleanup():
    _purge()
    yield
    _purge()


@pytest.fixture(scope="module")
def agent_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture
def offline_agent(agent_token):
    """Ensure the test agent is offline at start of each test."""
    requests.post(f"{API}/agents/status", json={"status": "offline"},
                  headers={"Authorization": f"Bearer {agent_token}"})
    yield


# ---------- Bug 2 ----------
class TestBug2RealIP:
    def test_x_forwarded_for_first_ip(self):
        _purge()
        r = requests.post(
            f"{API}/chat/session/anonymous",
            json={"client_id": "ipf1"},
            headers={"X-Forwarded-For": "203.0.113.55, 10.0.0.1"},
        )
        assert r.status_code == 200, r.text
        sid = r.json()["session_id"]
        s = db.sessions.find_one({"id": sid})
        assert s is not None
        assert s.get("creator_ip") == "203.0.113.55", f"got {s.get('creator_ip')}"

    def test_x_real_ip_fallback(self):
        """Public ingress always injects X-Forwarded-For, so test the
        X-Real-IP fallback by hitting the backend directly on localhost."""
        _purge()
        r = requests.post(
            "http://localhost:8001/api/chat/session/anonymous",
            json={"client_id": "ipf2"},
            headers={"X-Real-IP": "198.51.100.7"},
        )
        assert r.status_code == 200, r.text
        sid = r.json()["session_id"]
        s = db.sessions.find_one({"id": sid})
        assert s.get("creator_ip") == "198.51.100.7", f"got {s.get('creator_ip')}"

    def test_ip_present_in_agent_view(self, agent_token):
        _purge()
        r = requests.post(
            f"{API}/chat/session/anonymous",
            json={"client_id": "ipf3"},
            headers={"X-Forwarded-For": "192.0.2.99"},
        )
        sid = r.json()["session_id"]
        # Fetch via authenticated endpoint
        r2 = requests.get(f"{API}/chat/sessions/{sid}",
                          headers={"Authorization": f"Bearer {agent_token}"})
        assert r2.status_code == 200
        data = r2.json()
        assert data.get("creator_ip") == "192.0.2.99", f"agent view creator_ip={data.get('creator_ip')}"


# ---------- Bug 1 ----------
class TestBug1QueuePromotion:
    def test_promote_on_agent_online(self, agent_token, offline_agent):
        _purge()
        # Agent offline → both sessions should be queued
        r1 = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "q1"},
                           headers={"X-Forwarded-For": "1.1.1.1"})
        r2 = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "q2"},
                           headers={"X-Forwarded-For": "1.1.1.2"})
        assert r1.status_code == 200 and r2.status_code == 200
        sid1 = r1.json()["session_id"]
        sid2 = r2.json()["session_id"]
        s1 = db.sessions.find_one({"id": sid1})
        s2 = db.sessions.find_one({"id": sid2})
        assert s1["status"] == "queued", f"session1 status={s1['status']}"
        assert s2["status"] == "queued", f"session2 status={s2['status']}"

        # Agent goes online → first queued should promote to open
        r = requests.post(f"{API}/agents/status", json={"status": "online"},
                          headers={"Authorization": f"Bearer {agent_token}"})
        assert r.status_code == 200
        time.sleep(1.5)

        # Poll for promotion (there's an async broadcast)
        s1a = db.sessions.find_one({"id": sid1})
        assert s1a["status"] == "open", f"expected open, got {s1a['status']}"
        assert s1a.get("assigned_agent_id"), "no agent assigned"

    def test_promote_on_close(self, agent_token):
        """With agent online and one open session, add another (queued if capacity
        reduces). Close the open one → queued should promote."""
        _purge()
        # ensure online
        requests.post(f"{API}/agents/status", json={"status": "online"},
                      headers={"Authorization": f"Bearer {agent_token}"})

        # Session A - opens
        rA = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "cA"},
                           headers={"X-Forwarded-For": "2.2.2.1"})
        sidA = rA.json()["session_id"]
        assert db.sessions.find_one({"id": sidA})["status"] == "open"

        # Force capacity=1 by marking agent as busy manually — but simpler: manually
        # queue Session B by inserting queued (or just create and check). With cap=20
        # session B will be open. To test promotion, we mark B queued directly.
        rB = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "cB"},
                           headers={"X-Forwarded-For": "2.2.2.2"})
        sidB = rB.json()["session_id"]
        # Force B into queue for the test
        db.sessions.update_one({"id": sidB}, {"$set": {
            "status": "queued", "assigned_agent_id": None, "queue_position": 1,
        }})

        # Close A via agent endpoint
        rc = requests.post(f"{API}/chat/sessions/{sidA}/close",
                           headers={"Authorization": f"Bearer {agent_token}"})
        assert rc.status_code == 200, rc.text
        time.sleep(1.5)

        sB = db.sessions.find_one({"id": sidB})
        assert sB["status"] == "open", f"B expected open after close, got {sB['status']}"
        assert sB.get("assigned_agent_id"), "no agent assigned on promotion"


# ---------- Bug 3 ----------
class TestBug3PublicClose:
    def test_public_close_success(self, agent_token):
        _purge()
        requests.post(f"{API}/agents/status", json={"status": "online"},
                      headers={"Authorization": f"Bearer {agent_token}"})
        r = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "cc1"},
                         headers={"X-Forwarded-For": "3.3.3.1"})
        sid = r.json()["session_id"]
        tok = r.json()["session_token"]

        rc = requests.post(f"{API}/chat/public/{sid}/close", params={"session_token": tok})
        assert rc.status_code == 200, rc.text
        assert rc.json().get("ok") is True

        s = db.sessions.find_one({"id": sid})
        assert s["status"] == "closed"
        assert s.get("closed_by") == "customer"
        assert s.get("closed_reason") == "customer_closed"
        assert s.get("closed_at")
        assert s.get("archived_at")
        assert "summary" in s  # may be empty string / None depending on LLM

    def test_public_close_wrong_token(self):
        _purge()
        r = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "cc2"},
                         headers={"X-Forwarded-For": "3.3.3.2"})
        sid = r.json()["session_id"]
        rc = requests.post(f"{API}/chat/public/{sid}/close", params={"session_token": "wrong"})
        assert rc.status_code == 401

    def test_public_close_promotes_queue(self, agent_token):
        _purge()
        requests.post(f"{API}/agents/status", json={"status": "online"},
                      headers={"Authorization": f"Bearer {agent_token}"})
        rA = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "pc_a"},
                          headers={"X-Forwarded-For": "3.3.4.1"})
        sidA = rA.json()["session_id"]
        tokA = rA.json()["session_token"]

        rB = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "pc_b"},
                          headers={"X-Forwarded-For": "3.3.4.2"})
        sidB = rB.json()["session_id"]
        # Force B into queue
        db.sessions.update_one({"id": sidB}, {"$set": {
            "status": "queued", "assigned_agent_id": None, "queue_position": 1,
        }})

        rc = requests.post(f"{API}/chat/public/{sidA}/close", params={"session_token": tokA})
        assert rc.status_code == 200
        time.sleep(1.5)

        sB = db.sessions.find_one({"id": sidB})
        assert sB["status"] == "open", f"B status={sB['status']} — promotion failed"
        assert sB.get("assigned_agent_id")

    def test_public_close_idempotent(self, agent_token):
        _purge()
        r = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "cc3"},
                         headers={"X-Forwarded-For": "3.3.3.3"})
        sid = r.json()["session_id"]
        tok = r.json()["session_token"]
        r1 = requests.post(f"{API}/chat/public/{sid}/close", params={"session_token": tok})
        r2 = requests.post(f"{API}/chat/public/{sid}/close", params={"session_token": tok})
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json().get("already_closed") is True
