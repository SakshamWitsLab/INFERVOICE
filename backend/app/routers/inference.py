from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..config import CONFIG
from ..db import get_session
from ..inference import (
    cancel_run,
    deployed_machine_ids,
    install_asr_runtime,
    is_runnable,
    is_running,
    spawn_orchestration,
)
from ..models import InferenceRun, InferenceTask, Machine
from ..nvidia import get_stt_catalog
from ..ssh_pool import SSHError

log = logging.getLogger("infervoice.inference")

router = APIRouter(prefix="/api/inference", tags=["inference"])


from pydantic import BaseModel

def _task_out(t: InferenceTask) -> dict:
    return {
        "id": t.id,
        "machine_id": t.machine_id,
        "machine_name": t.machine_name,
        "nim_id": t.nim_id,
        "status": t.status,
        "transcript": t.transcript,
        "error": t.error,
        "wall_ms": t.wall_ms,
        "progress_pct": t.progress_pct,
        "phase": t.phase,
        "log_text": t.log_text,
    }


@router.get("/catalog")
async def runnable_catalog(session: AsyncSession = Depends(get_session)):
    catalog = await get_stt_catalog()
    out = []
    for m in catalog["models"]:
        out.append({**m, "runnable": m["downloadable"] and is_runnable(m["family"])})
    return {"models": out, "live_error": catalog["live_error"]}


@router.get("/deployed/{nim_id}")
async def deployed(nim_id: str, session: AsyncSession = Depends(get_session)):
    ids = await deployed_machine_ids(session, nim_id)
    machines = []
    for mid in ids:
        m = await session.get(Machine, mid)
        if m and m.status == "online":
            machines.append({"id": m.id, "name": m.name})
    return {"machines": sorted(machines, key=lambda x: x["name"])}


@router.post("/runs")
async def create_run(
    audio: UploadFile = File(...),
    model_id: str = Form(...),
    machine_ids: str = Form("[]"),
    duration_sec: float = Form(0.0),
    session: AsyncSession = Depends(get_session),
):
    try:
        ids = [str(x) for x in json.loads(machine_ids)]
    except json.JSONDecodeError:
        raise HTTPException(400, "machine_ids must be a JSON array")
    if not ids:
        raise HTTPException(400, "select at least one machine")

    catalog = await get_stt_catalog()
    model = next((m for m in catalog["models"] if m["nim_id"] == model_id), None)
    if not model:
        raise HTTPException(404, f"model {model_id} not found")
    if not (model["downloadable"] and is_runnable(model["family"])):
        raise HTTPException(400, f"{model['family']} models have no Mac runtime yet")

    deployed = await deployed_machine_ids(session, model_id)
    bad = [i for i in ids if i not in deployed]
    if bad:
        raise HTTPException(400, "model not deployed on some selected machines")

    ext = Path(audio.filename or "audio.wav").suffix.lower() or ".wav"
    if ext not in (".wav", ".mp3", ".flac", ".m4a", ".ogg"):
        ext = ".wav"

    run = InferenceRun(
        model_id=model_id,
        audio_path="",
        audio_name=audio.filename or "recording.wav",
        audio_duration=duration_sec or None,
    )
    audio_dir = CONFIG.data_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    local_path = audio_dir / f"{run.id}{ext}"
    content = await audio.read()
    if not content:
        raise HTTPException(400, "empty audio file")
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(413, "audio too large (max 100MB)")
    local_path.write_bytes(content)
    run.audio_path = str(local_path)
    session.add(run)
    await session.commit()
    await session.refresh(run)

    for mid in ids:
        m = await session.get(Machine, mid)
        if not m:
            continue
        session.add(
            InferenceTask(
                run_id=run.id,
                machine_id=m.id,
                machine_name=m.name,
                nim_id=model_id,
            )
        )
    await session.commit()

    spawn_orchestration(run.id, run.audio_duration)
    return {"run_id": run.id}


