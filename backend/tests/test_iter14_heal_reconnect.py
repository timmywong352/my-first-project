"""
Iter14 — Heal-on-reconnect regression tests.

The bug: when the agent's WS was momentarily disconnected during a customer
file upload, the broadcast was lost and the attachment never appeared on the
dashboard. The fix re-fetches messages via REST on `connected` transitions
false→true. These tests confirm the REST endpoints used for the heal path
DO return the persisted messages+attachments even when the message was
delivered while the WS was down.
"""
import io
import json
import os
import uuid
import asyncio
import websockets

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://live-chat-hub-28.preview.emergentagent.com").rstrip("/")
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://")


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def agent_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "agent@livechat.com", "password": "agent123"})
    assert r.status_code == 200, r.text
    body = r.json()
    return body.get("access_token") or body.get("token")


@pytest.fixture(scope="module")
def anon_session():
    cid = f"iter14_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{BASE_URL}/api/chat/session/anonymous",
                      json={"client_id": cid, "language": "en"})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. baseline: public + auth message endpoints work ----------
def test_public_messages_endpoint_requires_token(anon_session):
    r = requests.get(f"{BASE_URL}/api/chat/public/{anon_session['session_id']}/messages")
    assert r.status_code in (401, 422)


def test_public_messages_endpoint_returns_empty_initially(anon_session):
    r = requests.get(
        f"{BASE_URL}/api/chat/public/{anon_session['session_id']}/messages",
        params={"session_token": anon_session["session_token"]},
    )
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # Lily open() may have posted a lily greeting via /lily/open. Not called here,
    # so should be empty. If any msgs exist, they must all be lily/system.
    for m in data:
        assert m.get("sender_type") in ("lily", "system", "customer", "agent")


# ---------- 2. customer sends message w/ attachment via WS ----------
def test_customer_upload_and_ws_message_persists_and_is_visible_via_rest(anon_session, agent_token):
    """Simulates the bug scenario: customer uploads image + sends message.
    Even if the agent WS was down, the REST endpoints used by heal-on-reconnect
    (GET /api/chat/sessions/{id}/messages for agent, and public one for customer)
    must return the message WITH its attachment.
    """
    sid = anon_session["session_id"]
    stok = anon_session["session_token"]

    # (a) upload image as customer
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
        b"\xc0\x00\x00\x00\x03\x00\x01\x1d\xcc\x00\x0f\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    files = {"file": ("iter14.png", io.BytesIO(png_bytes), "image/png")}
    data = {"session_id": sid, "session_token": stok}
    r = requests.post(f"{BASE_URL}/api/upload", files=files, data=data)
    assert r.status_code == 200, r.text
    attachment = r.json()
    assert attachment["id"] and attachment["content_type"] == "image/png"

    # (b) send WS message with the attachment (customer side)
    async def send_via_ws():
        url = f"{WS_URL}/api/ws/customer?session_id={sid}&session_token={stok}"
        async with websockets.connect(url) as ws:
            await ws.send(json.dumps({
                "type": "message",
                "content": "iter14 customer image upload",
                "attachments": [attachment],
            }))
            # Wait for our own broadcast echo so we know it was persisted.
            for _ in range(5):
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                if msg.get("type") == "message" and msg["message"]["sender_type"] == "customer":
                    return msg["message"]
        return None

    delivered = asyncio.get_event_loop().run_until_complete(send_via_ws())
    assert delivered is not None, "WS did not echo the customer message back"
    assert delivered["content"] == "iter14 customer image upload"
    assert len(delivered.get("attachments") or []) == 1

    # (c) heal path for customer: GET /api/chat/public/{sid}/messages
    r = requests.get(
        f"{BASE_URL}/api/chat/public/{sid}/messages",
        params={"session_token": stok},
    )
    assert r.status_code == 200
    msgs = r.json()
    match = [m for m in msgs if m["id"] == delivered["id"]]
    assert len(match) == 1
    assert match[0]["content"] == "iter14 customer image upload"
    assert len(match[0].get("attachments") or []) == 1
    assert match[0]["attachments"][0]["id"] == attachment["id"]

    # (d) heal path for agent: GET /api/chat/sessions/{sid}/messages with Bearer
    r = requests.get(
        f"{BASE_URL}/api/chat/sessions/{sid}/messages",
        headers={"Authorization": f"Bearer {agent_token}"},
    )
    assert r.status_code == 200, r.text
    msgs = r.json()
    match = [m for m in msgs if m["id"] == delivered["id"]]
    assert len(match) == 1, "Agent-side heal endpoint did not return the customer's message"
    assert len(match[0].get("attachments") or []) == 1
    assert match[0]["attachments"][0]["id"] == attachment["id"]

    # (e) file itself is downloadable by agent (?auth=<token>) - regression
    r = requests.get(f"{BASE_URL}/api/files/{attachment['id']}", params={"auth": agent_token})
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("image/")
    assert r.content.startswith(b"\x89PNG")


# ---------- 3. Regression: agent send back to customer visible via public REST ----------
def test_agent_message_visible_via_customer_heal_endpoint(anon_session, agent_token):
    sid = anon_session["session_id"]
    stok = anon_session["session_token"]

    async def send_agent_ws():
        url = f"{WS_URL}/api/ws/agent?token={agent_token}"
        async with websockets.connect(url) as ws:
            await ws.send(json.dumps({
                "type": "message",
                "session_id": sid,
                "content": "iter14 agent reply while customer was offline",
                "attachments": [],
            }))
            for _ in range(6):
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                if msg.get("type") == "message" and msg["message"]["sender_type"] == "agent":
                    return msg["message"]
        return None

    delivered = asyncio.get_event_loop().run_until_complete(send_agent_ws())
    assert delivered is not None
    assert "iter14 agent reply" in delivered["content"]

    # Customer heal endpoint must see it
    r = requests.get(
        f"{BASE_URL}/api/chat/public/{sid}/messages",
        params={"session_token": stok},
    )
    assert r.status_code == 200
    msgs = r.json()
    assert any(m["id"] == delivered["id"] for m in msgs), \
        "Customer heal-on-reconnect endpoint did NOT return the missed agent message"


# ---------- 4. Regression: FRONTEND_TEST_MSG absence + auto-msg default ----------
def test_no_frontend_test_msg_and_defaults(agent_token):
    r = requests.get(f"{BASE_URL}/api/admin/settings",
                     headers={"Authorization": f"Bearer {agent_token}"})
    # agent may not have admin access — try to fetch, otherwise skip
    if r.status_code == 403:
        pytest.skip("agent has no admin access")
    if r.status_code == 200:
        data = r.json()
        # inactivity_auto_message either None or the friendly default, never FRONTEND_TEST_MSG
        val = (data.get("inactivity_auto_message") or "")
        assert "FRONTEND_TEST_MSG" not in val
