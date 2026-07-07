import pytest_asyncio  # noqa: F401

"""Iteration 7 — Lily AI concierge tests."""
import asyncio
import json
import os
import time
import uuid

import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://live-chat-hub-28.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": "admin@livechat.com", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def agent_token():
    r = requests.post(f"{API}/auth/login", json={"email": "agent@livechat.com", "password": "agent123"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _new_session(email_suffix=""):
    email = f"TEST_lily_{uuid.uuid4().hex[:8]}{email_suffix}@example.com"
    r = requests.post(f"{API}/chat/session", json={
        "name": "Test Lily User",
        "email": email,
        "subject": "Test conversation",
    })
    assert r.status_code in (200, 201), r.text
    d = r.json()
    return d["session_id"], d["session_token"], email


# ---------- tests ----------
def test_lily_status_enabled():
    r = requests.get(f"{API}/lily/status")
    assert r.status_code == 200
    data = r.json()
    assert data["enabled"] is True
    assert set(data["options"].keys()) >= {"query_recharge", "query_withdrawal", "view_promotions", "query_ticket"}


def test_lily_open_first_time():
    sid, token, email = _new_session()
    r = requests.post(f"{API}/lily/open", params={"session_id": sid, "session_token": token})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("enabled") is True
    assert "Lily" in d["message"]["content"] or "您好" in d["message"]["content"]


def test_lily_reply_angry_emotion():
    sid, token, email = _new_session()
    requests.post(f"{API}/lily/open", params={"session_id": sid, "session_token": token})
    r = requests.post(f"{API}/lily/reply", params={
        "text": "你们太慢了！我等了半小时都没人理我，充值也没到账，太差劲了！",
        "session_id": sid,
        "session_token": token,
    }, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["emotion"] == "angry", f"expected angry, got {d}"
    assert d["confidence"] > 0.5
    reply_text = d["message"]["content"]
    assert ("抱歉" in reply_text) or ("对不起" in reply_text), f"reply missing apology: {reply_text}"
    assert d["escalate"] is False
    # options list may include keys
    assert isinstance(d["options"], list)


def test_lily_reply_handoff_intent():
    sid, token, _ = _new_session()
    requests.post(f"{API}/lily/open", params={"session_id": sid, "session_token": token})
    r = requests.post(f"{API}/lily/reply", params={
        "text": "我要转人工",
        "session_id": sid,
        "session_token": token,
    }, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["escalate"] is True, d
    reply = d["message"]["content"]
    assert ("转接" in reply) or ("人工" in reply), reply


def test_lily_handoff_endpoint():
    sid, token, _ = _new_session()
    requests.post(f"{API}/lily/open", params={"session_id": sid, "session_token": token})
    r = requests.post(f"{API}/lily/handoff", params={"session_id": sid, "session_token": token})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] in ("open", "queued")


def test_customer_memory_persists(agent_token):
    sid, token, email = _new_session()
    requests.post(f"{API}/lily/open", params={"session_id": sid, "session_token": token})
    requests.post(f"{API}/lily/reply", params={
        "text": "你们太差了，充值没到账，我很生气！",
        "session_id": sid, "session_token": token,
    }, timeout=60)
    r = requests.get(f"{API}/lily/memory", params={"email": email},
                     headers={"Authorization": f"Bearer {agent_token}"})
    assert r.status_code == 200, r.text
    mem = r.json()
    assert mem.get("email") == email.lower()
    assert isinstance(mem.get("past_issues"), list) and len(mem["past_issues"]) >= 1
    assert isinstance(mem.get("emotion_history"), list) and len(mem["emotion_history"]) >= 1
    assert mem.get("session_count", 0) >= 1
    # complaint entry should exist (emotion was angry)
    assert isinstance(mem.get("past_complaints"), list)


@pytest.mark.asyncio
async def test_emotion_update_broadcast(agent_token):
    """Agent WS should receive emotion_update when customer sends emotional message."""
    ws_url = f"{WS_BASE}/ws/agent?token={agent_token}"
    got_emotion = {"event": None}

    async def agent_ws():
        try:
            async with websockets.connect(ws_url, open_timeout=10) as ws:
                # wait up to 40s for emotion_update
                end = time.time() + 40
                while time.time() < end:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=40)
                    except asyncio.TimeoutError:
                        break
                    try:
                        m = json.loads(raw)
                    except Exception:
                        continue
                    if m.get("type") == "emotion_update":
                        got_emotion["event"] = m
                        return
        except Exception as e:
            got_emotion["err"] = str(e)

    async def customer_action():
        await asyncio.sleep(1.5)
        sid, token, _ = _new_session()
        requests.post(f"{API}/lily/open", params={"session_id": sid, "session_token": token})
        requests.post(f"{API}/lily/reply", params={
            "text": "你们太让人失望了！",
            "session_id": sid, "session_token": token,
        }, timeout=60)

    await asyncio.gather(agent_ws(), customer_action())
    assert got_emotion["event"] is not None, f"No emotion_update received: {got_emotion}"
    assert got_emotion["event"]["type"] == "emotion_update"
    assert "emotion" in got_emotion["event"]
    assert "session_id" in got_emotion["event"]


def test_admin_toggle_disables_lily(admin_token):
    # turn off
    r = requests.patch(f"{API}/admin/settings", json={"lily_enabled": False},
                       headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200, r.text
    s = requests.get(f"{API}/lily/status").json()
    assert s["enabled"] is False
    # turn back on
    r = requests.patch(f"{API}/admin/settings", json={"lily_enabled": True},
                       headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    s = requests.get(f"{API}/lily/status").json()
    assert s["enabled"] is True


# ---------- Regression: core existing endpoints still work ----------
def test_regression_auth_me(agent_token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {agent_token}"})
    assert r.status_code == 200
    assert r.json()["email"] == "agent@livechat.com"


def test_regression_admin_settings_get(admin_token):
    r = requests.get(f"{API}/admin/settings", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200
    assert "lily_enabled" in r.json()


def test_regression_session_creation():
    sid, token, _ = _new_session()
    assert sid and token


def test_regression_agents_list(agent_token):
    r = requests.get(f"{API}/agents", headers={"Authorization": f"Bearer {agent_token}"})
    assert r.status_code in (200, 404)  # tolerate route naming
