#!/usr/bin/env bash
#
# First-start deploy for a self-hosted store.
#
# Collects everything the stack needs once (site name, domain, currency, Stripe/Resend
# keys, admin login), stores it in ONE root file — .deploy.env — derives the four
# config/.env.* files docker compose feeds the containers, then brings the whole stack
# up: build, migrate, optional demo seed, admin provisioning, smoke check.
#
#   ./scripts/deploy.sh                  interactive first start
#   ./scripts/deploy.sh --print-only     show what would be written, change nothing
#   ./scripts/deploy.sh --yes            non-interactive: values from environment/.deploy.env
#   ./scripts/deploy.sh --no-seed        skip the demo catalog even if asked before
#   ./scripts/deploy.sh --seed           load the demo catalog without asking
#   ./scripts/deploy.sh --skip-up        write env files only, do not start containers
#   ./scripts/deploy.sh --regenerate-secrets
#                                        rotate JWT_SECRET + POSTGRES_PASSWORD (destroys the
#                                        database volume first — existing data is lost)
#   ./scripts/deploy.sh --fresh-db       drop the pgdata volume and start postgres from scratch.
#                                        Needed when the cluster predates the password:
#                                        postgres reads POSTGRES_PASSWORD only at cluster
#                                        creation, so a stale volume keeps the OLD password
#                                        and every connection with the new one fails auth.
#
# Non-interactive inputs (also respected interactively as prefilled defaults):
#   SITE_NAME CERTBOT_EMAIL ADMIN_EMAIL ADMIN_PASSWORD SITE_DOMAIN STORE_CURRENCY
#   STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET RESEND_API_KEY
#   EMAIL_FROM SEED_DEMO=yes|no

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEPLOY_ENV="$ROOT/.deploy.env"
COMPOSE="${COMPOSE:-docker compose}"
# Named volume holding the postgres cluster. Compose prefixes it with the project name
# (directory basename unless COMPOSE_PROJECT_NAME / -p overrides it).
PG_VOLUME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT")}_pgdata"

YES=false
PRINT_ONLY=false
SEED_FLAG=""
SKIP_UP=false
REGEN_SECRETS=false
FRESH_DB=false

usage() {
  awk 'NR < 2 { next } /^$/ { exit } { sub(/^# ?/, ""); print }' "$0"
  exit "${1:-0}"
}

for arg in "$@"; do
  case "$arg" in
    --yes) YES=true ;;
    --print-only) PRINT_ONLY=true ;;
    --seed) SEED_FLAG="yes" ;;
    --no-seed) SEED_FLAG="no" ;;
    --skip-up) SKIP_UP=true ;;
    --regenerate-secrets) REGEN_SECRETS=true ;;
    --fresh-db) FRESH_DB=true ;;
    -h|--help) usage 0 ;;
    *) echo "unknown flag: $arg (see --help)" >&2; exit 1 ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }
}
need docker
need openssl

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not reachable. Start docker and try again." >&2
  exit 1
fi

# --- previous answers ---------------------------------------------------------
# Sourced for defaults only: every value below is re-validated before use, so a
# hand-edited .deploy.env cannot smuggle a bad value through.
FIRST_RUN=true
if [ -f "$DEPLOY_ENV" ]; then
  FIRST_RUN=false
  # shellcheck disable=SC1090
  set -a; . "$DEPLOY_ENV"; set +a
fi

# Fail fast before prompting: a non-interactive run cannot answer anything below, so
# missing required values error here instead of spinning in the validation loops.
# Only values without a usable default are listed — SITE_NAME, STORE_CURRENCY and
# friends fall back inside ask(), and EMAIL_FROM can be derived from the domain.
# (EMAIL_FROM is checked after derivation, since an empty value can be computed.)
if [ "$YES" = true ]; then
  missing=""
  for v in ADMIN_EMAIL ADMIN_PASSWORD; do
    eval "val=\${$v:-}"
    if [ -z "$val" ]; then missing="$missing $v"; fi
  done
  if [ -n "${SITE_DOMAIN:-}" ]; then
    valid_domain "$SITE_DOMAIN" || missing="$missing SITE_DOMAIN(bare domain)"
    valid_email "${CERTBOT_EMAIL:-}" || missing="$missing CERTBOT_EMAIL"
  fi
  if [ -n "$missing" ]; then
    echo "--yes needs these set (env or .deploy.env):$missing" >&2
    exit 1
  fi