@router.post("/runs/multi")
async def create_multi_run(
    audio: UploadFile = File(...),
    targets_json: str = Form(...),
    duration_sec: float = Form(0.0),
    session: AsyncSession = Depends(get_session),
):
    try:
        targets = json.loads(targets_json)
        assert isinstance(targets, list) and len(targets) > 0
    except (json.JSONDecodeError, AssertionError):
        raise HTTPException(400, "targets_json must be a non-empty JSON array of {model_id, machine_ids}")

    catalog = await get_stt_catalog()
    catalog_map = {m["nim_id"]: m for m in catalog["models"]}

    ext = Path(audio.filename or "audio.wav").suffix.lower() or ".wav"
    if ext not in (".wav", ".mp3", ".flac", ".m4a", ".ogg"):
        ext = ".wav"

    run = InferenceRun(
        model_id="multi",
        audio_path="",
        audio_name=audio.filename or "recording.wav",
        audio_duration=duration_sec or None,
    )
    audio_dir = CONFIG.data_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    local_path = audio_dir / f"{run.id}{ext}"
    content = await audio.read()
    if not content:
        raise HTTPException(400, "empty audio file")
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(413, "audio too large (max 100MB)")
    local_path.write_bytes(content)
    run.audio_path = str(local_path)
    session.add(run)
    await session.commit()
    await session.refresh(run)

    task_count = 0
    for pair in targets:
        mid = pair.get("model_id", "")
        mids = pair.get("machine_ids", [])
        model = catalog_map.get(mid)
        if not model:
            continue
        for machine_id in mids:
            m = await session.get(Machine, machine_id)
            if not m:
                continue
            session.add(
                InferenceTask(
                    run_id=run.id,
                    machine_id=m.id,
                    machine_name=m.name,
                    nim_id=mid,
                )
            )
            task_count += 1

    if task_count == 0:
        await session.delete(run)
        await session.commit()
        raise HTTPException(400, "no valid model+machine pairs")

    await session.commit()
    spawn_orchestration(run.id, run.audio_duration)
    return {"run_id": run.id}


@router.get("/runs/{run_id}")
async def get_run(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await session.get(InferenceRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    result = await session.exec(select(InferenceTask).where(InferenceTask.run_id == run_id))
    tasks = sorted(result.all(), key=lambda t: t.machine_name)
    return {
        "run": {
            "id": run.id,
            "model_id": run.model_id,
            "audio_name": run.audio_name,
            "audio_duration": run.audio_duration,
            "status": "running" if await is_running(run.id) else run.status,
            "created_at": run.created_at.isoformat(),
        },
        "tasks": [_task_out(t) for t in tasks],
    }


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await session.get(InferenceRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    was_running = await cancel_run(run_id)
    if not was_running:
        # Check if run is stuck in "running" state in DB (stale)
        if run.status != "running":
            raise HTTPException(400, "run is not running")
        # Mark run and its tasks as cancelled
        run.status = "cancelled"
        session.add(run)
        result = await session.exec(select(InferenceTask).where(InferenceTask.run_id == run_id))
        for t in result.all():
            if t.status not in ("done", "failed", "cancelled"):
                t.status = "cancelled"
                t.error = "Cancelled by user"
                session.add(t)
        await session.commit()
    return {"ok": True}


@router.delete("/runs/{run_id}")
async def delete_run(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await session.get(InferenceRun, run_id)
    if not run:
        raise HTTPException(404, "run not found")
    await cancel_run(run_id)
    result = await session.exec(select(InferenceTask).where(InferenceTask.run_id == run_id))
    for t in result.all():
        await session.delete(t)
    await session.delete(run)
    await session.commit()
    return {"ok": True}


@router.get("/runs")
async def list_runs(session: AsyncSession = Depends(get_session)):
    result = await session.exec(
        select(InferenceRun).order_by(InferenceRun.created_at.desc())
    )
    runs = list(result.all())[:20]
    out = []
    for r in runs:
        res = await session.exec(select(InferenceTask).where(InferenceTask.run_id == r.id))
        tasks = list(res.all())
        model_ids = sorted({t.nim_id for t in tasks})
        entry = {
            "id": r.id,
            "model_id": r.model_id,
            "audio_name": r.audio_name,
            "status": "running" if await is_running(r.id) else r.status,
            "created_at": r.created_at.isoformat(),
            "machines": [t.machine_name for t in tasks],
            "done": sum(1 for t in tasks if t.status == "done"),
        }
        if len(model_ids) > 1:
            entry["model_ids"] = model_ids
        out.append(entry)
    return {"runs": out}


@router.post("/install-runtime/{machine_id}")
async def bootstrap_runtime(machine_id: str, session: AsyncSession = Depends(get_session)):
    from ..inference import install_asr_runtime as _install
    from ..models import Machine

    machine = await session.get(Machine, machine_id)
    if not machine:
        raise HTTPException(404, "machine not found")
    try:
        return await _install(machine)
    except SSHError as exc:
        raise HTTPException(502, detail=str(exc))
