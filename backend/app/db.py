from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from .config import CONFIG

engine = create_async_engine(
    f"sqlite+aiosqlite:///{CONFIG.db_path}",
    echo=False,
    connect_args={"timeout": 15},
)


async def init_db() -> None:
    CONFIG.ensure_dirs()
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        for stmt in (
            "ALTER TABLE machine ADD COLUMN models_root TEXT",
            "ALTER TABLE modeldownloadjob ADD COLUMN progress_pct FLOAT",
            "ALTER TABLE modeldownloadjob ADD COLUMN phase VARCHAR",
            "ALTER TABLE modeldownloadjob ADD COLUMN files_done INTEGER",
            "ALTER TABLE modeldownloadjob ADD COLUMN files_total INTEGER",
            "ALTER TABLE inferencetask ADD COLUMN progress_pct FLOAT",
            "ALTER TABLE inferencetask ADD COLUMN phase VARCHAR",
            "ALTER TABLE inferencetask ADD COLUMN log_text VARCHAR",
        ):
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass


async def get_session() -> AsyncSession:
    async with AsyncSession(engine, expire_on_commit=False) as session:
        yield session


async def get_setting(session: AsyncSession, key: str, default: str | None = None) -> str | None:
    from .models import Setting

    row = await session.get(Setting, key)
    return row.value if row else default


async def set_setting(session: AsyncSession, key: str, value: str) -> None:
    from .models import Setting

    row = await session.get(Setting, key)
    if row:
        row.value = value
    else:
        session.add(Setting(key=key, value=value))
    await session.commit()