fi

# --- prompting helpers ---------------------------------------------------------
# EOF_SEEN trips when stdin runs dry (piped /dev/null, CI): validation loops below all
# test it, so a closed stdin fails with "required but missing" instead of looping forever.
EOF_SEEN=false

ask() { # $1=var $2=prompt $3=default $4=secret(y/n)
  local var="$1" prompt="$2" def="$3" secret="$4" current
  eval "current=\${$var:-}"
  if [ -n "$current" ]; then def="$current"; fi
  if [ "$YES" = true ]; then
    eval "$var=\"\$def\""
    return
  fi
  if [ "$secret" = y ]; then
    printf "%s [%s]: " "$prompt" "$( [ -n "$def" ] && echo "(saved)" || echo "required" )" >&2
    IFS= read -rsp "" val || EOF_SEEN=true; echo >&2
  else
    printf "%s [%s]: " "$prompt" "$def" >&2
    IFS= read -r val || EOF_SEEN=true
  fi
  if [ -z "$val" ]; then val="$def"; fi
  eval "$var=\"\$val\""
}

ask_yes_no() { # $1=var $2=prompt $3=default(yes/no)
  local var="$1" prompt="$2" def="$3" val
  if [ "$YES" = true ]; then
    eval "$var=\"\$def\""
    return
  fi
  printf "%s [%s]: " "$prompt" "$def" >&2
  IFS= read -r val || EOF_SEEN=true
  if [ -z "$val" ]; then val="$def"; fi
  case "$val" in
    y|Y|yes|YES) val="yes" ;;
    *) val="no" ;;
  esac
  eval "$var=\"\$val\""
}

