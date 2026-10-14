# OpenSeller

A self-hostable merchant platform: marketplace storefront, cart, Stripe checkout, customer
accounts, and an admin panel. Runs entirely on your own hardware with no external accounts
required — the only external dependency is a Stripe account for taking payments.

## Stack

- **Backend** — Express 5 + Prisma 7 + PostgreSQL 18, running TypeScript directly via Node's
  type stripping (no build step)
- **Frontend** — Next.js 16 + Tailwind 4 + shadcn/ui
- **Infra** — nginx reverse proxy, Redis (idempotency records), Docker Compose

## Quick start

```bash
make setup   # create config/.env.* from the examples
make seed    # migrate and load the demo catalog
make dev     # full stack in Docker, frontend hot reloads, http://localhost
```

Then open <http://localhost>.

Seeded logins, password `password123` for all:

| Role     | Email                     |
| -------- | ------------------------- |
| Admin    | `admin@openseller.test`   |
| Admin    | `ops@openseller.test`     |
| Shopper  | `sarah@openseller.test`   |

## Two ways to run

Everything runs in Docker Compose behind nginx on `:80`. There is no standalone-frontend
mode and no API-only mode: one origin, one command, one set of env files.

### Development

```bash
make dev
```

The frontend runs `next dev` with hot reload through a bind mount, and nginx proxies both
the API and the app. The frontend talks to the API through a relative `/api` path, so there
is no CORS and no cross-site cookie to reason about.

### Production

```bash
# config/.env.nginx needs DOMAIN (and CERTBOT_EMAIL) first
make prod
```

The frontend is built (`next build`) and served by `next start`, and nginx terminates TLS
via certbot, redirecting `:80` to `:443`. `make prod` refuses to start without a `DOMAIN`,
because without one it would quietly come up serving a self-signed certificate that looks
like a working TLS deployment and is not one; `make prod SELF_SIGNED=1` is the escape hatch
for testing that locally.

Two independent flags keep the modes apart:

| Variable         | Question                                     | Value            |
| ---------------- | -------------------------------------------- | ---------------- |
| `DOCKER_MODE`    | Is the frontend in this Compose stack?       | always `true`    |
| `FRONTEND_DEV`   | Dev server, or built for production?          | dev / prod       |

They used to be one variable, which meant `make docker-prod` served the Next **dev server**
under `PROD=true`. Keep them separate if you touch this.

### Deploying the frontend elsewhere

The frontend has no Docker requirement. Point it at the API and it runs anywhere:

```bash
NEXT_PUBLIC_API_URL=https://api.example.com npm run build
```

If the API is on a genuinely different *domain* from the frontend, set on the backend:

```env
FRONTEND_URL=https://shop.example.com
COOKIE_SAME_SITE=none
```

`none` forces `Secure` on the cookies, which in turn requires HTTPS. If both sit on
subdomains of one domain, set `COOKIE_DOMAIN=.example.com` instead and leave `SameSite` at
its `lax` default.

## Configuration

All config lives in `config/`. Each service reads its own file, and the
`.example.env.*` files are the committed templates.

| Variable | Default | Purpose |
| --- | --- | --- |
| `STORE_CURRENCY` | `usd` | ISO 4217 code for every price. Must match `NEXT_PUBLIC_STORE_CURRENCY`. |
| `STORE_URL` | `http://localhost` | Public base URL of the **storefront**, not the API. Stripe redirects and all email links point here. HTTPS in production (checked at boot). Set it explicitly rather than inferring it from `DOCKER_MODE`: a backend recreated with one value while nginx still proxies the other sends Stripe to a port nothing is listening on. |
| `LOW_STOCK_THRESHOLD` | `5` | Default "nearing out of stock" cutoff; per-variant override exists. |
| `STRIPE_SECRET_KEY` | — | Checkout sessions and refunds. |
| `STRIPE_PUBLISHABLE_KEY` | — | The `pk_` counterpart, for saving a card on `/profile/payment-methods`. Not derivable from the secret key; checkout itself never needs it, since it is a redirect to Stripe-hosted Checkout. |
| `STRIPE_WEBHOOK_SECRET` | — | Webhook signature verification. |
| `COOKIE_SAME_SITE` | `lax` | `none` only for cross-domain deployments. |
| `COOKIE_DOMAIN` | — | Shared parent domain, e.g. `.example.com`. |
| `FRONTEND_URL` | `http://localhost:3000` | Comma-separated CORS allow-list. |
| `MAX_UPLOAD_BYTES` | `5242880` | Per-file product image cap. |
| `REDIS_URL` | `redis://redis:6379` | Idempotency record store. Internal only, never expose it. |
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | How long a response stays replayable. |
| `IDEMPOTENCY_LEASE_SECONDS` | `60` | How long an in-flight request holds its key. |
| `IDEMPOTENCY_WAIT_MS` | `3000` | How long a duplicate waits for the original before a 409. |

