import csv
import io
import json
import logging
import os
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .models import Location, Visitor, FormQuestion
from .schemas import (
    CheckinRequest, CheckinResponse, VisitorResponse,
    StatusUpdate, NotesUpdate, LoginRequest, LoginResponse,
    QuestionUpdate, QuestionConfig, StatsResponse,
)
from .auth import verify_password, create_token, decode_token, require_jwt_secret
from .sse import notification_manager
from .seed import seed_database
from .migrate import run_migrations

logger = logging.getLogger(__name__)

# uvicorn configures handlers for its own loggers but leaves the root logger
# alone, so records from backend.* would fall through to the WARNING-level
# last-resort handler and vanish. Give the package its own stderr handler so
# startup messages -- notably the one-time migration adoption line -- are
# visible in `kubectl logs`.
_package_logger = logging.getLogger("backend")
if not _package_logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:     %(message)s"))
    _package_logger.addHandler(_handler)
    _package_logger.propagate = False
_package_logger.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

_startup_error: str | None = None

CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n", "＝", "＋", "－", "＠")


def escape_csv_formula_cell(value) -> str:
    text = "" if value is None else str(value)
    if text.startswith(CSV_FORMULA_PREFIXES):
        return f"'{text}"
    return text


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _startup_error
    require_jwt_secret()
    try:
        # Must complete before any other database access: run_migrations opens
        # its own short-lived sync connection, so nothing else may hold one
        # open while DDL runs.
        await run_migrations()
        async for db in get_db():
            app.state.location_password_hashes = await seed_database(db)
            break
        logger.info("Database migrations applied and seed data ensured")
    except Exception as e:
        _startup_error = f"Database init failed: {e}"
        logger.exception(_startup_error)
        raise
    yield


app = FastAPI(title="UC San Diego Passports API", lifespan=lifespan)

# Visitor check-in/sign-out timestamps are stored as naive UTC (see models.py);
# reports and exports display them in Pacific time for on-site staff.
PACIFIC = ZoneInfo("America/Los_Angeles")


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "img-src 'self' data: https://api.qrserver.com https://cdn.ucsd.edu; "
        "style-src 'self' 'unsafe-inline' https://cdn.ucsd.edu; "
        "font-src 'self' data: https://cdn.ucsd.edu; "
        "script-src 'self'; connect-src 'self'",
    )
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")


# --- Auth Dependency ---

