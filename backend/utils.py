import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional

from config import JWT_SECRET, JWT_ALGO, ACCESS_TOKEN_MINUTES


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_real_client_ip(request) -> str:
    """Extract the real client IP from a FastAPI/Starlette request.

    Kubernetes ingress and other reverse proxies drop the actual visitor IP
    into ``X-Forwarded-For`` (comma-separated, leftmost = original) or
    ``X-Real-IP``. Falls back to ``request.client.host`` (the proxy) if
    neither header is present.
    """
    if not request:
        return ""
    hdrs = request.headers
    xff = hdrs.get("x-forwarded-for") or hdrs.get("X-Forwarded-For")
    if xff:
        # First IP is the original client; trim whitespace
        first = xff.split(",")[0].strip()
        if first:
            return first
    xrip = hdrs.get("x-real-ip") or hdrs.get("X-Real-IP")
    if xrip and xrip.strip():
        return xrip.strip()
    return request.client.host if request.client else ""



def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        return None
