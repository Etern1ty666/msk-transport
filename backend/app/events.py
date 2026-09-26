"""Шина событий: конвейер (работает в потоке) → WebSocket-подписчики (asyncio)."""
from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Any


class EventBus:
    def __init__(self, history: int = 1000) -> None:
        self._subs: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self.history: deque[dict] = deque(maxlen=history)

    def attach(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def publish(self, kind: str, **payload: Any) -> None:
        ev = {"kind": kind, "ts": time.time(), **payload}
        self.history.append(ev)
        if self._loop is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._fanout, ev)

    def _fanout(self, ev: dict) -> None:
        for q in list(self._subs):
            if q.full():
                q.get_nowait()
            q.put_nowait(ev)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)


bus = EventBus()
