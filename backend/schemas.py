import json
import re
from pydantic import BaseModel
from pydantic import Field
from pydantic import field_serializer
from pydantic import field_validator
from pydantic import model_validator
from typing import Literal, Optional
from datetime import datetime, timezone

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
CHECKLIST_FIELDS = {"photo", "citizenship", "id", "payment"}


class CheckinRequest(BaseModel):
    location_id: Literal["csc", "bookstore"]
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: Optional[str] = Field(default=None, max_length=255)
    phone: str = Field(min_length=7, max_length=20)
    party_size: int = Field(ge=1, le=50)
    visit_type: Literal["appointment", "walk-in", "returning"]
    service_type: Optional[Literal["passports", "notary", "photo-only"]] = None
    photo_format: Optional[Literal["digital", "both", "printed"]] = None
    app_complete: Optional[bool] = None
    checklist: Optional[str] = Field(default=None, max_length=500)
    subscribe: bool = False

    @field_validator("first_name", "last_name", "phone")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Field cannot be blank")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if not value:
            return None
        if not EMAIL_RE.match(value):
            raise ValueError("Invalid email")
        return value

    @field_validator("checklist")
    @classmethod
    def validate_checklist(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("Checklist must be valid JSON") from exc
        if not isinstance(parsed, dict):
            raise ValueError("Checklist must be an object")
        if set(parsed) - CHECKLIST_FIELDS:
            raise ValueError("Checklist contains unknown fields")
        for field, field_value in parsed.items():
            if field_value is not None and not isinstance(field_value, bool):
                raise ValueError(f"Checklist field {field} must be boolean or null")
        return json.dumps(parsed, separators=(",", ":"))

    @model_validator(mode="after")
    def validate_service_flow(self):
        if self.visit_type != "returning" and self.service_type is None:
            raise ValueError("service_type is required for non-returning visits")
        if self.service_type != "photo-only" and self.photo_format is not None:
            raise ValueError("photo_format is only valid for photo-only visits")
        if self.service_type != "passports" and (self.app_complete is not None or self.checklist is not None):
            raise ValueError("passport document fields are only valid for passport visits")
        return self


class CheckinResponse(BaseModel):
    id: str
    message: str


class VisitorResponse(BaseModel):
    id: str
    location_id: str
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: str
    party_size: Optional[int] = None
    visit_type: str
    service_type: Optional[str] = None
    photo_format: Optional[str] = None
    app_complete: Optional[bool] = None
    checklist: Optional[str] = None
    subscribe: bool
    notes: str
    status: str
    check_in_at: datetime
    sign_out_at: Optional[datetime] = None

    model_config = {"from_attributes": True}

    @field_serializer("check_in_at", "sign_out_at")
    def serialize_as_utc(self, dt: Optional[datetime]) -> Optional[str]:
        # SQLite drops tzinfo on round-trip even though these are always
        # written as UTC (see models.py). Reattach it here so clients get an
        # unambiguous offset instead of a naive string that gets parsed as
        # the browser's local time.
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()


class StatusUpdate(BaseModel):
    status: Literal["Checked In", "Signed Out"]


class NotesUpdate(BaseModel):
    notes: str = Field(max_length=100)


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    token: str
    location_id: str


class QuestionUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=1000)


class QuestionConfig(BaseModel):
    photo: QuestionUpdate
    citizenship: QuestionUpdate
    id: QuestionUpdate
    payment: QuestionUpdate


class StatsResponse(BaseModel):
    total: int
    passports_count: int
    notary_count: int
    photo_only_count: int
    returning_count: int
    prep_rate: float
    walk_in_percent: float
    incomplete_app_count: int
    missing_photo_count: int
    missing_citizenship_count: int
    missing_id_count: int
    missing_payment_count: int
