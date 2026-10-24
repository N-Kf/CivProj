#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
mkdir -p .local/pip-cache .local/npm-cache
if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --cache-dir "$PROJECT_ROOT/.local/pip-cache" -r backend/requirements.lock
cd frontend
npm ci --cache "$PROJECT_ROOT/.local/npm-cache"
npm run build
