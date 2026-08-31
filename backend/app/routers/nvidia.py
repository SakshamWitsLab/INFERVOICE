from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db import get_session, get_setting, set_setting
from ..downloads import (
    SETTING_MODELS_ROOT,
    cancel_job,
    delete_deployment,
    install_hf_cli,
    refresh_job_status,
    start_download,
)
from ..models import Machine, ModelDownloadJob
from ..nvidia import (
    NvidiaError,
    delete_key,
    get_stt_catalog,
    key_hint,
    read_key,
    save_key,
    validate_key,
)
from ..ssh_pool import POOL, SSHError, run_cmd

router = APIRouter(prefix="/api/nvidia", tags=["nvidia"])


class KeyIn(BaseModel):
    api_key: str = Field(min_length=10, max_length=512)


class DownloadIn(BaseModel):
    machine_id: str
    nim_id: str
    hf_repo: str | None = None


class JobOut(BaseModel):
    id: str
    machine_id: str
    machine_name: str
    nim_id: str
    hf_repo: str
    target_dir: str
    status: str
    error: str | None
    remote_pid: int | None
    log_tail: str | None = None
    progress_pct: float | None = None
    phase: str | None = None
    files_done: int | None = None
    files_total: int | None = None
    created_at: str


def _job_out(job: ModelDownloadJob, log_tail: str | None = None) -> JobOut:
    return JobOut(
        id=job.id,
        machine_id=job.machine_id,
        machine_name=job.machine_name,
        nim_id=job.nim_id,
        hf_repo=job.hf_repo,
        target_dir=job.target_dir,
        status=job.status,
        error=job.error,
        remote_pid=job.remote_pid,
        log_tail=log_tail,
        progress_pct=job.progress_pct,
        phase=job.phase,
        files_done=job.files_done,
        files_total=job.files_total,
        created_at=job.created_at.isoformat(),
    )


