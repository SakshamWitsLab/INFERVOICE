from __future__ import annotations

from fastapi import APIRouter

from ..discovery import DISCOVERY
from ..models import Machine
from ..db import get_session
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from fastapi import Depends

router = APIRouter(prefix="/api/discovery", tags=["discovery"])


def _registered_keys(machines: list[Machine]) -> set[tuple[str, int]]:
    return {(m.host, m.port) for m in machines}


@router.get("")
async def mdns_list(session: AsyncSession = Depends(get_session)):
    hosts = DISCOVERY.mdns_hosts()
    reg = _registered_keys(list((await session.exec(select(Machine))).all()))
    return {
        "hosts": [
            {"source": h.source, "host": h.host, "port": h.port, "name": h.name, "registered": (h.host, h.port) in reg}
            for h in hosts
        ]
    }


@router.post("/scan")
async def scan(session: AsyncSession = Depends(get_session)):
    found = await DISCOVERY.subnet_scan()
    reg = _registered_keys(list((await session.exec(select(Machine))).all()))
    return {
        "hosts": [
            {"source": h.source, "host": h.host, "port": h.port, "name": h.name, "registered": (h.host, h.port) in reg}
            for h in found
        ]
    }
