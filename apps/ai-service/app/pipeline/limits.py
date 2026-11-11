"""In-memory abuse limits for the webhooks.

The service runs as one uvicorn process (Dockerfile CMD, no workers), so
process memory is shared by every request, and a restart resetting the
counters only ever lets a little more through. Same approach as the
backend's guest limits (apps/backend/src/guest-invoices/guest-limits.ts).
"""

from __future__ import annotations

import time
from collections import OrderedDict, deque
from typing import Callable


class SlidingWindowLimiter:
    """At most `limit` hits per key within `window_seconds`.

    Past `max_keys`, the least recently used keys are dropped one by one, so
    flooding it with new senders can't wipe everyone else's counters.
    """

    def __init__(
        self,
        limit: int,
        window_seconds: float,
        *,
        max_keys: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.limit = limit
        self.window = window_seconds
        self.max_keys = max_keys
        self._clock = clock
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()

    def allow(self, key: str) -> bool:
        now = self._clock()
        hits = self._hits.pop(key, None) or deque()
        while hits and hits[0] <= now - self.window:
            hits.popleft()
        allowed = len(hits) < self.limit
        if allowed:
            hits.append(now)
        self._hits[key] = hits
        while len(self._hits) > self.max_keys:
            self._hits.popitem(last=False)
        return allowed


class SeenRecently:
    """Remembers ids for `ttl_seconds`; `first_time(id)` is True once per id."""

    def __init__(
        self,
        ttl_seconds: float,
        *,
        max_ids: int = 50_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.ttl = ttl_seconds
        self.max_ids = max_ids
        self._clock = clock
        self._seen: OrderedDict[str, float] = OrderedDict()

    def first_time(self, key: str) -> bool:
        now = self._clock()
        while self._seen:
            oldest_key, at = next(iter(self._seen.items()))
            if at > now - self.ttl and len(self._seen) < self.max_ids:
                break
            self._seen.pop(oldest_key)
        if key in self._seen:
            return False
        self._seen[key] = now
        return True
