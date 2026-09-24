# Smart Package Locker Management System

Solution to the Everest Engineering coding challenge: delivery agents store packages in the smallest
locker that fits and receive a pickup code; customers retrieve with locker id + code and are charged for
extended storage; concurrent agents never get the same locker.

A monorepo with a **NestJS + PostgreSQL API** and a **React web UI** with **email one-time-code login**
for three roles (admin, delivery agent, customer), run together by Docker Compose.

```
apps/api            NestJS 12, TypeORM, PostgreSQL 16   the locker system (Levels 1-4)      apps/api/README.md
apps/web            React 19, Vite, nginx               role screens (agent / pickup / admin) with live locker status
docker/             Postgres init script (creates the e2e test database)
scripts/            share-url.sh: prints the public ngrok URL of a running stack
docker-compose.yml  db + mailpit + api + web; profiles: test (backend e2e runner), share (ngrok public URL)
docs/DESIGN.md      data model, concurrency argument, pickup-code security, pricing, trade-offs
docs/REVIEW.md      what two independent code reviews found, what was fixed, what is left open
```

## Quick start

Prerequisite: Docker Desktop with Compose v2. Nothing else to install.

```bash
docker compose up --build          # or: npm start
```

That is all it needs: the Postgres volume is created on first run, the API applies its migrations and
seeds six lockers and four demo accounts, and the UI is served by nginx. Nothing else has to exist
beforehand.