### Money

Prices are integer minor units everywhere, with a currency code alongside. They render as
`18.50 USD`, never as a symbol: which glyph a currency maps to is locale-dependent, and
locale belongs to the reader's browser, not the store. Codes are unambiguous and stable
across server-rendered HTML, hydration, and copy-paste. Formatting happens server-side so
hydration cannot disagree with the server's markup.

Changing currency is one env var. Note that minor units differ — `jpy` has none, most
currencies use 100, `kwd`/`bhd`/`omr` use 1000 — and that is handled from the code.

## Data model

`User` holds authentication only: credentials, email, verification, refresh tokens. A
customer's commerce data — addresses, orders, reviews, saved cards, complaints — hangs off
`Profile`, along with the Stripe customer id (a billing identity, not a credential).

Splitting them means revoking or deleting an account cannot cascade into order history or
erase published reviews. It also matches the JWT: the access token's subject is the *Profile*
id, so commerce queries are `where: { profileId: req.user.id }` with no join back to `User`.

## API

All responses use one envelope:

```json
{ "data": {}, "message": "", "error": false }
```

List endpoints take `?page` and `?perPage` (default 24, max 100) and return
`{ items, total, page, perPage, totalPages }`.

`GET /products` also accepts `?search=`, `?category=<slug>`, `?inStock=true` and `?sort=`
(`newest`, `price_asc`, `price_desc`, `rating`). Every sort ends on an `id` tiebreaker so
pagination is stable — without it, rows with equal sort keys can repeat or vanish across
pages.

Public:

| Method | Path |
| --- | --- |
| GET | `/health` |
| GET | `/homepage` |
| GET | `/categories` |
| GET | `/products` |
| GET | `/products/:slug` |
| GET | `/products/:slug/reviews` |
| GET | `/uploads/*` |

### Homepage

