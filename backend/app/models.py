from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlmodel import Field, SQLModel


class Machine(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    name: str = Field(index=True)
    host: str = Field(index=True)
    port: int = Field(default=22)
    username: str
    status: str = Field(default="unknown", index=True)
    error: Optional[str] = Field(default=None, max_length=500)
    specs_json: Optional[str] = None
    models_root: Optional[str] = None
    last_seen_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def endpoint(self) -> str:
        return f"{self.username}@{self.host}:{self.port}"

    def specs(self) -> dict[str, Any] | None:
        if not self.specs_json:
            return None
        try:
            return json.loads(self.specs_json)
        except json.JSONDecodeError:
            return None

    def set_specs(self, specs: dict[str, Any]) -> None:
        self.specs_json = json.dumps(specs)


STATUS_UNKNOWN = "unknown"


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
STATUS_ONLINE = "online"
STATUS_OFFLINE = "offline"
STATUS_AUTH_ERROR = "auth_error"


class ModelDownloadJob(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    machine_id: str = Field(index=True)
    machine_name: str
    nim_id: str
    hf_repo: str
    target_dir: str
    log_path: str
    remote_pid: Optional[int] = None
    status: str = Field(default="queued", index=True)
    error: Optional[str] = Field(default=None, max_length=500)
    progress_pct: Optional[float] = None
    phase: Optional[str] = None
    files_done: Optional[int] = None
    files_total: Optional[int] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class InferenceRun(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    model_id: str = Field(index=True)
    task_type: str = Field(default="stt")
    delivery: str = Field(default="download")
    audio_path: str
    audio_name: str
    audio_duration: Optional[float] = None
    text_input: Optional[str] = None
    status: str = Field(default="running", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class InferenceTask(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    run_id: str = Field(default_factory=lambda: uuid4().hex, index=True)
    machine_id: str
    machine_name: str
    nim_id: str
    task_type: str = Field(default="stt")
    delivery: str = Field(default="download")
    status: str = Field(default="queued", index=True)
    transcript: Optional[str] = None
    audio_out: Optional[str] = None
    error: Optional[str] = Field(default=None, max_length=500)
    wall_ms: Optional[int] = None
    progress_pct: Optional[float] = None
    phase: Optional[str] = None
    log_text: Optional[str] = Field(default=None, max_length=20000)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StorageVolume(BaseModel):
    mount: str
    total_gb: float
    used_gb: float
    free_gb: float
    pct_used: float


class Sysinfo(BaseModel):
    computer_name: str | None = None
    model_name: str | None = None
    model: str | None = None
    identifier: str | None = None
    chip: str | None = None
    cores_total: int | None = None
    cores_performance: int | None = None
    cores_efficiency: int | None = None
    memory_gb: float | None = None
    serial: str | None = None
    os_name: str | None = None
    os_version: str | None = None
    os_build: str | None = None
    uptime_seconds: int | None = None
    load_avg: tuple[float, float, float] | None = None
    storage: list[StorageVolume] = Field(default_factory=list)
    disk_total_gb: float | None = None
    disk_used_gb: float | None = None
    disk_free_gb: float | None = None
    disk_pct_used: float | None = None
    collected_at: datetime


class MachineOut(BaseModel):
    id: str
    name: str
    host: str
    port: int
    username: str
    status: str
    error: str | None
    specs: Sysinfo | None
    models_root: str | None = None
    last_seen_at: datetime | None
    created_at: datetime


class MachineCreate(BaseModel):
    name: str | None = None
    host: str
    port: int = Field(default=22, ge=1, le=65535)
    username: str


class MachineUpdate(BaseModel):
    name: str | None = None
    models_root: str | None = None
    host: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)


class ExecIn(BaseModel):
    command: str = Field(min_length=1, max_length=4096)


class ExecOut(BaseModel):
    exit_code: int | None
    stdout: str
    stderr: str
    duration_ms: int


class InstallKeyIn(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


StatusLiteral = Literal["unknown", "online", "offline", "auth_error"]
