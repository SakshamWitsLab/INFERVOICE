from __future__ import annotations

import asyncio
import logging
import re
import time
from pathlib import Path

import httpx

from .config import CONFIG

log = logging.getLogger("infervoice.nvidia")

NVIDIA_BASE = "https://integrate.api.nvidia.com/v1"
NVCF_FUNCTIONS = "https://api.nvcf.nvidia.com/v2/nvcf/functions"

STT_PATTERNS = re.compile(
    r"(parakeet|canary|asr|stt|transcri)", re.IGNORECASE
)
TTS_EXCLUDE = re.compile(r"(^|[^a-z])(tts|speech-synthesis|speechsynth)([^a-z]|$)|megatron|t5", re.IGNORECASE)
TTS_PATTERNS = re.compile(
    r"(^|[^a-z])(tts|speech-synthesis|speechsynth|magpie.*(speech|tts)|riva.*(speech|tts)|kokoro)([^a-z]|$)",
    re.IGNORECASE,
)


class NvidiaError(RuntimeError):
    pass


def key_path() -> Path:
    return CONFIG.data_dir / "nvidia_api_key"


def save_key(key: str) -> None:
    CONFIG.ensure_dirs()
    key_path().write_text(key.strip())
    key_path().chmod(0o600)


def read_key() -> str | None:
    try:
        val = key_path().read_text().strip()
        return val or None
    except FileNotFoundError:
        return None


def delete_key() -> None:
    try:
        key_path().unlink()
    except FileNotFoundError:
        pass


def key_hint() -> str | None:
    key = read_key()
    if not key:
        return None
    return f"{key[:6]}…{key[-4:]}"


async def validate_key(key: str) -> int:
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(
            f"{NVIDIA_BASE}/models",
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
        )
        if res.status_code == 401:
            raise NvidiaError("NVIDIA rejected this API key (401)")
        res.raise_for_status()
        data = res.json().get("data", [])
        return len(data)


_catalog_cache: tuple[float, list[dict]] | None = None
CATALOG_TTL = 600

_size_cache: dict[str, tuple[float, float | None]] = {}
SIZE_TTL = 21600


async def hf_model_size_gb(repo: str) -> float | None:
    now = time.monotonic()
    cached = _size_cache.get(repo)
    if cached and now - cached[0] < SIZE_TTL:
        return cached[1]
    gb: float | None = None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.get(
                f"https://huggingface.co/api/models/{repo}",
                params={"blobs": "true"},
            )
            res.raise_for_status()
            total = 0
            for sib in res.json().get("siblings", []):
                sz = sib.get("size")
                if isinstance(sz, int):
                    total += sz
            if total > 0:
                gb = round(total / 1024**3, 1)
    except Exception as exc:
        log.debug("size fetch failed for %s: %s", repo, exc)
    _size_cache[repo] = (now, gb)
    return gb


async def fetch_live_stt_models() -> list[dict]:
    global _catalog_cache
    key = read_key()
    if not key:
        raise NvidiaError("no NVIDIA API key configured")
    now = time.monotonic()
    if _catalog_cache and now - _catalog_cache[0] < CATALOG_TTL:
        return _catalog_cache[1]
    speech: list[dict] = []
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(
            NVCF_FUNCTIONS,
            params={"visibility": "public,authorized"},
            headers={"Authorization": f"Bearer {key}"},
        )
        if res.status_code == 401:
            raise NvidiaError("NVIDIA rejected the stored API key (401) — re-save it")
        res.raise_for_status()
        fns = res.json().get("functions") or []
    for f in fns:
        if f.get("status") != "ACTIVE":
            continue
        name = f.get("name", "") or ""
        if TTS_PATTERNS.search(name):
            speech.append(
                {"id": name, "function_id": f.get("id"), "owned_by": "nvidia", "task": "tts"}
            )
        elif STT_PATTERNS.search(name):
            speech.append(
                {"id": name, "function_id": f.get("id"), "owned_by": "nvidia", "task": "stt"}
            )
    _catalog_cache = (now, speech)
    log.info("nvidia catalog: %d NVCF speech functions (STT/TTS)", len(speech))
    return speech


class NvidiaModelInfo:
    def __init__(
        self,
        nim_id: str,
        family: str,
        hf_repo: str | None,
        description: str,
        downloadable: bool,
        source: str,
        task: str = "stt",
        api_supported: bool = False,
        function_id: str | None = None,
    ) -> None:
        self.nim_id = nim_id
        self.family = family
        self.hf_repo = hf_repo
        self.description = description
        self.downloadable = downloadable
        self.source = source
        self.task = task
        self.api_supported = api_supported
        self.function_id = function_id

    def as_dict(self) -> dict:
        return {
            "nim_id": self.nim_id,
            "family": self.family,
            "hf_repo": self.hf_repo,
            "description": self.description,
            "downloadable": self.downloadable,
            "source": self.source,
            "task": self.task,
            "api_supported": self.api_supported,
            "function_id": self.function_id,
            "size_gb": None,
        }