valid_email() { printf "%s" "$1" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; }
valid_domain() { printf "%s" "$1" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$'; }

# --- collect -------------------------------------------------------------------
echo "== store identity =="
ask SITE_NAME "Store name" "${SITE_NAME:-Acme}" n
while [ -z "${SITE_NAME:-}" ] && [ "$EOF_SEEN" != true ]; do ask SITE_NAME "Store name (required)" "" n; done

echo "== public address =="
echo "Leave the domain empty for a local trial on http://localhost (no TLS, no Stripe)."
ask SITE_DOMAIN "Domain (empty = local trial)" "${SITE_DOMAIN:-}" n
# Tolerate pasting a full URL; only the bare host is kept.
SITE_DOMAIN="$(printf "%s" "${SITE_DOMAIN:-}" | sed -e 's#^https\?://##' -e 's#/$##')"
while [ -n "${SITE_DOMAIN:-}" ] && ! valid_domain "$SITE_DOMAIN" && [ "$EOF_SEEN" != true ]; do
  echo "that does not look like a bare domain (e.g. shop.example.com)" >&2
  ask SITE_DOMAIN "Domain (empty = local trial)" "" n
  SITE_DOMAIN="$(printf "%s" "$SITE_DOMAIN" | sed -e 's#^https\?://##' -e 's#/$##')"
done

if [ -n "${SITE_DOMAIN:-}" ]; then
  ask CERTBOT_EMAIL "Email for Let's Encrypt notices" "${CERTBOT_EMAIL:-}" n
  while ! valid_email "${CERTBOT_EMAIL:-}" && [ "$EOF_SEEN" != true ]; do
    echo "a real email is required for certificate issuance" >&2
    ask CERTBOT_EMAIL "Email for Let's Encrypt notices" "" n
  done
  PROD_MODE=true
else
  PROD_MODE=false
fi

echo "== store owner (first admin) =="
ask ADMIN_EMAIL "Admin email" "${ADMIN_EMAIL:-}" n
while ! valid_email "${ADMIN_EMAIL:-}" && [ "$EOF_SEEN" != true ]; do
  echo "a valid email is required" >&2
  ask ADMIN_EMAIL "Admin email" "" n
done
ask ADMIN_PASSWORD "Admin password (min 12 chars)" "" y
while [ "${#ADMIN_PASSWORD}" -lt 12 ] && [ "$EOF_SEEN" != true ]; do
  echo "too short — 12 characters minimum" >&2
  ask ADMIN_PASSWORD "Admin password (min 12 chars)" "" y
done

echo "== money =="
ask STORE_CURRENCY "Currency code, e.g. usd, eur, aed" "${STORE_CURRENCY:-usd}" n
STORE_CURRENCY="$(printf "%s" "$STORE_CURRENCY" | tr '[:upper:]' '[:lower:]')"
while ! printf "%s" "$STORE_CURRENCY" | grep -Eq '^[a-z]{3}$' && [ "$EOF_SEEN" != true ]; do
  echo "must be a bare 3-letter code" >&2
  ask STORE_CURRENCY "Currency code" "usd" n
  STORE_CURRENCY="$(printf "%s" "$STORE_CURRENCY" | tr '[:upper:]' '[:lower:]')"
done

echo "== payments (Stripe, optional) =="
echo "Blank means the shop browses fine but checkout refuses with a clear message."
ask STRIPE_SECRET_KEY "Stripe secret key (sk_test_/sk_live_, blank to skip)" "${STRIPE_SECRET_KEY:-}" n
while [ -n "${STRIPE_SECRET_KEY:-}" ] && ! printf "%s" "$STRIPE_SECRET_KEY" | grep -Eq '^sk_(test|live)_' && [ "$EOF_SEEN" != true ]; do
  echo "expected sk_test_... or sk_live_..." >&2
  ask STRIPE_SECRET_KEY "Stripe secret key (blank to skip)" "" n
done
if [ -n "${STRIPE_SECRET_KEY:-}" ]; then
  ask STRIPE_PUBLISHABLE_KEY "Stripe publishable key (pk_test_/pk_live_)" "${STRIPE_PUBLISHABLE_KEY:-}" n
  while [ -n "${STRIPE_PUBLISHABLE_KEY:-}" ] && ! printf "%s" "$STRIPE_PUBLISHABLE_KEY" | grep -Eq '^pk_(test|live)_' && [ "$EOF_SEEN" != true ]; do
    echo "expected pk_test_... or pk_live_..." >&2
    ask STRIPE_PUBLISHABLE_KEY "Stripe publishable key" "" n
  done
  ask STRIPE_WEBHOOK_SECRET "Stripe webhook secret (whsec_...)" "${STRIPE_WEBHOOK_SECRET:-}" n
  while [ -n "${STRIPE_WEBHOOK_SECRET:-}" ] && ! printf "%s" "$STRIPE_WEBHOOK_SECRET" | grep -Eq '^whsec_' && [ "$EOF_SEEN" != true ]; do
    echo "expected whsec_..." >&2
    ask STRIPE_WEBHOOK_SECRET "Stripe webhook secret" "" n
  done
fi

echo "== email (Resend, optional) =="
echo "Blank means verification/reset links print to the backend log instead of sending."
ask RESEND_API_KEY "Resend API key (blank to skip)" "${RESEND_API_KEY:-}" n

if [ -z "${EMAIL_FROM:-}" ]; then
  if [ -n "${SITE_DOMAIN:-}" ]; then
    EMAIL_FROM="do-not-reply@${SITE_DOMAIN}"
  else
    EMAIL_FROM="do-not-reply@sampledomain.ae"
  fi
fi
ask EMAIL_FROM "From-address for store emails" "$EMAIL_FROM" n
while ! valid_email "$EMAIL_FROM" && [ "$EOF_SEEN" != true ]; do
  echo "must be a valid email address" >&2
  ask EMAIL_FROM "From-address for store emails" "" n
done

echo "== demo data =="
if [ -n "$SEED_FLAG" ]; then
  SEED_DEMO="$SEED_FLAG"
elif [ -n "${SEED_DEMO:-}" ] && [ "$YES" = true ]; then
  : # keep stored/non-interactive answer
else
  echo "Loads the demo catalog plus throwaway logins (admin@openseller.test / password123)."
  ask_yes_no SEED_DEMO "Load demo data" "${SEED_DEMO:-no}"
fi

# --- secrets --------------------------------------------------------------------
# Values from any source converge here validated, except EMAIL_FROM, which may have been
# derived empty-domain-side above and is checked in its own loop.
if [ -z "${EMAIL_FROM:-}" ] && [ "$EOF_SEEN" = true ]; then
  echo "EMAIL_FROM is required but stdin ran dry" >&2
  exit 1
fi
if [ "$REGEN_SECRETS" = true ]; then
  echo "rotating secrets — existing sessions stop working and the database is recreated."
  $COMPOSE down -v >/dev/null 2>&1 || true
  POSTGRES_PASSWORD=""
  JWT_SECRET=""
fi
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
fi
if [ -z "${JWT_SECRET:-}" ]; then
  JWT_SECRET="$(openssl rand -hex 48)"
fi

# --- derived values --------------------------------------------------------------
# One source of truth: everything below is computed, never asked.
if [ "$PROD_MODE" = true ]; then
  STORE_URL="https://$SITE_DOMAIN"
  COMPOSE_PROD=true
  COMPOSE_DEV=false
else
  STORE_URL="http://localhost"
  COMPOSE_PROD=false
  COMPOSE_DEV=true
fi
if [ -n "${STRIPE_SECRET_KEY:-}" ]; then
  ALLOW_MOCK_PAYMENTS=false
elif [ "$PROD_MODE" = true ]; then
  # Refused by the backend under PROD=true anyway; leaving it "true" would only crash
  # the boot with a clear error, so record the honest value.
  ALLOW_MOCK_PAYMENTS=false
else
  ALLOW_MOCK_PAYMENTS=true
fi

write_root_env() {
  umask 077
  cat > "$DEPLOY_ENV" <<EOF
# Generated by scripts/deploy.sh — single source of truth for this deployment.
# Re-running the script reuses these values; secrets rotate only with --regenerate-secrets.
SITE_NAME="$SITE_NAME"
SITE_DOMAIN="${SITE_DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
STORE_CURRENCY="$STORE_CURRENCY"
EMAIL_FROM="$EMAIL_FROM"
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-}"
STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:-}"
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-}"
RESEND_API_KEY="${RESEND_API_KEY:-}"
POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
JWT_SECRET="$JWT_SECRET"
SEED_DEMO="${SEED_DEMO:-no}"
EOF
  chmod 600 "$DEPLOY_ENV"
}

