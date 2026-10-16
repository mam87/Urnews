#!/usr/bin/env bash
# Prints the scheduler migration with the project URL filled in.
# Usage: scripts/render-scheduler.sh https://<ref>.supabase.co > /tmp/scheduler.sql
set -euo pipefail
cd "$(dirname "$0")/.."
sed "s#__PROJECT_URL__#$1#g" supabase/migrations/20261017000005_scheduler.sql
