#!/usr/bin/env bash
# Writes the PUBLIC Supabase URL and anon/publishable key into assets/js/config.js.
# Usage: scripts/configure-site.sh https://<ref>.supabase.co <anon-or-publishable-key>
# Never pass the service_role / secret key here — it would be exposed to every visitor.
set -euo pipefail
URL="$1"; KEY="$2"
[[ "$URL" =~ ^https://[a-z0-9]+\.supabase\.co$ ]] || { echo "URL must look like https://<ref>.supabase.co"; exit 1; }
case "$KEY" in sb_secret_*) echo "Refusing: that is a SECRET key. Use the anon/publishable key."; exit 1;; esac
if [[ "$KEY" == eyJ* ]] && echo "$KEY" | cut -d. -f2 | base64 -d 2>/dev/null | grep -q service_role; then
  echo "Refusing: that is the service_role key. Use the anon key."; exit 1
fi
cd "$(dirname "$0")/.."
sed -i "s#^export const SUPABASE_URL = .*#export const SUPABASE_URL = \"$URL\";#; s#^export const SUPABASE_ANON_KEY = .*#export const SUPABASE_ANON_KEY = \"$KEY\";#" assets/js/config.js
grep -n "SUPABASE_" assets/js/config.js
