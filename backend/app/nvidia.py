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

STT_PATTERNS = re.compile(
    r"(parakeet|canary|asr|speech|stt|voice|transcri)", re.IGNORECASE
)
TTS_EXCLUDE = re.compile(r"(^|[^a-z])(tts|speech-synthesis|speechsynth)([^a-z]|$)|megatron|t5", re.IGNORECASE)


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
    async with httpx.AsyncClient(timeout=25) as client:
        res = await client.get(
            f"{NVIDIA_BASE}/models",
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
        )
        if res.status_code == 401:
            raise NvidiaError("NVIDIA rejected the stored API key (401) — re-save it")
        res.raise_for_status()
        all_models = res.json().get("data", [])
    stt: list[dict] = []
    for m in all_models:
        mid = str(m.get("id", ""))
        if TTS_EXCLUDE.search(mid):
            continue
        if STT_PATTERNS.search(mid):
            stt.append(m)
    _catalog_cache = (now, stt)
    log.info("nvidia catalog: %d total, %d classified STT", len(all_models), len(stt))
    return stt


class NvidiaModelInfo:
    def __init__(
        self,
        nim_id: str,
        family: str,
        hf_repo: str | None,
        description: str,
        downloadable: bool,
        source: str,
    ) -> None:
        self.nim_id = nim_id
        self.family = family
        self.hf_repo = hf_repo
        self.description = description
        self.downloadable = downloadable
        self.source = source

    def as_dict(self) -> dict:
        return {
            "nim_id": self.nim_id,
            "family": self.family,
            "hf_repo": self.hf_repo,
            "description": self.description,
            "downloadable": self.downloadable,
            "source": self.source,
        }


SEED_MODELS: list[NvidiaModelInfo] = [
    NvidiaModelInfo(
        "parakeet-tdt-0.6b-v3",
        "Parakeet",
        "nvidia/parakeet-tdt-0.6b-v3",
        "600M multilingual ASR, 25 EU languages, auto language detect — Open ASR leaderboard #1",
        True,
        "curated",
    ),
    NvidiaModelInfo(
        "parakeet-tdt-0.6b-v2",
        "Parakeet",
        "nvidia/parakeet-tdt-0.6b-v2",
        "600M English ASR, fast long-form transcription with word timestamps",
        True,
        "curated",
    ),
    NvidiaModelInfo(
        "canary-1b-v2",
        "Canary",
        "nvidia/canary-1b-v2",
        "1B multilingual ASR + speech translation across 25 European languages",
        True,
        "curated",
    ),
    NvidiaModelInfo(
        "canary-1b-flash",
        "Canary",
        "nvidia/canary-1b-flash",
        "Fast 1B multilingual ASR tuned for low latency",
        True,
        "curated",
    ),
    NvidiaModelInfo(
        "parakeet-ctc-1.1b",
        "Parakeet",
        "nvidia/parakeet-ctc-1.1b",
        "1.1B English CTC model, robust streaming-style recognition",
        True,
        "curated",
    ),
]


def _family_of(model_id: str) -> str:
    low = model_id.lower()
    if "parakeet" in low:
        return "Parakeet"
    if "canary" in low:
        return "Canary"
    if "riva" in low:
        return "Riva"
    return "Speech"


def _find_hf_repo(nim_id: str) -> str | None:
    norm = nim_id.lower().replace("_", "-").replace("--", "-")
    for seed in SEED_MODELS:
        if seed.nim_id.lower() == norm:
            return seed.hf_repo
    if "/" in nim_id and nim_id.lower().startswith("nvidia/") and STT_PATTERNS.search(nim_id):
        candidate = "nvidia/" + nim_id.split("/")[-1].lower().replace("_", "-")
        return candidate
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
            repo = _find_hf_repo(mid)
            entry = {
                "nim_id": mid,
                "family": _family_of(mid),
                "hf_repo": repo,
                "description": f"Listed on build.nvidia.com · owned_by {m.get('owned_by', 'nvidia')}",
                "downloadable": bool(repo),
                "source": "api",
                "api_present": True,
            }
            key = mid.lower().replace("_", "-")
            existing = by_id.pop(key, None)
            if existing:
                existing.update({"source": "curated+api", "api_present": True})
                if not existing["hf_repo"] and repo:
                    existing["hf_repo"] = repo
                    existing["downloadable"] = True
                by_id[key] = existing
            else:
                entry["size_gb"] = None
                by_id[key] = entry
    except (NvidiaError, httpx.HTTPError) as exc:
        live_error = str(exc)

    repos = {m["nim_id"]: m["hf_repo"] for m in by_id.values() if m.get("downloadable") and m.get("hf_repo")}
    if repos:
        ids = list(repos)
        sizes = await asyncio.gather(*(hf_model_size_gb(r) for r in repos.values()))
        for mid, size in zip(ids, sizes):
            by_id[mid]["size_gb"] = size

    models = sorted(by_id.values(), key=lambda m: (not m["downloadable"], m["family"], m["nim_id"]))
    return {"models": models, "live_error": live_error}
