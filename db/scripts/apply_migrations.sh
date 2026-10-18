#!/usr/bin/env bash
set -euo pipefail

PGUSER="${POSTGRES_USER:-demo}"
PGPASSWORD="${POSTGRES_PASSWORD:-demo_secret_change_me}"
export PGPASSWORD
PGHOST="${POSTGRES_HOST:-postgres}"
PGPORT="${POSTGRES_PORT:-5432}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPANY_SCHEMA="$APP_ROOT/migrations/001_company_schema.sql"
AUDIT_SCHEMA="$APP_ROOT/migrations/002_audit_schema.sql"

for db in atlas_logistics maghreb_freight sahara_transport; do
  echo "Applying company schema to $db"
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$db" -f "$COMPANY_SCHEMA"
done

echo "Applying audit schema to sovereignty_audit"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d sovereignty_audit -f "$AUDIT_SCHEMA"

echo "Migrations complete."