# Derived formulaically from .deploy.env, so the four files can never drift apart.
write_config_envs() {
  cat > config/.env.database <<EOF
POSTGRES_USER=user
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=mydb
EOF

  cat > config/.env.backend <<EOF
DATABASE_URL="postgres://user:$POSTGRES_PASSWORD@db:5432/mydb"
FRONTEND_URL="$STORE_URL"
JWT_SECRET="$JWT_SECRET"
RESEND_API_KEY="${RESEND_API_KEY:-}"
NODE_ENV=""
STORE_NAME="$SITE_NAME"
EMAIL_FROM="$EMAIL_FROM"
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-}"
STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:-}"
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-}"
ALLOW_MOCK_PAYMENTS="$ALLOW_MOCK_PAYMENTS"
STORE_URL="$STORE_URL"
STORE_CURRENCY="$STORE_CURRENCY"
LOW_STOCK_THRESHOLD="5"
COOKIE_DOMAIN=""
REDIS_URL="redis://redis:6379"
IDEMPOTENCY_TTL_SECONDS="86400"
IDEMPOTENCY_LEASE_SECONDS="60"
IDEMPOTENCY_WAIT_MS="3000"
EOF

  # NEXT_PUBLIC_* bakes into the frontend at build time: these must exist BEFORE the
  # first `docker compose build`, which is why env generation precedes bring-up below.
  cat > config/.env.frontend <<EOF
