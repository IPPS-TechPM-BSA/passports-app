import csv
import io
import json
import logging
import os
import re
from datetime import date as Date, datetime, timedelta, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .models import Location, Visitor, FormQuestion, SurveyQuestion, SurveyResponse
from .schemas import (
    AFFILIATIONS, REFERRAL_SOURCES,
    split_services,
    CheckinRequest, CheckinResponse, VisitorResponse,
    StatusUpdate, NotesUpdate, LoginRequest, LoginResponse,
    FormQuestionOut, StatsResponse,
    BulkDeleteRequest,
    SurveyAnswerOut, SurveyQuestionConfig, SurveyQuestionOut,
    SurveyResponseOut, SurveyResponseRequest,
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
        affiliations=body.affiliations,
        referral_sources=body.referral_sources,
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

_DAY_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def _parse_day(day: str) -> Date:
    """A YYYY-MM-DD calendar day. strptime alone would also accept "2026-1-5",
    whose string order differs from its date order."""
    try:
        if not _DAY_PATTERN.fullmatch(day):
            raise ValueError(day)
        return datetime.strptime(day, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date")


def _pacific_day_start(day: Date) -> datetime:
    """The naive-UTC instant at which a Pacific calendar day begins."""
    midnight = datetime(day.year, day.month, day.day, tzinfo=PACIFIC)
    return midnight.astimezone(timezone.utc).replace(tzinfo=None)


def _check_in_between(start: str | None, end: str | None) -> list:
    """Filters for check-ins from the start of Pacific day `start` through the
    end of Pacific day `end`, both inclusive; either may be omitted.

    Check-ins are stored as naive UTC, but staff think in Pacific days: a 5 pm
    visit is already "tomorrow" in UTC.
    """
    start_day = _parse_day(start) if start else None
    end_day = _parse_day(end) if end else None
    if start_day and end_day and start_day > end_day:
        raise HTTPException(status_code=400, detail="Start date is after end date")
    conditions = []
    if start_day:
        conditions.append(Visitor.check_in_at >= _pacific_day_start(start_day))
    # The last representable day has no next day; nothing comes after it anyway.
    if end_day and end_day < Date.max:
        # The next day's midnight, not end + 24 hours: DST days are 23 or 25 hours.
        conditions.append(Visitor.check_in_at < _pacific_day_start(end_day + timedelta(days=1)))
    return conditions


def _resolve_range(date: str | None, start: str | None, end: str | None) -> tuple[str | None, str | None]:
    """`date` is shorthand for a one-day range, so it can't be combined with one."""
    if date:
        if start or end:
            raise HTTPException(status_code=400, detail="Use either date or start/end, not both")
        return date, date
    return start, end


@app.get("/api/visitors", response_model=list[VisitorResponse])
async def get_visitors(
    location: str = Query(...),
    date: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    search: str | None = Query(None, max_length=100),
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    """Visitors, newest first, optionally limited to one Pacific `date` or to
    check-ins between two Pacific days (YYYY-MM-DD, both inclusive)."""
    if _loc != location:
        raise HTTPException(status_code=403, detail="Location mismatch")

    start, end = _resolve_range(date, start, end)
    stmt = select(Visitor).where(Visitor.location_id == location, *_check_in_between(start, end))

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
    else:
        # Undoing a sign-out restores the visitor to the active queue and
        # clears the stale timestamp so exports show no sign-out time.
        visitor.sign_out_at = None
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


@app.delete("/api/visitors/{visitor_id}")
async def delete_visitor(
    visitor_id: str,
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    result = await db.execute(select(Visitor).where(Visitor.id == visitor_id))
    visitor = result.scalar_one_or_none()
    if visitor is None:
        raise HTTPException(status_code=404, detail="Visitor not found")
    if visitor.location_id != _loc:
        raise HTTPException(status_code=403, detail="Location mismatch")

    await db.delete(visitor)
    await db.commit()
    return {"ok": True}


@app.post("/api/visitors/bulk-delete")
async def bulk_delete_visitors(
    body: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    result = await db.execute(select(Visitor).where(Visitor.id.in_(body.ids)))
    visitors = list(result.scalars().all())
    if len(visitors) != len(body.ids):
        raise HTTPException(status_code=404, detail="One or more visitors not found")
    for visitor in visitors:
        if visitor.location_id != _loc:
            raise HTTPException(status_code=403, detail="Location mismatch")

    for visitor in visitors:
        await db.delete(visitor)
    await db.commit()
    return {"ok": True, "deleted": len(visitors)}


@app.get("/api/visitors/export")
async def export_visitors(
    location: str = Query(...),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    """CSV of the visitors between two Pacific days (both inclusive, either
    may be omitted), matching the range shown in the visitor log."""
    if _loc != location:
        raise HTTPException(status_code=403, detail="Location mismatch")

    result = await db.execute(
        select(Visitor)
        .where(Visitor.location_id == location, *_check_in_between(start, end))
        .order_by(Visitor.check_in_at.desc())
    )
    visitors = result.scalars().all()
    questions = await _load_form_questions(db)

    output = io.StringIO()
    csv.writer(output).writerows(_visitor_export_rows(visitors, questions))

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{_export_filename(location, start, end)}"'},
    )


def _export_filename(location: str, start: str | None, end: str | None) -> str:
    """visitors_csc.csv for all time, visitors_csc_2026-10-21.csv for one day,
    visitors_csc_2026-10-01_to_2026-10-21.csv for a range. Open ends read
    "start" and "now". Only called after the days have been validated."""
    if not start and not end:
        return f"visitors_{location}.csv"
    if start and start == end:
        return f"visitors_{location}_{start}.csv"
    return f"visitors_{location}_{start or 'start'}_to_{end or 'now'}.csv"


def _parse_checklist(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _visitor_export_rows(visitors, questions: list[FormQuestion]) -> list[list]:
    """Header plus one row per visitor for the CSV export.

    Each checklist question gets its own 1/0 column: the current questions in
    form order, then deleted questions that older visitors still have answers
    for. A blank cell means the visitor was never asked.
    """
    checklists = [_parse_checklist(v.checklist) for v in visitors]

    checklist_columns = [(q.key, q.title) for q in questions]
    known_keys = {q.key for q in questions}
    for checklist in checklists:
        for key in checklist:
            if key not in known_keys:
                known_keys.add(key)
                checklist_columns.append((key, key.replace("_", " ").title()))

    rows: list[list] = [[
        "ID", "First Name", "Last Name", "Email", "Phone", "Party Size",
        "Visit Type", "Service Type", "Photo Format",
        "Application Complete",
        *(escape_csv_formula_cell(title) for _key, title in checklist_columns),
        "UC San Diego Affiliation", "Heard About Us",
        "Notes", "Status",
        "Check-In Date (PT)", "Check-In Time (PT)", "Sign-Out Time (PT)",
    ]]

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

    def labels(stored, names):
        return ", ".join(names.get(key, key) for key in (stored or "").split(",") if key)

    def one_zero(val):
        if val is True:
            return 1
        if val is False:
            return 0
        return ""

    def fmt_phone(raw):
        digits = "".join(ch for ch in (raw or "") if ch.isdigit())
        if len(digits) == 10:
            return f"{digits[0:3]}-{digits[3:6]}-{digits[6:10]}"
        if len(digits) == 11 and digits[0] == "1":
            return f"1-{digits[1:4]}-{digits[4:7]}-{digits[7:11]}"
        return raw

    for v, checklist in zip(visitors, checklists):
        rows.append([
            escape_csv_formula_cell(v.id),
            escape_csv_formula_cell(v.first_name),
            escape_csv_formula_cell(v.last_name),
            escape_csv_formula_cell(v.email),
            escape_csv_formula_cell(fmt_phone(v.phone)),
            escape_csv_formula_cell(v.party_size),
            escape_csv_formula_cell(v.visit_type),
            escape_csv_formula_cell(v.service_type),
            escape_csv_formula_cell(v.photo_format),
            one_zero(v.app_complete),
            *(one_zero(checklist.get(key)) for key, _title in checklist_columns),
            labels(v.affiliations, AFFILIATIONS),
            labels(v.referral_sources, REFERRAL_SOURCES),
            escape_csv_formula_cell(v.notes),
            escape_csv_formula_cell(v.status),
            fmt_date(v.check_in_at), fmt_time(v.check_in_at), fmt_time(v.sign_out_at),
        ])

    return rows


async def _load_form_questions(db: AsyncSession) -> list[FormQuestion]:
    result = await db.execute(
        select(FormQuestion).order_by(FormQuestion.position, FormQuestion.key)
    )
    return list(result.scalars().all())


def _form_question_out(q: FormQuestion) -> FormQuestionOut:
    return FormQuestionOut(
        key=q.key, title=q.title, description=q.description,
        required=q.required if q.required is not None else True,
    )


@app.get("/api/questions", response_model=list[FormQuestionOut])
async def get_questions(db: AsyncSession = Depends(get_db)):
    return [_form_question_out(q) for q in await _load_form_questions(db)]


# --- Customer Experience Survey ---

def _survey_options(q: SurveyQuestion) -> list[str]:
    if not q.options:
        return []
    try:
        parsed = json.loads(q.options)
    except json.JSONDecodeError:
        return []
    return [option for option in parsed if isinstance(option, str)] if isinstance(parsed, list) else []


def _survey_question_out(q: SurveyQuestion) -> SurveyQuestionOut:
    return SurveyQuestionOut(
        id=q.id, type=q.question_type, label=q.label, required=q.required,
        options=_survey_options(q),
    )


async def _load_survey_questions(db: AsyncSession) -> list[SurveyQuestion]:
    result = await db.execute(
        select(SurveyQuestion).order_by(SurveyQuestion.position, SurveyQuestion.id)
    )
    return list(result.scalars().all())


@app.get("/api/survey/questions", response_model=list[SurveyQuestionOut])
async def get_survey_questions(db: AsyncSession = Depends(get_db)):
    return [_survey_question_out(q) for q in await _load_survey_questions(db)]


async def _prune_survey_answers(db: AsyncSession, current_ids: set[str]) -> None:
    """Permanently drops answers to questions no longer on the survey. The
    response itself (name, email, date) is kept."""
    for response in (await db.execute(select(SurveyResponse))).scalars().all():
        try:
            answers = json.loads(response.answers)
        except json.JSONDecodeError:
            continue
        if not isinstance(answers, list):
            continue
        kept = [a for a in answers if isinstance(a, dict) and a.get("question_id") in current_ids]
        if len(kept) != len(answers):
            response.answers = json.dumps(kept, separators=(",", ":"))


@app.put("/api/survey/questions", response_model=list[SurveyQuestionOut])
async def update_survey_questions(
    body: SurveyQuestionConfig,
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    # The saved list is the whole survey, in order. Questions sent with their
    # id are updated in place so their answers stay linked; questions left out
    # are deleted, and so are their answers in every stored response.
    ids = [q.id for q in body.questions if q.id]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=400, detail="Duplicate survey question")
    existing = {q.id: q for q in await _load_survey_questions(db)}
    kept_ids: set[str] = set()
    for position, question in enumerate(body.questions):
        row = existing.get(question.id) if question.id else None
        if row is None:
            row = SurveyQuestion()
            db.add(row)
        row.position = position
        row.question_type = question.question_type
        row.label = question.label
        row.required = question.required
        row.options = json.dumps(question.options, ensure_ascii=False) if question.options else None
        if row.id:
            kept_ids.add(row.id)
    for question_id, row in existing.items():
        if question_id not in kept_ids:
            await db.delete(row)
    await db.flush()
    current_ids = {q.id for q in await _load_survey_questions(db)}
    await _prune_survey_answers(db, current_ids)
    await db.commit()
    return [_survey_question_out(q) for q in await _load_survey_questions(db)]


@app.post("/api/survey/responses")
async def submit_survey_response(
    body: SurveyResponseRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Location).where(Location.id == body.location_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=400, detail="Invalid location")

    questions = await _load_survey_questions(db)
    questions_by_id = {q.id: q for q in questions}

    values: dict[str, bool | int | str | list[str] | None] = {}
    for answer in body.answers:
        question = questions_by_id.get(answer.question_id)
        if question is None:
            # The form was filled in before the survey was edited.
            raise HTTPException(status_code=409, detail="Survey questions have changed")
        if answer.question_id in values:
            raise HTTPException(status_code=400, detail="Duplicate survey answer")
        value: bool | int | str | list[str] | None = answer.value
        if question.question_type == "multiselect":
            if value is not None:
                options = _survey_options(question)
                if not isinstance(value, list) or any(choice not in options for choice in value):
                    raise HTTPException(status_code=400, detail="Selections must come from the question's options")
                # Stored in the form's order, each at most once; none chosen is no answer.
                value = [option for option in options if option in value] or None
        elif question.question_type == "checkbox":
            if value is not None and not isinstance(value, bool):
                raise HTTPException(status_code=400, detail="Checkbox answers must be true or false")
        elif question.question_type == "rating":
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5):
                raise HTTPException(status_code=400, detail="Rating answers must be an integer from 1 to 5")
        else:
            if value is not None:
                if not isinstance(value, str):
                    raise HTTPException(status_code=400, detail="Text answers must be a string")
                value = value.strip() or None
                if value is not None and len(value) > 2000:
                    raise HTTPException(status_code=400, detail="Text answers must be at most 2000 characters")
        if question.required and (value is None or value == ""):
            raise HTTPException(status_code=400, detail=f"Answer required: {question.label}")
        values[answer.question_id] = value

    snapshot = [
    ]
    for question in questions:
        if question.required and question.id not in values:
            raise HTTPException(status_code=400, detail=f"Answer required: {question.label}")
        snapshot.append({
            "question_id": question.id,
            "type": question.question_type,
            "label": question.label,
            "value": values.get(question.id),
        })

    response = SurveyResponse(
        location_id=body.location_id,
        name=body.name,
        email=body.email,
        answers=json.dumps(snapshot, separators=(",", ":")),
    )
    db.add(response)
    await db.commit()
    await db.refresh(response)
    return {"ok": True, "id": response.id}


@app.get("/api/survey/responses", response_model=list[SurveyResponseOut])
async def get_survey_responses(
    location: str = Query(...),
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    if _loc != location:
        raise HTTPException(status_code=403, detail="Location mismatch")

    result = await db.execute(
        select(SurveyResponse)
        .where(SurveyResponse.location_id == location)
        .order_by(SurveyResponse.submitted_at.desc())
    )
    responses = result.scalars().all()

    out = []
    for response in responses:
        try:
            parsed = json.loads(response.answers)
        except json.JSONDecodeError:
            parsed = []
        out.append(SurveyResponseOut(
            id=response.id,
            location_id=response.location_id,
            name=response.name,
            email=response.email,
            answers=[SurveyAnswerOut(**answer) for answer in parsed if isinstance(answer, dict)],
            submitted_at=response.submitted_at,
        ))
    return out


@app.post("/api/survey/responses/bulk-delete")
async def bulk_delete_survey_responses(
    body: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    result = await db.execute(select(SurveyResponse).where(SurveyResponse.id.in_(body.ids)))
    responses = list(result.scalars().all())
    if len(responses) != len(body.ids):
        raise HTTPException(status_code=404, detail="One or more responses not found")
    for response in responses:
        if response.location_id != _loc:
            raise HTTPException(status_code=403, detail="Location mismatch")

    for response in responses:
        await db.delete(response)
    await db.commit()
    return {"ok": True, "deleted": len(responses)}


@app.get("/api/stats", response_model=StatsResponse)
async def get_stats(
    location: str = Query(...),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _loc: str = Depends(get_current_location),
):
    """Visit statistics, optionally limited to check-ins between two Pacific
    calendar days (YYYY-MM-DD, both inclusive)."""
    if _loc != location:
        raise HTTPException(status_code=403, detail="Location mismatch")

    result = await db.execute(
        select(Visitor).where(Visitor.location_id == location, *_check_in_between(start, end))
    )
    visitors = result.scalars().all()
    total = len(visitors)

    # A visitor who picked several services counts once under each of them.
    passports = [v for v in visitors if "passports" in split_services(v.service_type)]
    notary = [v for v in visitors if "notary" in split_services(v.service_type)]
    photo_only = [v for v in visitors if "photo-only" in split_services(v.service_type)]

    passports_count = len(passports)
    notary_count = len(notary)
    photo_only_count = len(photo_only)

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
