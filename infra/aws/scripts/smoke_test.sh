#!/usr/bin/env bash
# Usage: ./smoke_test.sh http://alb-dns-name
set -euo pipefail
BASE="${1:?ALB base URL required}"
curl -sf "$BASE/health" | grep -q ok || curl -sf "$BASE:8000/health"
echo "Health OK"
curl -sf -X POST "$BASE/demo/run-urgent-casablanca" >/dev/null 2>&1 || \
  curl -sf -X POST "$BASE:8000/demo/run-urgent-casablanca" >/dev/null
echo "Demo endpoint OK (fictional SHP-1042)"
