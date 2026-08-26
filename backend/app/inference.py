from __future__ import annotations

import asyncio
import logging
import re

import asyncssh
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from .models import InferenceRun, InferenceTask, Machine, ModelDownloadJob
from .ssh_pool import POOL, run_cmd

log = logging.getLogger("infervoice.inference")

RUNNABLE_FAMILIES = {"Parakeet"}
AUDIO_REMOTE_DIR = "$HOME/infervoice_models/_audio"
INF_TIMEOUT = 600


def is_runnable(family: str) -> bool:
    return family in RUNNABLE_FAMILIES


INSTALL_ASR_SCRIPT = (
    'VENV="$HOME/.infervoice/asr-venv"; '
    '[ -x "$VENV/bin/parakeet-mlx" ] && { echo "ALREADY_INSTALLED"; exit 0; }; '
    'PYBIN="$(ls -v "$HOME"/.pyenv/versions/*/bin/python3 2>/dev/null | tail -1)"; '
    '[ -x "$PYBIN" ] || PYBIN="$(command -v /opt/homebrew/bin/python3.12 || command -v /opt/homebrew/bin/python3 || command -v /usr/local/bin/python3 || command -v python3)"; '
    '[ -n "$PYBIN" ] || { echo "NO_PYTHON3"; exit 1; }; '
    '"$PYBIN" -m venv "$VENV" >/dev/null 2>&1 || { echo "VENV_FAILED"; exit 1; }; '
    '"$VENV/bin/pip" install -q --upgrade pip >/dev/null 2>&1; '
    '"$VENV/bin/pip" install -q "parakeet-mlx" || { echo "PIP_FAILED"; exit 1; }; '
    '"$VENV/bin/parakeet-mlx" --help >/dev/null 2>&1 && echo INSTALL_OK || echo INSTALL_FAILED'
)


async def install_asr_runtime(machine: Machine) -> dict:
    conn = await POOL.get(machine.host, machine.port, machine.username)
    code, out, err = await run_cmd(conn, INSTALL_ASR_SCRIPT, timeout=900, max_output=4096)
    ok = "ALREADY_INSTALLED" in (out or "") or "INSTALL_OK" in (out or "")
    return {"ok": ok, "output": ((out or "") + "\n" + (err or ""))[-2000:]}


async def _has_local_mlx_weights(conn: asyncssh.SSHClientConnection, remote_dir: str) -> bool:
    _, out, _ = await run_cmd(
        conn,
        f'test -f "{remote_dir}/config.json" -a -f "{remote_dir}/model.safetensors" && echo YES || echo NO',
        timeout=8,
    )
    return "YES" in (out or "")


async def _upload_audio(
    conn: asyncssh.SSHClientConnection, local_path: str, remote_path: str
) -> None:
    remote_dir = remote_path.rsplit("/", 1)[0]
    await run_cmd(conn, f'mkdir -p "{remote_dir}"', timeout=10)
    sftp_path = remote_path
    if sftp_path.startswith("$HOME/"):
        sftp_path = sftp_path[len("$HOME/"):]
    elif sftp_path == "$HOME":
        sftp_path = "."
    async with conn.start_sftp_client() as sftp:
        await sftp.put(local_path, sftp_path)
    log.info("uploaded %s -> %s", local_path, remote_path)


def _clean_transcript(text: str) -> str:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return "\n".join(lines).strip()


_HF_MLX_MAP = {
    "parakeet-tdt-0.6b-v3": "mlx-community/parakeet-tdt-0.6b-v3",
    "parakeet-tdt-0.6b-v2": "mlx-community/parakeet-tdt-0.6b-v2",
    "parakeet-ctc-1.1b": "mlx-community/parakeet-ctc-1.1b",
}


def _hf_id_for(nim_id: str) -> str:
    return _HF_MLX_MAP.get(nim_id.lower(), nim_id)


