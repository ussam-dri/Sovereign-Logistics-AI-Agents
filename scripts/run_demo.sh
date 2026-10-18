#!/usr/bin/env bash
set -euo pipefail
COORD="${COORDINATOR_URL:-http://localhost:8000}"
echo "Running SHP-1042 demo against $COORD ..."
curl -sf -X POST "$COORD/demo/run-urgent-casablanca" | python -m json.tool
echo ""
echo "Recent audit:"
curl -sf "$COORD/audit/recent?limit=5" | python -m json.tool
