# Runs entirely in Docker. Two modes, and that is the whole interface:
#
#   make dev    frontend dev server with hot reload, no TLS  -> http://localhost
#   make prod   built frontend, real TLS via certbot        -> https://$DOMAIN
#
# Every service always comes up together, behind nginx on :80. There is no standalone-frontend
# mode and no API-only mode: one origin, one command, one set of env files.
#
# Two flags, two different questions, deliberately not merged:
#
#   DOCKER_MODE   "is the frontend in this compose stack?" Always true now, so nginx always
#                 proxies the frontend. Also picks the right dev default for STORE_URL.
#   FRONTEND_DEV  the frontend's own axis: dev server with hot reload, or a real production
#                 build. The only thing the two targets disagree about.
#
# These used to be one variable, and conflating them cost two real bugs: `make docker-prod` set
# PROD=true but the frontend's mode was pinned true in compose, so prod served the Next *dev
# server*; and a backend recreated with DOCKER_MODE=false while nginx still proxied the frontend
# made STORE_URL point Stripe's redirect at a port nothing was listening on.

COMPOSE ?= docker compose

# Escape hatch for running the prod stack on nginx's self-signed fallback. Off by default,
# because that fallback looks like a working TLS deployment and is not one.
SELF_SIGNED ?= 0

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Setup"
	@echo "  make setup       create config/.env.* from the examples"
	@echo "  make seed        migrate + load the demo catalog"
	@echo ""
	@echo "Run"
	@echo "  make dev         full stack, hot reload, no TLS (http://localhost)"
	@echo "  make prod        full stack, built frontend, TLS (needs DOMAIN in config/.env.nginx)"
	@echo "  make down        stop and remove containers (keeps data)"
	@echo "  make destroy     stop and remove containers AND the database volume"
	@echo ""
	@echo "Logs and shell"
	@echo "  make logs        tail all service logs"
	@echo "  make shell       shell inside the backend container"
	@echo "  make db          psql prompt"
	@echo "  make redis       redis-cli prompt (idempotency records)"
	@echo ""
	@echo "Quality"
	@echo "  make lint        frontend lint (backend has no typecheck yet)"
	@echo "  make test        all suites (needs the stack up and seeded)"
	@echo "  make test-cart   cart logic only (no stack needed)"
	@echo "  make clean       remove containers, volumes, build output, uploads"

# --- setup ---------------------------------------------------------------

.PHONY: setup
setup:
	@for f in database backend nginx frontend; do \
		if [ -f config/.env.$$f ]; then \
			echo "config/.env.$$f already exists, leaving it alone"; \
		else \
			cp config/.example.env.$$f config/.env.$$f; \
			echo "created config/.env.$$f"; \
		fi; \
	done
	@echo
	@echo "Review config/.env.backend before any real deployment:"
	@echo "  - STORE_URL must be the storefront's public https URL"
	@echo "  - JWT_SECRET must be changed"
	@echo "  - DATABASE_URL password must be changed"

.PHONY: seed
seed:
	$(COMPOSE) exec backend npx prisma migrate deploy
	$(COMPOSE) exec backend npx prisma db seed

# --- run -----------------------------------------------------------------

.PHONY: dev
dev:
	DOCKER_MODE=true FRONTEND_DEV=true PROD=false $(COMPOSE) up -d --build
	@echo
	@echo "dev stack up on http://localhost"
	@echo "frontend hot reloads through the bind mount; run 'make seed' once to load the demo catalog"

.PHONY: prod
prod:
	@# certbot needs a real name in front of this host. Without one the stack still comes up, and
	@# serves nginx's self-signed fallback, which looks like a TLS deployment and is not one.
	@if [ "$(SELF_SIGNED)" != "1" ]; then \
		grep -qE '^DOMAIN="[^"]+"' config/.env.nginx 2>/dev/null || { \
			echo "DOMAIN is not set in config/.env.nginx."; \
			echo; \
			echo "  make prod issues a real certificate with certbot, which needs a domain whose"; \
			echo "  DNS already points at this host. Set DOMAIN (and CERTBOT_EMAIL) there."; \
			echo; \
			echo "  For local work use 'make dev'."; \
			echo "  To run prod anyway on the self-signed fallback: make prod SELF_SIGNED=1"; \
			exit 1; \
		}; \
	fi
	DOCKER_MODE=true FRONTEND_DEV=false PROD=true $(COMPOSE) up -d --build
	@echo
	@echo "prod stack up; see 'make logs nginx' for certificate issuance"

.PHONY: down
down:
	DOCKER_MODE=true $(COMPOSE) down

.PHONY: destroy
destroy:
	DOCKER_MODE=true $(COMPOSE) down -v
	@echo "database volume removed"

# --- logs / shell --------------------------------------------------------

.PHONY: logs
logs:
	DOCKER_MODE=true $(COMPOSE) logs -f

# Per-service tail: make logs-backend, make logs-nginx, ...
.PHONY: logs-%
logs-%:
	DOCKER_MODE=true $(COMPOSE) logs -f $*

