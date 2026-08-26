from __future__ import annotations

import asyncio
import json
import logging

import asyncssh
from fastapi import WebSocket, WebSocketDisconnect

from .models import Machine
from .ssh_pool import POOL

log = logging.getLogger("infervoice.terminal")


async def bridge_terminal(ws: WebSocket, machine: Machine) -> None:
    await ws.accept()
    cols, rows = 120, 32

    def _json(msg: str) -> dict | None:
        try:
            data = json.loads(msg)
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None

    try:
        conn = await POOL.get(machine.host, machine.port, machine.username)
    except Exception as exc:
        await ws.send_text(json.dumps({"type": "error", "message": f"SSH connect failed: {exc}"}))
        await ws.close(code=1011)
        return

    process: asyncssh.SSHClientProcess | None = None
    pump_out: asyncio.Task | None = None

    async def output_pump() -> None:
        assert process is not None
        while True:
            data = await process.stdout.read(8192)
            if not data:
                await ws.send_text(json.dumps({"type": "exit"}))
                return
            await ws.send_bytes(data.encode() if isinstance(data, str) else data)

    try:
        process = await conn.create_process(
            term_type="xterm-256color", term_size=(cols, rows)
        )
        pump_out = asyncio.create_task(output_pump())

        while True:
            message = await ws.receive()
            if message.get("type") == "websocket.disconnect":
                break
            text = message.get("text")
            data_bytes = message.get("bytes")
            if data_bytes is not None:
                process.stdin.write(data_bytes.decode("utf-8", errors="replace"))
            elif isinstance(text, str):
                payload = _json(text)
                if payload is None:
                    process.stdin.write(text)
                    continue
                kind = payload.get("type")
                if kind == "resize":
                    new_cols = int(payload.get("cols", cols))
                    new_rows = int(payload.get("rows", rows))
                    if 2 <= new_cols <= 1000 and 2 <= new_rows <= 1000:
                        cols, rows = new_cols, new_rows
                        with_suppress(lambda: process.change_term_size(cols, rows))
                elif kind == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}))
        await ws.send_text("")
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning("terminal session error for %s: %s", machine.endpoint, exc)
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
        except Exception:
            pass
    finally:
        if pump_out:
            pump_out.cancel()
            try:
                await pump_out
            except (asyncio.CancelledError, Exception):
                pass
        if process is not None:
            try:
                process.kill()
            except Exception:
                try:
                    process.channel.close()
                except Exception:
                    pass
        try:
            await ws.close()
        except Exception:
            pass


def with_suppress(fn) -> None:
    try:
        result = fn()
        if asyncio.iscoroutine(result):
            asyncio.get_running_loop().create_task(result)
    except Exception:
        pass
