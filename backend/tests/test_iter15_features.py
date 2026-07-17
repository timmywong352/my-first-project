"""Iter15 tests: WS since_id replay, language switcher, audit trail edits."""
import os
import uuid
import time
import json
import asyncio
import pytest
import requests
import websockets
from pathlib import Path
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
except Exception:
    pass

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
WS_BASE = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api"

ADMIN_EMAIL, ADMIN_PW = "admin@livechat.com", "admin123"
AGENT_EMAIL, AGENT_PW = "agent@livechat.com", "agent123"


# --------- Auth helpers ---------
def login(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def agent_token():
    return login(AGENT_EMAIL, AGENT_PW)


@pytest.fixture(scope="module")
def admin_token():
    return login(ADMIN_EMAIL, ADMIN_PW)


@pytest.fixture(scope="module")
def anon_session():
    cid = f"iter15_{uuid.uuid4().hex[:10]}"
    r = requests.post(
        f"{BASE_URL}/api/chat/session/anonymous",
        json={"client_id": cid, "language": "en"},
        timeout=15,
    )
    if r.status_code == 429:
        pytest.skip("Rate limit hit on anonymous session creation")
    assert r.status_code == 200, r.text
    return r.json()


# --------- F3 language switcher (backend contract) ---------
class TestLilyLang:
    def test_lily_status_en(self):
        r = requests.get(f"{BASE_URL}/api/lily/status?lang=en", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d.get("language") == "en"
        assert isinstance(d.get("options"), dict)

    def test_lily_status_zh_options_chinese(self):
        r = requests.get(f"{BASE_URL}/api/lily/status?lang=zh", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d.get("language") == "zh"
        opts = d.get("options", {})
        labels = " ".join(
            (v.get("label", "") if isinstance(v, dict) else str(v)) for v in opts.values()
        )
        # Contains at least one CJK char
        assert any("\u4e00" <= c <= "\u9fff" for c in labels), f"Expected Chinese in options: {labels}"

    def test_lily_status_ms_options_malay(self):
        r = requests.get(f"{BASE_URL}/api/lily/status?lang=ms", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d.get("language") == "ms"
        opts = d.get("options", {})
        labels = " ".join(
            (v.get("label", "") if isinstance(v, dict) else str(v)) for v in opts.values()
        )
        low = labels.lower()
        # Malay option cues per PRD: Status deposit / pengeluaran / Promosi / tiket
        assert any(k in low for k in ["status", "pengeluaran", "promosi", "tiket"]), labels

    def test_lily_open_zh_greeting(self, anon_session):
        r = requests.post(
            f"{BASE_URL}/api/lily/open",
            params={
                "session_id": anon_session["session_id"],
                "session_token": anon_session["session_token"],
                "lang": "zh",
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        msg = d.get("message") or {}
        greeting = msg.get("content", "") if isinstance(msg, dict) else str(msg)
        assert any("\u4e00" <= c <= "\u9fff" for c in greeting), f"Expected Chinese greeting: {greeting}"


# --------- F1 since_id WS replay ---------
class TestSinceIdReplayCustomer:
    @pytest.mark.asyncio
    async def test_customer_sync_replay(self, anon_session, agent_token):
        sid = anon_session["session_id"]
        stok = anon_session["session_token"]
        ws_url = f"{WS_BASE}/ws/customer?session_id={sid}&session_token={stok}"

        # Connect briefly to establish presence, then close.
        async with websockets.connect(ws_url) as ws:
            # customer sends one msg so we have an anchor
            await ws.send(json.dumps({"type": "message", "content": "iter15 anchor"}))
            got_anchor = None
            for _ in range(5):
                m = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                if m.get("type") == "message" and m["message"].get("content") == "iter15 anchor":
                    got_anchor = m["message"]
                    break
            assert got_anchor, "did not receive anchor message"
            anchor_id = got_anchor["id"]

        # WS closed. Inject 2 agent messages via REST-like path: use agent WS to send.
        agent_ws_url = f"{WS_BASE}/ws/agent?token={agent_token}"
        async with websockets.connect(agent_ws_url) as aws:
            await aws.send(json.dumps({
                "type": "message", "session_id": sid, "content": "missed-1-iter15",
            }))
            await asyncio.sleep(0.3)
            await aws.send(json.dumps({
                "type": "message", "session_id": sid, "content": "missed-2-iter15",
            }))
            await asyncio.sleep(0.5)

        # Reconnect customer WS and send `sync` with since_id=anchor_id
        async with websockets.connect(ws_url) as ws2:
            await ws2.send(json.dumps({"type": "sync", "since_id": anchor_id}))
            replayed = []
            try:
                while True:
                    m = json.loads(await asyncio.wait_for(ws2.recv(), timeout=3))
                    if m.get("type") == "message":
                        replayed.append(m["message"].get("content"))
            except asyncio.TimeoutError:
                pass
        assert "missed-1-iter15" in replayed, replayed
        assert "missed-2-iter15" in replayed, replayed
        # Anchor should NOT be replayed
        assert "iter15 anchor" not in replayed

    @pytest.mark.asyncio
    async def test_agent_sync_replay(self, agent_token):
        # Create a new session so we don't tangle with the above
        cid = f"iter15b_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{BASE_URL}/api/chat/session/anonymous",
            json={"client_id": cid, "language": "en"}, timeout=15,
        )
        if r.status_code == 429:
            pytest.skip("Rate limit")
        anon = r.json()
        sid = anon["session_id"]
        stok = anon["session_token"]

        # send an initial customer msg via customer WS to be the anchor
        cust_url = f"{WS_BASE}/ws/customer?session_id={sid}&session_token={stok}"
        anchor_id = None
        async with websockets.connect(cust_url) as cws:
            await cws.send(json.dumps({"type": "message", "content": "agent-anchor"}))
            for _ in range(5):
                m = json.loads(await asyncio.wait_for(cws.recv(), timeout=5))
                if m.get("type") == "message" and m["message"].get("content") == "agent-anchor":
                    anchor_id = m["message"]["id"]
                    break
        assert anchor_id

        # inject a new customer msg while agent WS is disconnected
        async with websockets.connect(cust_url) as cws:
            await cws.send(json.dumps({"type": "message", "content": "cust-missed-iter15"}))
            await asyncio.sleep(0.5)

        # Now open agent WS and send sync
        agent_url = f"{WS_BASE}/ws/agent?token={agent_token}"
        async with websockets.connect(agent_url) as aws:
            await aws.send(json.dumps({
                "type": "sync", "session_id": sid, "since_id": anchor_id,
            }))
            got = []
            try:
                while True:
                    m = json.loads(await asyncio.wait_for(aws.recv(), timeout=3))
                    if m.get("type") == "message":
                        got.append(m["message"].get("content"))
            except asyncio.TimeoutError:
                pass
        assert "cust-missed-iter15" in got, got


# --------- F4 Audit trail ---------
class TestAuditTrail:
    @pytest.mark.asyncio
    async def test_edit_twice_and_audit(self, agent_token, admin_token):
        # Create a fresh anon session
        cid = f"iter15c_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{BASE_URL}/api/chat/session/anonymous",
            json={"client_id": cid, "language": "en"}, timeout=15,
        )
        if r.status_code == 429:
            pytest.skip("Rate limit")
        anon = r.json()
        sid = anon["session_id"]
        stok = anon["session_token"]

        # Agent sends a message via WS (needs assignment). Use agent WS.
        async with websockets.connect(f"{WS_BASE}/ws/agent?token={agent_token}") as aws:
            await aws.send(json.dumps({
                "type": "message", "session_id": sid, "content": "v0-original",
            }))
            msg = None
            for _ in range(6):
                m = json.loads(await asyncio.wait_for(aws.recv(), timeout=5))
                if m.get("type") == "message" and m["message"].get("content") == "v0-original":
                    msg = m["message"]
                    break
        assert msg, "did not receive agent msg echo"
        msg_id = msg["id"]

        # PATCH twice (agent)
        h = {"Authorization": f"Bearer {agent_token}"}
        r1 = requests.patch(f"{BASE_URL}/api/chat/messages/{msg_id}",
                            headers=h, json={"content": "v1-edit"}, timeout=10)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        # agent response must be stripped
        assert "previous_versions" not in d1
        assert "original_content" not in d1
        assert d1.get("edited") is True
        assert d1.get("content") == "v1-edit"

        r2 = requests.patch(f"{BASE_URL}/api/chat/messages/{msg_id}",
                            headers=h, json={"content": "v2-final"}, timeout=10)
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert "previous_versions" not in d2
        assert d2.get("content") == "v2-final"

        # (a) admin audit endpoint
        ha = {"Authorization": f"Bearer {admin_token}"}
        ra = requests.get(f"{BASE_URL}/api/admin/audit/edits",
                          headers=ha, params={"session_id": sid}, timeout=10)
        assert ra.status_code == 200, ra.text
        rows = ra.json()
        row = next((r for r in rows if r["id"] == msg_id), None)
        assert row, f"msg {msg_id} not in audit rows"
        assert row.get("original_content") == "v0-original", row
        pv = row.get("previous_versions") or []
        assert len(pv) == 2, f"expected 2 previous_versions, got {len(pv)}: {pv}"
        assert pv[0]["content"] == "v0-original"
        assert pv[1]["content"] == "v1-edit"
        assert pv[0].get("edited_by_name")

        # (b) agent GET messages: no audit fields
        rg = requests.get(f"{BASE_URL}/api/chat/sessions/{sid}/messages",
                          headers=h, timeout=10)
        assert rg.status_code == 200
        agent_msg = next((m for m in rg.json() if m["id"] == msg_id), None)
        assert agent_msg
        assert agent_msg.get("edited") is True
        assert "previous_versions" not in agent_msg
        assert "original_content" not in agent_msg
        assert "edited_by_name" not in agent_msg

        # (c) customer GET messages: no `edited` flag
        rc = requests.get(f"{BASE_URL}/api/chat/public/{sid}/messages",
                          params={"session_token": stok}, timeout=10)
        assert rc.status_code == 200
        cust_msg = next((m for m in rc.json() if m["id"] == msg_id), None)
        assert cust_msg
        assert cust_msg.get("content") == "v2-final"
        assert "edited" not in cust_msg, cust_msg
        assert "previous_versions" not in cust_msg
        assert "original_content" not in cust_msg

    def test_non_admin_cannot_access_audit(self, agent_token):
        h = {"Authorization": f"Bearer {agent_token}"}
        r = requests.get(f"{BASE_URL}/api/admin/audit/edits", headers=h, timeout=10)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"


# --------- Regression: FRONTEND_TEST_MSG absent, admin settings sane ---------
class TestRegressions:
    def test_public_settings_no_frontend_test_msg(self):
        r = requests.get(f"{BASE_URL}/api/public/settings", timeout=10)
        assert r.status_code == 200
        assert "FRONTEND_TEST_MSG" not in json.dumps(r.json())

    def test_admin_settings_no_frontend_test_msg(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/settings",
                         headers={"Authorization": f"Bearer {admin_token}"}, timeout=10)
        assert r.status_code == 200
        assert "FRONTEND_TEST_MSG" not in json.dumps(r.json())
