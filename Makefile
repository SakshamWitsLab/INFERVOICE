.PHONY: setup up down clean logs-backend logs-frontend

setup:
	python3 -m venv .venv
	./.venv/bin/pip install -r backend/requirements.txt
	cd frontend && npm install

up:
	bash scripts/dev.sh

dev: up

down:
	@lsof -t -iTCP:8747 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
	@lsof -t -iTCP:3000 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
	@echo "stopped"

clean:
	rm -rf frontend/.next
	find . -name __pycache__ -type d -exec rm -rf {} +
