"""WebSocket fan-out.

Single-instance implementation: an asyncio queue drained by a background task. Routers run in a
threadpool (sync SQLAlchemy), so `publish` is thread-safe via `call_soon_threadsafe`.

Scaling out: replace `publish` with a Redis PUBLISH and have each instance subscribe; the
subscriber feeds the same `_dispatch` function. The event contract is unchanged.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from fastapi import WebSocket

log = logging.getLogger("broadcaster")


@dataclass(eq=False)
class Client:
    ws: WebSocket
    user_id: int | None = None
    role: str = "anonymous"
    site_id: int | None = None
    family_ids: set[int] = field(default_factory=set)


class Broadcaster:
    def __init__(self) -> None:
        self._clients: set[Client] = set()
        self._queue: asyncio.Queue | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._task: asyncio.Task | None = None
        self.sent = 0

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue()
        self._task = asyncio.create_task(self._drain())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    # -- connections
    def add(self, client: Client) -> None:
        self._clients.add(client)

    def remove(self, client: Client) -> None:
        self._clients.discard(client)

    @property
    def connections(self) -> int:
        return len(self._clients)

    # -- publishing (thread-safe)
    def publish(
        self,
        event_type: str,
        data: dict,
        *,
        site_id: int | None = None,
        family_id: int | None = None,
        min_role: str | None = None,
        user_ids: set[int] | None = None,
    ) -> None:
        msg = {
            "type": event_type,
            "data": data,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        target = {"site_id": site_id, "family_id": family_id, "min_role": min_role, "user_ids": user_ids}
        if self._loop and self._queue:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, (msg, target))

    async def _drain(self) -> None:
        assert self._queue is not None
        while True:
            msg, target = await self._queue.get()
            await self._dispatch(msg, target)

    async def _dispatch(self, msg: dict, target: dict) -> None:
        from .deps import ROLE_RANK

        payload = json.dumps(msg)
        dead: list[Client] = []
        for c in list(self._clients):
            if target["site_id"] and c.site_id and c.site_id != target["site_id"]:
                continue
            if target["family_id"] is not None and target["family_id"] not in c.family_ids:
                continue
            if target["min_role"] and ROLE_RANK.get(c.role, -1) < ROLE_RANK[target["min_role"]]:
                continue
            if target["user_ids"] is not None and c.user_id not in target["user_ids"]:
                continue
            try:
                await c.ws.send_text(payload)
                self.sent += 1
            except Exception:  # noqa: BLE001 - any send failure means the socket is gone
                dead.append(c)
        for c in dead:
            self.remove(c)


broadcaster = Broadcaster()
