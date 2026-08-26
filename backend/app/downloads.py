from __future__ import annotations

import asyncio
import logging
import re

import asyncssh
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from .models import Machine, ModelDownloadJob
from .ssh_pool import POOL, run_cmd

log = logging.getLogger("infervoice.downloads")

MODELS_ROOT = "$HOME/infervoice_models"
SETTING_MODELS_ROOT = "models_root"
EXIT_MARKER = "__IV_EXIT:"

_FILES_RE = re.compile(r"Fetching (\d+) files:\s+(\d+)%\s*\|[^|]*\|\s*(\d+)/(\d+)")
_BYTES_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([KMGT])i?B?\s*/\s*(\d+(?:\.\d+)?)\s*([KMGT])i?B?")
_UNIT = {"K": 1 / 1024, "M": 1.0, "G": 1024.0, "T": 1024.0 * 1024}


def parse_hf_progress(tail: str) -> dict:
    if not tail:
        return {}
    lines = tail.replace("\r", "\n").split("\n")
    result: dict = {}
    for line in reversed(lines):
        m = _BYTES_RE.search(line)
        if m and "pct" not in result:
            v1, u1, v2, u2 = float(m.group(1)), m.group(2), float(m.group(3)), m.group(4)
            done_mb = v1 * _UNIT.get(u1, 1.0)
            total_mb = v2 * _UNIT.get(u2, 1.0)
            if total_mb > 0:
                result["pct"] = round(min(100.0, done_mb / total_mb * 100), 1)
                result["phase"] = "downloading weights"
        fm = _FILES_RE.search(line)
        if fm:
            result.setdefault("files_done", int(fm.group(3)))
            result.setdefault("files_total", int(fm.group(4)))
            result.setdefault("phase", "fetching files")
            break
    return {k: v for k, v in result.items()}


def _norm_root(path: str) -> str:
    p = path.strip().rstrip("/")
    if p.startswith("~/"):
        p = "$HOME/" + p[2:]
    elif p == "~":
        p = "$HOME"
    return p


def target_dir_for(root: str, nim_id: str) -> str:
    safe = nim_id.lower().replace("/", "_").replace(" ", "-")
    return f"{_norm_root(root)}/{safe}"


async def resolve_root(session: AsyncSession, machine: Machine | None = None) -> str:
    from .db import get_setting

    if machine and machine.models_root:
        return machine.models_root
    global_root = await get_setting(session, SETTING_MODELS_ROOT)
    return global_root or MODELS_ROOT


def display_dir(path: str) -> str:
    return path.replace("$HOME", "~")


def _launch_script(hf_repo: str, target_dir: str, log_path: str) -> str:
    return (
        'export PATH="$HOME/.local/bin:$PATH"; '
        'export BIN="$(command -v hf || command -v huggingface-cli || true)"; '
        '[ -n "$BIN" ] || { echo "HF CLI not found"; exit 127; }; '
        f'mkdir -p "{target_dir}" && '
        f'nohup sh -c "\\"\\$BIN\\" download {hf_repo} --local-dir \\"{target_dir}\\" >> \\"{log_path}\\" 2>&1; '
        f'echo {EXIT_MARKER}\\$? >> \\"{log_path}\\"" '
        '> /dev/null 2>&1 & echo PID:$!'
    )


