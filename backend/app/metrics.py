from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timezone

import asyncssh
from pydantic import BaseModel

from .models import Machine
from .ssh_pool import POOL

log = logging.getLogger("infervoice.metrics")

SAMPLE_SCRIPT = r"""
echo '@@CPU'
/usr/bin/top -l 2 -n 0 -s 1 2>/dev/null | /usr/bin/grep '^CPU usage' | /usr/bin/tail -1
echo '@@MEM'
/usr/bin/vm_stat 2>/dev/null
/usr/sbin/sysctl -n hw.memsize
echo '@@NET'
/usr/sbin/netstat -ib 2>/dev/null
"""


class MetricSample(BaseModel):
    ts: datetime
    cpu_pct: float
    mem_pct: float
    mem_used_gb: float
    mem_total_gb: float
    net_rx_kbps: float | None = None
    net_tx_kbps: float | None = None


_CPU_RE = re.compile(
    r"([\d.]+)%\s+user,\s*([\d.]+)%\s+sys,\s*([\d.]+)%\s+idle", re.IGNORECASE
)
_PAGE_RE = re.compile(r"(Pages free|Pages active|Pages inactive|Pages speculative|Pages wired down|Pages occupied by compressor):\s+(\d+)")
_PAGE_SIZE_RE = re.compile(r"page size of (\d+) bytes")
_LINK_RE = re.compile(r"^(en|bridge|bond|ap)\d*$")


def _parse_cpu(block: str) -> float | None:
    m = _CPU_RE.search(block)
    if not m:
        return None
    return round(float(m.group(1)) + float(m.group(2)), 1)


def _parse_mem(block: str) -> tuple[float, float, float] | None:
    pages: dict[str, int] = {}
    for m in _PAGE_RE.finditer(block):
        pages[m.group(1)] = int(m.group(2))
    size_match = _PAGE_SIZE_RE.search(block)
    page_size = int(size_match.group(1)) if size_match else 16384
    total_bytes = None
    for line in reversed(block.strip().splitlines()):
        if re.fullmatch(r"\d{6,}", line.strip()):
            total_bytes = int(line.strip())
            break
    if not pages or not total_bytes or total_bytes <= 0:
        return None
    used_pages = (
        pages.get("Pages active", 0)
        + pages.get("Pages wired down", 0)
        + pages.get("Pages occupied by compressor", 0)
    )
    total_pages = total_bytes // page_size
    pct = min(100.0, used_pages / max(total_pages, 1) * 100)
    used_gb = round(used_pages * page_size / 1024**3, 2)
    total_gb = round(total_bytes / 1024**3, 1)
    return round(pct, 1), used_gb, total_gb


def _parse_net(block: str) -> tuple[int, int]:
    rx = tx = 0
    for line in block.splitlines():
        if "<Link#" not in line:
            continue
        fields = line.split()
        if len(fields) < 10 or not _LINK_RE.match(fields[0]):            continue
        try:
            rx += int(fields[6])
            tx += int(fields[9])
        except (ValueError, IndexError):
            continue
    return rx, tx


class MetricsCache:
    def __init__(self) -> None:
        self._last: dict[str, tuple[float, int, int]] = {}

    def rates(self, machine_id: str, now: float, rx: int, tx: int) -> tuple[float | None, float | None]:
        prev = self._last.get(machine_id)
        self._last[machine_id] = (now, rx, tx)
        if prev is None:
            return None, None
        dt = now - prev[0]
        if dt <= 0 or dt > 10:
            return None, None
        rx_kbps = max(0.0, (rx - prev[1]) / dt / 1024)
        tx_kbps = max(0.0, (tx - prev[2]) / dt / 1024)
        return round(rx_kbps, 1), round(tx_kbps, 1)


CACHE = MetricsCache()


async def sample_metrics(conn: asyncssh.SSHClientConnection, machine_id: str) -> MetricSample:
    try:
        res = await asyncio.wait_for(conn.run(SAMPLE_SCRIPT, check=False), timeout=9)
    except asyncio.TimeoutError as exc:
        raise RuntimeError("metric sampling timed out") from exc
    out = res.stdout or ""

    sections: dict[str, list[str]] = {}
    current = None
    for line in out.splitlines():
        if line.startswith("@@"):
            current = line[2:].strip()
            sections[current] = []
        elif current:
            sections[current].append(line)

    cpu_block = "\n".join(sections.get("CPU", []))
    mem_block = "\n".join(sections.get("MEM", []))
    net_block = "\n".join(sections.get("NET", []))

    cpu_pct = _parse_cpu(cpu_block)
    mem_parsed = _parse_mem(mem_block)
    rx_bytes, tx_bytes = _parse_net(net_block)

    errors = []
    if cpu_pct is None:
        errors.append("cpu")
        cpu_pct = 0.0
    if mem_parsed is None:
        errors.append("mem")
        mem_pct, mem_used_gb, mem_total_gb = 0.0, 0.0, 0.0
    else:
        mem_pct, mem_used_gb, mem_total_gb = mem_parsed

    rx_kbps, tx_kbps = CACHE.rates(machine_id, time.monotonic(), rx_bytes, tx_bytes)

    if errors:
        log.debug("metric parse gaps for %s: %s", machine_id, errors)

    return MetricSample(
        ts=datetime.now(timezone.utc),
        cpu_pct=cpu_pct,
        mem_pct=mem_pct,
        mem_used_gb=mem_used_gb,
        mem_total_gb=mem_total_gb,
        net_rx_kbps=rx_kbps,
        net_tx_kbps=tx_kbps,
    )


class FleetEntry(BaseModel):
    machine_id: str
    name: str
    status: str
    disk_pct: float | None = None
    sample: MetricSample | None = None


async def _sample_one(m: Machine, sem: asyncio.Semaphore) -> FleetEntry:
    async with sem:
        specs = m.specs()
        disk_pct = specs.get("disk_pct_used") if specs else None
        try:
            conn = await POOL.get(m.host, m.port, m.username)
            sample = await asyncio.wait_for(sample_metrics(conn, m.id), timeout=12)
            return FleetEntry(
                machine_id=m.id, name=m.name, status=m.status,
                disk_pct=disk_pct, sample=sample,
            )
        except Exception as exc:
            log.debug("fleet sample failed for %s: %s", m.endpoint, exc)
            return FleetEntry(
                machine_id=m.id, name=m.name, status=m.status,
                disk_pct=disk_pct, sample=None,
            )


async def sample_fleet(machines: list[Machine], max_concurrency: int = 8) -> list[FleetEntry]:
    sem = asyncio.Semaphore(max_concurrency)
    return list(await asyncio.gather(*(_sample_one(m, sem) for m in machines)))
