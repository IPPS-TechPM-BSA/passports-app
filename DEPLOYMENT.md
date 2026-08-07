# Deployment Handoff — UC San Diego Passports Visitor Management

## App

- **Name / one-line purpose:** Passports visitor check-in and queue management for UC San Diego Passport Services (CSC and Bookstore locations).
- **Repo:** https://github.com/dominicfeliton/passports-app — private? Public
- **Image:** `ghcr.io/dominicfeliton/passports-app` — build workflow status: ✅
- **Stack:** Python/FastAPI + SQLite (aiosqlite), React/Vite SPA served from the same container

## Configuration

| Env var | Purpose | Example (non-secret) | Secret? |
|---|---|---|---|
| `DATABASE_URL` | SQLite database path | `sqlite+aiosqlite:////data/passports.db` | no |
| `JWT_SECRET` | Signing key for auth tokens | — | **yes — install as Secret** |
| `LOCATION_CSC_PASSWORD_HASH` | CSC dashboard bcrypt password hash | — | **yes — install as Secret** |
| `LOCATION_BOOKSTORE_PASSWORD_HASH` | Bookstore dashboard bcrypt password hash | — | **yes — install as Secret** |

- **App Secret needed:** `passports-app-secrets` with keys `JWT_SECRET`, `LOCATION_CSC_PASSWORD_HASH`, and `LOCATION_BOOKSTORE_PASSWORD_HASH`. Values delivered out-of-band.
- **TLS Secret needed:** `passports.apps.ucsd.edu` with `tls.crt` and `tls.key`, or provision that secret through the cluster TLS/cert-manager flow.
- **Ingress responsibility:** CORS headers and rate limiting are owned by ingress/WAF policy, not by the app container.
- **Persistence:** SQLite database at `/data/passports.db`, expected size 1Gi. Litestream enabled — live DB on node-local `emptyDir`, PVC as replica target.

## Dashboard credentials

No public default passwords are seeded. The app fails startup unless
`JWT_SECRET`, `LOCATION_CSC_PASSWORD_HASH`, and
`LOCATION_BOOKSTORE_PASSWORD_HASH` are supplied. The configured hashes are the
sole source of truth. On every start, the app validates and loads them for
authentication, creates missing location rows, and refreshes database copies as
derived state. A new or restored database therefore cannot override dashboard
credentials. Generate initial bcrypt hashes with:

```bash
printf '%s\n' "$NEW_CSC_PASSWORD" | \
  python -m backend.manage_passwords hash --password-stdin

printf '%s\n' "$NEW_BOOKSTORE_PASSWORD" | \
  python -m backend.manage_passwords hash --password-stdin
```

Expose the generated values to the pod with the required Secret object:

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

### Production password rotation

1. From a trusted terminal, run the rotation helper inside the live application
   pod. It verifies the current password and checks the new password against the
   other configured location, but does not mutate Kubernetes or the database:

```bash
kubectl -n tai-passport exec -it deploy/passports-app -- \
  python -m backend.manage_passwords change --location csc
```

2. Copy the final bcrypt hash printed to stdout and replace only the matching
   value in the admin-managed Secret; for this example:

```yaml
stringData:
  LOCATION_CSC_PASSWORD_HASH: "<exact hash printed by the change command>"
```

3. Apply the updated Secret. A Secret update does not alter environment
   variables in the existing pod, so the old password remains active until the
   deployment is restarted:

```bash
kubectl -n tai-passport apply -f passports-app-secrets.yaml
```

4. Restart and watch the rollout. The new pod loads the authoritative Secret
   hash and refreshes the derived database copy during startup:

```bash
kubectl -n tai-passport rollout restart deploy/passports-app
kubectl -n tai-passport rollout status deploy/passports-app
```

Repeat with `--location bookstore` and
`LOCATION_BOOKSTORE_PASSWORD_HASH` for the Bookstore dashboard.

### Rotation recovery

If the helper's printed hash is lost before the Secret is updated, no state has
changed. Rerun the helper with the same current password and choose a new value.
Do not look for hashes in application logs.

