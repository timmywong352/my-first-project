from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class CreateAgentBody(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "agent"


class UpdateAgentStatusBody(BaseModel):
    status: str  # online, offline, busy


class PreChatBody(BaseModel):
    name: str
    email: EmailStr
    subject: str
    page: Optional[str] = None
    location: Optional[str] = None


class AnonymousSessionBody(BaseModel):
    """Session created without a prechat form (Lily-first flow)."""
    client_id: Optional[str] = None       # localStorage-generated anonymous ID
    page: Optional[str] = None
    location: Optional[str] = None
    language: Optional[str] = "en"


class UpdateContactBody(BaseModel):
    """Customer supplies (or updates) their name/email mid-conversation."""
    session_token: str
    name: Optional[str] = None
    email: Optional[EmailStr] = None


class SendMessageBody(BaseModel):
    content: str = ""
    attachments: Optional[List[Dict[str, Any]]] = None


class EditMessageBody(BaseModel):
    content: str
    attachments: Optional[List[Dict[str, Any]]] = None


class QuickReplyBody(BaseModel):
    title: str
    content: str


class SettingsBody(BaseModel):
    widget_color: Optional[str] = None
    widget_accent: Optional[str] = None
    welcome_message: Optional[str] = None
    business_hours_start: Optional[str] = None
    business_hours_end: Optional[str] = None
    business_days: Optional[List[int]] = None
    inactivity_first_response_minutes: Optional[int] = None
    inactivity_auto_transfer: Optional[bool] = None
    inactivity_auto_message: Optional[str] = None
    inactivity_close_minutes: Optional[int] = None
    lily_enabled: Optional[bool] = None


class CsatBody(BaseModel):
    rating: int
