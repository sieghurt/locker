# Smart Package Locker API (`apps/api`)

NestJS 12 + TypeORM + PostgreSQL backend of the [Smart Package Locker monorepo](../../README.md).
All routes live under the `/api` prefix so the `web` container's nginx can proxy them on the same origin.

Delivery agents store packages; the system assigns the **smallest available locker that fits** and
issues a **pickup code**. Customers retrieve with locker id + code; the locker is released and a
**tiered storage charge** is returned. Concurrent storage requests are serialised at the database so
**no two requests ever receive the same locker**.

| Level | Requirement | Where |
|---|---|---|
| 1 | Create lockers, list availability, store package in smallest fitting locker, pickup code | `POST /api/lockers`, `GET /api/lockers`, `POST /api/packages` |
| 2 | Retrieve with locker id + code, locker freed, invalid scenarios handled | `POST /api/packages/retrieve` |
| 3 | Record store time, tiered charge (X/day 5 days, 2X next 5, 3X after), returned on pickup | `PricingModule`, charge in retrieve response |
| 4 | Concurrent storage requests never conflict; availability stays correct | `SELECT … FOR UPDATE SKIP LOCKED` + partial unique index |

## Run it

From the repository root, `docker compose up --build` starts Postgres, this API and the web UI. See the
[root README](../../README.md). Direct API access while the stack is up:

- API: <http://localhost:3000/api> (also proxied at <http://localhost:8080/api>)
- Swagger UI: <http://localhost:3000/api/docs>
- Health: <http://localhost:3000/api/health>

The container runs the TypeORM migrations on boot and, when the table is empty, seeds a demo inventory
from `SEED_LOCKERS` (3 small, 2 medium, 1 large). Set `SEED_LOCKERS=` (empty) to skip seeding.

Backend e2e suite inside Docker (dedicated `locker_test` database), from the repository root:

```bash
docker compose --profile test run --rm e2e
```

## Walkthrough

Every endpoint needs a session, so log in first and keep a cookie jar. With `DEMO_MODE` on (the compose
default) the login request returns the code, so there is no inbox step.

```bash
API=localhost:3000/api

login() {  # login <email> <cookie-jar>
  CODE=$(curl -s -X POST $API/auth/otp/request -H 'content-type: application/json' \
    -d "{\"email\":\"$1\"}" | jq -r '.data.demoCode')
  curl -s -c "$2" -o /dev/null -X POST $API/auth/otp/verify -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"code\":\"$CODE\"}"
}
login agent@locker.local agent.jar
login alice@locker.local alice.jar
login admin@locker.local admin.jar

# Level 1: an agent stores a small package for a customer account
ALICE=$(curl -s -b agent.jar "$API/users/customers?q=alice" | jq -r '.data.items[0].id')
curl -s -b agent.jar -X POST $API/packages -H 'content-type: application/json' \
  -d "{\"size\":\"SMALL\",\"customerId\":\"$ALICE\"}" | jq
# -> { success: true, data: { packageId, lockerId, lockerLabel: "S-01", customer, notified: true, storedAt } }
# The pickup code is emailed to the customer (Mailpit at :8025) and is not in an agent's response.

# See availability. Staff also get currentPackage.customerLabel; admins get accruedCharge.
curl -s -b agent.jar $API/lockers | jq '.data.items[] | {label, size, status}'

# An admin can read the code of a waiting package, to help a customer who cannot reach their email
LOCKER=$(curl -s -b agent.jar "$API/lockers?status=OCCUPIED" | jq -r '.data.items[0].id')
CODE=$(curl -s -b admin.jar $API/lockers/$LOCKER/pickup-code | jq -r '.data.pickupCode')

# Levels 2 + 3: the customer collects, and is charged for the storage
curl -s -b alice.jar -X POST $API/packages/retrieve -H 'content-type: application/json' \
  -d "{\"lockerId\":\"$LOCKER\",\"pickupCode\":\"$CODE\"}" | jq
# -> { success: true, data: { lockerOpened: true, storageCharge: { amount, chargedDays, breakdown: [...] } } }

# The charge lands in the customer's ledger
curl -s -b alice.jar $API/accounts/me | jq          # balance, charged, paid
curl -s -b admin.jar $API/packages/charges | jq     # outstanding and collected, station-wide

# Level 4: 40 agents at once against N free lockers -> N succeed, the rest get NO_SUITABLE_LOCKER
seq 40 | xargs -P 40 -I{} curl -s -b agent.jar -o /dev/null -w '%{http_code}\n' -X POST $API/packages \
  -H 'content-type: application/json' -d "{\"size\":\"SMALL\",\"customerId\":\"$ALICE\"}" | sort | uniq -c
```

## Authentication

