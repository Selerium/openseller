#!/bin/sh
# Container entrypoint: install the daily backup job, start cron, hand off to CMD.
#
# The crontab is (re)installed on every start rather than baked into the image, so a
# `docker compose up` after any downtime silently repairs a missing schedule instead of
# running forever with backups quietly off. `service cron start` daemonizes and returns,
# so the node process stays PID-facing and keeps receiving the container's signals.
set -e

# 1am UTC daily. Container clocks are UTC unless the operator sets TZ; the deploy
# summary says "1am UTC" for exactly this reason — silently inheriting a host timezone
# would move the window without telling anyone.
printf '%s\n' '0 1 * * * root /app/scripts/backup-db.sh >> /app/backups/backup-cron.log 2>&1' \
  > /etc/cron.d/pgbackup
chmod 644 /etc/cron.d/pgbackup

if ! service cron status >/dev/null 2>&1; then
  service cron start >/dev/null
fi

exec "$@"
