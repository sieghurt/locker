# Design — Smart Package Locker Management System

## Problem

Delivery agents need to drop packages into a locker station and customers need to collect them later
with a code. After this system exists: every stored package sits in the smallest locker that fits, has a
unique single-use pickup code, can be retrieved exactly once with locker id + code, is charged for the
time it spent in the locker, and no two concurrent agents are ever handed the same locker.

## Scope

- **System**: one NestJS service, one PostgreSQL database, REST interface under `/api`, a React kiosk UI
  served by nginx that proxies `/api/*` to the service, Docker Compose to run all three.
- **Data**: lockers and packages, with the invariants enforced by constraints.
- **Reliability**: transactional store/retrieve, concurrency under contention, safe retry of code generation.

Out of scope by the brief, but implemented as a separate layer on top: accounts with roles and
passwordless login, and emailing the pickup code to the customer (the brief's "external notification
system"). Still out of scope: hardware door control (the response carries `lockerOpened: true` as the
signal) and payments.

## Approach

### Topology

```
browser -> web (nginx :8080) -> /            static React build (apps/web)
                              -> /api/*      api (NestJS :3000) -> db (PostgreSQL 16)
```

The UI and the API share one origin through the proxy, so there is no CORS surface, and the API sets
`TRUST_PROXY` so `X-Forwarded-For` drives its per-IP limits. The UI is a thin client: every rule lives in
the API, the UI only renders the envelope (`data` or `error.code`) it gets back.

Only the proxy is published to the network. The API, Postgres and Mailpit are bound to `127.0.0.1`, so
they are reachable for curl, Swagger and the e2e suite but not from another host. That pairing matters:
because the API trusts `X-Forwarded-For`, anything that can talk to it directly can claim any client
address and walk past the per-IP rate limits. nginx also sets `X-Content-Type-Options`,
`X-Frame-Options` and `Referrer-Policy`, and hides its version, since the `share` profile puts this
server on a public URL.

### Accounts, login and authorisation

