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
# Checklist keys are form_questions.key values. Staff can add and remove
# questions, so the set is not fixed; only the shape is validated here.
QUESTION_KEY_RE = re.compile(r"^[a-z0-9_]{1,50}$")
MAX_FORM_QUESTIONS = 50


SERVICE_TYPES = ("passports", "notary", "photo-only")

# The check-in's Customer Survey step: answer keys in form order, with the
# English labels used in the CSV export.
AFFILIATIONS = {"student": "Student", "alumni": "Alumni", "staff": "Staff", "faculty": "Faculty", "na": "N/A"}
REFERRAL_SOURCES = {
    "web": "Web", "email": "Email", "passport_site": "Passport Site",
    "returning": "Returning", "signage": "Signage", "yelp": "Yelp", "other": "Other",
}


def clean_choices(value: str | None, allowed: dict[str, str]) -> str | None:
    """Comma-separated answer keys, checked and put in form order; None if none."""
    if value is None or not value.strip():
        return None
    chosen = {part.strip() for part in value.split(",") if part.strip()}
    if chosen - set(allowed):
        raise ValueError("Unknown answer")
    return ",".join(key for key in allowed if key in chosen)


def split_services(service_type: str | None) -> list[str]:
    """The services in a stored visitors.service_type value."""
    return [part for part in (service_type or "").split(",") if part]


def clean_email(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip().lower()
    if not value:
        return None
    if not EMAIL_RE.match(value):
        raise ValueError("Invalid email")
    return value


class CheckinRequest(BaseModel):
    location_id: Literal["csc", "bookstore"]
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=1, max_length=255)
    phone: str = Field(min_length=7, max_length=20)
    party_size: int = Field(ge=1, le=50)
    visit_type: Literal["appointment", "walk-in"]
    # One or more of SERVICE_TYPES, comma-separated: a visitor can need
    # several services in one visit.
    service_type: Optional[str] = Field(default=None, max_length=60)
    photo_format: Optional[Literal["digital", "both", "printed"]] = None
    app_complete: Optional[bool] = None
    checklist: Optional[str] = Field(default=None, max_length=4000)
    # Customer Survey step: both required, comma-separated answer keys.
    affiliations: str = Field(max_length=100)
    referral_sources: str = Field(max_length=200)
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
    def validate_email(cls, value: str) -> str:
        cleaned = clean_email(value)
        if cleaned is None:
            raise ValueError("Email is required")
        return cleaned

    @field_validator("service_type")
    @classmethod
    def validate_service_type(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        chosen = {part.strip() for part in value.split(",") if part.strip()}
        if chosen - set(SERVICE_TYPES):
            raise ValueError("Unknown service type")
        # Stored in a fixed order so the same selection always reads the same.
        return ",".join(service for service in SERVICE_TYPES if service in chosen)

    @field_validator("affiliations")
    @classmethod
    def validate_affiliations(cls, value: str) -> str:
        cleaned = clean_choices(value, AFFILIATIONS)
        if cleaned is None:
            raise ValueError("Choose at least one UC San Diego affiliation, or N/A")
        if "na" in cleaned.split(",") and cleaned != "na":
            raise ValueError("N/A cannot be combined with an affiliation")
        return cleaned

    @field_validator("referral_sources")
    @classmethod
    def validate_referral_sources(cls, value: str) -> str:
        cleaned = clean_choices(value, REFERRAL_SOURCES)
        if cleaned is None:
            raise ValueError("Choose at least one way you heard about us")
        return cleaned

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
        if len(parsed) > MAX_FORM_QUESTIONS:
            raise ValueError("Checklist contains too many fields")
        if any(not QUESTION_KEY_RE.match(field) for field in parsed):
            raise ValueError("Checklist contains invalid fields")
        for field, field_value in parsed.items():
            if field_value is not None and not isinstance(field_value, bool):
                raise ValueError(f"Checklist field {field} must be boolean or null")
        return json.dumps(parsed, separators=(",", ":"))

    @model_validator(mode="after")
    def validate_service_flow(self):
        services = split_services(self.service_type)
        if not services:
            raise ValueError("At least one service_type is required")
        if "photo-only" not in services and self.photo_format is not None:
            raise ValueError("photo_format is only valid for photo visits")
        if "passports" not in services and (self.app_complete is not None or self.checklist is not None):
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
    affiliations: Optional[str] = None
    referral_sources: Optional[str] = None
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


class BulkDeleteRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, value: list[str]) -> list[str]:
        value = list(dict.fromkeys(value))
        if not value:
            raise ValueError("At least one visitor id is required")
        for visitor_id in value:
            if not visitor_id or len(visitor_id) > 36:
                raise ValueError("Invalid visitor id")
        return value


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class LoginResponse(BaseModel):
    token: str
    location_id: str


class FormQuestionOut(BaseModel):
    key: str
    title: str
    description: str
    required: bool


class StatsResponse(BaseModel):
    total: int
    passports_count: int
    notary_count: int
    photo_only_count: int
    prep_rate: float
    walk_in_percent: float
    incomplete_app_count: int
    missing_photo_count: int
    missing_citizenship_count: int
    missing_id_count: int
    missing_payment_count: int


MAX_SURVEY_OPTIONS = 20


class SurveyQuestionIn(BaseModel):
    # An existing question keeps its id, and so its answers; none (or an
    # unknown id) adds a new question.
    id: Optional[str] = Field(None, max_length=36)
    question_type: Literal["checkbox", "text", "rating", "multiselect"]
    label: str = Field(min_length=1, max_length=200)
    required: bool = False
    # The possible selections of a "select all that apply" question.
    options: list[str] = Field(default_factory=list, max_length=MAX_SURVEY_OPTIONS)

    @field_validator("options")
    @classmethod
    def clean_options(cls, value: list[str]) -> list[str]:
        cleaned = [option.strip() for option in value if option.strip()]
        if any(len(option) > 100 for option in cleaned):
            raise ValueError("Options must be at most 100 characters")
        if len({option.lower() for option in cleaned}) != len(cleaned):
            raise ValueError("Options must be different from each other")
        return cleaned

    @model_validator(mode="after")
    def check_options_fit_the_type(self):
        if self.question_type != "multiselect":
            self.options = []
        elif not self.options:
            raise ValueError("A select-all-that-apply question needs at least one option")
        return self

    @field_validator("label")
    @classmethod
    def strip_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Label cannot be blank")
        return value


class SurveyQuestionConfig(BaseModel):
    questions: list[SurveyQuestionIn] = Field(max_length=50)


class SurveyQuestionOut(BaseModel):
    id: str
    type: str
    label: str
    required: bool
    options: list[str] = []


class SurveyAnswerIn(BaseModel):
    question_id: str = Field(min_length=1, max_length=36)
    # A list for "select all that apply" questions.
    value: bool | int | str | list[str] | None = None


class SurveyResponseRequest(BaseModel):
    location_id: Literal["csc", "bookstore"]
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=1, max_length=255)
    answers: list[SurveyAnswerIn] = Field(max_length=50)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be blank")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        cleaned = clean_email(value)
        if cleaned is None:
            raise ValueError("Invalid email")
        return cleaned


class SurveyAnswerOut(BaseModel):
    question_id: str
    type: str
    label: str
    value: bool | int | str | list[str] | None = None


class SurveyResponseOut(BaseModel):
    id: str
    location_id: str
    name: str
    email: str
    answers: list[SurveyAnswerOut]
    submitted_at: datetime

    @field_serializer("submitted_at")
    def serialize_as_utc(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
