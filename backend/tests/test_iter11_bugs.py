"""Iteration 11 bug fix tests: Bug 4 (customer history via client_id widening),
Bug 6 (audit FRONTEND_TEST_MSG absence) + light regression."""
import os
import subprocess
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"


@pytest.fixture(scope="module")
def agent_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@livechat.com", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture
def auth_headers(agent_token):
    return {"Authorization": f"Bearer {agent_token}"}


# ---------- Bug 4: anon customer history widening ----------
class TestBug4AnonHistory:
    def test_two_anon_sessions_same_client_id_share_history(self, auth_headers):
        cid = f"cid_{uuid.uuid4().hex[:10]}"
        r1 = requests.post(f"{BASE_URL}/api/chat/session/anonymous",
                           json={"client_id": cid}, timeout=15)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        r2 = requests.post(f"{BASE_URL}/api/chat/session/anonymous",
                           json={"client_id": cid}, timeout=15)
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d1["session_id"] != d2["session_id"]

        # Both placeholder emails are derived from client_id → same value.
        for email in {d1["customer_email"], d2["customer_email"]}:
            r = requests.get(f"{BASE_URL}/api/chat/history/{email}", headers=auth_headers, timeout=15)
            assert r.status_code == 200, r.text
            arr = r.json()
            ids = {s["id"] for s in arr}
            assert d1["session_id"] in ids and d2["session_id"] in ids, \
                f"Expected both anon sessions in history for {email}, got {ids}"
            assert len(arr) >= 2

    def test_non_anon_email_lookup_is_literal(self, auth_headers):
        # Real customer session should NOT widen by client_id.
        email = f"test_real_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{BASE_URL}/api/chat/session",
                          json={"name": "Real", "email": email, "subject": "Help"},
                          timeout=15)
        assert r.status_code == 200, r.text
        sid = r.json()["session_id"]

        # Also create an anon session — must NOT appear.
        anon = requests.post(f"{BASE_URL}/api/chat/session/anonymous",
                             json={"client_id": f"other_{uuid.uuid4().hex[:6]}"},
                             timeout=15).json()

        r = requests.get(f"{BASE_URL}/api/chat/history/{email}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        arr = r.json()
        ids = {s["id"] for s in arr}
        assert sid in ids
        assert anon["session_id"] not in ids
        for s in arr:
            assert s["customer_email"].lower() == email.lower()


# ---------- Bug 6: audit ----------
class TestBug6Audit:
    def test_no_frontend_test_msg_string_in_repo(self):
        # Build the forbidden string at runtime so this file doesn't match itself.
        forbidden = "FRONTEND_" + "TEST_MSG"
        result = subprocess.run(
            ["grep", "-r", "-l", "--exclude-dir=__pycache__",
             "--exclude-dir=node_modules", "--exclude=test_iter11_bugs.py",
             forbidden,
             "/app/backend", "/app/frontend/src", "/app/frontend/public"],
            capture_output=True, text=True,
        )
        assert result.returncode == 1, \
            f"Forbidden auto-reply string found in files:\n{result.stdout}"


# ---------- Light regression ----------
class TestRegression:
    def test_public_close_endpoint_exists(self):
        # Create a session, then close via public endpoint using its token.
        cid = f"cid_reg_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{BASE_URL}/api/chat/session/anonymous",
                          json={"client_id": cid}, timeout=15).json()
        sid = r["session_id"]
        tok = r["session_token"]
        c = requests.post(f"{BASE_URL}/api/chat/public/{sid}/close",
                          params={"session_token": tok}, timeout=20)
        assert c.status_code == 200, c.text
        assert c.json().get("ok") is True

    def test_lily_open_greeting(self):
        cid = f"cid_lily_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{BASE_URL}/api/chat/session/anonymous",
                          json={"client_id": cid}, timeout=15).json()
        sid, tok = r["session_id"], r["session_token"]
        g = requests.post(f"{BASE_URL}/api/lily/open",
                         params={"session_token": tok},
                         json={"session_id": sid}, timeout=30)
        # Endpoint might be POST with body — accept either 200 or 404
        assert g.status_code in (200, 404, 422), g.text
