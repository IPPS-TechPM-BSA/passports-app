# UC San Diego Passports Visitor Management

Visitor check-in and queue management for UC San Diego Passport Services.
Built with React + Decorator 5 + FastAPI + SQLite.

## Quick Start

```bash
# Backend: first-time setup
python3 -m venv venv && source venv/bin/activate
pip install -r backend/requirements.txt
# First setup only. Do not overwrite an existing .env.
cp -n .env.example .env

# Generate these values once, then paste them into .env. For local development,
# also set DATABASE_URL=sqlite+aiosqlite:///./passports.db in .env.
openssl rand -hex 32
python -m backend.manage_passwords hash  # CSC password hash
python -m backend.manage_passwords hash  # Bookstore password hash

# Backend: every launch reuses the exact values saved in .env.
uvicorn backend.app:app --reload --port 8000 --env-file .env

# Frontend (in another terminal)
npm install
npm run dev
```

Open http://localhost:5173

Local frontend development uses the Vite `/api` proxy to reach the backend.
Production CORS headers and rate limiting are handled at ingress.
The ignored `.env` file retains the JWT secret and exact bcrypt hashes between
launches. These configured hashes are the authority for dashboard login; the
database copy is derived and is refreshed from them whenever the app starts.

## Admin Passwords

No default dashboard passwords are created. The app fails startup unless
`JWT_SECRET`, `LOCATION_CSC_PASSWORD_HASH`, and
`LOCATION_BOOKSTORE_PASSWORD_HASH` are supplied. The configured location hashes
are the sole source of truth. At startup the app validates and loads them for
authentication, creates any missing location rows, and refreshes the database
copies as derived state. Wiping or restoring the database does not change the
configured dashboard passwords.

Generate hashes out of band:

```bash
printf '%s\n' "$NEW_CSC_PASSWORD" | \
  python -m backend.manage_passwords hash --password-stdin

printf '%s\n' "$NEW_BOOKSTORE_PASSWORD" | \
  python -m backend.manage_passwords hash --password-stdin
```

For Kubernetes, put the generated values in the required Secret object:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: passports-app-secrets
type: Opaque
stringData:
  JWT_SECRET: "<random 32+ byte secret>"
  LOCATION_CSC_PASSWORD_HASH: "<bcrypt hash>"
  LOCATION_BOOKSTORE_PASSWORD_HASH: "<bcrypt hash>"
```

To prepare a local dashboard-password rotation, load `.env` and run the
`change` helper:

```bash
python -m dotenv -f .env run -- \
  python -m backend.manage_passwords change --location csc
```

The helper verifies the current password, checks that the new password is not
used by another location, and prints a new hash. It does not modify the
database, `.env`, or Kubernetes. Copy the printed value into the matching
`LOCATION_*_PASSWORD_HASH` entry in `.env`, then restart the backend. Until the
restart, the running process continues using the old configured hash.

For a non-interactive rotation (e.g. in a script), pipe the current and new
passwords via stdin:

```bash
printf '%s\n%s\n' "$CURRENT_PASSWORD" "$NEW_PASSWORD" | \
  python -m dotenv -f .env run -- \
  python -m backend.manage_passwords change --location csc --password-stdin
```

For Kubernetes, run the helper inside the current pod so it can verify against
the hashes loaded from `passports-app-secrets`:

```bash
kubectl -n tai-passport exec -it deploy/passports-app -- \
  python -m backend.manage_passwords change --location csc
```

Copy the final hash exactly into the matching `stringData` key in
`passports-app-secrets`, update that one Secret key, and restart. The replacement
pod loads the new authoritative hash and refreshes the database copy; Litestream
does not participate in password rotation.

```bash
kubectl -n tai-passport apply -f passports-app-secrets.yaml
kubectl -n tai-passport rollout restart deploy/passports-app
kubectl -n tai-passport rollout status deploy/passports-app
```

If the printed hash is lost before updating the Secret, nothing changed; rerun
the helper. Never place plaintext passwords or hashes in the repository, logs,
tickets, or chat. See [DEPLOYMENT.md](DEPLOYMENT.md#dashboard-credentials) for
the production runbook.

## Database Migrations

Schema is owned by Alembic. **Any change to `backend/models.py` needs a matching
migration.** There is no `create_all` fallback: it created missing tables but
never altered existing ones, which is exactly how `visitors.party_size` shipped
to production without ever existing on the deployed volume.

Migrations run automatically at app startup, so normal development needs no
manual step. To inspect state:

```bash
python -m backend.migrate current      # revision this database is stamped at
python -m backend.migrate history
python -m backend.migrate heads
```

### Adding a column

```bash
# 1. Edit backend/models.py.

# 2. Bring your local database to head FIRST. Autogenerate diffs the models
#    against the live schema, so a stale database produces a wrong revision.
export DATABASE_URL=sqlite+aiosqlite:///./passports.db
python -m backend.migrate upgrade head

# 3. Generate the revision. Revision ids are sequential and zero-padded.
alembic -c backend/alembic.ini revision --autogenerate --rev-id 0003 \
  -m "add visitors.example"

# 4. READ the generated file in backend/migrations/versions/ and edit it.
#    Autogenerate is a first draft, not an answer: it never detects renames
#    (it emits drop + add, losing data) and it cannot know how to backfill a
#    NOT NULL column on existing rows.

# 5. Apply and test.
python -m backend.migrate upgrade head
python -m unittest discover -s backend/tests -v
```

Commit the revision alongside the model change. `test_migrations.py` asserts the
migrated schema matches the ORM models, so forgetting the revision fails CI.

Notes:

- **Do not copy the `if column exists` guard in `0002`.** It is a one-time
  reconciliation for databases that predate Alembic. Every revision from `0003`
  on starts from an Alembic-managed schema and must be a plain, unguarded
  operation.
- SQLite cannot alter columns in place, so autogenerate wraps alters in
  `op.batch_alter_table(...)`, which recreates the table. Check the generated
  version preserves your data before running it on anything you care about.
- Keep history linear. If `heads` prints more than one revision, `upgrade head`
  fails at startup; merge the branch before deploying.

## Tech Stack

- **Frontend**: React 18, Vite, Decorator 5 (Bootstrap 3 CDN)
- **Backend**: FastAPI (Python), SQLAlchemy, SQLite
- **Auth**: bcrypt + JWT
- **Updates**: dashboard polling
- **Deployment**: Docker multi-stage build

## Structure

```
src/              React application
  components/
    chrome/       Decorator 5 page shell
    kiosk/        Public check-in flow
    dashboard/    Staff dashboard
  context/        Global state
  hooks/          useIdleTimer, polling helpers
  services/       API client, translations
backend/          FastAPI application
  backend/        Python package
    app.py        Routes and API
    models.py     SQLAlchemy models
    auth.py       JWT + password hashing
    seed.py       Database seeding
    migrate.py    Migration runner + CLI
    migrations/   Alembic environment and versions/
```

## API Endpoints

| Method | Path | Auth |
|---|---|---|
| POST | /api/auth/login | Public |
| POST | /api/checkin | Public |
| GET | /api/visitors | JWT |
| PATCH | /api/visitors/:id/status | JWT |
| PATCH | /api/visitors/:id/notes | JWT |
| GET | /api/visitors/export | JWT |
| GET | /api/questions | Public |
| PUT | /api/questions | JWT |
| GET | /api/stats | JWT |

## Docker

```bash
docker build -t passports-app .
docker run --env-file .env -p 8000:8000 -v ./passports.db:/app/passports.db passports-app
```
