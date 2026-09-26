"""Конвейер: приём → нормализация → внешние данные → геопривязка → признаки → бэктест → обучение → прогноз → экспорт.

Каждая стадия публикует события (старт, прогресс, лог, метрики) в шину → WebSocket /ws/pipeline.
"""
from __future__ import annotations

import threading
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
import psutil

from app.config import DATA_DIR, DATASET_DIR
from app.events import bus
from app.ml import calendar as C
from app.ml import geo as G
from app.ml import weather as W
from app.ml.model import ROUTES, Coefficients, ModelParams, ProfileModel, full_grid, wape_score

HIST_START, HIST_END = "2025-01-01", "2025-10-31"
ORIGIN = pd.Timestamp(HIST_END)
SUB_START, SUB_END = "2025-11-01", "2025-12-31"
FC_START, FC_END = "2025-11-01", "2026-10-31"  # горизонт «год» — 12 месяцев от точки прогноза
BACKTEST_FOLDS = [
    ("2025-10-15", "2025-10-16", "2025-10-31", "2 недели: вторая половина октября"),
    ("2025-09-30", "2025-10-01", "2025-10-31", "1 месяц: октябрь"),
    ("2025-09-14", "2025-09-15", "2025-10-31", "1,5 месяца: сер. сентября – октябрь"),
    ("2025-03-31", "2025-04-01", "2025-05-31", "2 месяца: апрель–май (майские праздники)"),
    ("2025-02-28", "2025-03-01", "2025-04-30", "2 месяца: март–апрель"),
]
ABLATIONS = {
    "Полная модель": {},
    "Без погоды": {"use_weather": False},
    "Без календаря": {"use_calendar": False},
    "Без тренда": {"use_trend": False},
}
# подобрано на бэктесте (5 окон): тренд по последней неделе, погода — только сильные осадки
PARAMS = ModelParams(lookback_days=28, trend_alpha=1.0, trend_days=7, weather_heavy_only=True, weather_shrink=0.5)

STAGES = [
    ("ingest", "Приём сырых валидаций", "DuckDB читает train.csv + test.csv (≈10 ГБ) и сворачивает в маршрут × дата × час"),
    ("normalize", "Нормализация", "Полная сетка 10 маршрутов × 304 дня × 24 часа, нули в пропусках, сверка с labels"),
    ("external", "Внешние данные", "Производственный календарь РФ, школьные каникулы Москвы, погода Open-Meteo"),
    ("geo", "Геопривязка", "Остановки из справочников + линии OpenStreetMap, веса остановок"),
    ("features", "Признаки", "Профили маршрут × тип дня × час, выпуск ТС, погодные корзины"),
    ("backtest", "Бэктест", "Скользящее окно: 5 периодов × 4 варианта модели, WAPE-score"),
    ("train", "Обучение", "Финальная модель на 28 днях до 31.10.2025"),
    ("forecast", "Прогноз", "Горизонты день / месяц / год, компоненты прогноза"),
    ("export", "Экспорт", "submission.csv (14 640 строк) и артефакты модели"),
]


@dataclass
class Artifacts:
    hist: pd.DataFrame | None = None           # route, date, hour, y
    raw: pd.DataFrame | None = None            # сырые агрегаты (vehicles, failures, cards…)
    weather_hourly: pd.DataFrame | None = None
    weather_daily: pd.DataFrame | None = None
    geo: dict = field(default_factory=dict)
    geo_segments: list = field(default_factory=list)
    geo_schema: dict = field(default_factory=dict)
    vehicles: pd.DataFrame | None = None       # route, day_class, hour, vehicles
    bpv_target: dict = field(default_factory=dict)
    model: ProfileModel | None = None
    forecast: pd.DataFrame | None = None       # компоненты прогноза на FC_START..FC_END
    backtest: dict = field(default_factory=dict)
    stats: dict = field(default_factory=dict)
    submission_path: str | None = None
    built_at: float = 0.0


