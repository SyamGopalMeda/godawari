"""Tiny in-process TTL cache for hot read endpoints.

Keys are namespaced ("crowd:", "parking:", ...) so writers can invalidate a whole namespace.
In a multi-instance deployment replace with Redis (same get/set/invalidate contract) or keep this
per-instance cache with a short TTL: the WebSocket deltas keep clients current in between.
"""
from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

_lock = threading.Lock()
_store: dict[str, tuple[float, Any]] = {}
stats = {"hits": 0, "misses": 0}


def get_or_set(key: str, ttl: float, fn: Callable[[], Any]) -> Any:
    now = time.time()
    with _lock:
        hit = _store.get(key)
        if hit and hit[0] > now:
            stats["hits"] += 1
            return hit[1]
    value = fn()
    with _lock:
        _store[key] = (now + ttl, value)
        stats["misses"] += 1
    return value


def invalidate(prefix: str) -> None:
    with _lock:
        for k in [k for k in _store if k.startswith(prefix)]:
            del _store[k]


def clear() -> None:
    with _lock:
        _store.clear()