async def start_download(
    session: AsyncSession, machine: Machine, nim_id: str, hf_repo: str
) -> tuple[ModelDownloadJob, str | None]:
    root = await resolve_root(session, machine)
    target_dir = target_dir_for(root, nim_id)

    conn = await POOL.get(machine.host, machine.port, machine.username)

    code, out, err = await run_cmd(
        conn,
        'export PATH="$HOME/.local/bin:$PATH"; command -v hf || command -v huggingface-cli',
        timeout=10,
    )
    if code != 0 or not out.strip():
        raise RuntimeError(
            "HuggingFace CLI is not installed on that Mac — use the Install HF CLI button first"
        )

    job = ModelDownloadJob(
        machine_id=machine.id,
        machine_name=machine.name,
        nim_id=nim_id,
        hf_repo=hf_repo,
        target_dir=display_dir(target_dir),
        log_path="",
        status="downloading",
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    log_path = f"{target_dir}/download-{job.id[:8]}.log"
    job.log_path = log_path
    session.add(job)
    await session.commit()

    code, out, _ = await run_cmd(
        conn,
        f'mkdir -p "{target_dir}" && : > "{log_path}" && ' + _launch_script(hf_repo, target_dir, log_path),
        timeout=15,
    )
    pid = None
    if code == 0 and "PID:" in out:
        try:
            pid = int(out.strip().split("PID:")[-1].split()[0])
        except ValueError:
            pid = None
    if pid is None:
        job.status = "failed"
        job.error = (err or out or f"launch exited {code}")[:500]
    else:
        job.remote_pid = pid
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job, (None if pid else job.error)


async def refresh_job_status(session: AsyncSession, job: ModelDownloadJob) -> ModelDownloadJob:
    if job.status not in ("downloading",) or not job.remote_pid:
        return job
    try:
        machine = await session.get(Machine, job.machine_id)
        if not machine:
            job.status = "failed"
            job.error = "machine was removed from fleet"
            session.add(job)
            return job
        conn = await POOL.get(machine.host, machine.port, machine.username)
        _, out, _ = await run_cmd(
            conn,
            f'kill -0 {job.remote_pid} 2>/dev/null && echo ALIVE || echo DEAD; '
            f'tail -c 1500 "{job.log_path}" 2>/dev/null',
            timeout=12,
        )
        lines = (out or "").splitlines()
        alive = bool(lines) and lines[0].strip() == "ALIVE"
        rest = "\n".join(lines[1:]) if len(lines) > 1 else ""
        marker = re.search(re.escape(EXIT_MARKER) + r"(\d+)", rest)
        if marker:
            rc = marker.group(1)
            if rc == "0":
                job.status = "done"
                job.progress_pct = 100.0
            else:
                job.status = "failed"
                job.error = f"hf download exited {rc}: {rest[-200:]}"
        elif not alive:
            job.status = "failed"
            job.error = f"process died without exit marker. Log: {rest[-200:]}"
        else:
            prog = parse_hf_progress(rest)
            if prog.get("pct") is not None:
                job.progress_pct = prog["pct"]
                job.phase = prog.get("phase")
            elif prog.get("phase"):
                job.phase = prog["phase"]
            if prog.get("files_total"):
                job.files_done = prog.get("files_done", 0)
                job.files_total = prog["files_total"]
        session.add(job)
    except Exception as exc:
        log.debug("status refresh skipped for job %s: %s", job.id, exc)
    return job


async def cancel_job(session: AsyncSession, job: ModelDownloadJob) -> ModelDownloadJob:
    if job.status in ("done", "failed", "cancelled"):
        return job
    try:
        machine = await session.get(Machine, job.machine_id)
        if machine and job.remote_pid:
            conn = await POOL.get(machine.host, machine.port, machine.username)
            await run_cmd(
                conn,
                f'pkill -P {job.remote_pid} 2>/dev/null; kill {job.remote_pid} 2>/dev/null; true',
                timeout=8,
            )
    except Exception as exc:
        log.warning("cancel best-effort failed for %s: %s", job.id, exc)
    job.status = "cancelled"
    session.add(job)
    return job


INSTALL_HF_SCRIPT = (
    'export PATH="$HOME/.local/bin:$PATH"; '
    'if command -v hf >/dev/null || command -v huggingface-cli >/dev/null; then '
    'echo "ALREADY_INSTALLED"; exit 0; fi; '
    'command -v python3 >/dev/null || { echo "NO_PYTHON3"; exit 1; }; '
    'VENV="$HOME/.infervoice/hf-cli"; '
    '[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV" >/dev/null 2>&1 || { echo "VENV_FAILED"; exit 1; }; '
    '"$VENV/bin/pip" install -q --upgrade pip >/dev/null 2>&1; '
    '"$VENV/bin/pip" install -q "huggingface_hub" || { echo "PIP_FAILED"; exit 1; }; '
    'mkdir -p "$HOME/.local/bin"; '
    'ln -sf "$VENV/bin/huggingface-cli" "$HOME/.local/bin/huggingface-cli" 2>/dev/null; '
    '[ -x "$VENV/bin/hf" ] && ln -sf "$VENV/bin/hf" "$HOME/.local/bin/hf"; '
    '(command -v hf || command -v huggingface-cli) >/dev/null && echo INSTALL_OK || echo INSTALL_FAILED'
)


async def install_hf_cli(machine: Machine) -> dict:
    conn = await POOL.get(machine.host, machine.port, machine.username)
    code, out, err = await run_cmd(conn, INSTALL_HF_SCRIPT, timeout=420, max_output=4096)
    ok = "ALREADY_INSTALLED" in out or "INSTALL_OK" in out
    return {"ok": ok, "output": (out + ("\n" + err if err else ""))[-2000:]}
