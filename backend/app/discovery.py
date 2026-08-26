from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from dataclasses import dataclass, field
from datetime import datetime, timezone

from zeroconf import ServiceStateChange, Zeroconf
from zeroconf.asyncio import AsyncServiceBrowser, AsyncZeroconf

log = logging.getLogger("infervoice.discovery")

MDNS_SSH_TYPE = "_ssh._tcp.local."


@dataclass
class DiscoveredHost:
    source: str
    host: str
    port: int = 22
    name: str | None = None
    seen_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class DiscoveryService:
    def __init__(self) -> None:
        self._mdns: dict[str, DiscoveredHost] = {}
        self._zc: AsyncZeroconf | None = None
        self._browser: AsyncServiceBrowser | None = None

    async def start(self) -> None:
        try:
            self._zc = AsyncZeroconf()
            self._browser = AsyncServiceBrowser(
                self._zc.zeroconf,
                MDNS_SSH_TYPE,
                [self._on_state_change],
            )
            log.info("mDNS browser started for %s", MDNS_SSH_TYPE)
        except OSError as exc:
            log.warning("mDNS unavailable: %s", exc)
            self._zc = None

    async def stop(self) -> None:
        try:
            if self._browser:
                await self._browser.async_cancel()
        except Exception:
            pass
        if self._zc:
            await self._zc.async_close()
        self._zc = None
        self._browser = None

    def _on_state_change(
        self, zeroconf: Zeroconf, service_type: str, name: str, state_change: ServiceStateChange
    ) -> None:
        if state_change is ServiceStateChange.Removed:
            self._mdns.pop(name, None)
            return
        asyncio.get_running_loop().create_task(self._resolve(name))

    async def _resolve(self, name: str) -> None:
        from zeroconf import IPVersion

        if self._zc is None:
            return
        try:
            info = await self._zc.async_request(service_type=name, timeout=1500)
        except Exception as exc:
            log.warning("mDNS resolve failed for %s: %s", name, exc)
            return
        if info is None or not info.addresses:
            return
        addr = None
        for a in info.parsed_addresses(IPVersion.V4Only):
            addr = a
            break
        if not addr:
            return
        friendly = name.split(".", 1)[0].replace("\\032", " ").replace(r"\032", " ")
        self._mdns[name] = DiscoveredHost(
            source="mdns", host=addr, port=info.port or 22, name=friendly.rstrip(".")
        )

    def mdns_hosts(self) -> list[DiscoveredHost]:
        return sorted(self._mdns.values(), key=lambda h: (h.name or "", h.host))

    async def subnet_scan(self, timeout_per_host: float = 0.35) -> list[DiscoveredHost]:
        local_ip = _local_ip()
        if not local_ip:
            return []
        net = ipaddress.ip_network(f"{local_ip}/24", strict=False)
        candidates = [str(h) for h in net.hosts()]
        sem = asyncio.Semaphore(128)

        async def probe(ip: str) -> str | None:
            async with sem:
                try:
                    fut = asyncio.open_connection(ip, 22)
                    reader, writer = await asyncio.wait_for(fut, timeout=timeout_per_host)
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except Exception:
                        pass
                    return ip
                except (OSError, TimeoutError, asyncio.TimeoutError):
                    return None

        results = await asyncio.gather(*(probe(ip) for ip in candidates))
        found = [ip for ip in results if ip]
        log.info("subnet scan on %s: %d hosts with :22 open", net, len(found))
        return [DiscoveredHost(source="subnet", host=ip) for ip in sorted(found, key=ipaddress.ip_address)]


def _local_ip() -> str | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


DISCOVERY = DiscoveryService()
