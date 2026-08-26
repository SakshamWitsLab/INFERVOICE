from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="IV_", env_file=".env", extra="ignore")

    data_dir: Path = Path(os.path.expanduser("~/.infervoice"))
    host: str = "0.0.0.0"
    port: int = 8747
    cors_origins: list[str] = ["*"]
    poll_interval: float = 8.0
    connect_timeout: float = 6.0
    exec_timeout: float = 30.0
    sysinfo_timeout: float = 25.0
    health_concurrency: int = 16
    max_output_bytes: int = 262_144

    @property
    def db_path(self) -> Path:
        return self.data_dir / "infervoice.db"

    @property
    def key_dir(self) -> Path:
        return self.data_dir / "keys"

    @property
    def private_key_path(self) -> Path:
        return self.key_dir / "id_ed25519"

    @property
    def public_key_path(self) -> Path:
        return self.key_dir / "id_ed25519.pub"

    @property
    def fingerprints_path(self) -> Path:
        return self.data_dir / "host_fingerprints.json"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.key_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()


CONFIG = get_settings()
