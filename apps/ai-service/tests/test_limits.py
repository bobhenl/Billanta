"""Unit tests for the in-memory webhook limits (app/pipeline/limits.py), on a fake clock."""

from __future__ import annotations

from app.pipeline.limits import SeenRecently, SlidingWindowLimiter


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_limiter_allows_up_to_the_limit_then_recovers():
    clock = Clock()
    limiter = SlidingWindowLimiter(2, 60, clock=clock)
    assert limiter.allow("a") and limiter.allow("a")
    assert not limiter.allow("a")
    assert limiter.allow("b")
    clock.now = 61
    assert limiter.allow("a")


def test_limiter_drops_least_recent_keys_past_the_cap():
    limiter = SlidingWindowLimiter(1, 60, max_keys=2, clock=Clock())
    assert limiter.allow("a")
    assert limiter.allow("b")
    assert limiter.allow("c")  # evicts "a"
    assert limiter.allow("a")
    assert not limiter.allow("c")


def test_seen_recently_reports_each_id_once_within_ttl():
    clock = Clock()
    seen = SeenRecently(600, clock=clock)
    assert seen.first_time("1")
    assert not seen.first_time("1")
    clock.now = 601
    assert seen.first_time("1")