The home page is one JSON tree — sections → columns → elements — held in a single `HomePage`
row as two copies: `draft`, which the editor writes to, and `published`, which the storefront
serves. Publish copies the first over the second, so a half-built page is never in front of a
visitor.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/homepage` | Public. `{ layout, updatedAt }`; `layout` is `null` until something has been published. |
| GET | `/admin/homepage` | `{ draft, published, dirty, updatedAt }` — the editor's whole state in one response. |
| PUT | `/admin/homepage` | Body `{ layout }`; replaces the draft, or `400`s if the tree fails validation. |
| POST | `/admin/homepage/publish` | Draft becomes live. |
| POST | `/admin/homepage/discard-draft` | Draft resets to `published`. `400` when nothing has been published. |

`dirty` is computed by the API rather than by the editor, by comparing the two documents over
jsonb's canonical key order. A browser-side comparison of two trees built by different edits
disagrees with reality often enough to make the Publish button lie.

`/` renders `published` and falls back to the original placeholder whenever that is `null` or
has no sections left in it — so a store that has never opened the editor looks exactly as it
did before this feature existed, and an editor that has published everything away does too.

`backend/src/lib/homepage.ts` is what makes a client-authored tree safe to store as `jsonb`:
ids are bounded, kinds must be in the allowlist, backgrounds are hex colours or http(s) paths,
`fields` are depth- and size-limited, and unrecognised keys are dropped rather than kept —
junk written today is junk every storefront render pays for forever. Caps are 40 sections, 4
columns per section and 30 elements per column.

Element kinds are registered in `frontend/src/components/homepage/registry.ts` (label, default
fields, edit form, storefront renderer) and mirrored as an allowlist in the validator, so a
preset added to one and not the other fails the save instead of reaching the page.

### Idempotency

Every mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) may carry an `Idempotency-Key`
header. The frontend sends one on all of them; a client that omits it is unaffected, so this
is opt-in on the wire and a missing header can never become a new failure mode.

A key is minted when the user expresses an *intent* and reused for every attempt at that same
intent, which collapses a double-click, a fetch retried after a timeout, and React's dev-mode
double-invoked effects into a single execution. Responses report what happened:

| `Idempotency-Status` | Meaning |
| --- | --- |
| `stored` | Executed now; the response was recorded. |
| `replayed` | The same key already produced this response; the handler did not run again. |
| `bypassed` | Redis was unreachable, so the write happened with no record. See the caveat below. |
| `released` | The handler failed with a 5xx; the key was freed for a retry. |

Three behaviours worth knowing before relying on it:

- **Same key, different body is a `422`.** It catches a key recycled across two different
  actions, which would otherwise hand back the first action's result as if it were the
  second. Key *order* in a JSON body is not a difference: the fingerprint is computed over a
  sorted serialisation, so a re-serialised but identical body replays rather than being
  falsely accused.
- **A 5xx is not recorded.** The outcome of a failed request is unknown, and the whole point
  of reusing a key is to find out by retrying — so the reservation is dropped and the retry
  runs the handler for real. `4xx` is recorded, because the client received a definite answer
  and will mint a new key for the corrected attempt.
- **Replay includes `Set-Cookie`.** That is what lets a `/login` whose response was lost in
  transit still leave the client authenticated. The cost is that **Redis holds live session
  tokens** for the TTL. It is reachable only on the compose network and must never be given a
  published port. One sharp edge: an out-of-order stale retry can re-set an older refresh
  token over a newer one in the browser jar, and rotation will then reject it.

Keys are namespaced by the key alone, not by user or IP. Scoping by principal looks safer but
breaks the case this exists for — a retried `/login` carries cookies the first attempt did not
have, so a cookie-derived namespace would miss its own record and log in twice.

**When Redis is down the API fails open.** The write proceeds, the response comes back with
`Idempotency-Status: bypassed`, and the record is held in-process and flushed on reconnect.
The guarantee is genuinely weaker in that window — a duplicate write can slip through, and on
a multi-replica deploy a retry can land on an instance that never saw the outage. Availability
was judged the better default for a self-hosted store, but it is a real trade, not a free one.
Redis is a supervised compose service with a healthcheck, and the backend waits for it at
startup, so the fail-open path is a backstop rather than the normal case.

## Project structure

```text
.
├── backend/
│   ├── prisma/schema.prisma   # data model
│   ├── prisma/seed.ts         # demo catalog
│   └── src/
│       ├── controllers/       # routers, one per resource
│       ├── lib/               # config, prisma client, http, catalog helpers, redis
│       ├── middleware/        # checkTokens, requireAdmin, idempotency
│       └── app.ts             # middleware order matters, see below
├── frontend/                  # Next.js storefront and admin panel
├── nginx/                     # proxy config matrix, 2 x 2
├── config/                    # per-service env files
├── data/                      # PostgreSQL cluster (gitignored)
├── uploads/                   # product media (gitignored)
└── docker-compose.yml         # db, redis, backend, frontend (opt-in), nginx
```

### Middleware order

`app.ts` mounts the public catalog router *before* the protected router, because that mount
applies `checkTokens` to everything after it. The admin router mounts from *inside*
`routeGuard.ts` for the opposite reason: it needs `checkTokens` to have populated `req.user`
before `requireAdmin` can read the role.

`idempotency` sits after `express.json()` — it needs a parsed body to fingerprint — and before
every router, so a replayed key short-circuits ahead of the handler instead of running it and
then trying to undo the damage.

## Common commands

```bash
make help      # list everything
make logs      # tail all logs
make shell     # shell in the backend
make db        # psql prompt
make redis     # redis-cli prompt (idempotency records)
make down      # stop containers, keep data
make destroy   # stop containers and delete the database
make clean     # also drop build output, uploads, node_modules
make test      # API regression suites (needs the stack up)
```

## Tests

`make test` drives the running stack over HTTP the way a browser would, which is the only way to
catch the classes of bug that have actually bitten this project — cookie attributes, links aimed
at the wrong origin, and requests falling through to the auth guard instead of a 404.

| Suite | Covers |
| --- | --- |
| `regress` | catalog listing, filters, sorting, pagination, product detail, reviews, money |
| `isolation` | no commerce data or Stripe ids leak into public or `/me` responses |
| `guard` | auth: 401 vs 404 routing, refresh rotation, logout, admin role guard |
| `idempotency` | key replay, concurrent duplicates, 422 on a recycled key, 5xx key release |
| `email` | register → verify → login, and the email-change flow |
| `homepage` | draft/publish isolation, the validator's refusals, admin guard, discard, publish |

The suites need seeded data (`make seed`). `email` renames a shopper as part of testing the
email-change flow, so it uses a throwaway address; `backend/test/sweep.ts` deletes those accounts
and `make test` re-seeds around it. Running them repeatedly leaves the database in its seeded
state. `idempotency` rewrites a profile field and restores it, and it runs before `email` for
the same reason.

## Notes for contributors

- Migrations are generated with `prisma migrate diff --from-migrations --to-schema --script`
  and applied with `migrate deploy`, because `migrate dev` refuses to run non-interactively.
  The shadow database is `prisma_shadow`, declared in `prisma.config.ts`. Create it with
  `psql -c 'CREATE DATABASE prisma_shadow;'` before running the diff, or it silently no-ops.
- The backend has no typecheck configured yet; it runs on Node type stripping.
- `client_max_body_size` is 25m so batches of product images do not silently 413.
- `docker compose` needs ports 80 and 443 free. Another local stack on those will conflict.
- `STORE_URL` must be the **storefront**, not the API. Every email link and Stripe redirect
  points at it, and those are frontend routes that the API answers with a 404.