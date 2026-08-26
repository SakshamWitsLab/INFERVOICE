from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
from dataclasses import dataclass

import asyncssh

from .config import CONFIG

log = logging.getLogger("infervoice.ssh")


class SSHError(RuntimeError):
    pass


class HostKeyMismatch(SSHError):
    pass


class AuthError(SSHError):
    pass


def ensure_keypair() -> str:
    CONFIG.ensure_dirs()
    priv, pub = CONFIG.private_key_path, CONFIG.public_key_path
    if not priv.exists():
        key = asyncssh.generate_private_key("ssh-ed25519")
        key.write_private_key(str(priv))
        pub.write_bytes(key.export_public_key())
        priv.chmod(0o600)
        pub.chmod(0o644)
        log.info("generated control ssh keypair at %s", priv)
    return pub.read_text().strip()


def _fingerprint(key: asyncssh.SSHKey) -> str:
    der = key.export_public_key()
    return "sha256:" + base64.b64encode(hashlib.sha256(der).digest()).decode().rstrip("=")


def _load_fingerprints() -> dict[str, str]:
    try:
        return json.loads(CONFIG.fingerprints_path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_fingerprints(fp: dict[str, str]) -> None:
    CONFIG.fingerprints_path.write_text(json.dumps(fp, indent=2, sort_keys=True))


def check_host_fingerprint(host: str, port: int, conn: asyncssh.SSHClientConnection) -> str:
    server_key = conn.get_server_host_key()
    fp = _fingerprint(server_key)
    stored = _load_fingerprints()
    key_id = f"{host}:{port}"
    known = stored.get(key_id)
    if known is None:
        stored[key_id] = fp
        _save_fingerprints(stored)
        log.info("pinned host key for %s (%s)", key_id, fp[:20])
    elif known != fp:
        raise HostKeyMismatch(
            f"host key for {key_id} changed (was {known[:20]}..., now {fp[:20]}...). "
            "If this is expected, delete the entry in ~/.infervoice/host_fingerprints.json"
        )
    return fp


@dataclass(frozen=True)
class ConnKey:
    host: str
    port: int
    username: str


class SSHPool:
    def __init__(self) -> None:
        self._conns: dict[ConnKey, asyncssh.SSHClientConnection] = {}
        self._locks: dict[ConnKey, asyncio.Lock] = {}
        self._guard = asyncio.Lock()

    async def _get_lock(self, ck: ConnKey) -> asyncio.Lock:
        async with self._guard:
            if ck not in self._locks:
                self._locks[ck] = asyncio.Lock()
            return self._locks[ck]

    def peek(self, host: str, port: int, username: str) -> asyncssh.SSHClientConnection | None:
        return self._conns.get(ConnKey(host, port, username))

    async def get(self, host: str, port: int, username: str) -> asyncssh.SSHClientConnection:
        ck = ConnKey(host, port, username)
        conn = self._conns.get(ck)
        if conn is not None:
            try:
                await asyncio.wait_for(conn.run("true", check=True), timeout=3)
                return conn
            except Exception:
                await self.discard(ck)
        lock = await self._get_lock(ck)
        async with lock:
            conn = self._conns.get(ck)
            if conn is not None:
                return conn
            try:
                conn = await asyncio.wait_for(
                    asyncssh.connect(
                        host,
                        port=port,
                        username=username,
                        client_keys=[str(CONFIG.private_key_path)],
                        known_hosts=None,
                        login_timeout=CONFIG.connect_timeout,
                        connect_timeout=CONFIG.connect_timeout,
                    ),
                    timeout=CONFIG.connect_timeout + 2,
                )
            except asyncssh.PermissionDenied as exc:
                raise AuthError(
                    f"public key auth rejected by {host}. Install the control key first."
                ) from exc
            except (OSError, asyncssh.Error) as exc:
                raise SSHError(f"cannot reach {host}:{port} — {type(exc).__name__}: {exc}") from exc
            check_host_fingerprint(host, port, conn)
            self._conns[ck] = conn
            log.info("connected %s", ck)
            return conn

    async def discard(self, ck: ConnKey) -> None:
        conn = self._conns.pop(ck, None)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    async def invalidate(self, host: str, port: int, username: str) -> None:
        await self.discard(ConnKey(host, port, username))

    async def close_all(self) -> None:
        keys = list(self._conns)
        for ck in keys:
            await self.discard(ck)


POOL = SSHPool()


async def run_cmd(
    conn: asyncssh.SSHClientConnection,
    command: str,
    timeout: float | None = None,
    max_output: int | None = None,
) -> tuple[int | None, str, str]:
    limit = max_output or CONFIG.max_output_bytes

    async def _run():
        res = await conn.run(command, check=False)
        return res.exit_status, (res.stdout or "")[:limit], (res.stderr or "")[:limit]

    try:
        return await asyncio.wait_for(_run(), timeout=timeout or CONFIG.exec_timeout)
    except TimeoutError:
        return None, "", f"command timed out after {timeout or CONFIG.exec_timeout}s"
