from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db import get_session
from ..downloads import _norm_root
from ..metrics import MetricSample, sample_metrics
from ..models import (
    ExecIn,
    ExecOut,
    InstallKeyIn,
    Machine,
    MachineCreate,
    MachineOut,
    MachineUpdate,
)
from ..ops import check_machine, install_key, refresh_machine
from ..ssh_pool import POOL, SSHError, run_cmd

router = APIRouter(prefix="/api/machines", tags=["machines"])


def _out(m: Machine) -> MachineOut:
    return MachineOut(
        id=m.id,
        name=m.name,
        host=m.host,
        port=m.port,
        username=m.username,
        status=m.status,
        error=m.error,
        specs=m.specs(),
        models_root=m.models_root,
        last_seen_at=m.last_seen_at,
        created_at=m.created_at,
    )


async def _get_or_404(machine_id: str, session: AsyncSession) -> Machine:
    machine = await session.get(Machine, machine_id)
    if not machine:
        raise HTTPException(404, "machine not found")
    return machine


@router.get("", response_model=list[MachineOut])
async def list_machines(session: AsyncSession = Depends(get_session)):
    result = await session.exec(select(Machine).order_by(Machine.created_at))
    return [_out(m) for m in result.all()]


@router.post("", response_model=MachineOut, status_code=201)
async def add_machine(body: MachineCreate, session: AsyncSession = Depends(get_session)):
    machine = Machine(name=(body.name or body.host), host=body.host.strip(), port=body.port, username=body.username.strip())
    session.add(machine)
    await session.commit()
    await session.refresh(machine)
    try:
        await check_machine(session, machine)
        if machine.status == "online":
            asyncio.get_running_loop().create_task(_bg_refresh(machine.id))
    except Exception:
        pass
    await session.commit()
    return _out(machine)


async def _bg_refresh(machine_id: str) -> None:
    async for session in get_session():
        m = await session.get(Machine, machine_id)
        if m:
            try:
                await refresh_machine(session, m)
                await session.commit()
            except Exception:
                pass
        return


@router.get("/{machine_id}", response_model=MachineOut)
async def get_machine(machine_id: str, session: AsyncSession = Depends(get_session)):
    return _out(await _get_or_404(machine_id, session))


@router.patch("/{machine_id}", response_model=MachineOut)
async def update_machine(machine_id: str, body: MachineUpdate, session: AsyncSession = Depends(get_session)):
    m = await _get_or_404(machine_id, session)
    if body.name is not None:
        m.name = body.name.strip() or m.name
    if body.models_root is not None:
        cleaned = body.models_root.strip()
        if cleaned and not cleaned.startswith(("~", "/", "$HOME")):
            raise HTTPException(400, "models path must be absolute or start with ~")
        m.models_root = _norm_root(cleaned) if cleaned else None
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return _out(m)


@router.delete("/{machine_id}", status_code=204)
async def delete_machine(machine_id: str, session: AsyncSession = Depends(get_session)):
    m = await _get_or_404(machine_id, session)
    await POOL.invalidate(m.host, m.port, m.username)
    await session.delete(m)
    await session.commit()


@router.post("/{machine_id}/check", response_model=MachineOut)
async def recheck(machine_id: str, session: AsyncSession = Depends(get_session)):
    m = await _get_or_404(machine_id, session)
    await POOL.invalidate(m.host, m.port, m.username)
    await check_machine(session, m)
    await session.commit()
    return _out(m)


@router.post("/{machine_id}/refresh", response_model=MachineOut)
async def refresh(machine_id: str, session: AsyncSession = Depends(get_session)):
    m = await _get_or_404(machine_id, session)
    try:
        await refresh_machine(session, m)
        await session.commit()
    except Exception as exc:
        raise HTTPException(502, detail=str(exc))
    return _out(m)


@router.post("/{machine_id}/install-key")
async def install_key_route(machine_id: str, body: InstallKeyIn, session: AsyncSession = Depends(get_session)):
    m = await _get_or_404(machine_id, session)
    try:
        return await install_key(session, m, body.password)
    except PermissionError as exc:
        raise HTTPException(401, detail=str(exc))
    except ConnectionError as exc:
        raise HTTPException(502, detail=str(exc))


@router.get("/{machine_id}/metrics", response_model=MetricSample)
async def metrics(machine_id: str, session: AsyncSession = Depends(get_session)):
    m = await _get_or_404(machine_id, session)
    try:
        conn = await POOL.get(m.host, m.port, m.username)
    except SSHError as exc:
        raise HTTPException(502, detail=str(exc))
    try:
        return await sample_metrics(conn, m.id)
    except Exception as exc:
        raise HTTPException(502, detail=f"sampling failed: {exc}")


@router.post("/{machine_id}/exec", response_model=ExecOut)
async def exec_command(machine_id: str, body: ExecIn, session: AsyncSession = Depends(get_session)):
    import time as _time

    m = await _get_or_404(machine_id, session)
    try:
        conn = await POOL.get(m.host, m.port, m.username)
    except SSHError as exc:
        raise HTTPException(502, detail=str(exc))
    start = _time.monotonic()
    code, stdout, stderr = await run_cmd(conn, body.command)
    return ExecOut(exit_code=code, stdout=stdout, stderr=stderr, duration_ms=int((_time.monotonic() - start) * 1000))
