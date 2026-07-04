from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
from motor.motor_asyncio import AsyncIOMotorClient

# --- Env ---
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = os.environ.get("APP_NAME", "livechat")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@livechat.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

# --- Constants ---
JWT_ALGO = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 24  # 24h
MAX_ACTIVE_CHATS_PER_AGENT = 20
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"

ALLOWED_MIME_EXT = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "mp4": "video/mp4",
    "zip": "application/zip",
}

# --- Mongo ---
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
