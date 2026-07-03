"""Tests for iteration-2 features: closed-chat bug, archive search, typing preview, 20-limit."""
import os
import json
import asyncio
import time
import pytest
import requests
import websockets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://live-chat-hub-28.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api"

ADMIN = {"email": "admin@livechat.com", "password": "admin123"}
AGENT = {"email": "agent@livechat.com", "password": "agent123"}


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def agent_token():
    r = requests.post(f"{API}/auth/login", json=AGENT, timeout=30)
    assert r.status_code == 200
    return r.json()["token"]


def _new_session(name="TEST_C", email="tc@example.com", subject="TEST subject"):
    r = requests.post(f"{API}/chat/session", json={
        "name": name, "email": email, "subject": subject, "page": "/pricing"
    }, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ====================== BUG FIX: closed chat rejects customer messages =======================
class TestClosedChatBug:
    def test_customer_send_after_close_is_rejected(self, admin_token):
        sess = _new_session()
        sid, stok = sess["session_id"], sess["session_token"]

        async def run():
            cust_url = f"{WS_BASE}/ws/customer?session_id={sid}&session_token={stok}"
            async with websockets.connect(cust_url) as cws:
                # send a valid pre-close message
                await cws.send(json.dumps({"type": "message", "content": "hi before close"}))
                # wait for broadcast echo
                for _ in range(10):
                    try:
                        m = json.loads(await asyncio.wait_for(cws.recv(), timeout=3))
                        if m.get("type") == "message":
                            break
                    except asyncio.TimeoutError:
                        break

                # Count messages BEFORE close
                r0 = requests.get(f"{API}/chat/sessions/{sid}/messages",
                                  headers=_hdr(admin_token), timeout=30)
                assert r0.status_code == 200
                before = len(r0.json())

                # Close session via admin
                rc = requests.post(f"{API}/chat/sessions/{sid}/close",
                                   headers=_hdr(admin_token), timeout=60)
                assert rc.status_code == 200

                # Drain any session_closed broadcast
                await asyncio.sleep(0.5)
                for _ in range(5):
                    try:
                        await asyncio.wait_for(cws.recv(), timeout=1)
                    except asyncio.TimeoutError:
                        break

                # Now try to send a message post-close
                await cws.send(json.dumps({"type": "message", "content": "after-close attempt"}))

                got_error = None
                for _ in range(10):
                    try:
                        m = json.loads(await asyncio.wait_for(cws.recv(), timeout=3))
                    except asyncio.TimeoutError:
                        break
                    if m.get("type") == "error" and m.get("code") == "session_closed":
                        got_error = m
                        break
                assert got_error is not None, "Did not receive session_closed error"

                # Count messages AFTER — should not have increased
                r1 = requests.get(f"{API}/chat/sessions/{sid}/messages",
                                  headers=_hdr(admin_token), timeout=30)
                assert r1.status_code == 200
                after = len(r1.json())
                assert after == before, f"Message count increased after close: {before} -> {after}"

        asyncio.run(run())

    def test_customer_ws_on_closed_session_receives_notice_on_connect(self, admin_token):
        sess = _new_session()
        sid, stok = sess["session_id"], sess["session_token"]
        # close it
        rc = requests.post(f"{API}/chat/sessions/{sid}/close",
                           headers=_hdr(admin_token), timeout=60)
        assert rc.status_code == 200

        async def run():
            cust_url = f"{WS_BASE}/ws/customer?session_id={sid}&session_token={stok}"
            async with websockets.connect(cust_url) as cws:
                for _ in range(5):
                    try:
                        m = json.loads(await asyncio.wait_for(cws.recv(), timeout=3))
                    except asyncio.TimeoutError:
                        break
                    if m.get("type") == "session_closed":
                        return True
                return False

        assert asyncio.run(run()), "customer WS on closed session did not get session_closed"


# ====================== Archive ==========================================
class TestArchive:
    def test_session_after_close_has_archived_at(self, admin_token):
        sess = _new_session(name="TEST_Arch1", subject="TEST_UNIQKEY_ARCH")
        sid, stok = sess["session_id"], sess["session_token"]
        # add a customer message with a unique keyword

        async def send_msg():
            url = f"{WS_BASE}/ws/customer?session_id={sid}&session_token={stok}"
            async with websockets.connect(url) as cws:
                await cws.send(json.dumps({"type": "message", "content": "TEST_UNIQKEYWORD_XYZ hello"}))
                await asyncio.sleep(0.5)

        asyncio.run(send_msg())

        # close
        rc = requests.post(f"{API}/chat/sessions/{sid}/close",
                           headers=_hdr(admin_token), timeout=60)
        assert rc.status_code == 200

        # verify session fields
        r = requests.get(f"{API}/chat/sessions/{sid}", headers=_hdr(admin_token), timeout=30)
        assert r.status_code == 200
        s = r.json()
        assert s["status"] == "closed"
        assert s.get("archived_at") is not None
        assert s.get("closed_at") is not None

        # search by subject keyword
        r2 = requests.get(f"{API}/chat/archive/search",
                          params={"q": "TEST_UNIQKEY_ARCH"},
                          headers=_hdr(admin_token), timeout=30)
        assert r2.status_code == 200
        results = r2.json()
        assert any(x["id"] == sid for x in results), "archive search by subject failed"
        # Check enriched fields
        row = next(x for x in results if x["id"] == sid)
        assert "duration_seconds" in row
        assert "message_count" in row and row["message_count"] >= 1

        # Search by message content
        r3 = requests.get(f"{API}/chat/archive/search",
                          params={"q": "TEST_UNIQKEYWORD_XYZ"},
                          headers=_hdr(admin_token), timeout=30)
        assert r3.status_code == 200
        assert any(x["id"] == sid for x in r3.json()), "archive search by message content failed"

    def test_archive_search_requires_auth(self):
        r = requests.get(f"{API}/chat/archive/search", timeout=30)
        assert r.status_code == 401


# ====================== Agent load endpoint ============================
class TestAgentLoad:
    def test_me_load(self, agent_token):
        r = requests.get(f"{API}/agents/me/load", headers=_hdr(agent_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("active_chat_count", "max_active_chats", "at_capacity"):
            assert k in d
        assert d["max_active_chats"] == 20

    def test_list_agents_has_counts(self, agent_token):
        r = requests.get(f"{API}/agents", headers=_hdr(agent_token), timeout=30)
        assert r.status_code == 200
        for a in r.json():
            assert "active_chat_count" in a
            assert "max_active_chats" in a


# ====================== Typing preview =================================
class TestTypingPreview:
    def test_customer_typing_relayed_with_preview(self, agent_token):
        sess = _new_session(name="TEST_TypingCust")
        sid, stok = sess["session_id"], sess["session_token"]

        async def run():
            agent_url = f"{WS_BASE}/ws/agent?token={agent_token}"
            cust_url = f"{WS_BASE}/ws/customer?session_id={sid}&session_token={stok}"
            async with websockets.connect(agent_url) as aws, \
                    websockets.connect(cust_url) as cws:
                await asyncio.sleep(0.3)
                await cws.send(json.dumps({"type": "typing", "is_typing": True, "content": "Hello wo"}))
                got = None
                for _ in range(15):
                    try:
                        m = json.loads(await asyncio.wait_for(aws.recv(), timeout=3))
                    except asyncio.TimeoutError:
                        break
                    if m.get("type") == "typing" and m.get("sender_type") == "customer":
                        got = m
                        break
                assert got is not None, "no typing event"
                assert got.get("is_typing") is True
                assert got.get("preview") == "Hello wo", f"preview mismatch: {got}"

        asyncio.run(run())


# ====================== 20-active-chat cap =====================================
class TestChatCap:
    def test_auto_busy_and_no_autoassign_at_cap(self, admin_token):
        # 1. create a fresh agent so we don't disturb the seeded one
        email = f"testcap_{int(time.time())}@ex.com"
        rc = requests.post(f"{API}/agents", headers=_hdr(admin_token),
                           json={"email": email, "password": "pw12345",
                                 "name": "TEST_CapAgent", "role": "agent"}, timeout=30)
        assert rc.status_code == 200, rc.text
        agent_id = rc.json()["id"]

        # 2. Log in as the new agent to get a token
        rl = requests.post(f"{API}/auth/login",
                           json={"email": email, "password": "pw12345"}, timeout=30)
        assert rl.status_code == 200
        cap_token = rl.json()["token"]

        try:
            # 3. Seed 20 open sessions assigned to that agent via direct DB isn't possible from HTTP;
            # Instead use the WS auto-assign mechanism: create 20 sessions and have the agent send a
            # message on each — the WS handler will assign that session to the agent.
            session_ids = []
            for i in range(20):
                s = _new_session(name=f"TEST_Cap{i}", email=f"cap{i}@ex.com")
                session_ids.append((s["session_id"], s["session_token"]))

            # 21st unassigned session
            s21 = _new_session(name="TEST_Cap21", email="cap21@ex.com")
            sid21 = s21["session_id"]

            state = {}

            async def full_flow():
                url = f"{WS_BASE}/ws/agent?token={cap_token}"
                async with websockets.connect(url) as aws:
                    # assign 20
                    for sid, _ in session_ids:
                        await aws.send(json.dumps({
                            "type": "message", "session_id": sid, "content": f"assigning {sid[:6]}"
                        }))
                        await asyncio.sleep(0.05)
                    await asyncio.sleep(1.0)
                    # drain
                    for _ in range(30):
                        try:
                            await asyncio.wait_for(aws.recv(), timeout=0.3)
                        except asyncio.TimeoutError:
                            break
                    # Check status WHILE WS is still open
                    rload = requests.get(f"{API}/agents/me/load",
                                         headers=_hdr(cap_token), timeout=30)
                    state["load"] = rload.json()
                    rme = requests.get(f"{API}/auth/me", headers=_hdr(cap_token), timeout=30)
                    state["status"] = rme.json().get("status")

                    # Try 21st (over cap)
                    await aws.send(json.dumps({
                        "type": "message", "session_id": sid21, "content": "over-cap"
                    }))
                    await asyncio.sleep(0.5)
                    for _ in range(5):
                        try:
                            await asyncio.wait_for(aws.recv(), timeout=0.3)
                        except asyncio.TimeoutError:
                            break

            asyncio.run(full_flow())

            assert state["load"]["active_chat_count"] == 20, f"expected 20, got {state['load']}"
            assert state["load"]["at_capacity"] is True
            assert state["status"] == "busy", f"agent status not auto-busy: {state['status']}"

            # session21 should still be unassigned
            r21 = requests.get(f"{API}/chat/sessions/{sid21}",
                               headers=_hdr(admin_token), timeout=30)
            assert r21.status_code == 200
            assert r21.json().get("assigned_agent_id") in (None, ""), \
                f"session was auto-assigned despite cap: {r21.json().get('assigned_agent_id')}"

            # 7. Close one of the assigned sessions -> agent should flip back to online
            # First open the WS again (agent must be connected for auto-flip to be visible)
            close_sid = session_ids[0][0]

            async def close_flow():
                url = f"{WS_BASE}/ws/agent?token={cap_token}"
                async with websockets.connect(url) as aws:
                    await asyncio.sleep(0.3)
                    rcl = requests.post(f"{API}/chat/sessions/{close_sid}/close",
                                        headers=_hdr(admin_token), timeout=60)
                    assert rcl.status_code == 200
                    await asyncio.sleep(1.0)
                    rme2 = requests.get(f"{API}/auth/me",
                                        headers=_hdr(cap_token), timeout=30)
                    state["status_after_close"] = rme2.json().get("status")

            asyncio.run(close_flow())
            assert state["status_after_close"] == "online", \
                f"agent status did not auto-flip to online: {state['status_after_close']}"
        finally:
            # cleanup - delete the test agent
            try:
                requests.delete(f"{API}/agents/{agent_id}",
                                headers=_hdr(admin_token), timeout=30)
            except Exception:
                pass