@router.put("/key")
async def put_key(body: KeyIn):
    try:
        count = await validate_key(body.api_key)
    except NvidiaError as exc:
        raise HTTPException(400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(502, detail=f"could not reach NVIDIA: {exc}")
    save_key(body.api_key)
    return {"ok": True, "catalog_size": count}


@router.get("/key")
async def get_key():
    key = read_key()
    return {"configured": bool(key), "hint": key_hint()}


@router.delete("/key")
async def remove_key():
    delete_key()
    return {"ok": True}


@router.get("/models")
async def list_models():
    try:
        return await get_stt_catalog()
    except Exception as exc:
        raise HTTPException(502, detail=str(exc))


@router.post("/downloads")
async def create_download(body: DownloadIn, session: AsyncSession = Depends(get_session)):
    machine = await session.get(Machine, body.machine_id)
    if not machine:
        raise HTTPException(404, "machine not found")

    catalog = await get_stt_catalog()
    model = next(
        (m for m in catalog["models"] if m["nim_id"] == body.nim_id),
        None,
    )
    if not model:
        raise HTTPException(404, f"model {body.nim_id} not in catalog")
    repo = body.hf_repo or model["hf_repo"]
    if not repo or not model["downloadable"]:
        raise HTTPException(400, "this model has no HuggingFace weights available for Mac download")

    try:
        job, launch_error = await start_download(session, machine, body.nim_id, repo)
    except SSHError as exc:
        raise HTTPException(502, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, detail=str(exc))
    out = _job_out(job)
    if launch_error:
        out.log_tail = launch_error
    return out


@router.get("/downloads", response_model=list[JobOut])
async def list_downloads(session: AsyncSession = Depends(get_session)):
    result = await session.exec(select(ModelDownloadJob).order_by(ModelDownloadJob.created_at.desc()))
    jobs = [j for j in result.all() if j.status != "deleted"]
    refreshed = []
    for job in jobs:
        await refresh_job_status(session, job)
        refreshed.append(job)
    await session.commit()
    tails: dict[str, str | None] = {}
    active = [j for j in refreshed if j.status == "downloading"]
    if active:
        seen_machines: dict[str, object] = {}
        for job in active:
            machine = seen_machines.get(job.machine_id)
            if machine is None:
                machine = await session.get(Machine, job.machine_id)
                seen_machines[job.machine_id] = machine
            if not machine:
                continue
            from ..ssh_pool import POOL, run_cmd

            try:
                conn = await POOL.get(machine.host, machine.port, machine.username)
                _, tail_out, _ = await run_cmd(conn, f'tail -c 600 "{job.log_path}" 2>/dev/null', timeout=8)
                tails[job.id] = tail_out.strip()[-600:] or None
            except Exception:
                tails[job.id] = None
    return [_job_out(j, tails.get(j.id)) for j in refreshed]


@router.delete("/downloads/{job_id}")
async def cancel(job_id: str, session: AsyncSession = Depends(get_session)):
    job = await session.get(ModelDownloadJob, job_id)
    if not job:
        raise HTTPException(404, "job not found")
    await cancel_job(session, job)
    await session.commit()
    return _job_out(job)


@router.delete("/deployments/{machine_id}/{nim_id:path}")
async def remove_deployment(
    machine_id: str, nim_id: str, session: AsyncSession = Depends(get_session)
):
    machine = await session.get(Machine, machine_id)
    if not machine:
        raise HTTPException(404, "machine not found")
    try:
        result = await delete_deployment(session, machine_id, nim_id)
    except SSHError as exc:
        raise HTTPException(502, detail=str(exc))
    if not result["ok"]:
        raise HTTPException(500, detail=result.get("error", "delete failed"))
    return result


@router.post("/machines/{machine_id}/install-hf-cli")
async def bootstrap_hf(machine_id: str, session: AsyncSession = Depends(get_session)):
    machine = await session.get(Machine, machine_id)
    if not machine:
        raise HTTPException(404, "machine not found")
    try:
        return await install_hf_cli(machine)
    except SSHError as exc:
        raise HTTPException(502, detail=str(exc))


class PathIn(BaseModel):
    path: str = Field(min_length=1, max_length=512)


@router.get("/settings/models-root")
async def get_models_root(session: AsyncSession = Depends(get_session)):
    value = await get_setting(session, SETTING_MODELS_ROOT)
    return {"value": value}


@router.put("/settings/models-root")
async def put_models_root(body: PathIn, session: AsyncSession = Depends(get_session)):
    path = body.path.strip()
    if not path.startswith(("~", "/", "$HOME")):
        raise HTTPException(400, "path must be absolute or start with ~")
    await set_setting(session, SETTING_MODELS_ROOT, path)
    return {"ok": True, "value": path}


async def _du_size(machine: Machine, remote_dir: str) -> str | None:
    try:
        conn = await POOL.get(machine.host, machine.port, machine.username)
        exec_dir = remote_dir.replace("~", "$HOME", 1) if remote_dir.startswith("~") else remote_dir
        _, out, _ = await run_cmd(conn, f'du -sh "{exec_dir}" 2>/dev/null', timeout=15)
        first = (out or "").splitlines()[0] if out.strip() else ""
        size = first.split("\t")[0].strip()
        return size or None
    except Exception:
        return None


@router.get("/deployments")
async def deployments(
    verify: bool = False,
    session: AsyncSession = Depends(get_session),
):
    result = await session.exec(select(ModelDownloadJob))
    jobs = [j for j in result.all() if j.status == "done"]
    latest: dict[tuple[str, str], ModelDownloadJob] = {}
    for job in sorted(jobs, key=lambda j: j.created_at):
        latest[(job.machine_id, job.nim_id)] = job

    entries = []
    for (machine_id, nim_id), job in latest.items():
        machine = await session.get(Machine, machine_id)
        if machine is None:
            continue
        entries.append(
            {
                "machine_id": machine_id,
                "machine_name": machine.name if machine else job.machine_name,
                "machine_online": bool(machine and machine.status == "online"),
                "nim_id": nim_id,
                "hf_repo": job.hf_repo,
                "target_dir": job.target_dir,
                "disk_size": None,
            }
        )

    if verify:
        sem = asyncio.Semaphore(8)

        async def one(e: dict) -> None:
            if not e["machine_online"]:
                return
            async with sem:
                machine = await session.get(Machine, e["machine_id"])
                if machine:
                    e["disk_size"] = await _du_size(machine, e["target_dir"])

        await asyncio.gather(*(one(e) for e in entries))

    entries.sort(key=lambda e: (e["nim_id"], e["machine_name"]))
    return {"deployments": entries}
