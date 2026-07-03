"""Iteration-3 targeted retest:
Fix 2 -- Agent WS reconnect must NOT override auto_busy=busy state.
Fix 1 (closed banner) is covered via Playwright separately.
"""
import os
import json
import time
import asyncio
import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api"

ADMIN = {"email": "admin@livechat.com", "password": "admin123"}


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200
    return r.json()["token"]


def _new_session(name, email, subject="TEST subject"):
    r = requests.post(f"{API}/chat/session", json={
        "name": name, "email": email, "subject": subject, "page": "/pricing"
    }, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


class TestReconnectPreservesAutoBusy:
    """Fix 2 - agent WS reconnect while at cap must preserve status=busy/auto_busy=true."""

    def test_reconnect_does_not_flip_busy_to_online(self, admin_token):
        # 1. Fresh test agent
        email = f"testreconnect_{int(time.time())}@ex.com"
        rc = requests.post(f"{API}/agents", headers=_hdr(admin_token),
                           json={"email": email, "password": "pw12345",
                                 "name": "TEST_ReconnectAgent", "role": "agent"}, timeout=30)
        assert rc.status_code == 200, rc.text
        agent_id = rc.json()["id"]

        rl = requests.post(f"{API}/auth/login",
                           json={"email": email, "password": "pw12345"}, timeout=30)
        assert rl.status_code == 200
        agent_tok = rl.json()["token"]

        try:
            # 2. Create 20 sessions and get the agent assigned via WS auto-assign
            sessions = []
            for i in range(20):
                s = _new_session(f"TEST_R{i}", f"r{i}@ex.com")
                sessions.append((s["session_id"], s["session_token"]))

            state = {}

            async def assign_20():
                url = f"{WS_BASE}/ws/agent?token={agent_tok}"
                async with websockets.connect(url) as aws:
                    for sid, _ in sessions:
                        await aws.send(json.dumps({
                            "type": "message", "session_id": sid, "content": "hi"
                        }))
                        await asyncio.sleep(0.03)
                    await asyncio.sleep(1.2)
                    # drain
                    for _ in range(60):
                        try:
                            await asyncio.wait_for(aws.recv(), timeout=0.2)
                        except asyncio.TimeoutError:
                            break
                    # Sanity: while first WS is open, agent should be auto-busy
                    rme = requests.get(f"{API}/auth/me", headers=_hdr(agent_tok), timeout=30)
                    state["status_before_disconnect"] = rme.json().get("status")

            asyncio.run(assign_20())

            assert state["status_before_disconnect"] == "busy", \
                f"agent didn't reach busy after 20 assignments: {state}"

            # 3. WS closed. Reconnect on a FRESH WS and immediately check /auth/me.
            async def reconnect_and_check():
                url = f"{WS_BASE}/ws/agent?token={agent_tok}"
                async with websockets.connect(url) as aws:
                    await asyncio.sleep(0.6)  # allow connect handler to run
                    rme = requests.get(f"{API}/auth/me", headers=_hdr(agent_tok), timeout=30)
                    state["status_after_reconnect"] = rme.json().get("status")
                    rload = requests.get(f"{API}/agents/me/load", headers=_hdr(agent_tok), timeout=30)
                    state["load_after_reconnect"] = rload.json()

            asyncio.run(reconnect_and_check())

            assert state["load_after_reconnect"]["active_chat_count"] == 20, state["load_after_reconnect"]
            assert state["status_after_reconnect"] == "busy", (
                f"FIX 2 REGRESSION: reconnect overrode auto_busy — status={state['status_after_reconnect']}"
            )

            # 4. Close one session on a fresh reconnect; expect status flip to online.
            close_sid = sessions[0][0]

            async def close_one_and_check():
                url = f"{WS_BASE}/ws/agent?token={agent_tok}"
                async with websockets.connect(url) as aws:
                    await asyncio.sleep(0.4)
                    rcl = requests.post(f"{API}/chat/sessions/{close_sid}/close",
                                        headers=_hdr(admin_token), timeout=60)
                    assert rcl.status_code == 200, rcl.text
                    await asyncio.sleep(1.2)
                    rme = requests.get(f"{API}/auth/me", headers=_hdr(agent_tok), timeout=30)
                    state["status_after_close"] = rme.json().get("status")

            asyncio.run(close_one_and_check())

            assert state["status_after_close"] == "online", \
                f"status did not flip back to online after close: {state['status_after_close']}"
        finally:
            try:
                requests.delete(f"{API}/agents/{agent_id}",
                                headers=_hdr(admin_token), timeout=30)
            except Exception:
                pass