To also get a public URL for the stack, start it with the share profile instead
(see [Optional: share a public URL](#optional-share-a-public-url-for-testing)):

```bash
docker compose --profile share up --build    # or: npm run share
```

| What | URL |
|---|---|
| Web UI | <http://localhost:8080> (log in, then you land on your role's screen) |
| Delivery agent · Customer pickup · Station admin | <http://localhost:8080/agent> · <http://localhost:8080/pickup> · <http://localhost:8080/admin> |
| **Mailpit inbox** (all emails the app sends: login codes, pickup codes) | <http://localhost:8025> |
| Swagger UI (interactive API docs) | <http://localhost:8080/api/docs> |
| API, through the UI's proxy | <http://localhost:8080/api/lockers> |
| API, direct | <http://localhost:3000/api/lockers> |
| Health | <http://localhost:8080/api/health> |
| Postgres | `localhost:5433`, user / password / database `locker` |

On first boot the API runs its migrations and seeds 6 demo lockers (3 small, 2 medium, 1 large) plus
four demo accounts. The local stack runs with **`DEMO_MODE=true`**, so the login page lists these
accounts and one click logs you in (the API returns the login code in its response and the page
completes the login). The codes are still emailed, so you can also read them in the Mailpit inbox at
<http://localhost:8025>. Set `DEMO_MODE=false` in `.env` to get the normal email-only flow. The API
refuses to start with demo mode under `NODE_ENV=production`, which is why the compose file runs the API
with `NODE_ENV=development`.

| Email | Role | Can |
|---|---|---|
| `admin@locker.local` | ADMIN | everything: users, lockers, store, collect on a customer's behalf |
| `agent@locker.local` | AGENT | store packages for a customer |
| `alice@locker.local`, `bob@locker.local` | CUSTOMER | collect their own packages |

There is no self sign-up: admins create accounts on the Station admin screen (or `POST /api/users`).
Emails go to Mailpit by default; set the `MAIL_*` variables in `.env` to a real SMTP provider to send
for real (see `.env.example`).

### Your data between runs

The database lives in a named Docker volume, so **restarting or rebuilding keeps everything**. Only the
`-v` flag throws it away.

| Command | Containers | Your data |
|---|---|---|
| `docker compose up --build` | rebuilt and replaced | **kept** |
| `docker compose restart` | restarted | **kept** |
| `docker compose down` | removed | **kept** (the volume stays) |
| `docker compose down -v` | removed | **deleted**, next start re-seeds from scratch |

Two things make a rebuild safe. The API applies only migrations that have not run yet, and the seeders
check before writing: the boot log says `Skipping locker seed: 7 locker(s) already exist` and
`Skipping user seed: users already exist`. So the lockers you created, the accounts you added, the
packages in flight and the ledger all survive `up --build`; the demo seed only ever fills an empty
table.

Migrations are the exception worth knowing about, because changing data is their job. The four in this
project are additive, so upgrading a populated database keeps every row: when accounts were introduced,
packages stored before that kept their old customer reference rather than being removed.

To start clean on purpose:

```bash
docker compose down -v && docker compose up --build
```

## Try it in two minutes

Use two browser profiles (or one normal and one private window) so two accounts can be logged in at once,
and keep the Mailpit inbox (<http://localhost:8025>) open for the codes.

1. **Log in as the agent**: on the login page click the `agent@locker.local` demo button (or type the
   email and read the code from Mailpit). On **Delivery agent**, pick
   `SMALL`, search the customer directory for "alice", choose her, **Store package**. The locker grid
   turns one small locker red, the panel says the pickup code was emailed, and Mailpit shows the email to
   Alice with the code (Level 1). The agent never sees the code; only an admin storing a package gets a
   "Reveal code" control, for helping customers who cannot read their email.
2. **Log in as Alice** (`alice@locker.local`) in the other window. **Customer pickup** lists her waiting
   package and the locker; tap it, type a wrong code: "That pickup code does not match this locker." Now
   type the code from her email: the locker opens, turns green in both windows, and the storage charge
   table appears (Levels 2 and 3). Try the same with `bob@locker.local` and Alice's code: "not addressed
   to your account".
3. **Log in as the admin** (`admin@locker.local`). **Station admin** shows occupancy per size, the
   **Live activity** feed, the **Users** table (add accounts, change roles, deactivate), and **Fire
   burst**, which sends 20 concurrent store requests. With 4 free lockers the result reads "20 requests
   → 4 stored in 4 distinct lockers, 16 rejected" (Level 4).

The same flow with curl (the API uses an httpOnly session cookie, so log in first and keep a cookie jar):

```bash
# log in as the agent. With DEMO_MODE on (the compose default) the request returns the code, so there is
# no inbox step: read .data.demoCode instead of searching Mailpit.
CODE=$(curl -s -X POST localhost:8080/api/auth/otp/request -H 'content-type: application/json' \
  -d '{"email":"agent@locker.local"}' | grep -o '"demoCode":"[0-9]*' | grep -o '[0-9]*$')
curl -s -c agent.jar -X POST localhost:8080/api/auth/otp/verify -H 'content-type: application/json' -d "{\"email\":\"agent@locker.local\",\"code\":\"$CODE\"}"

# find Alice's account id, then store a small package for her
ALICE=$(curl -s -b agent.jar 'localhost:8080/api/users/customers?q=alice' | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
curl -s -b agent.jar -X POST localhost:8080/api/packages -H 'content-type: application/json' -d "{\"size\":\"SMALL\",\"customerId\":\"$ALICE\"}"
# -> {"success":true,"data":{"lockerLabel":"S-01","customer":{"label":"alice"},"notified":true,…}}
# No pickup code: the agent never sees it. It is in Alice's email (Mailpit), and an admin can read it with
#   curl -s -b admin.jar localhost:8080/api/lockers/<lockerId>/pickup-code

# Alice collects: log in as her the same way (alice.jar), then
curl -s -b alice.jar -X POST localhost:8080/api/packages/retrieve -H 'content-type: application/json' \
  -d '{"lockerId":"<lockerId>","pickupCode":"482913"}'
# -> {"success":true,"data":{"lockerOpened":true,"storageCharge":{"amount":10,"breakdown":[…]},…}}

# Level 4: 40 concurrent stores against 6 lockers -> 6 x 201, 34 x 409
seq 40 | xargs -P 40 -I{} curl -s -b agent.jar -o /dev/null -w '%{http_code}\n' -X POST localhost:8080/api/packages \
  -H 'content-type: application/json' -d "{\"size\":\"SMALL\",\"customerId\":\"$ALICE\"}" | sort | uniq -c
```

Every response uses one envelope: `{ "success": true, "data": … }` or
`{ "success": false, "error": { "code", "message", "details?" } }`. The full endpoint and error-code
table is in [apps/api/README.md](apps/api/README.md).

## How the challenge levels are met

| Level | Requirement | Implementation |
|---|---|---|
| 1 | Create lockers, view availability, store in the smallest fitting locker, issue a pickup code | One SQL statement picks the locker: `WHERE status = 'AVAILABLE' AND size IN (fitting sizes) ORDER BY size rank LIMIT 1 FOR UPDATE SKIP LOCKED`. Code is 6 random digits, returned once. |
| 2 | Retrieve with locker id + code, locker freed, invalid cases handled | Locker locked, checks in order: exists → has a package → not locked out → code matches (HMAC, constant-time). Package marked retrieved and locker freed in the same transaction. Codes are single use. |
| 3 | Record store time, tiered charge on pickup | `TieredPricingStrategy`: a day is a started 24 h period; X/day for 5 days, 2X next 5, 3X after, all configurable. Per-tier breakdown in the response. Customers see the running amount owed on their waiting packages; admins see it per locker and as station totals. |
| 4 | Concurrent stores never share a locker | `FOR UPDATE SKIP LOCKED` hands each concurrent transaction the next free locker with no waiting and no retry loop. A partial unique index (`packages.locker_id WHERE status = 'STORED'`) makes a double assignment impossible even if code ever regressed. |

Beyond the brief:

- **Accounts and login.** Three roles (`ADMIN`, `AGENT`, `CUSTOMER`), passwordless login by a one-time
  code emailed to the account (hashed at rest, 10-minute expiry, single use, 3–5 attempts), httpOnly
  session cookie. Every endpoint requires a session; lockers are created by admins, packages stored by
  agents for a chosen customer account, collected only by that customer (or an admin assisting).
- **Real notification.** The pickup code is emailed to the customer when the package is stored. Locally
  the Mailpit container receives it; point `MAIL_*` at an SMTP provider and it reaches real inboxes.
- **Code security.** Pickup codes are verified against an HMAC keyed by a server secret; while a package
  is waiting the code is also kept encrypted (AES-256-GCM, a second key) so an admin can read it out, and
  that copy is wiped on collection. Wrong codes are counted per package and lock the locker for 15
  minutes after 5 failures (`423 PICKUP_LOCKED`); the retrieve and login endpoints are rate limited per
  client IP (`429`).
- Environment is validated at boot; the service refuses to start on a bad value.

Details and trade-offs in [docs/DESIGN.md](docs/DESIGN.md).

## Architecture

```
browser ──► http://localhost:8080  (web: nginx)
                 ├── /            static React build
                 └── /api/*  ───► api:3000 (NestJS)  ───► db:5432 (PostgreSQL 16)
                                        └──────────────► mailpit:1025 (SMTP; inbox on :8025)
```

- **One origin for the browser.** nginx serves the UI and proxies `/api/*` to the API container, so there
  is no CORS configuration and one port to remember. In development, Vite's dev server does the same
  proxying.
- **Thin client.** Every rule lives in the API; the UI renders the envelope it gets back. The API sets
  `TRUST_PROXY=true` so its per-IP limits see the real client behind nginx.
- **Live status without polling.** `GET /api/lockers/events` is a Server-Sent Events stream. The API
  publishes `locker.created`, `package.stored` and `package.retrieved` after each transaction commits;
  every open screen refetches the board on any event, so agents, customers and admins on any device see
  the same state within a moment. If the stream drops, the UI polls every 5 s until it reconnects and
  the badge in the header says so. nginx keeps that one location unbuffered.
- **API layering.** Controller (validation, HTTP) → Service (rules, one transaction per operation) →
  Repository (all SQL, takes the caller's transaction) → PostgreSQL (constraints as the last line of defence).

### The web UI

Log in with an email code; the navigation shows only the screens your role may use. All screens share
one live locker board: green is available, red is occupied. Staff see whose package is inside (a display
name or a masked email); a customer sees only that the locker is taken. The header badge shows `live`
(server push) or `polling` (fallback), and every panel follows whichever mode the page is in.

- **Delivery agent** (`/agent`, agents and admins): size + a customer chosen from a searchable directory
  (names or masked emails, never full addresses) → locker label; the pickup code is emailed to the
  customer. Agents never see it; an admin on this screen gets a "Reveal code" control. "No suitable
  locker" surfaces the API's message.
- **Customer pickup** (`/pickup`, customers and admins): **My packages** lists what is waiting, where, and
  what it owes so far, with the total to pay in the header; collected packages show what they were charged.
  **My account** shows the balance and the full transaction history (charges and payments).
  Tap a package, enter the code from the email → "locker is open" and the charge breakdown. Wrong code, someone
  else's package, empty locker, lockout (`423`) and throttling (`429`) each have their own wording.
- **Station admin** (`/admin`, admins): occupancy counts overall and per size, add lockers, a live
  activity feed of every store and collection, **Fire burst** (N concurrent stores → stored / distinct
  lockers / rejected), and **Users**: add accounts of any role, change roles, deactivate and reactivate.
  Clicking a locker opens a popup showing who the package is for, what it owes so far, and a **Show pickup
  code** button, so an admin can help a customer who cannot reach their email (every reveal is logged). A
  **Storage charges** row totals what is outstanding across the lockers and what has been charged, and a
  **Customer accounts** row lists every customer's charged, paid and balance figures, with popups to read
  one customer's history or record a payment received.

## Optional: share a public URL for testing

An opt-in service tunnels the kiosk (UI and `/api`) through [ngrok](https://ngrok.com), so the app can
be tried from a phone or handed to a reviewer without deploying. It uses ngrok's official Docker image,
so nothing is installed locally.

**A plain `docker compose up --build` does not start it and prints no public URL**: the tunnel and the
banner live behind the `share` profile, so the stack never exposes itself to the internet unless you ask
it to.

```bash
cp .env.example .env            # set NGROK_AUTHTOKEN (free at https://dashboard.ngrok.com)
docker compose --profile share up --build
```

The public URL is printed for you as soon as the tunnel is up:

```
================= PUBLIC URL =================
  Kiosk UI   https://xxxx-xx-xx-xx-xx.ngrok-free.app
  Swagger    https://xxxx-xx-xx-xx-xx.ngrok-free.app/api/docs
  Inspector  http://localhost:4040
==============================================
```

A one-shot `share-url` service prints that banner and exits, so it appears inline when you run the stack
in the foreground. If you started it detached, ask for the URL any time:

```bash
npm run share:url                     # or ./scripts/share-url.sh
docker compose logs share-url         # the same banner from the run
```

<http://localhost:4040> is ngrok's request inspector, which also shows every API call the UI makes. Set
`NGROK_URL` in `.env` to use the one free static domain on your ngrok account instead of a random one.

Free-tier visitors see an ngrok interstitial once per browser. Anyone with the URL can create lockers and
store packages, so treat it as a throwaway test environment and stop it with
`docker compose --profile share down`.

## Tests

| Suite | Command (from the root) | Count | Covers |
|---|---|---|---|
| API unit | `npm --prefix apps/api test` | 81 | pricing boundaries and tiers, size rules, code generation and hashing, store/retrieve service logic incl. retry and lockout, env validation |
| API e2e (real Postgres) | `npm run test:e2e` | 66 | Login by emailed code, demo mode on and off (single use, attempt limit, request limit, inactive accounts, tampered cookie, logout), role enforcement on every endpoint, user management, masked customer directory, package ownership, Levels 1–3 flows and every invalid scenario, lockout and expiry, throttling, the SSE stream (auth required, events never carry a code or email), Level 4: 40 concurrent stores vs 5 lockers, size constraints under contention, interleaved store/retrieve |
| Web | `npm --prefix apps/web test` | 46 | API client envelope handling and error wording, login flow with one-click demo login, role-based routing and redirects, agent customer picker + store + reveal, customer panel, live hook (event → refetch, polling fallback, cleanup) |
| API e2e inside Docker | `docker compose --profile test run --rm e2e` | 66 | same as API e2e, against the `locker_test` database |

`npm test` runs the API unit and web suites together. `npm run lint`, `npm run typecheck` and
`npm run build` cover both apps. The e2e suite expects Postgres on `localhost:5433`
(`docker compose up -d db`).

## Development without Docker for the apps

Requires Node 24.9+ (`.nvmrc` at the root; the API's Jest relies on Node's `require(esm)` for NestJS 12).

```bash
nvm use
npm run install:all                  # npm ci in both apps
docker compose up -d db              # Postgres on localhost:5433

cp apps/api/.env.example apps/api/.env
DB_PORT=5433 npm run dev:api         # API with hot reload on :3000, docs at /api/docs
npm run dev:web                      # in another terminal: UI on :5173, proxying /api to :3000
```

Root scripts: `install:all`, `test`, `test:e2e`, `lint`, `typecheck`, `build`, `dev:api`, `dev:web`.

## Assumptions

- Package sizes use the same small / medium / large scale as lockers; a package fits any locker of its size
  or larger. Ties for "smallest available" are broken by creation order, so allocation is deterministic.
- A storage day is any started 24-hour period, so a pickup ten minutes after storage costs one day
  (X units). `STORAGE_FREE_DAYS` grants a grace period if the business prefers one.
- The pickup code appears once, in the store response, for the (out-of-scope) notification system.
- The brief leaves authentication and notification out of scope; this implementation adds both as a
  clearly separated layer (`auth`, `users`, `mail` modules and the guards) without changing the locker
  rules. The store and retrieve logic is the same code the Level 1–4 tests exercise.
- The only personal data stored is the account email (and an optional display name). Other users see a
  display name or a masked email, never the full address; emails are never logged.
- Login codes and pickup codes reach the customer by email. Agents never see a pickup code. Admins can:
  the store response includes it for them, and `GET /api/lockers/:id/pickup-code` shows the code of any
  waiting package (logged), so a station admin can help a customer who cannot read their email.
- Charges are decimals with two places; integer minor units would be the production choice.

## Code review

The project was reviewed twice independently, once over the API and once over the frontend and Docker
setup, and every finding was verified against the code before anything changed. The reviews found a
credential in the application logs, a broken concurrency demo, four panels that stopped refreshing after
thirty events, a station balance that only summed the page it had fetched, and a locker board that
showed customers each other's names. All of those are fixed, with tests that fail against the old code.

[docs/REVIEW.md](docs/REVIEW.md) records each finding, the failure it caused, and the five decisions
deliberately left open, including single-currency balances, non-idempotent payments, and sessions that
survive a user being deactivated.

## Where to read next

- [apps/api/README.md](apps/api/README.md): endpoints, error codes, configuration reference, curl walkthrough.
- [docs/DESIGN.md](docs/DESIGN.md): why `FOR UPDATE SKIP LOCKED` over the alternatives, schema and
  constraints, pickup-code security model, pricing rule, failure handling, risks and rollback.
- [docs/REVIEW.md](docs/REVIEW.md): the review record, the fixes, and the open decisions.