NEXT_PUBLIC_STORE_NAME="$SITE_NAME"
NEXT_PUBLIC_STORE_URL="$STORE_URL"
NEXT_PUBLIC_API_URL=""
NEXT_PUBLIC_STORE_CURRENCY="$STORE_CURRENCY"
EOF

  {
    echo "DOMAIN=\"${SITE_DOMAIN:-}\""
    echo "CERTBOT_EMAIL=\"${CERTBOT_EMAIL:-}\""
    echo 'CERTBOT_STAGING=""'
  } > config/.env.nginx
}

if [ "$PRINT_ONLY" = true ]; then
  echo "--- .deploy.env would contain (secrets redacted) ---"
  SITE_NAME="$SITE_NAME" SITE_DOMAIN="${SITE_DOMAIN:-}" CERTBOT_EMAIL="${CERTBOT_EMAIL:-}" \
    STORE_CURRENCY="$STORE_CURRENCY" EMAIL_FROM="$EMAIL_FROM" \
    STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:+<set>}" STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:+<set>}" \
    STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:+<set>}" RESEND_API_KEY="${RESEND_API_KEY:+<set>}" \
    POSTGRES_PASSWORD="<generated>" JWT_SECRET="<generated>" SEED_DEMO="${SEED_DEMO:-no}" \
    env | grep -E '^(SITE_|CERTBOT_|STORE_|EMAIL_|STRIPE_|RESEND_|POSTGRES_PASSWORD|JWT_SECRET|SEED_)' | sort
  echo "STORE_URL=$STORE_URL  ALLOW_MOCK_PAYMENTS=$ALLOW_MOCK_PAYMENTS  PROD=$COMPOSE_PROD"
  exit 0
fi

write_root_env
write_config_envs
echo "wrote .deploy.env (600) and config/.env.{database,backend,frontend,nginx}"

if [ "$SKIP_UP" = true ]; then
  echo "--skip-up: env files written, containers untouched."
  exit 0
fi

# --- bring-up ----------------------------------------------------------------------
# Stale-cluster guard. Postgres reads POSTGRES_PASSWORD exactly once, at cluster
# creation: a pgdata volume that predates .deploy.env (an old `make dev`, an aborted
# deploy) keeps its OLD password while the backend connects with the NEW one, and every
# connection then fails auth. Because the data lives in a named volume (not a bind
# mount), `down -v` and the wipe below genuinely destroy it — that is the point.
wipe_data() {
  echo "stopping containers and dropping volume $PG_VOLUME (ALL database content is destroyed)…"
  $COMPOSE down >/dev/null 2>&1 || true
  docker volume rm "$PG_VOLUME" >/dev/null 2>&1 || true
}
cluster_exists() { docker volume inspect "$PG_VOLUME" >/dev/null 2>&1; }

if [ "$FRESH_DB" = true ]; then
  if [ "$YES" = true ]; then
    wipe_data
  else
    ask_yes_no WIPE "Drop $PG_VOLUME and start postgres from scratch (destroys ALL data)" "no"
    if [ "$WIPE" = yes ]; then wipe_data; else echo "keeping existing database volume."; fi
  fi
elif [ "$FIRST_RUN" = true ] && cluster_exists; then
  echo "WARNING: docker volume $PG_VOLUME already holds a postgres cluster from a previous run." >&2
  echo "It keeps its OLD password; the backend would connect with the new one and fail auth." >&2
  if [ "$YES" = true ]; then
    echo "Re-run with --fresh-db to drop it and start over." >&2
    exit 1
  fi
  ask_yes_no WIPE "Drop it and start fresh" "no"
  if [ "$WIPE" = yes ]; then wipe_data; else echo "keeping existing volume — if the backend reports bad credentials, this is why."; fi
fi

export PROD="$COMPOSE_PROD"
export DOCKER_MODE=true
export FRONTEND_DEV="$COMPOSE_DEV"

echo "building + starting containers (first build takes a few minutes)…"
# Created up front so docker doesn't make them root-owned on first mount, which would
# leave the host operator unable to read their own backup files without sudo.
mkdir -p ./backups ./uploads
$COMPOSE up -d --build

echo "waiting for the API…"
ready=false
for _ in $(seq 1 60); do
  if curl -sf http://localhost/api/health >/dev/null 2>&1; then ready=true; break; fi
  sleep 5