SEED_MODELS: list[NvidiaModelInfo] = [
    NvidiaModelInfo(
        "parakeet-tdt-0.6b-v3",
        "Parakeet",
        "nvidia/parakeet-tdt-0.6b-v3",
        "600M multilingual ASR, 25 EU languages, auto language detect — Open ASR leaderboard #1",
        True,
        "curated",
        task="stt",
    ),
    NvidiaModelInfo(
        "parakeet-tdt-0.6b-v2",
        "Parakeet",
        "nvidia/parakeet-tdt-0.6b-v2",
        "600M English ASR, fast long-form transcription with word timestamps",
        True,
        "curated",
        task="stt",
    ),
    NvidiaModelInfo(
        "canary-1b-v2",
        "Canary",
        "nvidia/canary-1b-v2",
        "1B multilingual ASR + speech translation across 25 European languages",
        True,
        "curated",
        task="stt",
    ),
    NvidiaModelInfo(
        "canary-1b-flash",
        "Canary",
        "nvidia/canary-1b-flash",
        "Fast 1B multilingual ASR tuned for low latency",
        True,
        "curated",
        task="stt",
    ),
    NvidiaModelInfo(
        "parakeet-ctc-1.1b",
        "Parakeet",
        "nvidia/parakeet-ctc-1.1b",
        "1.1B English CTC model, robust streaming-style recognition",
        True,
        "curated",
        task="stt",
    ),
    NvidiaModelInfo(
        "kokoro-82m-v1.0",
        "Kokoro",
        "hexgrad/Kokoro-82M",
        "82M natural TTS with 60+ voices and multilingual support (MLX local)",
        True,
        "curated",
        task="tts",
    ),
    NvidiaModelInfo(
        "nvidia/tts-1.0",
        "TTS",
        None,
        "NVIDIA Riva cloud TTS via build.nvidia.com (API only)",
        False,
        "api",
        task="tts",
        api_supported=True,
    ),
]


def _family_of(model_id: str, task: str = "stt") -> str:
    low = model_id.lower()
    if "conformer" in low or "nemotron" in low or "whisper" in low or "riva" in low:
        return "Riva"
    if "parakeet" in low:
        return "Parakeet"
    if "canary" in low:
        return "Canary"
    if "kokoro" in low:
        return "Kokoro"
    if "riva" in low:
        return "Riva"
    return "TTS" if task == "tts" else "Speech"


def _find_hf_repo(nim_id: str) -> str | None:
    norm = nim_id.lower().replace("_", "-").replace("--", "-")
    for seed in SEED_MODELS:
        if seed.nim_id.lower() == norm:
            return seed.hf_repo
    # NVCF cloud speech functions are API-only; no local MLX weights asserted yet.
    return None


async def get_stt_catalog() -> dict:
    by_id: dict[str, dict] = {}
    for seed in SEED_MODELS:
        d = seed.as_dict()
        d["api_present"] = False
        d["size_gb"] = None
        by_id[d["nim_id"].lower()] = d

    live_error: str | None = None
    try:
        live = await fetch_live_stt_models()
        for m in live:
            mid = str(m.get("id", ""))
            if not mid:
                continue
            task = str(m.get("task") or "stt")
            repo = _find_hf_repo(mid)
            entry = {
                "nim_id": mid,
                "family": _family_of(mid, task),
                "hf_repo": repo,
                "description": f"NVIDIA cloud API · {task.upper()}",
                "downloadable": bool(repo),
                "source": "api",
                "api_present": True,
                "task": task,
                "api_supported": True,
                "function_id": m.get("function_id"),
                "size_gb": None,
            }
            key = mid.lower().replace("_", "-")
            existing = by_id.pop(key, None)
            if existing:
                existing.update({"source": "curated+api", "api_present": True, "api_supported": True})
                if not existing["function_id"] and entry.get("function_id"):
                    existing["function_id"] = entry["function_id"]
                if not existing["hf_repo"] and repo:
                    existing["hf_repo"] = repo
                    existing["downloadable"] = True
                by_id[key] = existing
            else:
                by_id[key] = entry
    except (NvidiaError, httpx.HTTPError) as exc:
        live_error = str(exc)

    # STT seeds that exist on the live NVIDIA catalog expose a cloud API endpoint.
    for d in by_id.values():
        if d["task"] == "stt" and d.get("api_present"):
            d["api_supported"] = True

    repos = {m["nim_id"]: m["hf_repo"] for m in by_id.values() if m.get("downloadable") and m.get("hf_repo")}
    if repos:
        ids = list(repos)
        sizes = await asyncio.gather(*(hf_model_size_gb(r) for r in repos.values()))
        for mid, size in zip(ids, sizes):
            by_id[mid]["size_gb"] = size

    models = sorted(by_id.values(), key=lambda m: (not m["downloadable"], m["family"], m["nim_id"]))
    return {"models": models, "live_error": live_error}