Every endpoint except `/api/health`, the login endpoints and `POST /api/auth/logout` requires a session
cookie (`sid`, httpOnly, SameSite=Lax, Secure over https). Log in with a one-time code emailed to a known
account:

| Method | Path | Purpose | Errors |
|---|---|---|---|
| `POST` | `/api/auth/otp/request` | `{ email }` → emails a 6-digit code; identical `202` whether or not the account exists | `429` |
| `POST` | `/api/auth/otp/verify` | `{ email, code }` → sets the session cookie, returns the user | `401 INVALID_LOGIN_CODE`, `429` |
| `POST` | `/api/auth/logout` | clears the cookie | |
| `GET` | `/api/auth/demo` | `{ enabled, accounts[] }`: with `DEMO_MODE=true` lists active accounts and `otp/request` also returns `demoCode`; otherwise `enabled: false` | |
| `GET` | `/api/auth/me` | the logged-in user | `401 NOT_LOGGED_IN` |

Codes are single use, expire after `OTP_TTL_MINUTES`, are burned after `OTP_MAX_ATTEMPTS` wrong guesses,
and an account gets at most `OTP_MAX_REQUESTS_PER_10_MIN` codes per ten minutes. A wrong role answers
`403 FORBIDDEN`.

| Role | May |
|---|---|
| `ADMIN` | everything below, plus user management and collecting on a customer's behalf |
| `AGENT` | list lockers, search customers, store packages |
| `CUSTOMER` | list lockers, see their own packages, collect their own packages |

There is no self sign-up. The first admin comes from `SEED_ADMIN_EMAIL` (applied to an empty users table);
admins create everyone else.

## API

All responses share one envelope: `{ "success": true, "data": … }` or
`{ "success": false, "error": { "code", "message", "details?" } }`.

| Method | Path | Purpose | Errors |
|---|---|---|---|
| `POST` | `/api/lockers` | Admin: create a locker `{ label, size }` | `409 LOCKER_LABEL_TAKEN` |
| `GET` | `/api/lockers?status&size&limit&offset` | List lockers with availability and the package inside | |
| `GET` | `/api/lockers/:id` | One locker. Staff also see `currentPackage.customerLabel`; admins see `accruedCharge` | `404 LOCKER_NOT_FOUND` |
| `GET` | `/api/lockers/:id/pickup-code` | Admin: the code of the package waiting in a locker, to read out to a customer (logged) | `404 LOCKER_NOT_FOUND`, `409 LOCKER_EMPTY` / `PICKUP_CODE_UNAVAILABLE` |
| `GET` | `/api/lockers/events` | Server-Sent Events: `locker.created`, `package.stored`, `package.retrieved` (+ `heartbeat` every 15 s), published after commit; never includes a pickup code | |
| `POST` | `/api/packages` | Agent/admin: store `{ size, customerId }` (a customer account id) → locker id; the pickup code is emailed to the customer (`notified`) and included in the response **only for admins** | `409 NO_SUITABLE_LOCKER`, `422 CUSTOMER_NOT_FOUND` |
| `POST` | `/api/packages/retrieve` | Customer (own package) or admin: `{ lockerId, pickupCode }` → charge | `404 LOCKER_NOT_FOUND`, `409 LOCKER_EMPTY`, `403 INVALID_PICKUP_CODE` / `NOT_YOUR_PACKAGE`, `423 PICKUP_LOCKED`, `429 TOO_MANY_REQUESTS` |
| `GET` | `/api/packages/mine` | Customer: own packages, newest first, each with `charge` (running total while waiting, final once collected) | |
| `GET` | `/api/packages/charges` | Admin: `{ outstanding, collected }` totals across the station | |
| `GET` | `/api/accounts/me` | Customer: my balance (`charged`, `paid`, `balance`) | |
| `GET` | `/api/accounts/me/transactions` | Customer: my transaction history, newest first, paginated | |
| `GET` | `/api/accounts` | Admin: every customer with their balance, plus `totalBalance` | |
| `GET` | `/api/accounts/:customerId` | Admin: one customer's balance | `404 USER_NOT_FOUND` |
| `GET` | `/api/accounts/:customerId/transactions` | Admin: one customer's history | `404 USER_NOT_FOUND` |
| `POST` | `/api/accounts/:customerId/payments` | Admin: record money received, `{ amount, note? }` | `404 USER_NOT_FOUND`, `400 VALIDATION_ERROR` |
| `POST` | `/api/accounts/:customerId/adjustments` | Admin: correct a balance, `{ amount (signed, non-zero), reason }` | `404 USER_NOT_FOUND`, `400 VALIDATION_ERROR` |
| `GET` | `/api/packages/:id` | Package status (never the code); customers see only their own | `404 PACKAGE_NOT_FOUND` |
| `GET` | `/api/users/customers?q=` | Agent/admin: active customers as `{ id, label, maskedEmail }` | |
| `GET` `POST` | `/api/users` | Admin: list / create `{ email, role, displayName? }` | `409 EMAIL_TAKEN` |
| `GET` `PATCH` | `/api/users/:id` | Admin: one user / change `role`, `displayName`, `active` (never their own role or active flag) | `404 USER_NOT_FOUND` |
| `GET` | `/api/health` | Liveness + database check | `503` |