async def transcribe_task(
    session: AsyncSession,
    task: InferenceTask,
    run: InferenceRun,
    machine: Machine,
) -> None:
    task.status = "uploading"
    session.add(task)
    await session.commit()

    conn = await POOL.get(machine.host, machine.port, machine.username)
    remote_audio = f"{AUDIO_REMOTE_DIR}/{run.id}.wav"
    root = await _resolve_root(session, machine)

    from .downloads import target_dir_for

    local_model_dir = target_dir_for(root, task.nim_id)

    try:
        await _upload_audio(conn, run.audio_path, remote_audio)
    except Exception as exc:
        task.status = "failed"
        task.error = f"audio upload failed: {exc}"[:500]
        session.add(task)
        await session.commit()
        return

    task.status = "inferring"
    session.add(task)
    await session.commit()

    if await _has_local_mlx_weights(conn, local_model_dir):
        model_arg = local_model_dir
    else:
        model_arg = _hf_id_for(task.nim_id)

    out_dir = f"{AUDIO_REMOTE_DIR}/out_{run.id[:8]}"
    out_file = f"{out_dir}/{run.id}.txt"
    script = (
        'export PATH="$HOME/.local/bin:$PATH"; '
        'BIN="$HOME/.infervoice/asr-venv/bin/parakeet-mlx"; '
        '[ -x "$BIN" ] || { echo "__IV_NO_RUNTIME__"; exit 97; }; '
        f'rm -rf "{out_dir}"; mkdir -p "{out_dir}"; '
        f'"$BIN" "{remote_audio}" --model "{model_arg}" '
        f'--output-format txt --output-dir "{out_dir}" '
        f'&& cat "{out_file}"'
    )

    import time as _time

    start = _time.monotonic()
    try:
        res = await asyncio.wait_for(
            conn.run(script, check=False), timeout=INF_TIMEOUT
        )
    except asyncio.TimeoutError:
        task.status = "failed"
        task.error = f"inference timed out after {INF_TIMEOUT}s"
        task.wall_ms = int((_time.monotonic() - start) * 1000)
        session.add(task)
        await session.commit()
        return

    wall_ms = int((_time.monotonic() - start) * 1000)
    stdout = res.stdout or ""
    stderr = res.stderr or ""

    if "__IV_NO_RUNTIME__" in stdout or res.exit_status == 97:
        task.status = "failed"
        task.error = "ASR runtime not installed on this Mac — install it from the Playground"
    elif res.exit_status != 0:
        task.status = "failed"
        task.error = f"inference failed ({res.exit_status}): {(stderr or stdout)[-300:]}"
    else:
        transcript = _clean_transcript(stdout)
        if not transcript:
            task.status = "failed"
            task.error = f"empty transcript. stderr: {stderr[-200:]}"
        else:
            task.status = "done"
            task.transcript = transcript[:20000]

    task.wall_ms = wall_ms
    session.add(task)
    await session.commit()


async def _resolve_root(session: AsyncSession, machine: Machine) -> str:
    from .db import get_setting
    from .downloads import MODELS_ROOT, SETTING_MODELS_ROOT

    if machine.models_root:
        return machine.models_root
    global_root = await get_setting(session, SETTING_MODELS_ROOT)
    return global_root or MODELS_ROOT


_background: set[asyncio.Task] = set()


async def orchestrate_run(run_id: str, audio_duration: float | None) -> None:
    async for session in get_sessions():
        try:
            run = await session.get(InferenceRun, run_id)
            if not run:
                return
            result = await session.exec(
                select(InferenceTask).where(InferenceTask.run_id == run_id)
            )
            tasks = list(result.all())
            machines: dict[str, Machine] = {}
            for t in tasks:
                m = machines.get(t.machine_id) or await session.get(Machine, t.machine_id)
                if m:
                    machines[t.machine_id] = m

            async def one(t: InferenceTask) -> None:
                m = machines.get(t.machine_id)
                if not m:
                    t.status = "failed"
                    t.error = "machine removed"
                    session.add(t)
                    await session.commit()
                    return
                try:
                    await transcribe_task(session, t, run, m)
                except Exception as exc:
                    log.exception("inference task %s crashed", t.id)
                    t.status = "failed"
                    t.error = f"{type(exc).__name__}: {exc}"[:500]
                    session.add(t)
                    await session.commit()

            await asyncio.gather(*(one(t) for t in tasks))
            run.status = "completed"
            session.add(run)
            await session.commit()
        except Exception:
            log.exception("orchestration for run %s failed", run_id)
        finally:
            return


def get_sessions():
    from .db import get_session

    return get_session()


def spawn_orchestration(run_id: str, audio_duration: float | None) -> None:
    task = asyncio.create_task(orchestrate_run(run_id, audio_duration))
    _background.add(task)
    task.add_done_callback(_background.discard)


async def deployed_machine_ids(session: AsyncSession, nim_id: str) -> set[str]:
    result = await session.exec(select(ModelDownloadJob))
    return {
        j.machine_id
        for j in result.all()
        if j.nim_id == nim_id and j.status == "done"
    }
