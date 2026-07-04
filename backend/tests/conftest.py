"""Shared fixtures: purge 127.0.0.1 sessions before each test so the new 5/hour
rate-limit doesn't cascade across HTTP tests.

Uses pymongo (sync) to avoid conflicts with Motor's event loop across pytest tests.
"""
import os
import pytest
from pathlib import Path

# Read Mongo config directly (same as backend/config.py) via env
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception:
    pass

from pymongo import MongoClient

_MONGO_URL = os.environ.get("MONGO_URL")
_DB_NAME = os.environ.get("DB_NAME")
_client = MongoClient(_MONGO_URL) if _MONGO_URL else None
_db = _client[_DB_NAME] if _client is not None and _DB_NAME else None


@pytest.fixture(autouse=True)
def _purge_local_ip_sessions():
    """Purge 127.0.0.1 sessions BEFORE each test to prevent the new 5/hr rate limit
    from cascading. Preserves the shared `chat_session` fixture (customer email
    `test_customer@example.com`) so class-scoped downstream tests keep working."""
    if _db is not None:
        try:
            _db.sessions.delete_many({
                "creator_ip": "127.0.0.1",
                "customer_email": {"$ne": "test_customer@example.com"},
            })
        except Exception:
            pass
    yield
