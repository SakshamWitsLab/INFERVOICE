from __future__ import annotations

import asyncio
import datetime
import logging
import time as _time

import asyncssh
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from .config import CONFIG
from .models import InferenceRun, InferenceTask, Machine, ModelDownloadJob
from .ssh_pool import POOL, run_cmd

log = logging.getLogger("infervoice.inference")

RUNNABLE_FAMILIES = {"Parakeet"}
AUDIO_REMOTE_DIR = "$HOME/infervoice_models/_audio"
INF_TIMEOUT = 600

_engine = create_async_engine(
    f"sqlite+aiosqlite:///{CONFIG.db_path}",
    echo=False,
    connect_args={"timeout": 15},
)


def _new_session() -> AsyncSession:
    return AsyncSession(_engine, expire_on_commit=False)


def is_runnable(family: str) -> bool:
    return family in RUNNABLE_FAMILIES


INSTALL_ASR_SCRIPT = (
    'set +e; setopt nullglob 2>/dev/null; '
    'VENV="$HOME/.infervoice/asr-venv"; '
    '[ -x "$VENV/bin/parakeet-mlx" ] && { echo "ALREADY_INSTALLED"; exit 0; }; '
    'echo ">>> Searching for existing Python >= 3.10"; '
    'PYBIN=""; '
    'for candidate in '
    '$HOME/.pyenv/versions/*/bin/python3 '
    '/Library/Frameworks/Python.framework/Versions/*/bin/python3 '
    '/opt/homebrew/bin/python3.13 '
    '/opt/homebrew/bin/python3.12 '
    '/opt/homebrew/bin/python3.11 '
    '/opt/homebrew/bin/python3.10 '
    '/opt/homebrew/bin/python3 '
    '/usr/local/bin/python3 '
    'python3 '
    'python3.13 '
    'python3.12 '
    'python3.11 '
    'python3.10; do '
    '[ -x "$candidate" ] || continue; '
    'if "$candidate" -c "import sys; exit(0 if sys.version_info >= (3, 10) else 1)" 2>/dev/null; then '
    'echo ">>> compatible: $candidate ($("$candidate" --version 2>&1))"; '
    '[ -z "$PYBIN" ] && PYBIN="$candidate"; '
    'fi; done; '
    'if [ -z "$PYBIN" ]; then echo ">>> No Python >= 3.10 found; bootstrapping via uv"; '
    'export UV_NO_MODIFY_PATH=1; '
    'export UV_PYTHON_INSTALL_DIR="$HOME/.infervoice/uv-python"; '
    'export UV_CACHE_DIR="$HOME/.infervoice/.uv-cache"; '
    'UV="$HOME/.local/bin/uv"; '
    'if [ ! -x "$UV" ]; then '
    'echo ">>> Installing uv"; '
    'curl -LsSf https://astral.sh/uv/install.sh | sh || { echo "UV_INSTALL_FAILED"; exit 1; }; '
    'fi; '
    'echo ">>> uv installing Python 3.12"; '
    '"$UV" python install 3.12 || { echo "UV_PYTHON_INSTALL_FAILED"; exit 1; }; '
    'PYBIN="$("$UV" python find 3.12)" || { echo "UV_PYTHON_FIND_FAILED"; exit 1; }; '
    'echo ">>> Using managed Python: $PYBIN ($("$PYBIN" --version 2>&1))"; '
    'fi; '
    '[ -n "$PYBIN" ] || { echo "NO_PYTHON3_10+"; exit 1; }; '
    'echo "USING_PYTHON: $("$PYBIN" --version 2>&1)"; '
    'echo ">>> Creating venv"; '
    '"$PYBIN" -m venv "$VENV" || { echo "VENV_FAILED"; exit 1; }; '
    'echo ">>> Installing parakeet-mlx"; '
    '"$VENV/bin/pip" install -q --upgrade pip 2>/dev/null; '
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


def _append_log(task: InferenceTask, msg: str) -> None:
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%H:%M:%S")
    line = f"[{ts}] {msg}\n"
    task.log_text = (task.log_text or "") + line
    if len(task.log_text) > 18000:
        task.log_text = task.log_text[-18000:]


async def _save_task(task: InferenceTask) -> None:
    """Persist task changes in its own session."""
    async with _new_session() as session:
        session.add(task)
        await session.commit()


async def _run_inference(
    conn: asyncssh.SSHClientConnection,
    script: str,
    task: InferenceTask,
    wall_start: float,
) -> tuple[int, str, str, int]:
    """Run inference script, return (exit_status, stdout, stderr, wall_ms)."""
    process = None
    _procs[task.run_id] = None
    try:
        process = await asyncio.wait_for(
            conn.create_process(script, encoding="utf-8"), timeout=30
        )
        _procs[task.run_id] = process
        try:
            await asyncio.wait_for(process.wait_closed(), timeout=INF_TIMEOUT)
        except asyncio.CancelledError:
            try:
                process.terminate()
            except Exception:
                pass
            raise
        except asyncio.TimeoutError:
            try:
                process.terminate()
            except Exception:
                pass
            task.status = "failed"
            task.error = f"inference timed out after {INF_TIMEOUT}s"
            task.wall_ms = int((_time.monotonic() - wall_start) * 1000)
            return -1, "", "", task.wall_ms
        status = process.exit_status if process.exit_status is not None else -1
        stdout_text = await process.stdout.read() if hasattr(process.stdout, 'read') else (process.stdout or "")
        stderr_text = await process.stderr.read() if hasattr(process.stderr, 'read') else (process.stderr or "")
        return status, stdout_text, stderr_text, int((_time.monotonic() - wall_start) * 1000)
    except asyncio.TimeoutError:
        task.status = "failed"
        task.error = "SSH channel open timed out"
        task.wall_ms = int((_time.monotonic() - wall_start) * 1000)
        return -1, "", "", task.wall_ms
    except asyncio.CancelledError:
        if process is not None:
            try:
                process.terminate()
            except Exception:
                pass
        raise
    finally:
        _procs.pop(task.run_id, None)


def _process_result(
    exit_status: int,
    stdout: str,
    stderr: str,
    wall_ms: int,
    task: InferenceTask,
) -> None:
    """Update task status based on inference result."""
    if "__IV_NO_RUNTIME__" in stdout or exit_status == 97:
        task.status = "failed"
        task.error = "__IV_NO_RUNTIME__"
    elif exit_status != 0:
        task.status = "failed"
        task.error = f"inference failed ({exit_status}): {(stderr or stdout)[-300:]}"
    else:
        transcript = _clean_transcript(stdout)
        if not transcript:
            task.status = "failed"
            task.error = f"empty transcript. stderr: {stderr[-200:]}"
        else:
            task.status = "done"
            task.transcript = transcript[:20000]
    task.wall_ms = wall_ms


async def transcribe_task(
    task_id: str,
    run_id: str,
    machine_id: str,
) -> None:
    """Run inference for a single task. Each task owns its own DB session."""
    async with _new_session() as session:
        task = await session.get(InferenceTask, task_id)
        run = await session.get(InferenceRun, run_id)
        machine = await session.get(Machine, machine_id)
        if not task or not run or not machine:
            return

        task.status = "uploading"
        _append_log(task, f"Starting on {machine.name} ({machine.host})")
        session.add(task)
        await session.commit()

        conn = await POOL.get(machine.host, machine.port, machine.username)
        remote_audio = f"{AUDIO_REMOTE_DIR}/{run.id}.wav"
        root = await _resolve_root(session, machine)

        from .downloads import target_dir_for

        local_model_dir = target_dir_for(root, task.nim_id)

        _append_log(task, f"Uploading audio ({run.audio_name}) to {machine.name}:{remote_audio}")
        try:
            await _upload_audio(conn, run.audio_path, remote_audio)
            _append_log(task, "Audio upload complete")
        except Exception as exc:
            _append_log(task, f"Audio upload FAILED: {exc}")
            task.status = "failed"
            task.error = f"audio upload failed: {exc}"[:500]
            session.add(task)
            await session.commit()
            return

        task.status = "downloading_model"
        task.phase = "checking model weights"
        _append_log(task, f"Checking model weights at {local_model_dir}")
        session.add(task)
        await session.commit()

        if await _has_local_mlx_weights(conn, local_model_dir):
            model_arg = local_model_dir
            task.phase = "using local weights"
            _append_log(task, "Found local MLX weights — using local path")
        else:
            model_arg = _hf_id_for(task.nim_id)
            task.phase = f"will download {model_arg}"
            _append_log(task, f"No local weights — will download from HuggingFace: {model_arg}")
        session.add(task)
        await session.commit()

        out_dir = f"{AUDIO_REMOTE_DIR}/out_{run.id[:8]}"
        out_file = f"{out_dir}/{run.id}.txt"
        script = (
            'export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"; '
            'BIN="$HOME/.infervoice/asr-venv/bin/parakeet-mlx"; '
            '[ -x "$BIN" ] || { echo "__IV_NO_RUNTIME__"; exit 97; }; '
            f'rm -rf "{out_dir}"; mkdir -p "{out_dir}"; '
            f'"$BIN" "{remote_audio}" --model "{model_arg}" '
            f'--output-format txt --output-dir "{out_dir}" '
            f'&& cat "{out_file}"'
        )

        task.status = "inferring"
        task.phase = "running parakeet-mlx"
        _append_log(task, f"Running inference: parakeet-mlx --model {model_arg}")
        session.add(task)
        await session.commit()

        start = _time.monotonic()
        exit_status, stdout, stderr, wall_ms = await _run_inference(conn, script, task, start)

        if exit_status == -1:
            _append_log(task, f"Inference timed out after {INF_TIMEOUT}s")
            session.add(task)
            await session.commit()
            return

        if stdout.strip():
            _append_log(task, f"stdout: {stdout.strip()[:500]}")
        if stderr.strip():
            _append_log(task, f"stderr: {stderr.strip()[:500]}")

        _process_result(exit_status, stdout, stderr, wall_ms, task)

        if task.error == "__IV_NO_RUNTIME__":
            _append_log(task, "ASR runtime not found — auto-installing parakeet-mlx")
            log.info("ASR runtime missing on %s, auto-installing...", machine.name)
            task.status = "installing_runtime"
            task.phase = "installing parakeet-mlx"
            session.add(task)
            await session.commit()
            try:
                install_result = await install_asr_runtime(machine)
            except Exception as exc:
                _append_log(task, f"Auto-install FAILED: {exc}")
                task.status = "failed"
                task.error = f"auto-install ASR runtime failed: {exc}"
                task.wall_ms = wall_ms
                session.add(task)
                await session.commit()
                return
            _append_log(task, f"Install output: {install_result['output'][-500:]}")
            if not install_result["ok"]:
                _append_log(task, "Auto-install did not succeed")
                task.status = "failed"
                task.error = f"ASR runtime auto-install failed: {install_result['output'][-300:]}"
                task.wall_ms = wall_ms
                session.add(task)
                await session.commit()
                return
            _append_log(task, "ASR runtime installed — retrying inference")
            task.status = "inferring"
            task.phase = "retrying inference"
            session.add(task)
            await session.commit()
            start2 = _time.monotonic()
            exit_status, stdout, stderr, wall_ms = await _run_inference(conn, script, task, start2)
            if exit_status == -1:
                _append_log(task, f"Retry timed out after {INF_TIMEOUT}s")
                session.add(task)
                await session.commit()
                return
            if stdout.strip():
                _append_log(task, f"stdout: {stdout.strip()[:500]}")
            if stderr.strip():
                _append_log(task, f"stderr: {stderr.strip()[:500]}")
            _process_result(exit_status, stdout, stderr, wall_ms, task)

        if task.status == "done":
            _append_log(task, f"Done in {wall_ms}ms (RTF {(wall_ms / 1000 / max(run.audio_duration or 1, 0.01)):.2f}x)")
        elif task.status == "failed":
            _append_log(task, f"FAILED: {task.error}")

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
_runs: dict[str, asyncio.Task] = {}
_procs: dict[str, object] = {}


async def orchestrate_run(run_id: str, audio_duration: float | None) -> None:
    """Orchestrate a run. Each task gets its own DB session."""
    async with _new_session() as session:
        run = await session.get(InferenceRun, run_id)
        if not run:
            return
        result = await session.exec(
            select(InferenceTask).where(InferenceTask.run_id == run_id)
        )
        tasks = list(result.all())
        task_infos = [(t.id, t.machine_id) for t in tasks]

    async def one(task_id: str, machine_id: str) -> None:
        try:
            await transcribe_task(task_id, run_id, machine_id)
        except asyncio.CancelledError:
            try:
                async with _new_session() as s:
                    t = await s.get(InferenceTask, task_id)
                    if t and t.status not in ("done", "failed", "cancelled"):
                        t.status = "cancelled"
                        _append_log(t, "Cancelled by user")
                        s.add(t)
                        await s.commit()
            except Exception:
                log.exception("failed to persist cancellation for task %s", task_id)
            raise
        except Exception as exc:
            log.exception("inference task %s crashed", task_id)
            try:
                async with _new_session() as s:
                    t = await s.get(InferenceTask, task_id)
                    if t and t.status not in ("done", "cancelled"):
                        t.status = "failed"
                        t.error = f"{type(exc).__name__}: {exc}"[:500]
                        s.add(t)
                        await s.commit()
            except Exception:
                log.exception("failed to save crash for task %s", task_id)

    try:
        await asyncio.gather(*(one(tid, mid) for tid, mid in task_infos))
    except asyncio.CancelledError:
        async with _new_session() as session:
            run = await session.get(InferenceRun, run_id)
            if run and run.status not in ("completed", "cancelled"):
                run.status = "cancelled"
                session.add(run)
                await session.commit()
        _runs.pop(run_id, None)
        raise

    async with _new_session() as session:
        run = await session.get(InferenceRun, run_id)
        if run and run.status != "cancelled":
            run.status = "completed"
            session.add(run)
            await session.commit()
    _runs.pop(run_id, None)


def spawn_orchestration(run_id: str, audio_duration: float | None) -> None:
    task = asyncio.create_task(orchestrate_run(run_id, audio_duration))
    _background.add(task)
    _runs[run_id] = task
    task.add_done_callback(_background.discard)


async def cancel_run(run_id: str) -> bool:
    """Cancel an in-flight run orchestration, if any. Returns True if it was running."""
    proc = _procs.get(run_id)
    if proc is not None:
        try:
            proc.terminate()
        except Exception:
            pass
    task = _runs.get(run_id)
    if not task or task.done():
        _runs.pop(run_id, None)
        _procs.pop(run_id, None)
        return False
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass
    _runs.pop(run_id, None)
    _procs.pop(run_id, None)
    return True


async def is_running(run_id: str) -> bool:
    task = _runs.get(run_id)
    if task is not None and not task.done():
        return True
    # Check DB for stale "running" status (e.g., after server restart)
    async with _new_session() as session:
        run = await session.get(InferenceRun, run_id)
        return run is not None and run.status == "running"


async def deployed_machine_ids(session: AsyncSession, nim_id: str) -> set[str]:
    result = await session.exec(select(ModelDownloadJob))
    return {
        j.machine_id
        for j in result.all()
        if j.nim_id == nim_id and j.status == "done"
    }
