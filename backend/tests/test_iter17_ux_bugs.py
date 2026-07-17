"""Iteration 17 — UX bug fixes:

Bug 1: Prior chat threads endpoint still returns ALL threads.
Bug 2: New sessions start with status='lily' and are excluded from the
       default agent sessions listing; POST /api/lily/handoff flips them
       to pending/queued and broadcasts pending_offer.
Bug 3: Close endpoints still work idempotently (frontend does optimistic UI).
"""
import os
import uuid
import asyncio
import time
import json
import pytest
import requests
import websockets
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception:
    pass

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fall back to prod override in the frontend .env if not exported
    try:
        fe_env = Path(__file__).resolve().parents[2] / "frontend" / ".env"
        for line in fe_env.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
    except Exception:
        pass

WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")

ADMIN_EMAIL = "admin@livechat.com"
ADMIN_PW = "admin123"
AGENT_EMAIL = "agent@livechat.com"
AGENT_PW = "agent123"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def agent_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": AGENT_EMAIL, "password": AGENT_PW})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def agent_headers(agent_token):
    return {"Authorization": f"Bearer {agent_token}"}


# ---------- helper ----------
def _create_anon(client_id=None, lang="en"):
    body = {"client_id": client_id or f"iter17_{uuid.uuid4().hex[:8]}", "language": lang}
    r = requests.post(f"{BASE_URL}/api/chat/session/anonymous", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _create_prechat():
    body = {
        "name": "TEST_Iter17 User",
        "email": f"test_iter17_{uuid.uuid4().hex[:6]}@example.com",
        "subject": "Iter17 prechat",
        "page": "/",
    }
    r = requests.post(f"{BASE_URL}/api/chat/session", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _handoff(session_id, token):
    r = requests.post(
        f"{BASE_URL}/api/lily/handoff",
        params={"session_id": session_id, "session_token": token, "lang": "en"},
    )
    assert r.status_code == 200, r.text
    return r.json()


# ============================================================
# Bug 2 — anonymous session starts as 'lily'
# ============================================================
class TestBug2AnonymousLilyStatus:
    def test_anon_session_created_with_status_lily(self):
        s = _create_anon()
        assert s["status"] == "lily", f"expected status='lily', got {s['status']}"
        assert s["queue_position"] is None

    def test_lily_session_excluded_from_default_agent_listing(self, agent_headers):
        s = _create_anon()
        r = requests.get(f"{BASE_URL}/api/chat/sessions", headers=agent_headers)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert s["session_id"] not in ids, "lily session must NOT show in default listing"

    def test_lily_status_filter_returns_lily_sessions(self, admin_headers):
        s = _create_anon()
        r = requests.get(
            f"{BASE_URL}/api/chat/sessions",
            params={"status_filter": "lily"},
            headers=admin_headers,
        )
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert s["session_id"] in ids

    def test_handoff_flips_to_pending_or_queued_and_appears_in_listing(self, admin_headers):
        s = _create_anon()
        result = _handoff(s["session_id"], s["session_token"])
        assert result["status"] in ("pending", "queued", "open"), result
        # Fetch session directly
        r = requests.get(f"{BASE_URL}/api/chat/sessions/{s['session_id']}", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["status"] in ("pending", "queued", "open")
        # Now visible in the default listing
        r2 = requests.get(f"{BASE_URL}/api/chat/sessions", headers=admin_headers)
        assert r2.status_code == 200
        assert s["session_id"] in [x["id"] for x in r2.json()]


# ============================================================
# Bug 2 — prechat session ALSO starts as 'lily'
# ============================================================
class TestBug2PrechatLilyStatus:
    def test_prechat_session_created_with_status_lily(self):
        s = _create_prechat()
        assert s["status"] == "lily"
        assert s["queue_position"] is None

    def test_prechat_excluded_from_default_listing(self, agent_headers):
        s = _create_prechat()
        r = requests.get(f"{BASE_URL}/api/chat/sessions", headers=agent_headers)
        assert s["session_id"] not in [x["id"] for x in r.json()]

    def test_prechat_handoff_flips_status(self, admin_headers):
        s = _create_prechat()
        result = _handoff(s["session_id"], s["session_token"])
        assert result["status"] in ("pending", "queued", "open")


# ============================================================
# Bug 2 — no pending_offer WS at session creation, only at handoff
# ============================================================
class TestBug2WebSocketEvents:
    @pytest.mark.asyncio
    async def test_no_pending_offer_at_creation_but_at_handoff(self, admin_token):
        ws_url = f"{WS_BASE}/api/ws/agent?token={admin_token}"
        received = []

        async with websockets.connect(ws_url) as ws:
            # Give the connection a beat to settle
            await asyncio.sleep(0.5)

            async def collect(duration):
                end = time.time() + duration
                while time.time() < end:
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=0.5)
                        try:
                            received.append(json.loads(msg))
                        except Exception:
                            pass
                    except asyncio.TimeoutError:
                        continue

            # Kick off a listen window while we create session
            listen_task = asyncio.create_task(collect(2.5))
            await asyncio.sleep(0.2)
            s = _create_anon()
            await listen_task

            creation_offers = [m for m in received
                               if m.get("type") == "pending_offer"
                               and m.get("session", {}).get("id") == s["session_id"]]
            assert not creation_offers, f"pending_offer fired at creation: {creation_offers}"

            # Now handoff and expect a pending_offer OR new_session for that sid
            received.clear()
            listen_task = asyncio.create_task(collect(3.5))
            await asyncio.sleep(0.2)
            _handoff(s["session_id"], s["session_token"])
            await listen_task

            related = [m for m in received
                       if (m.get("session") or {}).get("id") == s["session_id"]
                       or m.get("session_id") == s["session_id"]]
            # We expect at least one broadcast about this session post-handoff
            assert related, f"no agent broadcast after handoff. all received={received}"


# ============================================================
# Bug 1 — threads endpoint returns all threads for the same customer
# ============================================================
class TestBug1ThreadHistory:
    def test_threads_endpoint_returns_all_sessions_for_client_id(self, admin_headers):
        cid = f"iter17_prior_{uuid.uuid4().hex[:6]}"
        # Create 3 sessions for same client_id, handoff and close first two
        sessions = []
        for i in range(3):
            s = _create_anon(client_id=cid)
            sessions.append(s)
            if i < 2:
                _handoff(s["session_id"], s["session_token"])
                # close it
                r = requests.post(
                    f"{BASE_URL}/api/chat/sessions/{s['session_id']}/close",
                    headers=admin_headers,
                )
                assert r.status_code == 200

        current = sessions[-1]
        r = requests.get(
            f"{BASE_URL}/api/chat/threads/{current['session_id']}",
            headers=admin_headers,
        )
        assert r.status_code == 200
        threads = r.json()
        ids = [t["session"]["id"] for t in threads]
        assert len(threads) >= 3, f"expected >=3 threads, got {len(threads)}: {ids}"
        for s in sessions:
            assert s["session_id"] in ids


# ============================================================
# Bug 3 — close endpoint remains functional and idempotent
# ============================================================
class TestBug3CloseSessionEndpoint:
    def test_agent_close_endpoint_works(self, admin_headers):
        s = _create_anon()
        _handoff(s["session_id"], s["session_token"])
        r = requests.post(
            f"{BASE_URL}/api/chat/sessions/{s['session_id']}/close",
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # GET to verify persisted
        r2 = requests.get(
            f"{BASE_URL}/api/chat/sessions/{s['session_id']}",
            headers=admin_headers,
        )
        assert r2.status_code == 200
        assert r2.json()["status"] == "closed"

        # Idempotent second close
        r3 = requests.post(
            f"{BASE_URL}/api/chat/sessions/{s['session_id']}/close",
            headers=admin_headers,
        )
        assert r3.status_code == 200
        assert r3.json().get("already_closed") is True

    def test_customer_public_close_endpoint_works(self):
        s = _create_anon()
        r = requests.post(
            f"{BASE_URL}/api/chat/public/{s['session_id']}/close",
            params={"session_token": s["session_token"]},
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True
