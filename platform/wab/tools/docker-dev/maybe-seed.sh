#!/bin/bash
# Run `yarn seed` only when the database has no users.
# Without this guard, the seed script wipes the entire DB on every container
# start (it calls initDb which TRUNCATE org CASCADE), destroying all
# user-created accounts, projects, and hosting domain registrations.

set -o errexit -o nounset

DB_HOST="${DB_HOST:-plasmic-db}"
DB_USER="${DB_USER:-wab}"
DB_NAME="${DB_NAME:-wab}"
DB_PASSWORD="${DB_PASSWORD:-SEKRET}"

# psql returns empty stdout if the connection fails or the table is missing.
# Treat both as "DB not ready / not seeded" so seed runs.
USER_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT count(*) FROM "user"' 2>/dev/null || echo "")

if [ -z "$USER_COUNT" ] || [ "$USER_COUNT" = "0" ]; then
    echo "DB has no users; running yarn seed."
    # NODE_ENV=development: since upstream added checkWeakPassword, DbInit's
    # DEFAULT_DEV_PASSWORD seed users are only allowed outside production mode.
    # A fresh prod-mode deployment otherwise crash-loops on WeakPasswordError.
    NODE_ENV=development yarn seed
else
    echo "DB already has $USER_COUNT users; skipping yarn seed to preserve data."
fi
