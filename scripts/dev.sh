#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
api_pid=''
web_pid=''
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$api_pid" ]]; then kill "$api_pid" 2>/dev/null || true; fi
  if [[ -n "$web_pid" ]]; then kill "$web_pid" 2>/dev/null || true; fi
  wait || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload --reload-dir backend/app &
api_pid=$!
cd frontend
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort &
web_pid=$!
wait -n "$api_pid" "$web_pid"
