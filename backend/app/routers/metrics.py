from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db import get_session
from ..metrics import sample_fleet
from ..models import Machine

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/fleet")
async def fleet_metrics(session: AsyncSession = Depends(get_session)):
    result = await session.exec(select(Machine))
    machines = list(result.all())
    if not machines:
        return []
    return await sample_fleet(machines)
