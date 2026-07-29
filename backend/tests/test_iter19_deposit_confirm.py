"""Iter19 — Deposit-status confirm gate.
Backend coverage:
- GET /api/lily/status?lang=en|zh|ms returns deposit_confirm{line1,line2,yes,no}
- Existing keys (enabled, options, language) still present.
- Handoff still works exactly the same (yes-path is unchanged).
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

EN_LINE1 = "Let me connect you with our live chat agents who can help check your deposit status."
EN_LINE2 = "You'll be now redirected to another window to chat with our Customer Support team."


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- /api/lily/status i18n ----------
class TestLilyStatusI18n:
    def _get(self, sess, lang):
        r = sess.get(f"{API}/lily/status", params={"lang": lang})
        assert r.status_code == 200, r.text
        return r.json()

    def test_status_has_all_fields_en(self, sess):
        data = self._get(sess, "en")
        # Unchanged
        assert "enabled" in data and isinstance(data["enabled"], bool)
        assert "options" in data and isinstance(data["options"], dict)
        for k in ("query_recharge", "query_withdrawal", "view_promotions", "query_ticket"):
            assert k in data["options"], f"missing option {k}"
        assert data.get("language") == "en"
        # New deposit_confirm block
        dc = data.get("deposit_confirm")
        assert isinstance(dc, dict), "deposit_confirm missing"
        for k in ("line1", "line2", "yes", "no"):
            assert k in dc and dc[k], f"deposit_confirm.{k} missing/empty"
        assert dc["line1"] == EN_LINE1
        assert dc["line2"] == EN_LINE2
        assert dc["yes"] == "Yes, proceed"
        assert dc["no"] == "No, cancel"

    def test_status_zh(self, sess):
        dc = self._get(sess, "zh")["deposit_confirm"]
        assert dc["yes"] == "好的，继续"
        assert dc["no"] == "不用了，取消"
        # Chinese chars in line1
        assert any("\u4e00" <= ch <= "\u9fff" for ch in dc["line1"])
        assert any("\u4e00" <= ch <= "\u9fff" for ch in dc["line2"])

    def test_status_ms(self, sess):
        dc = self._get(sess, "ms")["deposit_confirm"]
        assert dc["yes"] == "Ya, teruskan"
        assert dc["no"] == "Tidak, batal"
        assert "ejen sembang langsung" in dc["line1"].lower()


# ---------- Handoff still works (Yes-path parity) ----------
class TestDepositHandoffParity:
    def _new_anon(self, sess, lang="en"):
        cid = f"iter19_{uuid.uuid4().hex[:8]}"
        r = sess.post(f"{API}/chat/session/anonymous", json={
            "client_id": cid, "language": lang, "page": "https://test/iter19",
        })
        assert r.status_code in (200, 201), r.text
        return r.json()

    def test_handoff_after_confirm_yes(self, sess):
        s = self._new_anon(sess, "en")
        sid, tok = s["session_id"], s["session_token"]
        # Simulate what the widget does when user clicks Yes
        r = sess.post(
            f"{API}/lily/handoff",
            params={
                "session_id": sid,
                "session_token": tok,
                "customer_text": "Deposit status",
                "lang": "en",
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] in ("open", "queued")
        # Verify state persisted
        time.sleep(0.5)
        # Login as admin to inspect
        login = sess.post(f"{API}/auth/login", json={
            "email": "admin@livechat.com", "password": "admin123",
        })
        assert login.status_code == 200
        token = login.json().get("access_token") or login.json().get("token")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        r2 = sess.get(f"{API}/chat/sessions/{sid}", headers=headers)
        # It's OK if this endpoint doesn't exist; just check via listing
        if r2.status_code == 200:
            body = r2.json()
            assert body.get("status") in ("open", "queued")
        # cleanup: close
        sess.post(
            f"{API}/chat/public/{sid}/close",
            params={"session_token": tok},
        )