If the Secret was updated but the rollout has not happened, the old pod still
uses its startup environment. Correct or roll back the Secret, then restart.
Database and Litestream recovery are not part of credential recovery because
their password-hash copies are derived from the Secret.

To rerun the helper:

```bash
kubectl -n tai-passport exec -it deploy/passports-app -- \
  python -m backend.manage_passwords change --location csc
```

Do not store plaintext dashboard passwords in Helm values, ConfigMaps, or the
repository.

## Schema migrations

Database schema is managed by Alembic (`backend/migrations/`).

- **When they run:** inside the app container during FastAPI startup — after the
  `litestream-restore` initContainer has restored `/data/passports.db`, and while
  the `litestream-replicate` sidecar is live, so every DDL statement lands in the
  WAL and replicates within `syncInterval` (1s). Migrations deliberately do *not*
  run in an initContainer, which would write to the database before the replicate
  sidecar is watching it.
- **Concurrency:** `replicaCount: 1` with `strategy.type: Recreate` guarantees
  exactly one process ever migrates. No advisory lock or leader election is
  needed; adding replicas later would require revisiting this.
- **First rollout after this change** logs `adopting this database at baseline
  revision 0001` exactly once, then applies `0002`
  (`ALTER TABLE visitors ADD COLUMN party_size`). Later restarts log nothing new.
  This fixes the `no such column: visitors.party_size` errors on
  `GET /api/visitors` and on check-in.
- **Failure mode:** a failing migration raises out of the lifespan, so uvicorn
  exits and the pod crash-loops. Because the strategy is `Recreate`, the old pod
  is already gone — a bad migration is an outage. Diagnose with
  `kubectl -n tai-passport logs deploy/passports-app`, not `/api/health` (which
  never comes up).
- **Rollback:** rolling the image back does *not* undo schema changes. Revisions
  are additive and old code tolerates extra columns, so image rollback is
  normally safe on its own. Run `downgrade` only deliberately — it destroys the
  data in dropped columns. The Litestream replica at `/replica/passports` is the
  recovery point of last resort.

```bash
kubectl -n tai-passport exec deploy/passports-app -- python -m backend.migrate current -v
kubectl -n tai-passport exec deploy/passports-app -- python -m backend.migrate history
kubectl -n tai-passport exec deploy/passports-app -- python -m backend.migrate heads
```

Use the CLI for inspection. Apply schema changes by rolling out a new image and
letting startup do it — running `upgrade` against a live pod writes to the same
file the running app holds open, and the process will not pick up the change
without a restart.

No new env vars, Secret keys, chart values, or volumes are introduced.

## Ride-along services

None. Single-container app.

## Helm chart

- Location in repo: `chart/`
- `helm lint` + `helm template` pass: yes
- Litestream enabled by default for safe SQLite on NFS storage. Set `litestream.enabled: false` and `persistence.enabled: false` if data persistence isn't needed.

## Access & data

- **Audience:** campus-only (default)
- **Login needed?** yes (location-based JWT auth via password) — no SAML/OAuth; flag to platform team if auth proxy integration is desired
- **Data classification:** P1/P2 only confirmed? yes — visitor names, emails, phone numbers (contact info for passport service appointments; no SSN, no financial data, no health info)

## API reference

| Method | Path | Auth |
|---|---|---|
| POST | `/api/auth/login` | Public |
| POST | `/api/checkin` | Public |
| GET | `/api/visitors` | JWT |
| PATCH | `/api/visitors/:id/status` | JWT |
| PATCH | `/api/visitors/:id/notes` | JWT |
| GET | `/api/visitors/export` | JWT |
| GET | `/api/questions` | Public |
| PUT | `/api/questions` | JWT |
| GET | `/api/stats` | JWT |
| GET | `/api/health` | Public |

## Contact

- **Developer / owner:** Ben Pollak (bpollak@ucsd.edu)
- **Best way to reach for review questions:** GitHub issues or email