Malformed input (body fields or a non-UUID path/body id) is `400 VALIDATION_ERROR` with the messages in
`details`. Swagger documents the `data` schema of each endpoint; the envelope wraps it.

## Design in one page

```
HTTP  ─► Controller (DTO validation, status codes)
        ─► Service (business rules, one transaction per operation)
           ─► Repository (all SQL; takes the caller's EntityManager)
              ─► PostgreSQL (constraints are the last line of defence)
```

**Allocation (Level 1 + 4).** One SQL statement picks the locker:

```sql
SELECT … FROM lockers l
WHERE l.status = 'AVAILABLE' AND l.size IN (<sizes that can hold the package>)
ORDER BY <size rank>, l.created_at, l.id
LIMIT 1 FOR UPDATE SKIP LOCKED
```

Smallest fitting locker first. `FOR UPDATE SKIP LOCKED` makes concurrent transactions skip rows
another transaction has already claimed instead of waiting, so N simultaneous requests for N free
lockers each get a different one and the (N+1)th gets a clean `NO_SUITABLE_LOCKER`. The package
insert and the locker status update happen in the same transaction. Should any code path ever get
this wrong, the partial unique index `packages(locker_id) WHERE status = 'STORED'` refuses a second
package in an occupied locker.

**Pickup codes (Level 1 + 2).** Six random digits (`crypto.randomInt`), returned exactly once, stored
as an HMAC-SHA256 keyed by `PICKUP_CODE_SECRET` and compared in constant time. Uniqueness among
active codes is a partial unique index; on the (≈0.0001 %) collision the service simply retries with a
new code. Two controls make guessing impractical: the retrieve endpoint is throttled per client IP
(10/min), and every wrong code is counted **per package**; after `PICKUP_MAX_FAILED_ATTEMPTS` (5) the
locker refuses all pickups, right code included, for `PICKUP_LOCKOUT_MINUTES` (15) and answers
`423 PICKUP_LOCKED`. The counter restarts once the lockout expires.

**Retrieval (Level 2).** Locks the locker row (`FOR UPDATE`, waiting this time), checks in order:
locker exists → has a stored package → code matches. Then marks the package `RETRIEVED` with its
charge and flips the locker to `AVAILABLE`, atomically. A second retrieval with the same code gets
`LOCKER_EMPTY`: codes are single use.

**Charges (Level 3).** `StoragePricingStrategy` is an abstract class; `TieredPricingStrategy` is the
bound implementation. A day is a started 24-hour period from `storedAt`. Defaults: X = 10 units,
tiers 5 / 5 / open-ended at 1× / 2× / 3×, no free days. All configurable by environment.
Example: 12 days → 5×10 + 5×20 + 2×30 = 210 units, with the per-tier breakdown in the response.
A retrieval clock slightly behind the storage clock (NTP step, skewed replicas) is a zero-day stay, never an error.

**Extensibility.** Add a locker size: one enum member + rank + one-line migration. Change pricing:
bind another `StoragePricingStrategy`. Change code format: bind another `PickupCodeGenerator`.
Add locker states (e.g. OUT_OF_SERVICE): extend `LockerStatus`; allocation already filters on it.

See [docs/DESIGN.md](../../docs/DESIGN.md) for data model, failure handling, trade-offs and assumptions.

## Local development (without Docker for the app)

Requires Node **24.9+** (`.nvmrc` provided; Jest needs `require(esm)` for NestJS 12) and a Postgres.

```bash
nvm use
npm install
(cd ../.. && docker compose up -d db)   # Postgres on localhost:5433
cp .env.example .env                    # then set DB_PORT=5433
npm run start:dev                       # http://localhost:3000/api/docs
```

Tests:

```bash
npm test                           # unit: pricing, allocation, codes, services, lockout, events, charges, ledger (81 tests)
npm run test:e2e                   # e2e against the compose db, database locker_test (66 tests)
npm run lint && npm run typecheck
```