.PHONY: shell
shell:
	$(COMPOSE) exec backend sh

.PHONY: db
db:
	$(COMPOSE) exec db sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

# Redis holds idempotency records. Handy for confirming a key was stored and for watching the
# TTL on it: KEYS 'idem:*' then TTL <key>.
.PHONY: redis
redis:
	$(COMPOSE) exec redis redis-cli

# --- quality -------------------------------------------------------------

# The backend runs TypeScript directly through Node's type stripping, so it has no tsc and no
# tsconfig; typechecking it is one of the hardening items, not a working check today.
.PHONY: lint
lint:
	cd frontend && npm run lint

# API regression suites. These are plain node scripts, not a test framework: they drive the
# running stack over HTTP exactly as a browser would, which is the only way to catch the bugs
# that actually happened here (cookie attributes, wrong-origin links, fall-through routing).
#
# `email` renames a real shopper, so the target depends on a clean seed. Sweep first, re-seed,
# then run with email last so nothing after it sees renamed data. `idempotency` rewrites a
# shopper's profile, so it runs before email too and restores what it touches.
# `orders` drives PATCH /admin/orders and the checkout confirm/cancel endpoints; it writes
# orders straight into the DB (make-order.ts) and creates a few real, unpaid Stripe Checkout
# sessions, all of which sweep removes before the next run.
#
# `cart` is the odd one out: the cart is client state that never reaches the API until Phase 4, so
# there is nothing to drive over HTTP. It imports the pure module directly, which needs Node's type
# stripping, hence the per-suite command below rather than a uniform `node test/$$s.mjs`.
.PHONY: test
test: test-sweep seed
	@fail=0; \
	for s in cart regress isolation guard orders storefront idempotency email account homepage; do \
		case $$s in \
			cart) cmd="node --no-warnings --experimental-strip-types frontend/test/cart.mjs" ;; \
			*)    cmd="node backend/test/$$s.mjs" ;; \
		esac; \
		printf '%-12s ' "$$s"; \
		out=$$($$cmd 2>&1); \
		echo "$$out" | tail -1; \
		echo "$$out" | grep -qE '[0-9]+ passed, 0 failed' || { \
			echo "$$out" | grep -E '^\s+FAIL'; fail=1; \
		}; \
	done; \
	$(MAKE) --no-print-directory test-sweep; \
	if [ $$fail -ne 0 ]; then echo "SUITE FAILURES"; exit 1; fi; \
	echo "all suites passed"

# Cart logic only. Needs no stack and no database, so it runs before the stack has ever been
# brought up -- the one suite that can catch a regression on a cold checkout.
.PHONY: test-cart
test-cart:
	node --no-warnings --experimental-strip-types frontend/test/cart.mjs

# Removes throwaway accounts by address or prefix, for ad-hoc probing outside the suites.
# `make test-clean-email prefix=ui.`
.PHONY: test-clean-email
test-clean-email:
	DOCKER_MODE=true $(COMPOSE) exec -T backend node /app/test/cleanup-email.ts "" "$(prefix)"

# Creates one verified throwaway shopper and prints its credentials as JSON. For suites that
# need an account they can then delete — `account` is the only one so far, since account
# deletion is the only endpoint that destroys what it is given.
#
# Must run inside the container, like test-sweep: the host cannot reach the database. Verification
# is set directly rather than by registering, because registration mails a token and there is no
# inbox here to read it out of.
.PHONY: test-account
test-account:
	DOCKER_MODE=true $(COMPOSE) exec -T backend node /app/test/make-account.ts $(or $(email),throwaway@openseller.test)

# Writes one throwaway guest order in a chosen state for the orders suite — a row the admin
# endpoint can act on (paid, fulfilled, refunded, cancelled) that checkout over HTTP could not
# produce without a real charge. `make test-order mode=paid`; the suite creates its own, this
# is for manual probing.
.PHONY: test-order
test-order:
	DOCKER_MODE=true $(COMPOSE) exec -T backend node /app/test/make-order.ts $(or $(mode),pending)

# Drops the throwaway accounts the suites create. Must run inside the container, since the host
# cannot reach the database directly.
.PHONY: test-sweep
test-sweep:
	DOCKER_MODE=true $(COMPOSE) exec -T backend node /app/test/sweep.ts

# Writes an email verification token for an account directly, because no suite can read one out
# of an inbox and the expiry paths are exactly what needs testing. Prints the plaintext token as
# JSON; the row only ever holds its SHA-256.
#
#   make test-set-token email=bob@x.test mode=expire
.PHONY: test-set-token
test-set-token:
	DOCKER_MODE=true $(COMPOSE) exec -T backend node /app/test/set-token.ts "$(or $(email),sarah@openseller.test)" --"$(or $(mode),valid)"

.PHONY: clean
clean:
	DOCKER_MODE=true $(COMPOSE) down -v --remove-orphans
	rm -rf frontend/.next frontend/.next-docker frontend/.next.old frontend/node_modules backend/node_modules
	rm -rf uploads/*
	@echo "containers, volumes (including the pgdata database volume), build output and uploads cleaned"