done
if [ "$ready" != true ]; then
  echo "API did not become healthy. Inspect with: docker compose logs backend" >&2
  exit 1
fi

echo "applying database migrations…"
if ! $COMPOSE exec -T backend npx prisma migrate deploy; then
  cat >&2 <<EOF
migrations failed — most likely the database credentials do not match the cluster.
Postgres reads POSTGRES_PASSWORD only at cluster creation, so if the $PG_VOLUME volume
predates .deploy.env (or the password was changed afterwards), the cluster still holds
the OLD password. Re-run with --fresh-db to drop the volume and start over (destroys
all data).
EOF
  exit 1
fi

# Idempotent seed: `make seed`-style upserts make re-seeding harmless, but skipping when
# the catalog is already populated keeps a re-run from resetting demo edits.
if [ "${SEED_DEMO:-no}" = yes ]; then
  total="$(curl -s 'http://localhost/api/products?perPage=1' | grep -o '"total":[0-9]*' | grep -o '[0-9]*' || echo 0)"
  if [ "${total:-0}" -gt 0 ]; then
    echo "catalog already populated ($total products) — skipping seed."
  else
    echo "loading demo catalog + demo accounts…"
    $COMPOSE exec -T backend npx prisma db seed
    echo "NOTE: the seed includes public demo logins (admin@openseller.test / password123)."
    echo "Delete them from the dashboard before treating this as a real store."
  fi
fi

echo "provisioning admin $ADMIN_EMAIL …"
PROVISION_ADMIN_EMAIL="$ADMIN_EMAIL" PROVISION_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  $COMPOSE exec -T -e PROVISION_ADMIN_EMAIL -e PROVISION_ADMIN_PASSWORD backend \
  node src/scripts/provisionAdmin.ts

echo "smoke check: admin login…"
if curl -sf -X POST http://localhost/api/login \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null; then
  echo "admin login OK"
else
  echo "WARNING: admin login failed — check 'docker compose logs backend'" >&2
fi

# The backend entrypoint installs the crontab on every start, but "installed" is not
# "running" — confirm the daemon survived the boot before promising nightly backups.
echo "checking nightly backups…"
if $COMPOSE exec -T backend sh -c 'pgrep -x cron >/dev/null' 2>/dev/null; then
  echo "nightly backups ACTIVE: pg_dump daily at 1am UTC into ./backups (14-day retention)"
else
  echo "WARNING: cron is not running in the backend container — no nightly backups." >&2
  echo "Check 'docker compose logs backend' and 'docker compose exec backend service cron status'." >&2
fi

# --- summary --------------------------------------------------------------------------
cat <<EOF

=================== $SITE_NAME is up ===================
Store:    $STORE_URL
Admin:    $STORE_URL/admin  ($ADMIN_EMAIL)
Health:   $STORE_URL/api/health
Data:     named volumes (pgdata for postgres), ./uploads (product media)
Config:   .deploy.env is the source of truth; config/.env.* are derived from it.
Rerun:    ./scripts/deploy.sh reuses saved answers (demo-seed is asked again each run).
Backups:  nightly pg_dump at 1am UTC into ./backups (kept 14 days).
  ⚠ OFFSITE: ./backups lives on THIS machine, next to the database it backs up.
  If this disk dies, both die together. Copy dumps elsewhere — object storage,
  another host, anywhere but here — or you do not have backups, you have files.
EOF
if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
  if [ "$PROD_MODE" = true ]; then
    echo "PAYMENTS: no Stripe keys — checkout is DISABLED until you add them to .deploy.env and re-run."
  else
    echo "PAYMENTS: no Stripe keys — mock checkout is ON for this trial (never for production)."
  fi
fi
if [ -z "${RESEND_API_KEY:-}" ]; then
  echo "EMAIL: no Resend key — verification/reset links print to 'docker compose logs backend'."
fi
if [ "$PROD_MODE" = true ]; then
  echo "TLS: certbot issues a real certificate once DNS points $SITE_DOMAIN at this host (watch 'docker compose logs nginx')."
fi
