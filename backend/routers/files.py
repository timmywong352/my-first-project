import uuid
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, Response, UploadFile

from config import ALLOWED_MIME_EXT, APP_NAME, db
from storage import get_object, put_object
from utils import decode_token, now_iso

router = APIRouter(tags=["files"])


async def _authorize_upload(request: Request, session_id: Optional[str], session_token: Optional[str]) -> str:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if token:
        payload = decode_token(token)
        if payload and payload.get("type") == "access":
            return f"agent:{payload['sub']}"
    if session_id and session_token:
        s = await db.sessions.find_one({"id": session_id})
        if s and s.get("session_token") == session_token:
            return f"customer:{session_id}"
    raise HTTPException(status_code=401, detail="Not authorized to upload")


@router.post("/upload")
async def upload(
    request: Request,
    file: UploadFile = File(...),
    session_id: Optional[str] = Form(None),
    session_token: Optional[str] = Form(None),
):
    identity = await _authorize_upload(request, session_id, session_token)
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename required")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_MIME_EXT:
        raise HTTPException(status_code=400, detail=f"File type .{ext} not allowed")
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")
    content_type = ALLOWED_MIME_EXT[ext]
    file_id = str(uuid.uuid4())
    safe_identity = identity.replace(":", "_")
    path = f"{APP_NAME}/uploads/{safe_identity}/{file_id}.{ext}"
    result = put_object(path, data, content_type)
    record = {
        "id": file_id,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "uploaded_by": identity,
        "is_deleted": False,
        "created_at": now_iso(),
    }
    await db.files.insert_one(record)
    record.pop("_id", None)
    return {
        "id": file_id,
        "url": f"/api/files/{file_id}",
        "filename": file.filename,
        "content_type": content_type,
        "size": record["size"],
        "ext": ext,
    }


@router.get("/files/{file_id}")
async def download_file(
    file_id: str,
    request: Request,
    auth: Optional[str] = Query(None),
    session_token: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
):
    authorized = False
    token = request.cookies.get("access_token")
    if not token:
        hdr = request.headers.get("Authorization", "")
        if hdr.startswith("Bearer "):
            token = hdr[7:]
    if not token and auth:
        token = auth
    if token:
        payload = decode_token(token)
        if payload and payload.get("type") == "access":
            authorized = True
    if not authorized and session_id and session_token:
        s = await db.sessions.find_one({"id": session_id})
        if s and s.get("session_token") == session_token:
            authorized = True
    if not authorized:
        raise HTTPException(status_code=401, detail="Not authorized")

    record = await db.files.find_one({"id": file_id, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    content, ct = get_object(record["storage_path"])
    return Response(
        content=content,
        media_type=record.get("content_type") or ct,
        headers={"Content-Disposition": f'inline; filename="{record["original_filename"]}"'},
    )
