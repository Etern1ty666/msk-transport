"""ПОТОК (СПП) API — система прогнозирования пассажиропотока трамвайных маршрутов Москвы.

REST:  /api/*          — прогнозы, история, карта, модель, экспорт, конвейер, метрики
WS:    /ws/pipeline    — ход конвейера (стадии, прогресс, логи) в реальном времени
       /ws/live        — «живая» загрузка маршрутов по времени суток (симуляция дня по прогнозу)
       /ws/system      — метрики сервиса (RPS, p50/p95, CPU, RAM)
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from functools import lru_cache

import numpy as np
import psutil
from fastapi import FastAPI, Query as Q, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import orjson
from fastapi.responses import FileResponse, JSONResponse, Response

from app.events import bus
from app.ml import geo as G
from app import settings as SET
from app.ml.model import Coefficients
from app.pipeline import SUB_START, pipeline
from app.store import Query, QueryError, Store

class FastJSON(JSONResponse):
    """orjson-сериализация (в 3–5 раз быстрее стандартной, понимает numpy)."""

    def render(self, content) -> bytes:
        return orjson.dumps(content, option=orjson.OPT_SERIALIZE_NUMPY | orjson.OPT_NON_STR_KEYS)


STATE: dict = {"store": None}
PROC = psutil.Process(os.getpid())
LAT: deque = deque(maxlen=20000)  # (ts, path, ms, status)
STARTED = time.time()


def _on_ready(art) -> None:
    STATE["store"] = Store(art)
    _cached_forecast.cache_clear()
    _cached_geo.cache_clear()


pipeline.on_ready = _on_ready


@asynccontextmanager
async def lifespan(app: FastAPI):
    bus.attach(asyncio.get_running_loop())
    # первичная сборка: ~1–2 с на кэшированных агрегатах
    await asyncio.to_thread(pipeline.start, False, False)
    PROC.cpu_percent(None)
    yield


app = FastAPI(title="ПОТОК (СПП) — Система прогнозирования пассажиропотока", version="1.0.0", lifespan=lifespan,
              default_response_class=FastJSON)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def timing(request: Request, call_next):
    t0 = time.perf_counter()
    status = 500
    try:
        resp = await call_next(request)
        status = resp.status_code
        return resp
    finally:
        ms = (time.perf_counter() - t0) * 1000
        if request.url.path.startswith("/api"):
            LAT.append((time.time(), request.url.path, ms, status))


@app.exception_handler(QueryError)
async def query_error(_: Request, e: QueryError):
    return JSONResponse(status_code=400, content={"error": str(e)})


@app.exception_handler(Exception)
async def any_error(_: Request, e: Exception):
    return JSONResponse(status_code=500, content={"error": "Внутренняя ошибка сервиса", "detail": str(e)})


def store() -> Store:
    s = STATE["store"]
    if s is None:
        raise QueryError("Модель ещё собирается — повторите через несколько секунд")
    return s


def _routes(s: str | None) -> tuple[int, ...]:
    if not s or s == "all":
        return ()
    try:
        return tuple(sorted({int(x) for x in s.split(",") if x.strip()}))
    except ValueError as e:
        raise QueryError("route: список номеров через запятую, например 1,7,17") from e


def _coef(weather: float | None = None, event: float | None = None, season: float | None = None,
          trend: float | None = None, holiday: float | None = None) -> Coefficients:
    # не переданный коэффициент — из настроек, сохранённых на сервере (страница «Настройки»)
    saved = SET.get().coef
    weather, event, season, trend, holiday = (saved[k] if v is None else v for k, v in
                                              zip(("weather", "event", "season", "trend", "holiday"), (weather, event, season, trend, holiday)))
    for name, v, lo, hi in [("weather", weather, 0, 3), ("event", event, 0, 3), ("season", season, 0.3, 2),
                            ("trend", trend, 0, 3), ("holiday", holiday, 0, 3)]:
        if not lo <= v <= hi:
            raise QueryError(f"Коэффициент {name} должен быть в диапазоне {lo}…{hi}")
    return Coefficients(weather=weather, event=event, season=season, trend=trend, holiday=holiday)


@lru_cache(maxsize=4096)
def _cached_forecast(q: Query) -> dict:
    return store().forecast(q)


@lru_cache(maxsize=1)
def _cached_geo() -> dict:
    s = store()
    return {"routes": [s.geo[r] for r in sorted(s.geo)], "segments": s.art.geo_segments, "schema": s.art.geo_schema, "note": s.meta()["geo_note"],
            "all_routes": G.ALL_TRAM_ROUTES,
            "bounds": [[37.30, 55.53], [37.98, 55.95]]}


# ------------------------------------------------------------------ REST
@app.get("/api/health", tags=["service"])
async def health():
    return {"status": "ok" if STATE["store"] else "building", "uptime_s": round(time.time() - STARTED),
            "pipeline_running": pipeline.running}


@app.get("/api/meta", tags=["reference"], summary="Маршруты, горизонты, источники, статистика данных")
async def meta():
    return store().meta()


@app.get("/api/geo", tags=["reference"], summary="Линии маршрутов и остановки с весами")
async def geo():
    return _cached_geo()


def _query(horizon, date, month, date_from, date_to, route, stop_id, hour_from, hour_to, agg, by_route,
           weather, event, season, trend, holiday) -> Query:
    c = _coef(weather, event, season, trend, holiday)
    return Query(horizon=horizon, date=date, month=month, date_from=date_from, date_to=date_to,
                 routes=_routes(route), stop_id=stop_id, hour_from=hour_from, hour_to=hour_to, agg=agg,
                 by_route=by_route, coef=(c.weather, c.event, c.season, c.trend, c.holiday))


@app.get("/api/forecast", tags=["forecast"], summary="Прогноз с агрегацией по маршруту/остановке/интервалу")
async def forecast(
    horizon: str = Q("day", description="day | month | year"),
    date: str | None = Q(None, description="Дата для horizon=day, YYYY-MM-DD"),
    month: str | None = Q(None, description="Месяц для horizon=month, YYYY-MM"),
    date_from: str | None = None, date_to: str | None = None,
    route: str | None = Q(None, description="Маршруты через запятую или all"),
    stop_id: str | None = Q(None, description="ID остановки (из /api/geo)"),
    hour_from: int = 0, hour_to: int = 23,
    agg: str | None = Q(None, description="hour | day | month | hour_of_day | weekday"),
    by_route: bool = False,
    weather: float | None = None, event: float | None = None, season: float | None = None, trend: float | None = None, holiday: float | None = None,
):
    return _cached_forecast(_query(horizon, date, month, date_from, date_to, route, stop_id, hour_from, hour_to,
                                   agg, by_route, weather, event, season, trend, holiday))


@app.get("/api/forecast/export", tags=["forecast"], summary="Выгрузка прогноза в CSV / XLSX")
def export(
    format: str = "csv", horizon: str = "day", date: str | None = None, month: str | None = None,
    date_from: str | None = None, date_to: str | None = None, route: str | None = None,
    stop_id: str | None = None, hour_from: int = 0, hour_to: int = 23,
    agg: str | None = Q(None, description="hour | day | month | hour_of_day | weekday — как на графике"),
    by_route: bool = Q(False, description="Столбец на каждый маршрут"),
    weather: float | None = None, event: float | None = None, season: float | None = None, trend: float | None = None, holiday: float | None = None,
):
    q = _query(horizon, date, month, date_from, date_to, route, stop_id, hour_from, hour_to, agg, by_route,
               weather, event, season, trend, holiday)
    body, ctype, name = store().export(q, format)
    return Response(body, media_type=ctype, headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/history", tags=["forecast"], summary="Фактические посадки за январь–октябрь 2025")
def history(route: str | None = None, date_from: str | None = None, date_to: str | None = None, agg: str = "day"):
    return store().history(_routes(route), date_from, date_to, agg)


@app.get("/api/decompose", tags=["model"], summary="Разложение прогноза дня на компоненты")
def decompose(route: int, date: str = SUB_START, weather: float | None = None, event: float | None = None, season: float | None = None,
              trend: float | None = None, holiday: float | None = None):
    return store().decompose(route, date, _coef(weather, event, season, trend, holiday))


@app.get("/api/load", tags=["forecast"], summary="Снимок загрузки маршрутов на дату и час (для карты)")
async def load(date: str = SUB_START, hour: int = 8, weather: float | None = None, event: float | None = None, season: float | None = None,
         trend: float | None = None, holiday: float | None = None):
    return store().load_snapshot(date, hour, _coef(weather, event, season, trend, holiday))


@app.get("/api/day", tags=["forecast"], summary="Сутки целиком: посадки, вагоны, загрузка и дефицит по маршрутам × часам")
async def day(date: str = SUB_START, weather: float | None = None, event: float | None = None, season: float | None = None,
              trend: float | None = None, holiday: float | None = None):
    return store().day_view(date, _coef(weather, event, season, trend, holiday))


@app.get("/api/recommendations", tags=["forecast"], summary="Перегруженные часы и рекомендация по выпуску вагонов")
async def recommendations(date: str = SUB_START, min_ratio: float = 1.0, weather: float | None = None, event: float | None = None,
                    season: float | None = None, trend: float | None = None, holiday: float | None = None):
    return store().recommendations(date, _coef(weather, event, season, trend, holiday), min_ratio)


@app.get("/api/model", tags=["model"], summary="Внутренности модели: профили, множители, бэктест")
def model():
    return store().model_info()


@app.get("/api/backtest/hourly", tags=["model"])
def backtest_hourly(route: int | None = None):
    return store().backtest_hourly(route)


@app.get("/api/submission", tags=["forecast"], summary="submission.csv для платформы хакатона")
def submission():
    s = store()
    return FileResponse(s.art.submission_path, media_type="text/csv", filename="submission.csv")


@app.get("/api/settings", tags=["settings"], summary="Настройки сервиса: коэффициенты прогноза, норматив, пороги рекомендаций")
def get_settings():
    s = store()
    return {**SET.get().as_dict(), "defaults": SET.DEFAULTS.as_dict(), "coef_range": SET.COEF_RANGE, "limits": SET.LIMITS,
            "norm_base": {str(r): round(float(t), 1) for r, t in zip(s.routes, s.target_base)}}


@app.put("/api/settings", tags=["settings"], summary="Сохранить настройки — прогноз у всех пользователей считается с ними")
async def put_settings(request: Request):
    try:
        SET.save(await request.json())
    except SET.SettingsError as e:
        raise QueryError(str(e)) from e
    _cached_forecast.cache_clear()
    return get_settings()


@app.post("/api/settings/reset", tags=["settings"], summary="Вернуть настройки модели по умолчанию")
def reset_settings():
    SET.save(SET.DEFAULTS.as_dict())
    _cached_forecast.cache_clear()
    return get_settings()


@app.get("/api/pipeline", tags=["pipeline"], summary="Состояние конвейера и последние логи")
def pipeline_state():
    logs = [e for e in bus.history if e["kind"] == "log"][-300:]
    return {**pipeline.snapshot(), "logs": logs}


@app.post("/api/pipeline/run", tags=["pipeline"], summary="Перезапустить конвейер")
def pipeline_run(force_raw: bool = False):
    if not pipeline.start(force_raw=force_raw):
        return JSONResponse(status_code=409, content={"error": "Конвейер уже выполняется"})
    return {"started": True, "run_id": pipeline.run_id}


def system_metrics(window: float = 60.0) -> dict:
    now = time.time()
    recent = [x for x in list(LAT) if now - x[0] <= window]
    ms = np.array([x[2] for x in recent]) if recent else np.array([0.0])
    per_path: dict[str, list[float]] = {}
    for _, p, m, _ in recent:
        per_path.setdefault(p, []).append(m)
    mem = PROC.memory_info().rss / 2**20
    return {
        "ts": now, "uptime_s": round(now - STARTED),
        "rps": round(len(recent) / window, 2), "requests_60s": len(recent),
        "p50_ms": round(float(np.percentile(ms, 50)), 2), "p95_ms": round(float(np.percentile(ms, 95)), 2),
        "p99_ms": round(float(np.percentile(ms, 99)), 2),
        "errors_60s": sum(1 for x in recent if x[3] >= 500),
        "cpu_percent": PROC.cpu_percent(None), "rss_mb": round(mem, 1),
        "cache": _cached_forecast.cache_info()._asdict(),
        "endpoints": {p: {"n": len(v), "p95_ms": round(float(np.percentile(v, 95)), 2)} for p, v in per_path.items()},
    }


@app.get("/api/system", tags=["service"], summary="Метрики сервиса")
def system():
    return system_metrics()


# ------------------------------------------------------------------ WebSocket
@app.websocket("/ws/pipeline")
async def ws_pipeline(ws: WebSocket):
    await ws.accept()
    q = bus.subscribe()
    try:
        await ws.send_json({"kind": "snapshot", **pipeline.snapshot(),
                            "logs": [e for e in bus.history if e["kind"] == "log"][-300:]})
        while True:
            ev = await q.get()
            await ws.send_json(ev)
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(q)


@app.websocket("/ws/system")
async def ws_system(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            await ws.send_json(system_metrics())
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        pass


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    """Симуляция суток: сервер «прокручивает» время и шлёт загрузку маршрутов.

    Клиент может прислать {"date": "...", "speed": 1..20, "paused": bool, "minute": 0..1439, coef...}.
    """
    await ws.accept()
    ctl = {"date": SUB_START, "speed": 4.0, "paused": False, "minute": 5 * 60, "coef": {}}
    snaps: dict = {}

    async def reader():
        while True:
            msg = json.loads(await ws.receive_text())
            if "coef" in msg or "date" in msg:
                snaps.clear()
            ctl.update({k: v for k, v in msg.items() if k in ctl})

    task = asyncio.create_task(reader())
    try:
        while True:
            if task.done():
                break
            key = (ctl["date"], json.dumps(ctl["coef"], sort_keys=True))
            if key not in snaps:
                try:
                    c = Coefficients(**{**SET.get().coef, **{k: float(v) for k, v in ctl["coef"].items()}})
                    snaps.clear()
                    snaps[key] = [store().load_snapshot(ctl["date"], h, c) for h in range(24)]
                except QueryError as e:
                    await ws.send_json({"type": "error", "error": str(e)})
                    ctl["date"] = SUB_START
                    continue
            day = snaps[key]
            minute = int(ctl["minute"]) % 1440
            h, frac = divmod(minute, 60)
            a, b = day[h]["routes"], day[(h + 1) % 24]["routes"]
            f = frac / 60
            routes = []
            for ra, rb in zip(a, b):
                r = {k: v for k, v in ra.items() if k != "hourly"}
                r["boardings"] = round(ra["boardings"] * (1 - f) + rb["boardings"] * f)
                r["load_ratio"] = round(ra["load_ratio"] * (1 - f) + rb["load_ratio"] * f, 3)
                routes.append(r)
            await ws.send_json({"type": "tick", "date": ctl["date"], "minute": minute,
                                "time": f"{h:02d}:{frac:02d}", "hour": h, "routes": routes, "paused": ctl["paused"]})
            if not ctl["paused"]:
                ctl["minute"] = minute + 5
            await asyncio.sleep(max(0.05, 1.0 / float(ctl["speed"])))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        task.cancel()
