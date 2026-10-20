import os

import bcrypt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from .models import Location, FormQuestion, SurveyQuestion

REQUIRED_LOCATIONS = {
    "csc": "CSC",
    "bookstore": "Bookstore",
}

DEFAULT_SURVEY_QUESTIONS = [
    ("rating", "How would you rate your overall experience?", True),
    ("checkbox", "Was our staff friendly and helpful?", True),
    ("text", "How can we improve your experience?", False),
]


def _password_hash_env(loc_id: str) -> str:
    return f"LOCATION_{loc_id.upper()}_PASSWORD_HASH"


def _configured_password_hash(loc_id: str) -> str | None:
    value = os.environ.get(_password_hash_env(loc_id))
    return value.strip() if value and value.strip() else None


def _validate_password_hash(loc_id: str, password_hash: str) -> None:
    if not password_hash.startswith(("$2a$", "$2b$", "$2y$")):
        raise RuntimeError(
            f"{_password_hash_env(loc_id)} must be a bcrypt hash generated with "
            "python -m backend.manage_passwords hash --password-stdin"
        )
    try:
        bcrypt.checkpw(b"password-hash-validation", password_hash.encode("utf-8"))
    except ValueError as exc:
        raise RuntimeError(f"{_password_hash_env(loc_id)} is not a valid bcrypt hash") from exc


def get_configured_password_hashes() -> dict[str, str]:
    """Load and validate the required location password hashes."""
    configured_password_hashes: dict[str, str] = {}
    missing_password_envs: list[str] = []

    for loc_id in REQUIRED_LOCATIONS:
        password_hash = _configured_password_hash(loc_id)
        if not password_hash:
            missing_password_envs.append(_password_hash_env(loc_id))
            continue
        configured_password_hashes[loc_id] = password_hash

    if missing_password_envs:
        missing = ", ".join(missing_password_envs)
        raise RuntimeError(
            "Location dashboard password hashes are required and no defaults are seeded. "
            f"Set bcrypt hashes via: {missing}"
        )

    seen_hashes: dict[str, str] = {}
    for loc_id, password_hash in configured_password_hashes.items():
        _validate_password_hash(loc_id, password_hash)
        duplicate_loc_id = seen_hashes.get(password_hash)
        if duplicate_loc_id is not None:
            raise RuntimeError(
                "Location dashboard password hashes must be distinct: "
                f"{_password_hash_env(duplicate_loc_id)} and "
                f"{_password_hash_env(loc_id)} contain the same bcrypt hash"
            )
        seen_hashes[password_hash] = loc_id

    return configured_password_hashes


async def seed_database(db: AsyncSession) -> dict[str, str]:
    """Ensure locations and default form questions exist."""
    configured_password_hashes = get_configured_password_hashes()

    for loc_id, name in REQUIRED_LOCATIONS.items():
        result = await db.execute(select(Location).where(Location.id == loc_id))
        existing = result.scalar_one_or_none()
        password_hash = configured_password_hashes[loc_id]

        if existing is None:
            db.add(Location(
                id=loc_id,
                name=name,
                password_hash=password_hash,
            ))
        else:
            existing.name = name
            existing.password_hash = password_hash

    # Seed default form questions only when the table is empty: staff can
    # delete questions from the dashboard, and those must not come back on
    # the next restart.
    defaults = {
        "photo": {
            "title": "Passport Photo",
            "description": "Do you have a 2x2 inch color photo taken within the last 6 months?",
        },
        "citizenship": {
            "title": "Proof of Citizenship",
            "description": "Do you have a certified birth certificate or naturalization certificate?",
        },
        "id": {
            "title": "Photo Identification",
            "description": "Do you have a valid driver's license or government-issued ID?",
        },
        "payment": {
            "title": "Form of Payment",
            "description": "Do you have a credit card, check, or money order for processing fees?",
        },
    }

    result = await db.execute(select(func.count()).select_from(FormQuestion))
    if result.scalar_one() == 0:
        for position, (key, val) in enumerate(defaults.items()):
            db.add(FormQuestion(
                key=key,
                position=position,
                title=val["title"],
                description=val["description"],
            ))

    # Seed the customer experience survey only when the table is empty, so
    # dashboard edits survive restarts.
    result = await db.execute(select(func.count()).select_from(SurveyQuestion))
    if result.scalar_one() == 0:
        for position, (question_type, label, required) in enumerate(DEFAULT_SURVEY_QUESTIONS):
            db.add(SurveyQuestion(
                position=position,
                question_type=question_type,
                label=label,
                required=required,
            ))

    await db.commit()
    return configured_password_hashes
