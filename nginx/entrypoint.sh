#!/bin/sh
set -e

PROD="${PROD:-false}"
DOCKER_MODE="${DOCKER_MODE:-false}"
NGINX_CONF_DIR="/etc/nginx/conf.d"
CONF_SRC="/etc/nginx/templates"

# Config matrix: PROD (dev/prod) x DOCKER_MODE (API-only / API + frontend).
#
#   DOCKER_MODE=false  frontend runs standalone (npm run dev, or Vercel)
#   DOCKER_MODE=true   frontend runs in this compose stack, so nginx must also proxy it
#
# Picking only on PROD, as this used to, silently served an API-only config in the mode that
# needed a frontend proxy, so every non-API request 404'd.
case "$PROD:$DOCKER_MODE" in
  "false:false") CONF="$CONF_SRC/default.dev.conf";    LABEL="dev, API only" ;;
  "true:false")  CONF="$CONF_SRC/default.conf";        LABEL="prod, API only" ;;
  "false:true")  CONF="$CONF_SRC/default.full.dev.conf"; LABEL="dev, API + frontend" ;;
  "true:true")   CONF="$CONF_SRC/default.full.conf";     LABEL="prod, API + frontend" ;;
esac

echo "[entrypoint] $PROD / $DOCKER_MODE – using $LABEL config ($(basename "$CONF"))"
cp "$CONF" "$NGINX_CONF_DIR/default.conf"

# Skip all SSL/certbot logic in dev mode
if [ "$PROD" != "true" ]; then
  exec nginx -g 'daemon off;'
fi

# --- PROD-only below ---

DOMAIN="${DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
WEBROOT="/var/www/certbot"
LIVE="/etc/letsencrypt/live/default"
MARKER="/etc/letsencrypt/.selfsigned"

mkdir -p "$WEBROOT" "$LIVE"

# 1. Self-signed fallback so nginx can always start (until a real cert exists)
if [ ! -f "$LIVE/fullchain.pem" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 90 \
    -keyout "$LIVE/privkey.pem" -out "$LIVE/fullchain.pem" \
    -subj "/CN=localhost" >/dev/null 2>&1
  touch "$MARKER"
fi

# 2. If DOMAIN is set and we're still on the fallback, obtain a real cert via
#    the ACME webroot once nginx is listening (runs in the background)
if [ -n "$DOMAIN" ] && [ -f "$MARKER" ]; then
  (
    sleep 3
    rm -rf /etc/letsencrypt/renewal/default.conf "$LIVE"
    mkdir -p "$LIVE"
    args="certonly --webroot -w $WEBROOT --cert-name default"
    args="$args --non-interactive --agree-tos --no-eff-email"
    [ -n "$CERTBOT_EMAIL" ] && args="$args --email $CERTBOT_EMAIL"
    for d in $DOMAIN; do args="$args -d $d"; done
    [ "$CERTBOT_STAGING" = "true" ] && args="$args --staging"
    if certbot $args; then
      rm -f "$MARKER"
      nginx -s reload
    else
      echo "[certbot] issuance failed - keeping self-signed cert (check DNS + port 80)"
      openssl req -x509 -nodes -newkey rsa:2048 -days 90 \
        -keyout "$LIVE/privkey.pem" -out "$LIVE/fullchain.pem" \
        -subj "/CN=localhost" >/dev/null 2>&1
      touch "$MARKER"
    fi
  ) &
fi

# 3. Renewal loop (~every 24h; reloads nginx only when a cert is renewed)
(
  while true; do
    sleep 86400
    certbot renew --quiet --deploy-hook "nginx -s reload" 2>/dev/null || true
  done
) &

exec nginx -g 'daemon off;'
