from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    kwargs: dict = {"pool_size": 30, "max_overflow": 60, "pool_timeout": 10}
    if url.startswith("sqlite"):
        # busy timeout lets concurrent writers wait instead of failing with "database is locked"
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    eng = create_engine(url, pool_pre_ping=True, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(eng, "connect")
        def _set_sqlite_pragma(dbapi_connection, _):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

    return eng


engine = _make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema() -> None:
    """Create tables, then add columns introduced after a database was first created (lightweight migration).

    Production should use Alembic; this keeps existing pilot/demo databases working after upgrades.
    """
    from sqlalchemy import inspect, text

    Base.metadata.create_all(engine)
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = col.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {ddl}'))
        if engine.dialect.name == "postgresql":
            for c in ("lat", "lng"):
                conn.execute(text(f"ALTER TABLE locations ALTER COLUMN {c} DROP NOT NULL"))
        # rows created before the provenance columns existed came from the synthetic demo seed
        conn.execute(text("UPDATE locations SET verification = 'demo' WHERE verification IS NULL"))
        conn.execute(text("UPDATE video_analyses SET output_video = FALSE WHERE output_video IS NULL"))