**Roles.** `ADMIN` manages users and lockers and may do anything an agent or customer can (including
collecting a package on a customer's behalf at the kiosk). `AGENT` stores packages for a customer chosen
from a directory. `CUSTOMER` sees and collects only packages addressed to their account. There is no
self sign-up; the first admin comes from `SEED_ADMIN_EMAIL` into an empty table.

**Login without passwords.** `POST /auth/otp/request` looks the email up; if it belongs to an active
account, a 6-digit code is generated with `crypto.randomInt`, stored as `HMAC-SHA256(AUTH_SECRET,
userId:code)` in `otp_codes` with a 10-minute expiry, and emailed. The response is the same `202` either
way, so the endpoint cannot enumerate accounts. Earlier open codes for the account are consumed when a
new one is issued; an account gets at most 3 codes per 10 minutes; a code is burned after 5 wrong
guesses; both login endpoints sit in the `otp` per-IP rate-limit bucket. `POST /auth/otp/verify`
compares in constant time, marks the code consumed and issues a session.

**Demo mode.** `DEMO_MODE=true` makes `otp/request` also return the code it emailed and adds
`GET /auth/demo` listing active accounts, so the login page can offer one-click sign-in for reviewers.
It is a local convenience: the flag is refused when `NODE_ENV=production`, the server logs a warning at
boot, and unknown or inactive addresses still get the neutral response with no code.

**Sessions.** A signed token `base64url(payload).base64url(HMAC-SHA256)` carrying `{ id, role, email,
iat, exp }`, kept in an httpOnly, SameSite=Lax cookie (Secure when the request arrived over https,
which `TRUST_PROXY` makes visible behind nginx/ngrok). Stateless: no session table, and rotating
`AUTH_SECRET` logs everyone out. A JWT library would have bought nothing over 40 lines of `node:crypto`.

**Enforcement.** `SessionGuard` is a global `APP_GUARD` that runs after the throttler: every route needs
a valid cookie unless marked `@Public()`, and `@Roles(...)` narrows it further. Ownership is enforced in
the service, where the data is: a customer collecting a package not addressed to them gets
`403 NOT_YOUR_PACKAGE` before any code comparison, and customers reading packages see only their own.

**Privacy.** Emails are the only personal data stored. Staff (agents and admins) see a display name or a
masked email (`al***@example.com`), never the full address, on the locker board, in the customer
directory, in the activity feed and in the SSE stream. Customers see none of it: their board says a
locker is occupied without saying whose package it is, and their event stream carries no customer label.
Emails and codes never appear in logs, including email subjects, which is where a login code lives.

**Notification.** After the store transaction commits, the API emails the customer the locker label and
pickup code. Locally the Compose stack routes SMTP to a Mailpit container (inbox on `:8025`); in
production the same `SmtpMailer` points at any provider. A mail failure does not undo the store: the
response reports `notified: false` and the agent's screen says so.

**Who sees a pickup code.** The customer, by email. Agents never: the controller strips `pickupCode`
from their store response, so an agent cannot collect a package they stored. Admins can, in two ways:
their own store response includes it, and `GET /lockers/:id/pickup-code` returns the code of the package
currently waiting in a locker, so a station admin can help a customer who cannot reach their inbox.

To make that second path possible the code is kept in two forms while the package is `STORED`: the
HMAC (`pickup_code_hash`), used for verification exactly as before, and an AES-256-GCM ciphertext
(`pickup_code_encrypted`) under `PICKUP_CODE_ENCRYPTION_KEY`, a key deliberately separate from the HMAC
secret so leaking one does not compromise the other. The ciphertext is wiped in the same transaction that
marks the package retrieved, the endpoint is admin-only, and every reveal is logged with the admin's id.
Packages stored before this existed have no ciphertext and answer `409 PICKUP_CODE_UNAVAILABLE`. The
trade-off is explicit: a database leak *plus* the encryption key would expose waiting codes, which is why
the key lives in the environment and codes stop being recoverable the moment they are used.

### Live updates

`GET /api/lockers/events` is a Server-Sent Events stream (`@Sse()` in NestJS). `LockerEventsService`
is an in-process RxJS subject; `LockersService.create`, `PackagesService.store` and
`PackagesService.retrieve` publish to it **after their transaction commits**, so a subscriber can never
see a change that was rolled back. Frames carry the locker id, label, size, new status and the package
id, never a pickup code, and the customer label only for staff. A `heartbeat` frame every 15 s keeps
proxies from closing an idle connection; nginx serves that one location with buffering off.

Clients (the web UI's `useLiveLockers` hook) treat events as an invalidation signal: on any event they
refetch `GET /lockers`, coalescing bursts into one request, so the board is always the database's view
rather than a client-side reconstruction. If the stream fails they poll every 5 s until `EventSource`
reconnects, and the header badge says which mode the page is in.

The hook also exposes a `revision` that advances on every successful load. Panels that hold their own
data (a customer's packages and account, the admin's charges and customer accounts) use it as their
refetch key, so they follow the board in live *and* polling mode. An earlier version keyed off the
length of the event feed, which is capped and stays empty without a stream, so those panels silently
stopped refreshing; see [REVIEW.md](REVIEW.md). SSE was chosen over WebSockets because the data flows one way, it is plain HTTP (works
through nginx, ngrok and corporate proxies), and the browser API reconnects by itself.

The subject is per process. With several API replicas, an event published on one would not reach
clients connected to another; the seam is `LockerEventsService`, which would then be backed by Postgres
`LISTEN/NOTIFY` or Redis pub/sub with no change to publishers or the endpoint.

### Layering (API)

```
Controller  DTO validation (class-validator), HTTP status, response mapping. No business rules.
Service     Business rules; owns the transaction boundary; throws DomainErrors.
Repository  All SQL. Transactional methods receive the caller's EntityManager.
Database    Constraints and indexes are the last line of defence, not the only one.
```

Cross-cutting: `ResponseEnvelopeInterceptor` (`{ success: true, data }`), `HttpExceptionFilter`
(`{ success: false, error: { code, message, details } }`; maps `DomainError` → status, validation →
400 `VALIDATION_ERROR`, everything else → 500 with the cause logged and hidden), `ThrottlerGuard`.

### Modules and boundaries

| Module | Owns | Exposes |
|---|---|---|
| `lockers` | `lockers` table, size scale, allocation query | `LockersService`, `LockersRepository` |
| `packages` | `packages` table, pickup codes, store/retrieve use cases | HTTP only |
| `pricing` | Storage charge rule | `StoragePricingStrategy` |
| `users` | `users` table, roles, admin CRUD, masked customer directory | `UsersService`, `UsersRepository` |
| `auth` | `otp_codes` table, login flow, session tokens, the global `SessionGuard` | `SessionTokenService` |
| `mail` | Outbound email (`Mailer`: SMTP or log-only) | `Mailer` (global) |
| `billing` | `customer_transactions` ledger, balances, payments | `BillingService` |
| `common` | Envelope, errors, clock, rate-limit buckets, health | |

`packages` writes the locker **status** through `LockersRepository` inside its own transaction; it never
touches locker rows directly. Only `packages` writes `packages`.

### Contracts

| Operation | Input | Output | Errors |
|---|---|---|---|
| Create locker | `label` (1–32, unique), `size` | locker | `LOCKER_LABEL_TAKEN` 409 |
| List lockers | `status?`, `size?`, `limit` (≤500), `offset` | items + total; `currentPackage` carries the customer label for staff only, and `accruedCharge` for admins | |
| Store package | `size`, `customerId` (a customer account) | `lockerId`, `lockerLabel`, `customer`, `notified`; `pickupCode` for admins only | `NO_SUITABLE_LOCKER` 409, `CUSTOMER_NOT_FOUND` 422, `PICKUP_CODE_GENERATION_FAILED` 503 |
| Retrieve | `lockerId`, `pickupCode` | `lockerOpened`, `storageCharge { amount, chargedDays, breakdown }` | `LOCKER_NOT_FOUND` 404, `LOCKER_EMPTY` 409, `INVALID_PICKUP_CODE` / `NOT_YOUR_PACKAGE` 403, `PICKUP_LOCKED` 423, 429 |
| Reveal a waiting code | `lockerId` | `pickupCode`, `customerLabel` (admin only, logged) | `LOCKER_EMPTY` 409, `PICKUP_CODE_UNAVAILABLE` 409 |
| Account | — (self) or `customerId` (admin) | `balance`, `charged`, `paid`, `transactions` | `USER_NOT_FOUND` 404 |
| Record payment / adjustment | `amount` (+ `note` / `reason`) | the ledger row written | `USER_NOT_FOUND` 404, `VALIDATION_ERROR` 400 |

Everything is synchronous: each operation is a handful of indexed queries in one short transaction.

### Allocation (Level 1 and 4)

```sql
SELECT l.* FROM lockers l
WHERE  l.status = 'AVAILABLE' AND l.size IN ($sizes_that_can_hold_package)
ORDER  BY CASE l.size WHEN 'SMALL' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LARGE' THEN 2 END,
          l.created_at, l.id
LIMIT  1
FOR UPDATE SKIP LOCKED;
```

- Smallest fitting locker first; ties broken deterministically.
- `FOR UPDATE` claims the row for the transaction. `SKIP LOCKED` makes a concurrent transaction skip
  a row someone else holds instead of blocking on it, so N simultaneous requests walk the same ordered
  list and each takes the next free row. There is no application-level lock, queue, or retry loop for
  contention: Postgres does the serialisation and the throughput is bounded only by the pool.
- Same transaction: insert `packages` row (`STORED`), set locker `OCCUPIED`, commit.
- Belt and braces: `UNIQUE (locker_id) WHERE status = 'STORED'` on `packages`. If any future code path
  tried to put a second package in an occupied locker, the database would refuse.

### Pickup codes

- Format: `PICKUP_CODE_LENGTH` (default 6) decimal digits from `crypto.randomInt`. Keypad-friendly.
- Storage: HMAC-SHA256 keyed with `PICKUP_CODE_SECRET`. A leaked table is useless without the secret;
  a plain SHA-256 of a 6-digit code would be reversible in milliseconds. Comparison is constant-time.
- Uniqueness: `UNIQUE (pickup_code_hash) WHERE status = 'STORED'`. Only active codes must be unique;
  a retrieved package's code can be reissued later. Collision probability per store with 1,000 active
  packages is 0.1 %; the service retries with a new code up to 3 times, then returns 503.
- Exposure: returned once in the store response. Never in any list, detail, or log.
- Guessing, two layers:
  1. `POST /packages/retrieve` is limited to `PICKUP_RATE_LIMIT_PER_MINUTE` (10) per client IP
     (`@nestjs/throttler`, in-memory, so per process; set `TRUST_PROXY=true` behind a load balancer or
     every customer shares the proxy's IP). This slows a single attacker; it does not stop a distributed one.
  2. **Per-package lockout**, the control that actually protects a 6-digit space: every wrong code
     increments `packages.failed_pickup_attempts` (committed even though the request is rejected); at
     `PICKUP_MAX_FAILED_ATTEMPTS` (5) the package gets `pickup_locked_until = now + PICKUP_LOCKOUT_MINUTES`
     (15) and every attempt, right code included, answers `423 PICKUP_LOCKED` until then. The count
     restarts after the lockout. Worst case for an attacker: 5 guesses per 15 minutes per locker, i.e.
     ~570 years for the full space, independent of how many IPs they have.

### Retrieval (Level 2)

Transaction: lock the locker row `FOR UPDATE` (waiting, not skipping: two customers at one door must
serialise, and a store on a just-freed locker must see the release) → locker exists → has a `STORED`
package → not locked out → HMAC matches → quote charge → mark package `RETRIEVED` with `retrieved_at`,
`storage_charge`, `charged_days` → locker `AVAILABLE` → commit. A second attempt with the same code
finds no stored package and gets `LOCKER_EMPTY`.

The transaction returns an outcome rather than throwing: a wrong code must *commit* its
failed-attempt update and only then be rejected, so the service throws after the commit.

Error precedence is deliberate: unknown locker (404) before empty locker (409) before locked out (423)
before bad code (403), so a customer at the kiosk gets the most actionable message.

### Storage charges (Level 3)

`StoragePricingStrategy.quote(storedAt, retrievedAt) → StorageCharge`. Bound implementation
`TieredPricingStrategy`, configured from the environment:

| | Days | Rate |
|---|---|---|
| Tier 1 | `STORAGE_TIER_1_DAYS` (5) | 1 × `STORAGE_RATE_PER_DAY` |
| Tier 2 | `STORAGE_TIER_2_DAYS` (5) | 2 × |
| Tier 3 | open-ended | 3 × |

A day is a **started** 24-hour period from `stored_at` (`ceil(elapsed / 24h)`), the same rule a car park
uses.

**The ledger.** `customer_transactions` is append-only: one row per billed collection (`CHARGE`, written
inside the retrieval transaction so the package and the ledger commit together or not at all) and one per
payment an admin records (`PAYMENT`). `amount` is signed, positive owed and negative settled, so a balance
is `SUM(amount)` and history is never rewritten. A check constraint enforces the sign per type, and a
partial unique index on `(package_id) WHERE type = 'CHARGE'` means a collection can be billed only once.
Money changing hands is out of scope: recording a payment states that it was received, it does not take it.

The dependency runs one way, `packages → billing`: the packages module calls `billCollection` during
retrieval, and billing knows nothing about lockers or packages. That is why the accruing (unbilled)
amount lives on the packages endpoints rather than in the account response; the UI shows both together.

**What is owed, and what is recorded.** The amount a waiting package owes changes with every passing day,
so it is computed on demand rather than stored: `chargeSoFar()` quotes `stored_at → now` for a `STORED`
package and `stored_at → retrieved_at` for one already collected. The figure that *is* persisted is the
one calculated at collection (`storage_charge`, `charged_days`), which is what the customer was actually
charged and what the station totals are built from. A customer sees the running amount for their own
packages on `GET /packages/mine`; an admin sees it per locker (`currentPackage.accruedCharge`, stripped
for other roles) and as station totals on `GET /packages/charges`, which sums live quotes for waiting
packages and `SUM(storage_charge)` for collected ones. Taking payment is out of scope: the system states
the amount, it does not settle it. Negative elapsed time (retrieval host clock behind the storage host's) is clamped to zero days
rather than rejected: clock drift must never make a package unretrievable. `STORAGE_FREE_DAYS` (default 0) is subtracted before tiering. The response returns the total and a
per-tier breakdown so the customer can see how the number was reached. `retrieved_at` comes from an
injected `Clock` so the rule is testable without waiting.

## Data changes

```
lockers                                   packages
  id          uuid PK                       id                uuid PK
  label       varchar(32) NOT NULL UNIQUE   locker_id         uuid NOT NULL → lockers.id (RESTRICT)
  size        locker_size NOT NULL          size              locker_size NOT NULL
  status      locker_status NOT NULL        customer_id       varchar(64) NOT NULL
  created_at  timestamptz                   pickup_code_hash  char(64) NOT NULL
  updated_at  timestamptz                   status            package_status NOT NULL
                                            stored_at         timestamptz NOT NULL
                                            retrieved_at      timestamptz NULL
                                            storage_charge    numeric(12,2) NULL
                                            charged_days      integer NULL
                                            pickup_code_encrypted text NULL   (AES-GCM, wiped on retrieval)
                                            failed_pickup_attempts integer NOT NULL DEFAULT 0
                                            pickup_locked_until    timestamptz NULL
                                            customer_id       varchar(64) NULL   (legacy free-text reference)
                                            customer_user_id  uuid NULL → users.id (RESTRICT)
                                            created_at / updated_at

customer_transactions
  id                  uuid PK
  customer_user_id    uuid NOT NULL → users.id (RESTRICT)
  type                transaction_type NOT NULL   (CHARGE | PAYMENT | ADJUSTMENT)
  amount              numeric(12,2) NOT NULL      (signed; CHECK matches the type)
  currency            varchar(12) NOT NULL
  description         varchar(200) NOT NULL
  package_id          uuid NULL → packages.id     (UNIQUE where type = 'CHARGE')
  recorded_by_user_id uuid NULL → users.id
  occurred_at / created_at

users                                     otp_codes
  id            uuid PK                     id          uuid PK
  email         varchar(254) NOT NULL       user_id     uuid NOT NULL → users.id (CASCADE)
                UNIQUE, CHECK lowercase     code_hash   char(64) NOT NULL
  role          user_role NOT NULL          expires_at  timestamptz NOT NULL
  display_name  varchar(80) NULL            consumed_at timestamptz NULL
  active        boolean NOT NULL            attempts    integer NOT NULL DEFAULT 0
  last_login_at timestamptz NULL            created_at  timestamptz
  created_at / updated_at
```

`packages.customer_id` was the free-text reference before accounts existed; the second migration made it
nullable and added `customer_user_id`. Rows from before keep their text, new rows carry the account id
(the application requires it), so the schema change was additive and no data was rewritten.

Enums: `locker_size (SMALL, MEDIUM, LARGE)`, `locker_status (AVAILABLE, OCCUPIED)`,
`package_status (STORED, RETRIEVED)`, `user_role (ADMIN, AGENT, CUSTOMER)`,
`transaction_type (CHARGE, PAYMENT, ADJUSTMENT)`.

Constraints:

- `ck_packages_status_fields`: `STORED` ⇒ retrieval fields all NULL; `RETRIEVED` ⇒ all NOT NULL.
- `ck_packages_retrieved_after_stored`, `ck_packages_charge_not_negative`, `ck_packages_failed_attempts_not_negative`.
- `ux_packages_one_stored_per_locker` — `UNIQUE (locker_id) WHERE status = 'STORED'`.
- `ux_packages_active_pickup_code` — `UNIQUE (pickup_code_hash) WHERE status = 'STORED'`.

Indexes: `ix_lockers_status_size` (allocation query), `ix_packages_locker_id` (retrieve, list join),
`ix_packages_customer_id` (future "my packages" lookups).

`lockers.status` is denormalised (derivable from `packages`), kept because it makes the allocation
query a single indexed scan and the list view a single join, and it is written in the same transaction
as the package row. The partial unique index is the guard against the two ever disagreeing.

Migration: one forward migration in SQL (`InitialSchema`), run on boot (`DB_MIGRATIONS_RUN`) or via
the TypeORM CLI, fully reversible (`down` drops everything). Greenfield, so no expand/contract needed.

## Failure handling

| Dependency / case | Behaviour |
|---|---|
| Postgres down at boot | TypeORM retries (Nest default 10 × 3 s); Compose waits for the db healthcheck first |
| Postgres down at runtime | Request fails 500 (`INTERNAL_ERROR`); `/health` returns 503; nothing half-written thanks to transactions |
| Two agents, one locker | One commits, the other skips the locked row and gets `NO_SUITABLE_LOCKER` or the next free locker |
| Pickup code collision | Retry with a new code (≤3), then 503 `PICKUP_CODE_GENERATION_FAILED`; nothing persisted |
| Duplicate label race | DB unique constraint → `LOCKER_LABEL_TAKEN` 409 |
| Client retries a store after a timeout | Not idempotent by design: a retry stores a second package (there is no idempotency key in the brief). Adding `Idempotency-Key` → unique index on `(customer_id, key)` is the natural extension |
| Bad configuration | Validated at boot; the process refuses to start with a clear message. A placeholder secret (`change-me…`, `local-dev…`) is refused outright under `NODE_ENV=production` and warned about loudly otherwise |
| A payment recorded twice | Not prevented: there is no idempotency key. It is corrected by adding an `ADJUSTMENT` row, never by editing history |
| Brute-forcing codes | 10 attempts/min/IP on retrieve, 300 req/min/IP elsewhere; 5 wrong codes per package → 15-minute lockout (423) |
| Guessing login codes | 10 req/min/IP on the login endpoints; 5 wrong guesses burn the code; 3 codes per account per 10 min; unknown emails get the same response |
| SMTP down | Login codes cannot be delivered (logged, user sees the neutral message); package stores still succeed with `notified: false` |
| Stolen or forged cookie | HMAC over the payload; a single changed byte is a 401. Expiry is inside the signed payload |
| API host clock behind storage clock | Charged as zero days; never an error |

Timeouts: the only outbound dependency is Postgres via the `pg` pool (default connect timeout). No
third-party calls exist.

## Trade-offs

| Decision | Alternative rejected | Why |
|---|---|---|
| `FOR UPDATE SKIP LOCKED` | Optimistic locking with a version column and retry loop | Optimistic locking makes every contender but one fail and retry; under a burst that is O(n²) work and unpredictable latency. Skip-locked gives each transaction the next free row in one query. |
| | Application mutex / in-memory queue | Breaks with more than one API instance. |
| | `SERIALIZABLE` isolation | Correct but again retry-on-conflict for every contender. |
| HMAC of the code, secret in env | Plain SHA-256 | Trivially reversible for a 6-digit space. |
| | Store plaintext | A DB leak would open every locker. |
| Denormalised `lockers.status` + partial unique index | Derive status from `packages` on every read | Read simplicity and index-friendly allocation; the index keeps it honest. |
| Abstract class as DI token (`StoragePricingStrategy`, `PickupCodeGenerator`, `Clock`) | Symbol tokens + `@Inject()` | Type-safe injection with less ceremony; swapping the implementation is a one-line provider change. |
| Decimal money (`numeric(12,2)`, JS number rounded to 2 dp) | Integer minor units | The brief speaks in "units" and never combines currencies; noted as the production upgrade. |
| Explicit `EntityManager` threaded through repositories | `@Transactional()` decorator / CLS | Visible transaction boundaries; nothing commits by accident. |
| Email one-time codes | Passwords | Nothing to leak or reset; the email inbox is already the trust anchor for a pickup-code system. |
| Signed stateless session cookie | Server-side session table / `@nestjs/jwt` + Passport | No per-request DB read, no extra dependency; revocation is by expiry or secret rotation, acceptable for 12-hour kiosk sessions. |
| Admin-created accounts only | Self sign-up | The station operator decides who is an agent; customers arrive from the ordering system, not from a form. |
| Append-only ledger with a signed `ADJUSTMENT` row | Editing or deleting a wrong row | History stays the explanation of the balance; a correction is itself a fact, with a reason and an author. |
| Customers see occupancy only | Showing every signed-in user who has a package where | An association of identity, locker and timing that a customer has no need for; staff still see it because they act on it. |
| The pickup code is emailed and shown to admins only | Returning it to whoever stored the package | An agent who cannot read the code cannot collect the package they stored; an admin can still help a customer who has lost the email. |

## Risks and rollback

- **Rotating `PICKUP_CODE_SECRET`** invalidates every outstanding code. Rotation needs a dual-key
  verify window; not built.
- **Pool exhaustion under very large bursts**: skip-locked transactions are short, but `pg` defaults to
  10 connections; raise `max` for a station with hundreds of agents.
- **Clock skew**: charges depend on the API host clock (`Clock`). Backward skew is clamped to a zero-day
  charge (revenue risk, not availability risk). Use NTP; or take `now()` from the database if several
  API hosts disagree materially.
- **Rate limiter is per process**: with several API replicas the per-IP limit multiplies by the replica
  count. The per-package lockout lives in the database and is unaffected.
- **Balances assume one currency.** Each ledger row records the currency it was written in, but the
  aggregates sum across them. Only a change to `STORAGE_CURRENCY` can produce a mix, and that needs a
  data migration anyway; the service logs an error if it ever sees more than one currency in the ledger.
- **A deactivated user keeps their session** until it expires, because sessions are stateless signed
  cookies with no per-request database read. The endpoint documentation and the test both say so.
- Rollback: `npm run migration:revert` drops the schema; the service is stateless otherwise. The
  `AddUsersAndAuth` down-migration deliberately leaves `packages.customer_id` nullable: packages stored
  after it reference an account instead, so restoring `NOT NULL` would fail on their null values.

## Assumptions made

Listed in the README under *Assumptions*. The two that most affect behaviour: a package fits any locker
of its size or larger on the shared S/M/L scale, and any started 24-hour period is a chargeable day
(no free grace period unless `STORAGE_FREE_DAYS` is set).

## Verification

- 81 unit tests: pricing (boundaries, tiers, free days, rounding, clock skew, config validation), size
  rules, code generation/hashing, services with mocked repositories (happy, failure, retry and lockout
  paths, ownership, notification email and its failure, event publication without codes), event stream,
  environment schema.
- 66 end-to-end tests against real Postgres, all through real logins: the OTP flow and demo mode (identical response
  for unknown emails, single-use codes, attempt and request limits, inactive accounts, logout, tampered
  cookies), role enforcement on every endpoint, user management and the masked customer directory,
  package ownership, the customer ledger (charges billed on collection, payments, balances, history,
  pagination and role boundaries), Levels 1–3 flows and invalid scenarios, per-package lockout and expiry, per-IP
  throttling, the SSE stream (auth required, no code or email in any frame), plus Level 4: 40 concurrent
  stores against 5 lockers → exactly 5 × 201, 35 × 409, all locker ids distinct, availability consistent;
  size constraints under contention; interleaved store/retrieve.
- 46 frontend tests (Vitest + Testing Library): API client envelope handling and error wording, the login
  flow with and without demo mode, role-based routing and redirects, the agent's customer picker → store → reveal, the customer panel,
  the live hook (event → refetch, polling fallback, cleanup) against a fake EventSource.
- Independent review by the backend-engineering-kit reviewer agent: verdict "approve with suggestions";
  its two major findings (clock-skew 500, per-locker lockout) and the minor ones are addressed above.
- Manual: `docker compose up --build`, then the walkthrough in the README, including a 40-request
  burst against the seeded 6 lockers → `6 × 201, 34 × 409`.
