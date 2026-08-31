from __future__ import annotations

import asyncio
import logging

import httpx

from .nvidia import NvidiaError, read_key

log = logging.getLogger("infervoice.cloud_api")

STT_API_BASE = "https://ai.api.nvidia.com/v1"
# Cloud TTS flows through NVIDIA Riva gRPC (grpc.nvcf.nvidia.com:443). The client
# resolves the model's function-id fresh from NVCF before synthesizing.
NVCF_FUNCTIONS = "https://api.nvcf.nvidia.com/v2/nvcf/functions"
RIVA_GRPC = "grpc.nvcf.nvidia.com:443"


def _headers() -> dict[str, str]:
    key = read_key()
    if not key:
        raise NvidiaError("no NVIDIA API key configured")
    return {"Authorization": f"Bearer {key}"}


async def transcribe_audio(audio_path: str, model: str) -> str:
    """Cloud STT via build.nvidia.com OpenAI-compatible transcription."""
    import mimetypes

    mime = mimetypes.guess_type(audio_path)[0] or "audio/wav"
    async with httpx.AsyncClient(timeout=120) as client:
        with open(audio_path, "rb") as fh:
            files = {"file": ("audio", fh, mime)}
            data = {"model": model}
            res = await client.post(
                f"{STT_API_BASE}/audio/transcriptions",
                headers=_headers(),
                files=files,
                data=data,
            )
    if res.status_code == 401:
        raise NvidiaError("NVIDIA rejected the stored API key (401) — re-save it")
    res.raise_for_status()
    return res.text.strip()


async def _resolve_function_id(candidates: list[str]) -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(
            NVCF_FUNCTIONS,
            params={"visibility": "public,authorized"},
            headers=_headers(),
        )
        if res.status_code == 401:
            raise NvidiaError("NVIDIA rejected the stored API key (401) — re-save it")
        res.raise_for_status()
        body = res.json()
    import re as _re

    active = [fn for fn in body.get("functions") or [] if fn.get("status") == "ACTIVE"]
    for pattern in candidates:
        rx = _re.compile(pattern, _re.IGNORECASE)
        for fn in active:
            if rx.search(fn.get("name", "") or ""):
                return fn["id"]
    raise NvidiaError(f"no ACTIVE NVCF function matched {candidates!r}")


async def synthesize_speech_cloud(text: str, out_path: str, voice: str | None = None) -> str:
    """Cloud TTS via NVIDIA Riva gRPC. Lazy-imports the Riva client deps.

    Requires: pip install nvidia-riva-client grpclib (v2 package -> `riva.client`)
    """
    try:
        from riva.client import Auth, SpeechSynthesisService  # type: ignore
        from riva.client.proto.riva_audio_pb2 import AudioEncoding  # type: ignore
    except ImportError as exc:
        raise NvidiaError(
            "Cloud TTS dependency not installed. Run: pip install nvidia-riva-client grpclib"
        ) from exc

    fid = await _resolve_function_id(
        [r"magpie.*tts.*multilingual", r"magpie.*tts", r"chatterbox.*multilingual.*tts", r"chatterbox.*tts"]
    )
    key = read_key()
    auth = Auth(
        uri=RIVA_GRPC,
        use_ssl=True,
        metadata_args=[
            ["function-id", fid],
            ["authorization", f"Bearer {key}"],
        ],
    )
    service = SpeechSynthesisService(auth)
    resp = await asyncio.to_thread(
        service.synthesize,
        text=text,
        language_code="en-US",
        encoding=AudioEncoding.LINEAR_PCM,
        sample_rate_hz=22050,
        voice_name=voice,
    )
    pcm = bytes(resp.audio or b"")
    if not pcm:
        raise NvidiaError("Riva TTS returned empty audio")

    import wave

    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(pcm)
    return out_path


async def cloud_call_available() -> bool:
    return read_key() is not None