async def get_current_location(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    token = auth.removeprefix("Bearer ")
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload["location_id"]


# --- Public Routes ---

@app.post("/api/auth/login")
async def login(
    body: LoginRequest,
    request: Request,
):
    password_hashes: dict[str, str] = request.app.state.location_password_hashes
    for location_id, password_hash in password_hashes.items():
        if verify_password(body.password, password_hash):
            token = create_token(location_id)
            return LoginResponse(token=token, location_id=location_id)
    raise HTTPException(status_code=401, detail="Invalid password")


@app.post("/api/checkin", response_model=CheckinResponse)
async def checkin(
    body: CheckinRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Location).where(Location.id == body.location_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=400, detail="Invalid location")

    visitor = Visitor(
        location_id=body.location_id,
        first_name=body.first_name,
        last_name=body.last_name,
        email=body.email or None,
        phone=body.phone,
        party_size=body.party_size,
        visit_type=body.visit_type,
        service_type=body.service_type or None,
        photo_format=body.photo_format or None,
        app_complete=body.app_complete,
        checklist=body.checklist,
        subscribe=body.subscribe,
        status="Checked In",
    )
    db.add(visitor)
    await db.commit()
    await db.refresh(visitor)

    await notification_manager.publish(body.location_id, "checkin", {
        "id": visitor.id,
        "first_name": visitor.first_name,
        "last_name": visitor.last_name,
        "service_type": visitor.service_type,
    })

    return CheckinResponse(id=visitor.id, message="Check-in successful")


# --- Protected Routes (require JWT) ---

@app.get("/api/visitors", response_model=list[VisitorResponse])
async def get_visitors(
    location: str = Query(...),
    date: str | None = Query(None),
    search: str | None = Query(None, max_length=100),
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    if _loc != location:
        raise HTTPException(status_code=403, detail="Location mismatch")

    stmt = select(Visitor).where(Visitor.location_id == location)

    if date:
        stmt = stmt.where(func.date(Visitor.check_in_at) == date)

    if search:
        q = f"%{search}%"
        stmt = stmt.where(
            Visitor.first_name.ilike(q) |
            Visitor.last_name.ilike(q) |
            Visitor.email.ilike(q) |
            Visitor.phone.ilike(q)
        )

    stmt = stmt.order_by(Visitor.check_in_at.desc())
    result = await db.execute(stmt)
    visitors = result.scalars().all()

    return [VisitorResponse.model_validate(v) for v in visitors]


@app.patch("/api/visitors/{visitor_id}/status")
async def update_visitor_status(
    visitor_id: str,
    body: StatusUpdate,
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    result = await db.execute(select(Visitor).where(Visitor.id == visitor_id))
    visitor = result.scalar_one_or_none()
    if visitor is None:
        raise HTTPException(status_code=404, detail="Visitor not found")
    if visitor.location_id != _loc:
        raise HTTPException(status_code=403, detail="Location mismatch")

    visitor.status = body.status
    if body.status == "Signed Out":
        visitor.sign_out_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


@app.patch("/api/visitors/{visitor_id}/notes")
async def update_visitor_notes(
    visitor_id: str,
    body: NotesUpdate,
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    result = await db.execute(select(Visitor).where(Visitor.id == visitor_id))
    visitor = result.scalar_one_or_none()
    if visitor is None:
        raise HTTPException(status_code=404, detail="Visitor not found")
    if visitor.location_id != _loc:
        raise HTTPException(status_code=403, detail="Location mismatch")

    visitor.notes = (body.notes or "")[:100]
    await db.commit()
    return {"ok": True}


@app.get("/api/visitors/export")
async def export_visitors(
    location: str = Query(...),
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    if _loc != location:
        raise HTTPException(status_code=403, detail="Location mismatch")

    result = await db.execute(
        select(Visitor).where(Visitor.location_id == location).order_by(Visitor.check_in_at.desc())
    )
    visitors = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "First Name", "Last Name", "Email", "Phone", "Party Size",
        "Visit Type", "Service Type", "Photo Format",
        "Application Complete", "Checklist",
        "Subscribe", "Notes", "Status",
        "Check-In Date (PT)", "Check-In Time (PT)", "Sign-Out Time (PT)",
    ])

    def to_pacific(dt):
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(PACIFIC)

    def fmt_date(dt):
        dt = to_pacific(dt)
        return dt.strftime("%Y-%m-%d") if dt else ""

    def fmt_time(dt):
        dt = to_pacific(dt)
        return dt.strftime("%H:%M") if dt else ""

    def yes_no(val):
        if val is True:
            return "Yes"
        if val is False:
            return "No"
        return ""

    def fmt_phone(raw):
        digits = "".join(ch for ch in (raw or "") if ch.isdigit())
        if len(digits) == 10:
            return f"{digits[0:3]}-{digits[3:6]}-{digits[6:10]}"
        if len(digits) == 11 and digits[0] == "1":
            return f"1-{digits[1:4]}-{digits[4:7]}-{digits[7:11]}"
        return raw

    for v in visitors:
        writer.writerow([
            escape_csv_formula_cell(v.id),
            escape_csv_formula_cell(v.first_name),
            escape_csv_formula_cell(v.last_name),
            escape_csv_formula_cell(v.email),
            escape_csv_formula_cell(fmt_phone(v.phone)),
            escape_csv_formula_cell(v.party_size),
            escape_csv_formula_cell(v.visit_type),
            escape_csv_formula_cell(v.service_type),
            escape_csv_formula_cell(v.photo_format),
            escape_csv_formula_cell(yes_no(v.app_complete)),
            escape_csv_formula_cell(v.checklist),
            escape_csv_formula_cell(yes_no(v.subscribe)),
            escape_csv_formula_cell(v.notes),
            escape_csv_formula_cell(v.status),
            fmt_date(v.check_in_at), fmt_time(v.check_in_at), fmt_time(v.sign_out_at),
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=visitors_{location}.csv"},
    )


@app.get("/api/questions")
async def get_questions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(FormQuestion))
    questions = result.scalars().all()
    return {q.key: {"title": q.title, "description": q.description} for q in questions}


@app.put("/api/questions")
async def update_questions(
    body: QuestionConfig,
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    for key, val in [("photo", body.photo), ("citizenship", body.citizenship),
                     ("id", body.id), ("payment", body.payment)]:
        result = await db.execute(select(FormQuestion).where(FormQuestion.key == key))
        q = result.scalar_one_or_none()
        if q:
            q.title = val.title
            q.description = val.description
    await db.commit()
    return {"ok": True}


@app.get("/api/stats", response_model=StatsResponse)
async def get_stats(
    location: str = Query(...),
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    if _loc != location:
        raise HTTPException(status_code=403, detail="Location mismatch")

    result = await db.execute(
        select(Visitor).where(Visitor.location_id == location)
    )
    visitors = result.scalars().all()
    total = len(visitors)

    passports = [v for v in visitors if v.service_type == "passports"]
    notary = [v for v in visitors if v.service_type == "notary"]
    photo_only = [v for v in visitors if v.service_type == "photo-only"]
    returning = [v for v in visitors if v.service_type is None]

    passports_count = len(passports)
    notary_count = len(notary)
    photo_only_count = len(photo_only)
    returning_count = len(returning)

    walk_ins = [v for v in visitors if v.visit_type == "walk-in"]
    walk_in_percent = round((len(walk_ins) / total * 100), 1) if total > 0 else 0

    incomplete_app = [v for v in passports if v.app_complete is False]
    prep_rate = round(
        ((passports_count - len(incomplete_app)) / passports_count * 100), 1
    ) if passports_count > 0 else 0

    def checklist_value(v: Visitor, field: str):
        if not v.checklist:
            return None
        try:
            parsed = json.loads(v.checklist)
        except json.JSONDecodeError:
            return None
        if not isinstance(parsed, dict):
            return None
        return parsed.get(field)

    def missing(field):
        return [v for v in passports if checklist_value(v, field) is False]

    return StatsResponse(
        total=total,
        passports_count=passports_count,
        notary_count=notary_count,
        photo_only_count=photo_only_count,
        returning_count=returning_count,
        prep_rate=prep_rate,
        walk_in_percent=walk_in_percent,
        incomplete_app_count=len(incomplete_app),
        missing_photo_count=len(missing("photo")),
        missing_citizenship_count=len(missing("citizenship")),
        missing_id_count=len(missing("id")),
        missing_payment_count=len(missing("payment")),
    )


# --- Health Check ---

@app.get("/api/health")
async def health():
    if _startup_error:
        return {"status": "error", "detail": _startup_error}
    return {"status": "ok"}


# --- SPA catch-all ---

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    if full_path.startswith("api/") or full_path.startswith("events"):
        raise HTTPException(status_code=404, detail="Not found")
    if STATIC_DIR.is_dir() and (STATIC_DIR / "index.html").exists():
        return FileResponse(str(STATIC_DIR / "index.html"))
    raise HTTPException(status_code=404, detail="Not found")
