import jwt as _jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from config import ACCESS_TOKEN_MINUTES, JWT_ALGO, JWT_SECRET, db
from deps import get_current_user
from models import LoginBody
from utils import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
async def login(body: LoginBody, response: Response):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], user["email"], user["role"])
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=False,
        samesite="lax", max_age=ACCESS_TOKEN_MINUTES * 60, path="/",
    )
    return {
        "token": token,
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"],
            "role": user["role"], "status": user.get("status", "offline"),
        },
    }


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    """Issue a fresh token. Accepts an expired token as long as its signature is valid
    and its expiry is within the last 30 days."""
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="No token provided")
    try:
        # Allow expired tokens (verify_exp=False) but check signature
        payload = _jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGO], options={"verify_exp": False},
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    # Reject tokens expired more than 30 days ago
    from datetime import datetime, timezone
    exp = payload.get("exp", 0)
    now = datetime.now(timezone.utc).timestamp()
    if now - exp > 30 * 24 * 3600:
        raise HTTPException(status_code=401, detail="Token too old to refresh")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    new_token = create_access_token(user["id"], user["email"], user["role"])
    response.set_cookie(
        key="access_token", value=new_token, httponly=True, secure=False,
        samesite="lax", max_age=ACCESS_TOKEN_MINUTES * 60, path="/",
    )
    return {
        "token": new_token,
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"],
            "role": user["role"], "status": user.get("status", "offline"),
        },
    }


@router.post("/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user
