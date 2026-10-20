import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from .database import Base


class Location(Base):
    __tablename__ = "locations"

    id = Column(String(20), primary_key=True)  # 'csc', 'bookstore'
    name = Column(String(100), nullable=False)
    # Derived from the authoritative LOCATION_*_PASSWORD_HASH configuration.
    password_hash = Column(String(255), nullable=False)

    visitors = relationship("Visitor", back_populates="location")


class Visitor(Base):
    __tablename__ = "visitors"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    location_id = Column(String(20), ForeignKey("locations.id"), nullable=False)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=False)
    party_size = Column(Integer, nullable=True)
    visit_type = Column(String(20), nullable=False)       # appointment, walk-in (older rows may be "returning")
    service_type = Column(String(60), nullable=True)      # comma-separated: passports, notary, photo-only
    photo_format = Column(String(20), nullable=True)      # digital, both, printed
    app_complete = Column(Boolean, nullable=True)
    checklist = Column(Text, nullable=True)               # JSON string
    # Customer Survey step answers, comma-separated keys (see schemas.py).
    affiliations = Column(String(100), nullable=True)
    referral_sources = Column(String(200), nullable=True)
    subscribe = Column(Boolean, default=False)
    notes = Column(String(100), default="")
    status = Column(String(20), default="Checked In")     # Checked In, Signed Out
    check_in_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    sign_out_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    location = relationship("Location", back_populates="visitors")


class FormQuestion(Base):
    __tablename__ = "form_questions"

    key = Column(String(50), primary_key=True)   # photo, citizenship, id, payment, or a slug of a staff-added title
    position = Column(Integer, nullable=False, default=0)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    # Required questions must be answered Yes or No before a passport visitor can finish.
    required = Column(Boolean, nullable=False, default=True)


class SurveyQuestion(Base):
    __tablename__ = "survey_questions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    position = Column(Integer, nullable=False, default=0)
    question_type = Column(String(20), nullable=False)   # checkbox, text, rating, multiselect
    label = Column(String(200), nullable=False)
    required = Column(Boolean, nullable=False, default=False)
    options = Column(Text, nullable=True)                # JSON list of selections (multiselect only)


class SurveyResponse(Base):
    __tablename__ = "survey_responses"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    location_id = Column(String(20), ForeignKey("locations.id"), nullable=False)
    name = Column(String(200), nullable=False)
    email = Column(String(255), nullable=False)
    answers = Column(Text, nullable=False)               # JSON snapshot: [{question_id, type, label, value}]
    submitted_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
