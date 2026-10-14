# OpenSeller

A self-hostable e-commerce platform: customer storefront (marketplace, cart, checkout), customer accounts (addresses, orders, complaints, reviews), real-time complaint messaging with notifications, discount codes, and an admin back office (dashboard, orders, complaints, homepage editor, products). One Docker Compose stack — PostgreSQL, Redis, Express API, Next.js frontend, nginx — with Stripe as the only external dependency, and even that is optional for trials (mock-payment mode).

**Stack:** Express 5 + Prisma 7 + PostgreSQL 18 (TypeScript via Node type stripping, no build step) · Next.js 16 + Tailwind 4 + shadcn/ui · nginx reverse proxy with automatic Let's Encrypt TLS · Redis for idempotency records.

## Deploy it yourself

One script takes you from a fresh clone to a running store:

```bash
./scripts/deploy.sh
```

It interviews you (store name, domain, currency, Stripe/Resend keys, admin login), writes a single root `.deploy.env` as the source of truth, derives the per-service `config/.env.*` files Docker Compose consumes, then does the full first start: build → up → migrate → optional demo seed → admin provisioning → login smoke check → URL summary.

```bash
./scripts/deploy.sh --yes            # non-interactive (values from env / .deploy.env)
./scripts/deploy.sh --seed           # load demo catalog without asking
./scripts/deploy.sh --no-seed        # skip demo data
./scripts/deploy.sh --skip-up        # write env files only, don't start containers
./scripts/deploy.sh --print-only     # show what would be written, change nothing
./scripts/deploy.sh --regenerate-secrets  # rotate JWT + DB password (destroys data)
```

What it asks for and why:

| Input | Why |
|---|---|
| Store name | Replaces the `sampledomain` placeholder in the header, homepage, and email templates (via `STORE_NAME` / `NEXT_PUBLIC_STORE_NAME`) |
| Domain (or empty for local trial) | Sets `STORE_URL`, CORS origins, and nginx `DOMAIN` for automatic certbot issuance |
| Currency code | Single `STORE_CURRENCY` drives integer-minor-unit pricing everywhere |
| Stripe keys (optional) | Blank = browsable store, checkout refuses with a clear message; mock payments cover trials |
| Resend key (optional) | Blank = verification/reset links print to the backend log instead of sending |
| Admin email + password | Provisioned directly in the DB (verified + `ADMIN`); never written to disk |

Re-runs are safe: saved answers are reused, secrets never rotate unless asked, and seeding is skipped when the catalog is already populated. Live secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`) are generated with `openssl`, never prompted.

Nightly `pg_dump` runs at 1am UTC from cron inside the backend container into `./backups` (14-day retention). Those files sit next to the database they back up — copy them offsite (object storage, another host) or you have files, not backups.

## Engineering highlights

- **Auth model that survives real life.** `User` holds credentials only; all commerce data hangs off `Profile`, so deleting an account can't cascade into order history. The JWT subject *is* the profile id, so commerce queries never join back. Email change revokes verification without locking the user out mid-session (`verificationPending` vs signed-out are distinct states in the client).
- **Checkout is honest about money.** Prices re-price server-side from the catalog at session creation; oversell is refused pre-payment but tolerated post-payment (a webhook race must never fail a charge already taken). Discount codes re-validate at purchase time with race-safe redemption counting, and Stripe line items are scaled so the receipt totals to the cent.
- **Idempotency as infrastructure, not garnish.** Every mutating request can carry a key; same-key-different-body is a 422, 5xx releases the key, replays include `Set-Cookie` (a lost login response still authenticates). Redis holding session tokens is called out as a real trade, with the fail-open reasoning documented.
- **Real-time with a durability story.** WebSocket threads + notification bell are the fast path; `Notification` rows are the record, so offline readers lose nothing. Guest threads auth by order token, admins by role, and sockets degrade to REST polling behavior when disconnected.
- **Data-model hygiene.** Orders snapshot addresses/discounts/codes as strings, never relations — history survives edits and deletes. Complaint threads are append-only; the admin detail endpoint selects field-by-field because the full rows carry a token hash and a password hash.
- **Operational honesty.** Prod refuses to boot in misconfigured states that would fail silently (mock payments under `PROD`, missing `DOMAIN` serving a self-signed cert that *looks* deployed). Migration and seed flows are idempotent; the deploy script never overwrites live secrets.

## Feature tour

- **Storefront:** marketplace with search/filter/sort, product pages with variants and reviews, localStorage cart with server reconciliation (repriced/clamped/unavailable lines reported, never silently dropped), guest + account checkout with saved addresses, discount codes, Stripe Checkout or mock confirm.
- **Accounts:** address book with defaults, order history with timelines, complaint filing with a two-sided live message thread (customer replies reopen closed threads), notifications inbox + header bell fed by WebSocket.
- **Admin:** dashboard (metrics, discount-code CRUD), orders (fulfil/cancel/refund with timeline + complaint threads inline), complaints queue linking into per-complaint views (order, timeline, thread, reply, acknowledge/resolve/dismiss), visual homepage editor (draft/published isolation, validated JSON tree), product and catalog management.

## Local development

```bash
make setup   # create config/.env.* from examples (first time only)
make seed    # migrate + load demo catalog
make dev     # full stack, hot reload, http://localhost
```

Single origin behind nginx (`/api` → backend), so no CORS or cookie configuration in dev. `NEXT_PUBLIC_*` values bake in at `next build` — set them before building, which `deploy.sh` ordering guarantees.

## Makefile reference

| Command | What it does |
|---|---|
| `make help` | List everything |
| `make setup` | Create `config/.env.*` from examples (never overwrites) |
| `make seed` | `prisma migrate deploy` + `prisma db seed` |
| `make dev` | Full stack, frontend dev server with hot reload (`http://localhost`) |
| `make prod` | Full stack, built frontend, real TLS (needs `DOMAIN`; `SELF_SIGNED=1` override for local TLS tests) |
| `make down` / `make destroy` | Stop (keep data) / stop and delete the database volume |
| `make logs` / `make logs-<svc>` | Tail all or one service |
| `make shell` / `make db` / `make redis` | Shell in backend / `psql` / `redis-cli` (idempotency records) |
| `make lint` | Frontend `tsc --noEmit` (backend runs on type stripping, no typecheck configured) |
| `make test` | All suites against the running stack (sweeps + reseeds around itself) |
| `make test-cart` | Cart-logic unit tests, no stack needed |
| `make test-account email=...` | Throwaway verified shopper for ad-hoc probing |
| `make test-order mode=paid` | Throwaway guest order in a chosen state |
| `make test-clean-email prefix=...` / `make test-set-token email=... mode=...` | Sweep helpers and verification-token writer |
| `make clean` | Remove containers, volumes (including `pgdata`), build output, uploads |

Suites in `backend/test/*.mjs` drive the stack over HTTP like a browser would (cookie attributes, wrong-origin links, auth-guard fall-through); `frontend/test/cart.mjs` asserts the pure cart reducer. They need a seeded stack; `email` renames a shopper mid-run so it uses a throwaway address and runs last.
