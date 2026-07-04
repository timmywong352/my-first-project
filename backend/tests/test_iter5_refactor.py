"""Iteration-5 tests: two-way typing preview (agent->customer) + dynamic agent aggregation counts."""
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
AGENT = {"email": "agent@livechat.com", "password": "agent123"}


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    return r.json()["token"]


@pytest.fixture(scope="module")
def agent_token():
    r = requests.post(f"{API}/auth/login", json=AGENT, timeout=30)
    return r.json()["token"]


def _new_session(name="TEST_iter5", email="iter5@ex.com", subject="TEST subj"):
    r = requests.post(f"{API}/chat/session", json={
        "name": name, "email": email, "subject": subject, "page": "/pricing"
    }, timeout=30)
    return r.json()


class TestAgentToCustomerTyping:
    """Agent typing preview must be relayed to customer WS."""

    def test_agent_typing_reaches_customer(self, agent_token):
        sess = _new_session(name="TEST_AgentTyping")
        sid, stok = sess["session_id"], sess["session_token"]

        async def run():
            agent_url = f"{WS_BASE}/ws/agent?token={agent_token}"
            cust_url = f"{WS_BASE}/ws/customer?session_id={sid}&session_token={stok}"
            async with websockets.connect(agent_url) as aws, \
                    websockets.connect(cust_url) as cws:
                await asyncio.sleep(0.3)
                await aws.send(json.dumps({
                    "type": "typing", "session_id": sid,
                    "is_typing": True, "content": "partial reply text"
                }))
                got = None
                for _ in range(20):
                    try:
                        m = json.loads(await asyncio.wait_for(cws.recv(), timeout=3))
                    except asyncio.TimeoutError:
                        break
                    if m.get("type") == "typing" and m.get("sender_type") == "agent":
                        got = m
                        break
                assert got is not None, "customer did not receive agent typing event"
                assert got["is_typing"] is True
                assert got["preview"] == "partial reply text", f"preview mismatch: {got}"
                assert "name" in got

                # Now stop-typing => preview must be empty
                await aws.send(json.dumps({
                    "type": "typing", "session_id": sid,
                    "is_typing": False, "content": "should be cleared"
                }))
                got2 = None
                for _ in range(20):
                    try:
                        m = json.loads(await asyncio.wait_for(cws.recv(), timeout=3))
                    except asyncio.TimeoutError:
                        break
                    if m.get("type") == "typing" and m.get("sender_type") == "agent":
                        got2 = m
                        break
                assert got2 is not None
                assert got2["is_typing"] is False
                assert got2["preview"] == "", f"preview must be empty on stop: {got2}"

        asyncio.run(run())


class TestListAgentsAggregationDynamic:
    """GET /api/agents active_chat_count must dynamically reflect open assigned sessions."""

    def test_active_chat_count_dynamic(self, admin_token):
        # Fresh agent
        email = f"testagg_{int(time.time())}@ex.com"
        rc = requests.post(f"{API}/agents", headers=_hdr(admin_token),
                           json={"email": email, "password": "pw12345",
                                 "name": "TEST_AggAgent", "role": "agent"}, timeout=30)
        assert rc.status_code == 200
        agent_id = rc.json()["id"]

        rl = requests.post(f"{API}/auth/login",
                           json={"email": email, "password": "pw12345"}, timeout=30)
        agent_tok = rl.json()["token"]

        try:
            # Initial baseline: 0
            r = requests.get(f"{API}/agents", headers=_hdr(admin_token), timeout=30)
            row = next(a for a in r.json() if a["id"] == agent_id)
            assert row["active_chat_count"] == 0, row
            assert "email" in row and "name" in row and "role" in row and "status" in row
            assert row["max_active_chats"] == 20

            # Assign 3 sessions via WS auto-assign
            sess_list = []
            for i in range(3):
                s = _new_session(name=f"TEST_agg{i}", email=f"agg{i}@ex.com")
                sess_list.append((s["session_id"], s["session_token"]))

            async def assign():
                url = f"{WS_BASE}/ws/agent?token={agent_tok}"
                async with websockets.connect(url) as aws:
                    for sid, _ in sess_list:
                        await aws.send(json.dumps({
                            "type": "message", "session_id": sid, "content": "hi"
                        }))
                        await asyncio.sleep(0.1)
                    await asyncio.sleep(1.0)

            asyncio.run(assign())

            r2 = requests.get(f"{API}/agents", headers=_hdr(admin_token), timeout=30)
            row2 = next(a for a in r2.json() if a["id"] == agent_id)
            assert row2["active_chat_count"] == 3, f"after 3 assigns, got {row2}"

            # Close one
            rcl = requests.post(f"{API}/chat/sessions/{sess_list[0][0]}/close",
                                headers=_hdr(admin_token), timeout=60)
            assert rcl.status_code == 200

            r3 = requests.get(f"{API}/agents", headers=_hdr(admin_token), timeout=30)
            row3 = next(a for a in r3.json() if a["id"] == agent_id)
            assert row3["active_chat_count"] == 2, f"after 1 close, got {row3}"
        finally:
            try:
                requests.delete(f"{API}/agents/{agent_id}",
                                headers=_hdr(admin_token), timeout=30)
            except Exception:
                pass
