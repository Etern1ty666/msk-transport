"""Нагрузочный тест API: смесь реальных запросов дашборда со случайными параметрами.

    python scripts/loadtest.py --url http://localhost:8000 --duration 30 --concurrency 64
Случайные коэффициенты делают бóльшую часть запросов промахами кэша (честная оценка).
"""
from __future__ import annotations

import argparse
import asyncio
import random
import time

import httpx
import numpy as np

ROUTES = [1, 7, 11, 12, 17, 25, 26, 28, 50]


def rand_date() -> str:
    d = np.datetime64("2025-11-01") + np.timedelta64(random.randint(0, 60), "D")
    return str(d)


def make_request(cache_friendly: float) -> str:
    k = random.random()
    w = 1.0 if random.random() < cache_friendly else round(random.uniform(0.5, 1.5), 2)
    if k < 0.45:
        return f"/api/forecast?horizon=day&date={rand_date()}&route={random.choice(ROUTES)}&weather={w}"
    if k < 0.65:
        return f"/api/forecast?horizon=month&month={random.choice(['2025-11', '2025-12'])}&by_route=true&event={w}"
    if k < 0.75:
        return f"/api/forecast?horizon=year&route={random.choice(ROUTES)}&season={w}"
    if k < 0.9:
        return f"/api/load?date={rand_date()}&hour={random.randint(5, 23)}&weather={w}"
    return f"/api/recommendations?date={rand_date()}&trend={w}"


async def main(url: str, duration: float, conc: int, cache_friendly: float) -> None:
    lat: list[float] = []
    codes: dict[int, int] = {}
    stop = time.perf_counter() + duration
    limits = httpx.Limits(max_connections=conc, max_keepalive_connections=conc)
    async with httpx.AsyncClient(base_url=url, limits=limits, timeout=10) as c:
        async def worker():
            while time.perf_counter() < stop:
                t = time.perf_counter()
                try:
                    r = await c.get(make_request(cache_friendly))
                    codes[r.status_code] = codes.get(r.status_code, 0) + 1
                except httpx.HTTPError:
                    codes[0] = codes.get(0, 0) + 1
                lat.append((time.perf_counter() - t) * 1000)
        t0 = time.perf_counter()
        await asyncio.gather(*[worker() for _ in range(conc)])
        el = time.perf_counter() - t0
    a = np.array(lat)
    print(f"concurrency={conc} duration={el:.1f}s requests={len(a)} codes={codes}")
    print(f"RPS={len(a) / el:.0f}  p50={np.percentile(a, 50):.1f}ms  p95={np.percentile(a, 95):.1f}ms  "
          f"p99={np.percentile(a, 99):.1f}ms  max={a.max():.1f}ms")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--duration", type=float, default=30)
    ap.add_argument("--concurrency", type=int, default=64)
    ap.add_argument("--cache-friendly", type=float, default=0.3, help="доля запросов с коэффициентами по умолчанию")
    a = ap.parse_args()
    asyncio.run(main(a.url, a.duration, a.concurrency, a.cache_friendly))
