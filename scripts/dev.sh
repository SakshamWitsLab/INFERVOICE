#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== InferVoice: setup =="
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
./.venv/bin/pip install -q -r backend/requirements.txt

if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install --silent)
fi

for port in 8747 3000; do
  pids=$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "== freeing port $port =="
    kill $pids 2>/dev/null || true
    sleep 1
  fi
done

cleanup() {
  jobs -p | xargs kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "== starting backend  → http://localhost:8747/docs =="
(cd backend && exec ../.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8747 --reload) &

echo "== starting frontend → http://localhost:3000 =="
(cd frontend && exec npm run dev) &

wait
