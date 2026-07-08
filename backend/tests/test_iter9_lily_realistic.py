"""Iteration 9 – Realistic Lily portrait + regreet + anonymous session tests."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://live-chat-hub-28.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def anon_session():
    r = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "TEST_iter9_client", "language": "en"})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- anonymous session ----------
def test_anon_session_shape(anon_session):
    data = anon_session
    assert data["anonymous"] is True
    assert data["customer_email"].endswith("@anon.pulse.local")
    assert data["session_id"]
    assert data["session_token"]


# ---------- TTS ----------
def test_lily_tts_returns_mp3():
    r = requests.post(f"{API}/lily/tts", json={"text": "test", "voice": "nova"})
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("audio/mpeg")
    assert len(r.content) > 200  # non-empty audio


def test_lily_tts_empty_text_rejected():
    r = requests.post(f"{API}/lily/tts", json={"text": "  ", "voice": "nova"})
    assert r.status_code == 400


# ---------- regreet ----------
def test_lily_regreet_excludes_previous(anon_session):
    sid, tok = anon_session["session_id"], anon_session["session_token"]
    # First open
    r0 = requests.post(f"{API}/lily/open", params={"session_id": sid, "session_token": tok, "lang": "en"})
    assert r0.status_code == 200, r0.text
    first = r0.json()["message"]["content"]

    seen = {first}
    last = first
    for _ in range(6):
        r = requests.post(f"{API}/lily/regreet", params={
            "session_id": sid, "session_token": tok, "lang": "en", "exclude": last,
        })
        assert r.status_code == 200, r.text
        text = r.json()["message"]["content"]
        assert text != last, "regreet returned excluded greeting"
        seen.add(text)
        last = text
    assert len(seen) >= 3, f"only saw {len(seen)} unique greetings"


def test_lily_regreet_invalid_token(anon_session):
    r = requests.post(f"{API}/lily/regreet", params={
        "session_id": anon_session["session_id"], "session_token": "bad", "lang": "en",
    })
    assert r.status_code == 401


# ---------- handoff ----------
def test_lily_handoff_saves_message_and_routes():
    # fresh session
    s = requests.post(f"{API}/chat/session/anonymous", json={"client_id": "TEST_iter9_handoff", "language": "en"}).json()
    sid, tok = s["session_id"], s["session_token"]
    requests.post(f"{API}/lily/open", params={"session_id": sid, "session_token": tok, "lang": "en"})

    r = requests.post(f"{API}/lily/handoff", params={
        "session_id": sid, "session_token": tok, "customer_text": "Deposit status", "lang": "en",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in ("open", "queued")

    # Verify the handoff line is persisted as a Lily message
    msgs = requests.get(f"{API}/chat/public/{sid}/messages", params={"session_token": tok}).json()
    contents = [m["content"] for m in msgs]
    assert any("connecting you to a human agent" in c for c in contents), contents
    assert "Deposit status" in contents


# ---------- status ----------
def test_lily_status_options_english():
    r = requests.get(f"{API}/lily/status", params={"lang": "en"})
    assert r.status_code == 200
    data = r.json()
    opts = data["options"]
    labels = {v["label"] for v in opts.values()}
    assert {"Deposit status", "Withdrawal status", "Promotions", "Ticket status"} <= labels


# ---------- realistic portrait asset ----------
def test_lily_realistic_png_served():
    r = requests.get(f"{BASE_URL}/lily_realistic.png")
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("image/")
    assert len(r.content) > 50_000  # ~700KB expected
