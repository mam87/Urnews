#!/usr/bin/env bash
# Bundles each edge function into one ASCII-only index.js (npm deps stay external, resolved by deno.json).
# ASCII-only output avoids any corruption of Arabic regexes/strings when uploading through APIs.
# Usage: scripts/build-functions.sh [outdir]   (needs: npx esbuild)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist/functions}"
for f in news-ingest news-notify; do
  mkdir -p "$OUT/$f"
  npx --yes esbuild@0.24.0 "supabase/functions/$f/index.ts" --bundle --format=esm --platform=neutral --target=es2022 \
    --charset=ascii --external:@supabase/supabase-js --external:fast-xml-parser --outfile="$OUT/$f/index.js" --log-level=warning
  node -e 'const fs=require("fs");const p=process.argv[1];fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace(/[^\x00-\x7f]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0")))' "$OUT/$f/index.js"
  cp "supabase/functions/$f/deno.json" "$OUT/$f/"
done
echo "built into $OUT"