class Pipeline:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.running = False
        self.state = {k: {"key": k, "title": t, "desc": d, "status": "pending", "progress": 0.0,
                          "started": None, "finished": None, "duration": None, "message": "", "metrics": {}}
                      for k, t, d in STAGES}
        self.run_id = 0
        self.on_ready: Callable[[Artifacts], None] | None = None

    # ---------- события ----------
    def _stage(self, key: str, **upd) -> None:
        self.state[key].update(upd)
        bus.publish("stage", run_id=self.run_id, stage=self.state[key])

    def log(self, stage: str, msg: str, level: str = "info") -> None:
        bus.publish("log", run_id=self.run_id, stage=stage, level=level, message=msg)

    def progress(self, stage: str, p: float, msg: str = "") -> None:
        self._stage(stage, progress=round(min(max(p, 0.0), 1.0), 3), message=msg or self.state[stage]["message"])

    def snapshot(self) -> dict:
        return {"run_id": self.run_id, "running": self.running, "stages": list(self.state.values())}

    # ---------- запуск ----------
    def start(self, force_raw: bool = False, background: bool = True) -> bool:
        if not self.lock.acquire(blocking=False):
            return False
        self.running = True
        self.run_id += 1
        for s in self.state.values():
            s.update(status="pending", progress=0.0, started=None, finished=None, duration=None, message="", metrics={})
        bus.publish("run", run_id=self.run_id, status="started", snapshot=self.snapshot())
        if background:
            threading.Thread(target=self._run, args=(force_raw,), daemon=True).start()
        else:
            self._run(force_raw)
        return True

    def _run(self, force_raw: bool) -> None:
        art = Artifacts()
        t0 = time.time()
        try:
            for key, _, _ in STAGES:
                self._stage(key, status="running", started=time.time(), progress=0.0)
                ts = time.time()
                metrics = getattr(self, f"_s_{key}")(art, force_raw) or {}
                self._stage(key, status="done", progress=1.0, finished=time.time(),
                            duration=round(time.time() - ts, 2), metrics=metrics)
            art.built_at = time.time()
            if self.on_ready:
                self.on_ready(art)
            bus.publish("run", run_id=self.run_id, status="done", duration=round(time.time() - t0, 1))
        except Exception as e:  # noqa: BLE001 — отдаём ошибку в UI
            running = [k for k, s in self.state.items() if s["status"] == "running"]
            for k in running:
                self._stage(k, status="error", message=str(e))
            self.log(running[0] if running else "pipeline", traceback.format_exc(), "error")
            bus.publish("run", run_id=self.run_id, status="error", error=str(e))
        finally:
            self.running = False
            self.lock.release()

    # ---------- стадии ----------
    def _s_ingest(self, art: Artifacts, force_raw: bool) -> dict:
        out = DATA_DIR / "raw_hourly.parquet"
        files = [DATASET_DIR / "train.csv", DATASET_DIR / "test.csv"]
        size_gb = sum(f.stat().st_size for f in files if f.exists()) / 1e9
        if out.exists() and not force_raw:
            self.log("ingest", f"Кэш найден: {out.name}. Сырые CSV ({size_gb:.1f} ГБ) не перечитываем. "
                               "Кнопка «Пересчитать из сырых» запустит DuckDB заново.")
        elif all(f.exists() for f in files):
            self.log("ingest", f"DuckDB: читаем {size_gb:.1f} ГБ сырых валидаций…")
            self._duckdb_aggregate(out)
        else:
            self.log("ingest", "Сырые CSV не найдены — работаем по labels/*.csv", "warn")
        if out.exists():
            art.raw = pd.read_parquet(out)
            art.raw["date"] = pd.to_datetime(art.raw.date)
            art.raw = art.raw[art.raw.date <= HIST_END]
            r = art.raw
            art.stats.update({
                "raw_size_gb": round(size_gb, 2),
                "validations": int(r.validations.sum()),
                "boardings": int(r.boardings.sum()),
                "failures": int(r.failures.sum()),
                "failure_rate": round(float(r.failures.sum() / r.validations.sum()), 4),
                "wallet_share": round(float(r.wallet.sum() / r.boardings.sum()), 4),
                "pass_share": round(float(r.pass_tickets.sum() / r.boardings.sum()), 4),
                "social_share": round(float(r.social.sum() / r.boardings.sum()), 4),
            })
            self.log("ingest", f"Валидаций: {art.stats['validations']:,}, успешных посадок: {art.stats['boardings']:,}, "
                               f"отказов: {art.stats['failure_rate']:.2%}".replace(",", " "))
        return {k: art.stats[k] for k in ("raw_size_gb", "validations", "boardings", "failure_rate") if k in art.stats}

    def _duckdb_aggregate(self, out) -> None:
        import duckdb
        from app.ml.aggregate_raw import SQL
        con = duckdb.connect()
        con.execute("SET threads TO 8; SET memory_limit='3GB'; SET preserve_insertion_order=false;")
        files = [str(DATASET_DIR / "train.csv"), str(DATASET_DIR / "test.csv")]
        done = threading.Event()

        t0 = time.time()
        expected = 20.0 * max(1.0, sum(Path(f).stat().st_size for f in files) / 10.4e9)

        def poll():
            n = 0
            while not done.wait(0.5):
                n += 1
                el = time.time() - t0
                try:
                    p = con.query_progress()
                except Exception:  # noqa: BLE001
                    p = -1
                if p is not None and p > 0:
                    self.progress("ingest", p / 100, f"DuckDB: {p:.0f}% · {el:.0f} с")
                else:  # COPY не отдаёт прогресс — оценка по времени
                    self.progress("ingest", min(0.95, el / expected), f"DuckDB сканирует CSV · {el:.0f} с (≈{expected:.0f} с)")
                if n % 6 == 0:
                    self.log("ingest", f"DuckDB: {el:.0f} с, память процесса {psutil.Process().memory_info().rss / 2**20:.0f} МБ")

        th = threading.Thread(target=poll, daemon=True)
        th.start()
        try:
            con.execute(SQL.format(files=files, out=out))
        finally:
            done.set()
        self.log("ingest", f"Агрегаты записаны в {out.name} за {time.time() - t0:.1f} с")

    def _s_normalize(self, art: Artifacts, _f) -> dict:
        tr_path = DATASET_DIR / "labels" / "labels_day_train.csv"
        te_path = DATASET_DIR / "labels" / "labels_day_test.csv"
        if tr_path.exists() and te_path.exists():
            labels = pd.concat([pd.read_csv(tr_path, sep=";"), pd.read_csv(te_path, sep=";")])
            labels["date"] = pd.to_datetime(labels.date)
            labels = labels[labels.date <= HIST_END]
            self.progress("normalize", 0.3, "labels загружены")
        elif art.raw is not None:
            # В контейнере нет распакованного dataset.zip, но есть кэш data/raw_hourly.parquet.
            # Он собран из тех же train.csv/test.csv, поэтому полностью заменяет labels.
            labels = art.raw.loc[:, ["route", "date", "hour", "boardings"]].copy()
            labels["date"] = pd.to_datetime(labels.date)
            labels = labels[labels.date <= HIST_END]
            self.progress("normalize", 0.3, "labels недоступны — история из кэша агрегатов")
            self.log("normalize", "Папка labels/ не найдена — история восстановлена из data/raw_hourly.parquet", "warn")
        else:
            raise RuntimeError("Нет ни dataset/labels/*.csv, ни data/raw_hourly.parquet — нечем построить историю")
        art.hist = full_grid(labels, HIST_START, HIST_END)
        zeros = int((art.hist.y == 0).sum())
        self.log("normalize", f"labels: {len(labels):,} строк → полная сетка {len(art.hist):,} (дозаполнено нулями {zeros:,})".replace(",", " "))
        m = {"rows": len(art.hist), "filled_zeros": zeros, "routes": len(ROUTES)}
        if art.raw is not None:
            chk = art.hist.merge(art.raw[["route", "date", "hour", "boardings"]], on=["route", "date", "hour"], how="left")
            diff = int((chk.y - chk.boardings.fillna(0)).abs().sum())
            m["raw_vs_labels_diff"] = diff
            self.log("normalize", f"Сверка сырых агрегатов с labels: расхождение {diff} посадок из {int(chk.y.sum()):,}".replace(",", " "))
        dead = [r for r in ROUTES if art.hist[art.hist.route == r].y.sum() == 0]
        if dead:
            self.log("normalize", f"Маршруты без посадок в истории: {dead} — прогноз 0", "warn")
        art.stats.update(hist_rows=len(art.hist), total_boardings=int(art.hist.y.sum()), dead_routes=dead)
        return m

    def _s_external(self, art: Artifacts, _f) -> dict:
        self.progress("external", 0.2, "Open-Meteo archive API")
        art.weather_hourly = W.load_hourly()
        art.weather_daily = W.daily(art.weather_hourly)
        self.log("external", f"Погода: {len(art.weather_hourly):,} часов, источник {W.SOURCE}".replace(",", " "))
        cal = C.calendar_frame(pd.date_range(HIST_START, FC_END))
        n_hol = int(cal.is_holiday.sum())
        self.log("external", f"Календарь: {n_hol} праздничных/перенесённых дней 2025–2026, {len(C.SCHOOL_HOLIDAYS)} периодов каникул")
        nd = cal[(cal.date >= SUB_START) & (cal.date <= SUB_END) & ((cal.is_holiday == 1) | (cal.is_working_weekend == 1) | (cal.special != ""))]
        for r in nd.itertuples():
            self.log("external", f"  {r.date:%d.%m.%Y}: {r.day_type}{' (рабочая суббота)' if r.is_working_weekend else ''}{' ' + r.special if r.special else ''}")
        wn = art.weather_daily[(art.weather_daily.date >= SUB_START) & (art.weather_daily.date <= SUB_END)]
        return {"weather_hours": len(art.weather_hourly), "holidays": n_hol,
                "nov_dec_mean_temp": round(float(wn.t_mean.mean()), 1), "nov_dec_rain_days": int((wn.precip > 2).sum())}

    def _s_geo(self, art: Artifacts, _f) -> dict:
        art.geo = G.build_geo(ROUTES)
        art.geo_segments = G.build_segments(ROUTES)
        shared = sum(1 for x in art.geo_segments if len(x["routes"]) > 1)
        self.log("geo", f"Отрезков путей: {len(art.geo_segments)}, из них общих для нескольких маршрутов: {shared}")
        art.geo_schema = G.build_schema(G.build_segments(ROUTES, one_direction=True), art.geo)
        self.log("geo", f"Схема: {len(art.geo_schema['segments'])} выпрямленных участков (45°/90°)")
        for r, g in art.geo.items():
            self.log("geo", f"Маршрут {r}: {len(g['stops'])} остановок ({g['stops_source']}), {len(g['lines'])} сегментов линии")
        return {"stops": sum(len(g["stops"]) for g in art.geo.values()),
                "segments": sum(len(g["lines"]) for g in art.geo.values())}

    def _s_features(self, art: Artifacts, _f) -> dict:
        m = {}
        if art.raw is not None:
            r = art.raw[art.raw.date > ORIGIN - pd.Timedelta(days=42)].copy()
            r["day_class"] = r.date.map({d: C.day_class(d) for d in r.date.unique()})
            art.vehicles = r.groupby(["route", "day_class", "hour"]).vehicles.median().rename("vehicles").reset_index()
            h = art.raw[(art.raw.vehicles > 0) & art.raw.hour.between(6, 21)]
            bpv = h.boardings / h.vehicles
            art.bpv_target = {int(k): float(v) for k, v in (h.assign(bpv=bpv).groupby("route").bpv.quantile(0.95)).items()}
            m["bpv_p95_mean"] = round(float(np.mean(list(art.bpv_target.values()))), 1)
            self.log("features", "Выпуск ТС по часам (медиана 6 недель) и норматив посадок на ТС (p95) по маршрутам")
        d = art.hist.groupby(["route", "date"]).y.sum().reset_index()
        d["day_class"] = d.date.map({x: C.day_class(x) for x in d.date.unique()})
        art.stats["day_class_mean"] = d.groupby("day_class").y.mean().round(0).to_dict()
        self.log("features", "Классы дней: пн / вт–чт / пт / сб / вс+праздники")
        return m

    def _s_backtest(self, art: Artifacts, _f) -> dict:
        res, n, total = [], 0, len(BACKTEST_FOLDS) * len(ABLATIONS)
        series = None
        per_route = {}
        for origin, s, e, title in BACKTEST_FOLDS:
            row = {"origin": origin, "start": s, "end": e, "title": title}
            for name, kw in ABLATIONS.items():
                params = ModelParams(**{**PARAMS.__dict__, **kw})
                m = ProfileModel(params).fit(art.hist, pd.Timestamp(origin), art.weather_daily)
                pr = m.predict(pd.date_range(s, e), art.weather_daily).merge(art.hist, on=["route", "date", "hour"])
                row[name] = round(wape_score(pr.y, pr.yhat), 4)
                if name == "Полная модель" and origin == "2025-09-30":
                    daily = pr.groupby("date")[["y", "yhat"]].sum().reset_index()
                    series = [{"date": f"{r.date:%Y-%m-%d}", "actual": int(r.y), "pred": round(float(r.yhat))}
                              for r in daily.itertuples()]
                    hourly = pr.groupby(["route", "date", "hour"])[["y", "yhat"]].sum().reset_index()
                    art.backtest["hourly"] = hourly
                    per_route = {int(rt): round(wape_score(g.y, g.yhat), 4)
                                 for rt, g in pr.groupby("route") if g.y.sum() > 0}
                n += 1
                self.progress("backtest", n / total, f"{title}: {name} → {row[name]:.4f}")
            self.log("backtest", f"{title}: " + ", ".join(f"{k} {row[k]:.4f}" for k in ABLATIONS))
            res.append(row)
        mean = {k: round(float(np.mean([r[k] for r in res])), 4) for k in ABLATIONS}
        art.backtest.update(folds=res, mean=mean, series=series, per_route=per_route,
                            baseline=0.48, ceiling_note="Профиль, подобранный на самом октябре (оракул): 0.929")
        self.log("backtest", "Среднее: " + ", ".join(f"{k} {v:.4f}" for k, v in mean.items()))
        return {"wape_score": mean["Полная модель"], **{f"Δ {k}": round(mean["Полная модель"] - v, 4)
                                                        for k, v in mean.items() if k != "Полная модель"}}

    def _s_train(self, art: Artifacts, _f) -> dict:
        art.model = ProfileModel(PARAMS).fit(art.hist, ORIGIN, art.weather_daily)
        m = art.model
        self.log("train", f"Праздничные множители к воскресенью: первый день {m.holiday_first_:.3f}, прочие {m.holiday_other_:.3f}")
        self.log("train", "Погода (лог-эффект по осадкам): " + ", ".join(f"корзина {k}: {v:+.3f}" for k, v in m.weather_effect_.items()))
        self.log("train", "Тренд маршрутов: " + ", ".join(f"{k}: {v:.3f}" for k, v in m.trend_.items()))
        return {"holiday_first": round(m.holiday_first_, 3), "holiday_other": round(m.holiday_other_, 3),
                "profile_cells": len(m.profile_)}

    def _season_index(self, art: Artifacts) -> pd.DataFrame:
        """Месячный индекс к октябрю по будням (для горизонта «год»): 50% маршрут + 50% сеть."""
        d = art.hist.groupby(["route", "date"]).y.sum().reset_index()
        d = d[[C.day_type(x) == "wd" for x in d.date]]
        d["m"] = d.date.dt.month
        p = d.pivot_table(index="m", columns="route", values="y", aggfunc="median")
        net = p.sum(axis=1)
        net = net / net.loc[10]
        idx = p.div(p.loc[10]).mul(0.5).add(net.values[:, None] * 0.5).clip(0.6, 1.2)
        idx.loc[11] = 1.0
        idx.loc[12] = 1.0
        return idx.fillna(1.0).stack().rename("season_mult").reset_index().rename(columns={"m": "month"})

    def _s_forecast(self, art: Artifacts, _f) -> dict:
        dates = pd.date_range(FC_START, FC_END)
        wd = art.weather_daily  # на 2026 погоды нет → нейтральный множитель
        fc = art.model.predict(dates, wd)
        self.progress("forecast", 0.5, "компоненты посчитаны")
        season = self._season_index(art)
        fc["month"] = fc.date.dt.month
        fc = fc.merge(season, on=["month", "route"], how="left")
        fc["season_mult"] = np.where(fc.date <= SUB_END, 1.0, fc.season_mult.fillna(1.0))
        if art.vehicles is not None:
            fc = fc.merge(art.vehicles.rename(columns={"day_class": "ref_class"}), on=["route", "ref_class", "hour"], how="left")
        else:
            fc["vehicles"] = np.nan
        fc["vehicles"] = fc.vehicles.fillna(0.0)
        keep = ["route", "date", "hour", "day_type", "day_class", "is_holiday", "base", "trend_mult",
                "cal_mult", "weather_mult", "season_mult", "vehicles"]
        art.forecast = fc[keep].sort_values(["route", "date", "hour"]).reset_index(drop=True)
        yhat = (fc.base * fc.trend_mult * fc.cal_mult * fc.weather_mult * fc.season_mult)
        nd = fc.date <= SUB_END
        self.log("forecast", f"Ноябрь–декабрь 2025: {yhat[nd].sum():,.0f} посадок; год: {yhat.sum():,.0f}".replace(",", " "))
        return {"rows": len(art.forecast), "nov_dec_total": int(yhat[nd].sum()), "year_total": int(yhat.sum())}

    def _s_export(self, art: Artifacts, _f) -> dict:
        fc = art.forecast
        sub = fc[(fc.date >= SUB_START) & (fc.date <= SUB_END)].copy()
        sub["prediction"] = np.round(sub.base * sub.trend_mult * sub.cal_mult * sub.weather_mult * sub.season_mult * PARAMS.scale).astype(int)
        sub["date"] = sub.date.dt.strftime("%Y-%m-%d")
        path = DATA_DIR / "submission.csv"
        sub[["route", "date", "hour", "prediction"]].to_csv(path, sep=";", index=False)
        art.submission_path = str(path)
        fc.to_parquet(DATA_DIR / "forecast_components.parquet")
        self.log("export", f"submission.csv: {len(sub)} строк → {path}")
        assert len(sub) == 14640, "сетка сабмита должна быть 14 640 строк"
        return {"submission_rows": len(sub), "total": int(sub.prediction.sum())}


pipeline = Pipeline()
