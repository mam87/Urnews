#!/usr/bin/env bash
# Applies all migrations (except the pg_cron scheduler, which needs Supabase) to a throwaway
# local Postgres database with Supabase stubs, then runs the DB test-suite.
# Usage: PGHOST=/var/tmp/pgtest PGPORT=54329 tests/run-sql-tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=news_test_$$
P="psql -U ${PGUSER:-postgres} -v ON_ERROR_STOP=1 -q"
$P -c "create database $DB" >/dev/null
trap '$P -c "drop database if exists $DB" >/dev/null' EXIT
$P -d $DB -f tests/sql/00_supabase_stubs.sql >/dev/null
for f in supabase/migrations/*.sql; do
  case "$f" in *scheduler*) continue;; esac
  $P -d $DB -f "$f" >/dev/null
done
$P -At -d $DB -f tests/sql/10_db_tests.sql 2>&1 >/dev/null | sed -E "s/^psql:[^ ]+ (NOTICE|WARNING):  /  /" | grep -v "already exists"
