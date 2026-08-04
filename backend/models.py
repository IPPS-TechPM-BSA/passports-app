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
    visit_type = Column(String(20), nullable=False)       # appointment, walk-in, returning
    service_type = Column(String(20), nullable=True)      # passports, notary, photo-only
    photo_format = Column(String(20), nullable=True)      # digital, both, printed
    app_complete = Column(Boolean, nullable=True)
    checklist = Column(Text, nullable=True)               # JSON string
    subscribe = Column(Boolean, default=False)
    notes = Column(String(100), default="")
    status = Column(String(20), default="Checked In")     # Checked In, Signed Out
    check_in_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    sign_out_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    location = relationship("Location", back_populates="visitors")


class FormQuestion(Base):
    __tablename__ = "form_questions"

    key = Column(String(50), primary_key=True)   # photo, citizenship, id, payment
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
