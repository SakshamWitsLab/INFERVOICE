# InferVoice — Mac Fleet Control Center

Control a fleet of Macs (or Linux boxes) on your LAN from a single web dashboard and run **distributed speech AI** across them — live specs, storage, remote terminals, and **STT / TTS inference**. Run models **locally on your machines (MLX)** and/or **via NVIDIA's cloud API** in the same run (hybrid), then compare transcripts and speed side-by-side.

## Stack

| Layer    | Tech |
|----------|------|
| Backend  | Python 3.12 · FastAPI · asyncssh (pooled connections) · SQLModel/SQLite · zeroconf |
| Frontend | Next.js 16 · React 19 · Tailwind v4 · xterm.js · lucide-react |

Local runtimes (auto-installed on each machine): **Parakeet MLX** (STT) and **Kokoro MLX** (TTS) via Apple MLX. Cloud inference uses NVIDIA's NVCF API (Riva gRPC for TTS, OpenAI-compatible transcription endpoint for STT).

## Requirements

- **Control center host:** Python 3.12+ and Node.js 18+ (any OS; macOS/Linux recommended).
- **Fleet machines:** macOS (Apple Silicon `arm64` strongly recommended for local MLX runtimes — M1/M2/M3/M4) or Linux, with **SSH (Remote Login)** enabled and an account reachable over your LAN.
- To unlock the **full live catalog** and **cloud API inference**: an NVIDIA build.nvidia.com API key (optional for local-only usage).

## Setup

### 1. Enable Remote Login on each target machine

On each Mac you want to control: **System Settings → General → Sharing → enable Remote Login**. Note the machine's IP, your username, and password (password is used once, in-memory, to install the SSH key — never stored).

### 2. Start the control center

```bash
make up
```

This one command:
- creates a `.venv`, installs `backend/requirements.txt`
- installs frontend npm dependencies
- starts the **backend** API on `http://localhost:8747` (FastAPI + hot reload)
- starts the **frontend** UI on `http://localhost:3000`

Open your browser at **http://localhost:3000**.

> Equivalent manual start if you prefer not to use `make`:

```bash
python3 -m venv .venv
./.venv/bin/pip install -r backend/requirements.txt
# terminal 1 — backend
./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8747 --reload
# terminal 2 — frontend
cd frontend && npm install && npm run dev
```

API docs (Swagger UI): http://localhost:8747/docs

To stop everything: `make down`.

### 3. (Optional) Add your NVIDIA API key

Open the app → **Models** page → **NVIDIA API key** field → save. The key is stored at `~/.infervoice/nvidia_api_key` (permissions `0600`). This enables:

- the **live STT/TTS catalog** (pulled from NVIDIA's NVCF functions API)
- **cloud (API) inference** — transcribe audio and synthesize speech without touching your machines

Without a key, local models (deploy + run on your fleet) still work fully.

## Using the GUI

### 1. Add your machines — Dashboard

- Open the **Dashboard** (`/`).
- Click **Add machine** → **Scan LAN** to auto-discover Macs via Bonjour/mDNS + subnet scan, or enter **IP + username** manually → add.
- If auth fails, click **Install SSH key** and enter the account password **once**. The backend pushes an ed25519 key and pins the target's host key (TOFU). The machine then goes online and its specs auto-collect.
- Open the **machine detail** page for full specs, storage, the **exec box** (one-shot command), and the **remote terminal**.

### 2. Browse & deploy models — Models

- Open the **Models** page (`/models`), which has **STT** and **TTS** tabs.
- Each model shows badges: **Local** (downloadable, runs on your machines) and/or **API** (cloud-capable).
- Click **Download** on a local model to fetch its weights (auto-installs the MLX runtime on the target if missing).
- **Deploy** the model to one or more machines. Deployed models then appear in the Playground as local targets.

### 3. Run inference — Playground

Open **Playground** (`/playground`):

- **STT** — record live audio or upload a file (`wav/mp3/flac/m4a`).
- **TTS** — type text to speak (optionally name the output).
- In **Models & targets**, select per model:
  - **Local** — pick the machine(s) it is deployed on (MLX inference via SSH).
  - **☁ API** — run it in the cloud (requires an NVIDIA API key).
- You can combine **local + cloud** in a single run (**hybrid**) — e.g. run Kokoro locally on Saksham *and* Magpie via API at once. The results grid compares transcripts, wall-clock time, and real-time factor (RTF), marks the **FASTEST**, and renders **audio players** for TTS (with a **save** link).
- The first local STT/TTS run on a machine auto-installs the runtime (`parakeet-mlx` for STT, `kokoro-mlx` for TTS) — expect a one-time download on that first run.

### 4. Watch metrics — Monitor

Open **Monitor** (`/monitor`) for live per-machine resource metrics (CPU / RAM / disk) streamed from the background health loop.

## Configuration (env prefix `IV_`)

| Var                 | Default              | Notes |
|---------------------|----------------------|-------|
| `IV_DATA_DIR`       | `~/.infervoice`      | SQLite db, keys, host fingerprints, downloads |
| `IV_PORT`           | `8747`               | API port |
| `IV_CORS_ORIGINS`   | `["*"]`              | JSON list of allowed origins |
| `IV_POLL_INTERVAL`  | `8.0`                | Health-check cadence (seconds) |

To point the standalone frontend at a non-default API: `NEXT_PUBLIC_API_URL=http://host:port npm run build`.

## Core API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/inference/catalog` | STT + TTS model catalog (with task, local/API flags) |
| POST | `/api/inference/runs/multi` | Hybrid audio → STT run across targets |
| POST | `/api/inference/runs/tts` | TTS run (text) across targets (local + cloud) |
| GET | `/api/inference/runs/{id}` | Run detail incl. per-task status/transcript/audio |
| GET | `/api/inference/audio-out/{task_id}` | Generated TTS WAV |
| GET | `/api/inference/transcript/{task_id}` | Final transcript text |
| POST | `/api/nvidia/downloads` | Download a model to a machine |
| POST | `/api/inference/install-runtime/{machine_id}` | Install ASR/TTS runtime on a machine |
| GET | `/api/machines` | Fleet machines / status |

## Security model

- Designed as a **trusted-LAN admin tool**. The API has no authentication in Phase 1 — do not expose it beyond your network.
- SSH uses **key auth only** after the initial one-time password-based key install.
- Host keys are pinned **TOFU-style** at `~/.infervoice/host_fingerprints.json`; delete an entry only if you know the target was rebuilt.
- NVIDIA API key is stored locally with `0600` permissions and is only sent to NVIDIA endpoints.

## Roadmap

- ✅ Phase 1 — fleet control: discovery, key install, specs, storage, exec, terminal
- ✅ Phase 2 — model registry + artifact distribution (STT / TTS runtimes per Mac)
- ✅ Phase 3 — distributed test runs (local + cloud hybrid), benchmark aggregation, audio generation
- 🔜 Phase 4 — API tokens + multi-user roles, live GPU/ANE metrics, additional cloud + local models
