from __future__ import annotations

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlmodel.ext.asyncio.session import AsyncSession

from ..db import get_session
from ..models import Machine
from ..terminal import bridge_terminal

router = APIRouter(tags=["terminal"])


@router.websocket("/ws/terminal/{machine_id}")
async def terminal_ws(ws: WebSocket, machine_id: str):
    async for session in get_session():
        machine = await session.get(Machine, machine_id)
        break
    if not machine:
        await ws.close(code=4404)
        return
    try:
        await bridge_terminal(ws, machine)
    except WebSocketDisconnect:
        pass
