from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import asyncssh
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from .config import CONFIG
from .db import get_session
from .models import Machine, STATUS_AUTH_ERROR, STATUS_OFFLINE, STATUS_ONLINE, STATUS_UNKNOWN, Sysinfo
from .ssh_pool import AuthError, POOL, SSHError, ensure_keypair, run_cmd

log = logging.getLogger("infervoice.ops")


def classify_error(exc: Exception) -> tuple[str, str]:
    if isinstance(exc, AuthError):
        return STATUS_AUTH_ERROR, str(exc)
    if isinstance(exc, SSHError):
        return STATUS_OFFLINE, str(exc)
    msg = f"{type(exc).__name__}: {exc}"
    lowered = msg.lower()
    if "auth" in lowered or "denied" in lowered or "permission" in lowered:
        return STATUS_AUTH_ERROR, msg[:500]
    return STATUS_OFFLINE, msg[:500]


async def check_machine(session: AsyncSession, machine: Machine) -> None:
    try:
        conn = await POOL.get(machine.host, machine.port, machine.username)
    except Exception as exc:
        status, error = classify_error(exc)
        _mark(session, machine, status, error)
        return
    _mark(session, machine, STATUS_ONLINE, None)


async def refresh_machine(session: AsyncSession, machine: Machine) -> Sysinfo:
    try:
        conn = await POOL.get(machine.host, machine.port, machine.username)
        sysinfo = await collect_with_fallback(conn)
    except Exception as exc:
        status, error = classify_error(exc)
        _mark(session, machine, status, error)
        raise
    machine.set_specs(sysinfo.model_dump(mode="json"))
    _mark(session, machine, STATUS_ONLINE, None)
    return sysinfo


async def collect_with_fallback(conn):
    from .sysinfo import collect_sysinfo

    return await collect_sysinfo(conn)


def _mark(session: AsyncSession, machine: Machine, status: str, error: str | None) -> None:
    machine.status = status
    machine.error = error
    if status == STATUS_ONLINE:
        machine.last_seen_at = datetime.now(timezone.utc)
    session.add(machine)


async def install_key(session: AsyncSession, machine: Machine, password: str) -> dict:
    pub_key = ensure_keypair()
    try:
        conn = await asyncssh.connect(
            machine.host,
            port=machine.port,
            username=machine.username,
            password=password,
            known_hosts=None,
            login_timeout=CONFIG.connect_timeout,
            connect_timeout=CONFIG.connect_timeout,
        )
    except asyncssh.PermissionDenied as exc:
        raise PermissionError(f"password rejected for {machine.username}@{machine.host}") from exc
    except (OSError, asyncssh.Error) as exc:
        raise ConnectionError(f"cannot reach {machine.host}:{machine.port} — {exc}") from exc

    try:
        quoted = pub_key.replace("'", "'\\''")
        cmd = (
            "umask 077; mkdir -p \"$HOME/.ssh\"; "
            f"touch \"$HOME/.ssh/authorized_keys\"; "
            f"grep -qxF '{quoted}' \"$HOME/.ssh/authorized_keys\" || echo '{quoted}' >> \"$HOME/.ssh/authorized_keys\"; "
            "chmod 700 \"$HOME/.ssh\"; chmod 600 \"$HOME/.ssh/authorized_keys\""
        )
        res = await conn.run(cmd, check=True)
        log.info("installed control key on %s (exit %s)", machine.endpoint, res.exit_status)
    finally:
        conn.close()

    await POOL.invalidate(machine.host, machine.port, machine.username)
    try:
        sysinfo = await refresh_machine(session, machine)
    except Exception:
        sysinfo = None
    return {
        "installed": True,
        "public_key": pub_key,
        "specs": sysinfo.model_dump(mode="json") if sysinfo else None,
    }


class HealthLoop:
    def __init__(self, interval: float) -> None:
        self.interval = interval
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="health-loop")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("health tick failed")
            await asyncio.sleep(self.interval)

    async def tick(self) -> None:
        async for session in get_session():
            result = await session.exec(select(Machine))
            machines = list(result.all())
            if not machines:
                return
            sem = asyncio.Semaphore(CONFIG.health_concurrency)

            async def one(m: Machine) -> None:
                async with sem:
                    try:
                        await check_machine(session, m)
                    except Exception:
                        log.exception("health check failed for %s", m.endpoint)

            await asyncio.gather(*(one(m) for m in machines))
            await session.commit()


HEALTH_LOOP = HealthLoop(CONFIG.poll_interval)


def new_machine_from_create(name: str | None, host: str, port: int, username: str) -> Machine:
    return Machine(name=name or host, host=host.strip(), port=port, username=username.strip())