Migrations are plain SQL in `src/database/migrations`; `npm run migration:run` / `migration:revert`
use the same DataSource definition the app does.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` `DB_SSL` | `localhost` `5432` `locker` `locker` `locker` `false` | PostgreSQL |
| `DB_MIGRATIONS_RUN` | `true` | Run pending migrations on boot |
| `PICKUP_CODE_SECRET` | required, ≥ 32 chars | HMAC key for stored codes |
| `PICKUP_CODE_LENGTH` | `6` | Digits per code (4–12) |
| `PICKUP_CODE_ENCRYPTION_KEY` | required, ≥ 32 chars | Encrypts waiting codes for the admin reveal; keep it different from `PICKUP_CODE_SECRET` |
| `STORAGE_RATE_PER_DAY` | `10` | X in the tiered rule |
| `STORAGE_TIER_1_DAYS` / `STORAGE_TIER_2_DAYS` | `5` / `5` | Length of the 1× and 2× tiers; 3× thereafter |
| `STORAGE_FREE_DAYS` | `0` | Days at the start that are not charged |
| `STORAGE_CURRENCY` | `UNITS` | Label echoed in responses |
| `RATE_LIMIT_PER_MINUTE` | `300` | Per-IP ceiling, whole API |
| `PICKUP_RATE_LIMIT_PER_MINUTE` | `10` | Per-IP ceiling on `POST /packages/retrieve` |
| `PICKUP_MAX_FAILED_ATTEMPTS` | `5` | Wrong codes tolerated per package before its locker is locked out |
| `PICKUP_LOCKOUT_MINUTES` | `15` | Length of that lockout |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy so per-IP limits use `X-Forwarded-For` (the compose file sets it: nginx fronts the API) |
| `SEED_LOCKERS` | unset | e.g. `SMALL:3,MEDIUM:2,LARGE:1`; applied only to an empty table |
| `DEMO_MODE` | `false` | Return login codes in the API response and list accounts at `/api/auth/demo`. Refused with `NODE_ENV=production` |
| `AUTH_SECRET` | required, ≥ 32 chars | Signs session cookies and keys login-code hashes; rotating it logs everyone out |
| `SESSION_TTL_HOURS` | `12` | Session cookie lifetime |
| `OTP_LENGTH` / `OTP_TTL_MINUTES` / `OTP_MAX_ATTEMPTS` | `6` / `10` / `5` | Login code shape and limits |
| `OTP_MAX_REQUESTS_PER_10_MIN` | `3` | Codes one account may request per 10 minutes |
| `OTP_RATE_LIMIT_PER_MINUTE` | `10` | Per-IP ceiling on the login endpoints |
| `MAIL_HOST` `MAIL_PORT` `MAIL_SECURE` `MAIL_USER` `MAIL_PASSWORD` `MAIL_FROM` | unset / `1025` / `false` / … | SMTP for login and pickup codes; empty host = log only |
| `SEED_ADMIN_EMAIL` | unset | First admin, created into an empty users table |
| `SEED_USERS` | unset | Demo accounts `email:ROLE,…`, into an empty users table |

The service validates all of these at boot and refuses to start on a bad value.

## Assumptions

- Package sizes use the same S/M/L scale as lockers; a package fits any locker of its size or larger.
- "Smallest available locker" ties are broken by creation order, then id, so allocation is deterministic.
- A storage "day" is any started 24-hour period; a pickup 10 minutes after storage is one day (X units).
  A free allowance can be granted with `STORAGE_FREE_DAYS` if the business prefers.
- The pickup code is shown once in the store response for the (out-of-scope) notification system; it is
  never retrievable afterwards.
- A package is addressed to a customer account (`customerId` is that account's id). The only personal
  data stored is the account email; other users see a display name or a masked email, never the address.
- Money is a decimal with two places (`numeric(12,2)`); integer minor units would be the production choice.
- Authentication and role separation (agent vs customer) are out of scope; the endpoints are the seam
  where a guard would go. The web UI shows all roles on one screen for the same reason.

## Project layout

```
apps/api/src/
├── main.ts / app.module.ts / app.setup.ts   bootstrap; global pipes, filter, interceptor, swagger
├── config/          environment schema (validated at boot), TypeORM DataSource (app + CLI)
├── auth/            OTP login, session tokens, SessionGuard (global), @Public / @Roles / @CurrentUser
├── users/           accounts with roles, admin CRUD, masked customer directory
├── mail/            Mailer abstraction: SMTP (Mailpit locally, any provider) or log-only
├── common/          response envelope, error filter, domain errors, clock, rate-limit buckets, health
├── database/        DatabaseModule, SQL migrations, constraint names shared with the code
├── lockers/         entity, size scale, repository (allocation query), service, controller, seeder, SSE event stream
├── packages/        entity, pickup-code generator + hasher + lockout policy, repository, service, controller
├── billing/         customer ledger: transactions, balances, payments (accounts endpoints)
└── pricing/         StoragePricingStrategy + TieredPricingStrategy
apps/api/test/       e2e suites (lockers, packages levels 1-3 + lockout, concurrency level 4, rate limit) + fixtures
```
