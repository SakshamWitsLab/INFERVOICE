# InferVoice — Mac Fleet Control Center

Control multiple Macs on your LAN from one dashboard: live specs, storage, one-shot command execution, and full remote shells. Foundation for the upcoming distributed LLM/STT/TTS model-testing phases.

## Stack

| Layer    | Tech |
|----------|------|
| Backend  | Python 3.12 · FastAPI · asyncssh (pooled connections) · SQLModel/SQLite · zeroconf |
| Frontend | Next.js 16 · React 19 · Tailwind v4 · xterm.js |

## Features (Phase 1)

- **Dashboard** — machine cards with live status polling (online / offline / auth error), chip, RAM, OS, disk usage bars
- **Discovery** — Bonjour/mDNS (`_ssh._tcp`) browsing + fast parallel subnet scan of your /24 for open SSH ports
- **Key-based SSH** — the backend generates an ed25519 keypair on first run; install it on any Mac with a single password prompt (password is used once in-memory, never stored)
- **TOFU host-key pinning** — server host keys are fingerprinted and pinned on first connect; any MITM/key change raises a loud error
- **Remote terminal** — xterm.js in the browser bridged over WebSocket to an SSH PTY (resize-aware)
- **One-shot exec** — run a command via REST and get stdout/stderr/exit code
- **Health loop** — background checker updates machine status every few seconds; the API stays pure-read and fast

## Setup

### 1. Target Macs
On each Mac you want to control: **System Settings → General → Sharing → enable Remote Login**.

### 2. Backend

```bash
python3 -m venv .venv
./.venv/bin/pip install -r backend/requirements.txt
make backend          # or: cd backend && ../.venv/bin/uvicorn app.main:app --port 8747
```

API docs: http://localhost:8747/docs

### 3. Frontend

```bash
cd frontend && npm install
npm run dev           # http://localhost:3000
```

To point the frontend at a non-default API: `NEXT_PUBLIC_API_URL=http://host:port npm run build`.

## Usage flow

1. Open the dashboard → **Add machine**
2. **Scan LAN** to discover Macs (or type IP + username manually) → add it
3. If auth fails, click **Install SSH key**, enter the account password once
4. Machine goes online — specs auto-collect; open the detail page for full specs, storage, exec box, and terminal

## Configuration (env prefix `IV_`)

| Var                 | Default              | Notes |
|---------------------|----------------------|-------|
| `IV_DATA_DIR`       | `~/.infervoice`      | SQLite db, keys, host fingerprints |
| `IV_PORT`           | `8747`               | API port |
| `IV_CORS_ORIGINS`   | `["*"]`              | JSON list of allowed origins |
| `IV_POLL_INTERVAL`  | `8.0`                | Health-check cadence (seconds) |

## Security model

- Designed as a **trusted-LAN admin tool**. The API has no authentication in Phase 1 — do not expose it beyond your network.
- SSH uses key auth only after initial password-based key install.
- Host keys are pinned TOFU-style at `~/.infervoice/host_fingerprints.json`; delete an entry only if you know the target was rebuilt.

## Roadmap

- Phase 2: model registry + artifact distribution (LLM / STT / TTS runtimes per Mac)
- Phase 3: distributed test runs, benchmark aggregation, live GPU/ANE metrics
- Phase 4: API tokens + multi-user roles
