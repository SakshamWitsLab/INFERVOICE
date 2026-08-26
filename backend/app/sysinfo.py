from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timezone

import asyncssh

from .models import StorageVolume, Sysinfo
from .ssh_pool import run_cmd


def _parse_int(value: str | None) -> int | None:
    if not value:
        return None
    m = re.search(r"\d+", value)
    return int(m.group()) if m else None


def _parse_memory_gb(value: str | None) -> float | None:
    if not value:
        return None
    m = re.match(r"([\d.]+)\s*(GB|TB|MB)", value.strip(), re.IGNORECASE)
    if not m:
        return None
    num = float(m.group(1))
    unit = m.group(2).upper()
    factor = {"TB": 1024.0, "GB": 1.0, "MB": 1 / 1024}[unit]
    return round(num * factor, 1)


def _parse_cores(raw: str | None) -> tuple[int | None, int | None, int | None]:
    if not raw:
        return None, None, None
    m = re.search(r"proc\s+(\d+)(?::(\d+):(\d+))?", raw)
    if not m:
        total = _parse_int(raw)
        return total, None, None
    total = int(m.group(1))
    perf = int(m.group(2)) if m.group(2) else None
    effi = int(m.group(3)) if m.group(3) else None
    return total, perf, effi


async def _hardware(conn: asyncssh.SSHClientConnection) -> dict:
    code, out, err = await run_cmd(
        conn, "/usr/sbin/system_profiler SPHardwareDataType -json", timeout=20
    )
    if code != 0 or not out.strip():
        raise RuntimeError(f"system_profiler failed ({code}): {err[:200]}")
    data = json.loads(out)
    items = (data.get("SPHardwareDataType") or [{}])
    item = items[0] if items else {}
    cores_total, cores_perf, cores_eff = _parse_cores(item.get("number_processors"))
    return {
        "computer_name": item.get("machine_name"),
        "model_name": item.get("machine_name"),
        "model": item.get("machine_model") or item.get("machine_name"),
        "identifier": item.get("machine_model"),
        "chip": item.get("chip_type") or item.get("processor_name"),
        "cores_total": cores_total,
        "cores_performance": cores_perf,
        "cores_efficiency": cores_eff,
        "memory_gb": _parse_memory_gb(item.get("physical_memory")),
        "serial": item.get("serial_number"),
    }


async def _os_version(conn: asyncssh.SSHClientConnection) -> dict:
    _, out, _ = await run_cmd(conn, "sw_vers && echo '---' && scutil --get ComputerName")
    os_name = os_ver = build = None
    computer_name = None
    for line in out.splitlines():
        if line.startswith("ProductName:"):
            os_name = line.split(":", 1)[1].strip()
        elif line.startswith("ProductVersion:"):
            os_ver = line.split(":", 1)[1].strip()
        elif line.startswith("BuildVersion:"):
            build = line.split(":", 1)[1].strip()
        elif "---" in line:
            continue
        else:
            computer_name = line.strip() or computer_name
    return {"os_name": os_name, "os_version": os_ver, "os_build": build, "computer_name": computer_name}


_DF_RE = re.compile(
    r"^(?P<fs>\S+)\s+(?P<blocks>\d+)\s+(?P<used>\d+)\s+(?P<avail>\d+)\s+(?P<pct>\d+)%\s+(?P<mount>.+)$",
    re.MULTILINE,
)


async def _storage(conn: asyncssh.SSHClientConnection) -> list[StorageVolume]:
    _, out, _ = await run_cmd(conn, "/bin/df -k /System/Volumes/Data / 2>/dev/null")
    volumes: dict[str, StorageVolume] = {}
    for m in _DF_RE.finditer(out):
        mount = m.group("mount").strip()
        if mount == "/":
            continue
        total_kb, used_kb, avail_kb = int(m.group("blocks")), int(m.group("used")), int(m.group("avail"))
        gb = 1024 * 1024
        volumes[mount] = StorageVolume(
            mount=mount,
            total_gb=round(total_kb / gb, 1),
            used_gb=round(used_kb / gb, 1),
            free_gb=round(avail_kb / gb, 1),
            pct_used=round(used_kb / max(total_kb, 1) * 100, 1),
        )
    ordered = sorted(volumes.values(), key=lambda v: v.mount)
    preferred = [v for v in ordered if v.mount == "/System/Volumes/Data"]
    rest = [v for v in ordered if v.mount != "/System/Volumes/Data"]
    volumes_list = preferred + rest
    if volumes_list:
        total = max(v.total_gb for v in volumes_list)
        used = sum(v.used_gb for v in volumes_list)
        free = max(0.0, total - used)
        summary = {
            "disk_total_gb": round(total, 1),
            "disk_used_gb": round(used, 1),
            "disk_free_gb": round(free, 1),
            "disk_pct_used": round(used / max(total, 0.001) * 100, 1),
        }
    else:
        summary = {}
    return volumes_list, summary


async def _uptime_load(conn: asyncssh.SSHClientConnection) -> dict:
    _, out, _ = await run_cmd(
        conn, "/usr/sbin/sysctl -n kern.boottime vm.loadavg"
    )
    uptime_seconds = None
    load_avg = None
    boot_m = re.search(r"sec\s*=\s*(\d+)", out)
    if boot_m:
        uptime_seconds = max(0, int(time.time()) - int(boot_m.group(1)))
    load_m = re.search(r"\{\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\}", out)
    if load_m:
        load_avg = (float(load_m.group(1)), float(load_m.group(2)), float(load_m.group(3)))
    return {"uptime_seconds": uptime_seconds, "load_avg": load_avg}


async def collect_sysinfo(conn: asyncssh.SSHClientConnection) -> Sysinfo:
    hardware_task = asyncio.create_task(_hardware(conn))
    os_task = asyncio.create_task(_os_version(conn))
    storage_task = asyncio.create_task(_storage(conn))
    uptime_task = asyncio.create_task(_uptime_load(conn))

    results = await asyncio.gather(
        hardware_task, os_task, storage_task, uptime_task, return_exceptions=True
    )
    hardware, osinfo, storage, uptimeload = results

    merged: dict = {"collected_at": datetime.now(timezone.utc)}
    errors = []
    for label, res in (
        ("hardware", hardware),
        ("os", osinfo),
        ("storage", storage),
        ("uptime/load", uptimeload),
    ):
        if isinstance(res, BaseException):
            errors.append(f"{label}: {type(res).__name__}: {res}")
        elif isinstance(res, tuple):
            merged["storage"] = res[0]
            merged.update(res[1])
        elif isinstance(res, dict):
            merged.update(res)
    if isinstance(hardware, BaseException):
        raise RuntimeError(f"critical collector failed — {errors}")
    merged["_warnings"] = errors
    payload = {k: v for k, v in merged.items() if k != "_warnings"} 
    sysinfo = Sysinfo(**payload)
    return sysinfo


def fmt_uptime(seconds: int | None) -> str:
    if seconds is None:
        return "—"
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    mins = rem // 60
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    parts.append(f"{mins}m")
    return " ".join(parts)
