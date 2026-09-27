"""In-memory хранилище прогноза и истории: фильтрация, агрегация, коэффициенты, выгрузка."""
from __future__ import annotations

import io
import json
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.config import DATA_DIR
from app.ml import calendar as C
from app.ml import depots as DEP
from app.ml import paymix as PAY
from app.ml import geo as G
from app.ml.model import ROUTES, Coefficients
from app.ml.weather import SOURCE as WEATHER_SOURCE
from app.pipeline import FC_END, FC_START, HIST_END, HIST_START, PARAMS, SUB_END, SUB_START, Artifacts

HORIZONS = {
    "day": {"title": "День", "agg": "hour", "desc": "Краткосрочный: сутки с разбивкой по часам"},
    "month": {"title": "Месяц", "agg": "day", "desc": "Среднесрочный: календарный месяц по дням"},
    "year": {"title": "Год", "agg": "month", "desc": "Долгосрочный (сценарный): 12 месяцев от точки прогноза"},
}

LOAD_LEVELS = [(0.7, "low", "свободно"), (1.0, "mid", "норма"), (1.2, "high", "внимание"), (math.inf, "crit", "перегрузка")]


class QueryError(ValueError):
    """Ошибка параметров запроса → HTTP 400 с понятным сообщением."""


@dataclass(frozen=True)
class Query:
    horizon: str = "day"
    date: str | None = None
    month: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    routes: tuple[int, ...] = ()
    stop_id: str | None = None
    hour_from: int = 0
    hour_to: int = 23
    agg: str | None = None
    by_route: bool = False
    coef: tuple = ()  # Coefficients в виде кортежа — для кэша


def load_level(ratio: float) -> tuple[str, str]:
    for thr, key, title in LOAD_LEVELS:
        if ratio < thr:
            return key, title
    return "crit", "перегрузка"


class Store:
    def __init__(self, art: Artifacts) -> None:
        self.art = art
        fc = art.forecast.copy()
        fc["date"] = pd.to_datetime(fc.date)
        self.fc = _with_keys(fc)
        self.hist = _with_keys(art.hist.copy())
        self.geo = art.geo
        self.stop_index = {s["stop_id"]: (r, s) for r, g in self.geo.items() for s in g["stops"]}
        self.version = int(art.built_at)
        self.days = pd.DatetimeIndex(sorted(fc.date.unique()))
        # тензоры [маршрут × день × час] — горячие запросы считаются срезами numpy за доли миллисекунды
        R, D = len(ROUTES), len(self.days)
        srt = self.fc.sort_values(["route", "date", "hour"])
        assert len(srt) == R * D * 24, "прогноз должен покрывать полную сетку"
        self.T = {c: srt[c].to_numpy(float).reshape(R, D, 24)
                  for c in ("base", "trend_mult", "cal_mult", "weather_mult", "season_mult", "vehicles")}
        self.ridx = {r: i for i, r in enumerate(ROUTES)}
        self.day_keys = np.array([f"{d:%Y-%m-%d}" for d in self.days])
        self.month_keys = np.array([f"{d:%Y-%m}" for d in self.days])
        self.dow = self.days.dayofweek.to_numpy()
        self.target = np.array([self.art.bpv_target.get(r, 110.0) for r in ROUTES])
        self.depots = DEP.load()  # площадки и выпуск вагонов (data/depots.json)
        self.paymix = PAY.load()  # доли типов оплаты по маршруту и часу (data/paymix.json)
        self._ycache: dict[tuple, np.ndarray] = {}

    def yhat_tensor(self, coef: Coefficients) -> np.ndarray:
        key = (coef.weather, coef.event, coef.season, coef.trend, coef.holiday, PARAMS.scale)
        y = self._ycache.get(key)
        if y is None:
            T = self.T
            y = (T["base"] * (1 + (T["trend_mult"] - 1) * coef.trend) * (1 + (T["cal_mult"] - 1) * coef.holiday)
                 * np.power(T["weather_mult"], coef.weather) * T["season_mult"] * (coef.season * coef.event * PARAMS.scale))
            np.clip(y, 0, None, out=y)
            if len(self._ycache) > 256:
                self._ycache.clear()
            self._ycache[key] = y
        return y

    # ---------- прогноз с коэффициентами ----------
    @staticmethod
    def apply(df: pd.DataFrame, coef: Coefficients) -> np.ndarray:
        trend = 1 + (df.trend_mult.to_numpy() - 1) * coef.trend
        cal = 1 + (df.cal_mult.to_numpy() - 1) * coef.holiday
        weather = np.power(df.weather_mult.to_numpy(), coef.weather)
        season = df.season_mult.to_numpy() * coef.season
        y = df.base.to_numpy() * trend * cal * weather * season * coef.event * PARAMS.scale
        return np.clip(y, 0, None)

    def _range(self, q: Query) -> tuple[pd.Timestamp, pd.Timestamp]:
        lo, hi = pd.Timestamp(FC_START), pd.Timestamp(FC_END)
        try:
            if q.date_from or q.date_to:
                a = pd.Timestamp(q.date_from or FC_START)
                b = pd.Timestamp(q.date_to or q.date_from)
            elif q.horizon == "day":
                a = b = pd.Timestamp(q.date or SUB_START)
            elif q.horizon == "month":
                a = pd.Timestamp((q.month or SUB_START[:7]) + "-01")
                b = a + pd.offsets.MonthEnd(0)
            elif q.horizon == "year":
                a, b = lo, hi
            else:
                raise QueryError(f"Неизвестный горизонт '{q.horizon}'. Допустимо: day, month, year")
        except (ValueError, TypeError) as e:
            if isinstance(e, QueryError):
                raise
            raise QueryError(f"Некорректная дата: {e}") from e
        if a > b:
            raise QueryError("Начало интервала позже конца")
        if b < lo or a > hi:
            raise QueryError(f"Прогноз доступен на период {FC_START} … {FC_END}")
        return max(a, lo), min(b, hi)

    def select(self, q: Query) -> tuple[pd.DataFrame, float, str | None]:
        if not 0 <= q.hour_from <= q.hour_to <= 23:
            raise QueryError("Часы должны быть в диапазоне 0…23, hour_from ≤ hour_to")
        a, b = self._range(q)
        routes = list(q.routes) or ROUTES
        bad = [r for r in routes if r not in ROUTES]
        if bad:
            raise QueryError(f"Неизвестные маршруты: {bad}. Доступны: {ROUTES}")
        share, stop_name = 1.0, None
        if q.stop_id:
            if q.stop_id not in self.stop_index:
                raise QueryError(f"Остановка '{q.stop_id}' не найдена")
            r, s = self.stop_index[q.stop_id]
            routes, share, stop_name = [r], s["weight"], s["name"]
        fc = self.fc
        m = (fc.date >= a) & (fc.date <= b) & fc.hour.between(q.hour_from, q.hour_to) & fc.route.isin(routes)
        df = fc.loc[m].copy()
        df["yhat"] = self.apply(df, Coefficients(*q.coef) if q.coef else Coefficients()) * share
        return df, share, stop_name

    def forecast(self, q: Query) -> dict:
        if not 0 <= q.hour_from <= q.hour_to <= 23:
            raise QueryError("Часы должны быть в диапазоне 0…23, hour_from ≤ hour_to")
        a, b = self._range(q)
        routes = list(q.routes) or ROUTES
        bad = [r for r in routes if r not in ROUTES]
        if bad:
            raise QueryError(f"Неизвестные маршруты: {bad}. Доступны: {ROUTES}")
        share, stop_name = 1.0, None
        if q.stop_id:
            if q.stop_id not in self.stop_index:
                raise QueryError(f"Остановка '{q.stop_id}' не найдена")
            r, st = self.stop_index[q.stop_id]
            routes, share, stop_name = [r], st["weight"], st["name"]
        d0, d1 = (a - self.days[0]).days, (b - self.days[0]).days + 1
        h0, h1 = q.hour_from, q.hour_to + 1
        ri = [self.ridx[r] for r in routes]
        y = self.yhat_tensor(Coefficients(*q.coef) if q.coef else Coefficients())[ri, d0:d1, h0:h1] * share
        agg = q.agg or HORIZONS.get(q.horizon, {}).get("agg", "hour")
        days = self.day_keys[d0:d1]
        if agg == "hour":
            keys = [f"{d} {h:02d}:00" for d in days for h in range(h0, h1)]
            M = y.reshape(len(ri), -1)
        elif agg == "day":
            keys, M = list(days), y.sum(2)
        elif agg == "month":
            months = self.month_keys[d0:d1]
            starts = np.r_[0, np.flatnonzero(months[1:] != months[:-1]) + 1]
            keys, M = list(months[starts]), np.add.reduceat(y.sum(2), starts, axis=1)
        elif agg == "hour_of_day":
            keys, M = [f"{h:02d}" for h in range(h0, h1)], y.sum(1)
        elif agg == "weekday":
            dow = self.dow[d0:d1]
            present = [k for k in range(7) if (dow == k).any()]
            keys = [["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][k] for k in present]
            M = np.stack([y[:, dow == k, :].sum((1, 2)) for k in present], axis=1)
        else:
            raise QueryError("agg: hour | day | month | hour_of_day | weekday")
        tot = M.sum(0)
        if q.by_route:
            names = [str(r) for r in routes]
            series = [{"t": k, **{n: round(float(M[i, j]), 1) for i, n in enumerate(names)}, "total": round(float(tot[j]), 1)}
                      for j, k in enumerate(keys)]
        else:
            series = [{"t": k, "total": round(float(tot[j]), 1)} for j, k in enumerate(keys)]
        ph = y.sum((0, 1))
        return {
            "horizon": q.horizon, "agg": agg, "stop": stop_name, "stop_share": share,
            "date_from": str(days[0]), "date_to": str(days[-1]),
            "total": round(float(y.sum())), "by_route": {str(r): int(round(float(y[i].sum()))) for i, r in enumerate(routes)},
            "peak_hour": int(h0 + ph.argmax()) if ph.max() > 0 else None,
            "series": series, "rows": int(y.shape[0] * y.shape[1] * y.shape[2]),
            "note": "Остановочная детализация — оценка по весам остановок" if stop_name else None,
        }

    def export(self, q: Query, fmt: str) -> tuple[bytes, str, str]:
        df, _, stop_name = self.select(q)
        out = df[["route", "date", "hour", "day_type", "base", "trend_mult", "cal_mult", "weather_mult",
                  "season_mult", "yhat"]].copy()
        out["date"] = out.date.dt.strftime("%Y-%m-%d")
        out["prediction"] = np.round(out.pop("yhat")).astype(int)
        if stop_name:
            out.insert(1, "stop", stop_name)
        out = out.round(4)
        name = f"forecast_{q.horizon}_{out.date.min() if len(out) else ''}_{out.date.max() if len(out) else ''}"
        if fmt == "csv":
            return out.to_csv(sep=";", index=False).encode("utf-8-sig"), "text/csv; charset=utf-8", name + ".csv"
        if fmt == "xlsx":
            buf = io.BytesIO()
            with pd.ExcelWriter(buf, engine="openpyxl") as w:
                out.to_excel(w, sheet_name="Прогноз", index=False)
                agg = out.groupby(["route", "date"]).prediction.sum().reset_index()
                agg.to_excel(w, sheet_name="По дням", index=False)
            return buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name + ".xlsx"
        raise QueryError("format должен быть csv или xlsx")

    # ---------- история ----------
    def history(self, routes: tuple[int, ...], date_from: str | None, date_to: str | None, agg: str) -> dict:
        h = self.hist
        a = pd.Timestamp(date_from or HIST_START)
        b = pd.Timestamp(date_to or HIST_END)
        m = (h.date >= a) & (h.date <= b)
        if routes:
            m &= h.route.isin(routes)
        df = h.loc[m].rename(columns={"y": "yhat"})
        s = df.assign(k=_agg_key(df, agg)).groupby("k", observed=True).yhat.sum()
        return {"agg": agg, "series": [{"t": k, "total": int(v)} for k, v in s.items()], "total": int(df.yhat.sum())}

    # ---------- разложение прогноза ----------
    def decompose(self, route: int, date: str, coef: Coefficients) -> dict:
        d = pd.Timestamp(date)
        df = self.fc[(self.fc.route == route) & (self.fc.date == d)].copy()
        if df.empty:
            raise QueryError("Нет прогноза для этой даты/маршрута")
        df["yhat"] = self.apply(df, coef)
        mults = [
            ("Тренд", 1 + (df.trend_mult.to_numpy() - 1) * coef.trend),
            ("Календарь", 1 + (df.cal_mult.to_numpy() - 1) * coef.holiday),
            ("Погода", np.power(df.weather_mult.to_numpy(), coef.weather)),
            ("Сезон", df.season_mult.to_numpy() * coef.season),
            ("Событие", np.full(len(df), coef.event)),
            ("Масштаб", np.full(len(df), PARAMS.scale)),
        ]
        cur = df.base.to_numpy().astype(float)
        steps = [("Профиль (база)", float(cur.sum()))]
        for title, mult in mults:
            nxt = cur * mult
            if abs(nxt.sum() - cur.sum()) > 0.5 or title in ("Тренд", "Календарь", "Погода"):
                steps.append((title, float(nxt.sum() - cur.sum())))
            cur = nxt
        cal = C.calendar_frame(pd.DatetimeIndex([d])).iloc[0]
        w = self.art.weather_daily
        wrow = w[w.date == d]
        return {
            "route": route, "date": date, "day_type": cal.day_type, "day_class": cal.day_class,
            "special": cal.special, "school_holiday": bool(cal.school_holiday),
            "weather": None if wrow.empty else {k: round(float(wrow.iloc[0][k]), 1) for k in ("t_mean", "precip", "snowfall", "wind")},
            "waterfall": [{"name": n, "value": round(v)} for n, v in steps] + [{"name": "Итог", "value": round(float(df.yhat.sum()))}],
            "hours": [{"hour": int(r.hour), "base": round(r.base, 1), "yhat": round(r.yhat, 1),
                       "vehicles": float(r.vehicles)} for r in df.itertuples()],
        }

    # ---------- загрузка на карте ----------
    def _day(self, date: str) -> int:
        try:
            d = (pd.Timestamp(date) - self.days[0]).days
        except ValueError as e:
            raise QueryError(f"Некорректная дата: {date}") from e
        if not 0 <= d < len(self.days):
            raise QueryError(f"Нет прогноза на {date}. Период: {FC_START} … {FC_END}")
        return d

    def load_snapshot(self, date: str, hour: int, coef: Coefficients) -> dict:
        if not 0 <= hour <= 23:
            raise QueryError("hour должен быть 0…23")
        d = self._day(date)
        y = self.yhat_tensor(coef)[:, d, :]
        veh = self.T["vehicles"][:, d, :]
        routes = []
        for i, r in enumerate(ROUTES):
            v, b, target = float(veh[i, hour]), float(y[i, hour]), float(self.target[i])
            bpv = b / v if v > 0 else 0.0
            ratio = bpv / target if target else 0.0
            lvl, lvl_title = load_level(ratio)
            routes.append({
                "route": r, "boardings": round(b), "vehicles": v,
                "per_vehicle": round(bpv, 1), "norm_per_vehicle": round(target, 1), "load_ratio": round(ratio, 3),
                "level": lvl, "level_title": lvl_title,
                "extra_vehicles": max(0, math.ceil(b / target) - int(v)) if v > 0 else 0,
                "day_total": round(float(y[i].sum())), "hourly": [round(float(x)) for x in y[i]],
            })
        return {"date": date, "hour": hour, "routes": routes}

    def day_view(self, date: str, coef: Coefficients) -> dict:
        """Всё о сутках одним ответом: посадки, вагоны, загрузка и дефицит по маршрутам × 24 часа."""
        d = self._day(date)
        y = self.yhat_tensor(coef)[:, d, :]
        veh = self.T["vehicles"][:, d, :]
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = np.where(veh > 0, y / veh / self.target[:, None], 0.0)
        extra = np.where(veh > 0, np.maximum(0, np.ceil(y / self.target[:, None]) - np.floor(veh)), 0)
        ts = self.days[d]
        cal = C.calendar_frame(pd.DatetimeIndex([ts])).iloc[0]
        wh = self.art.weather_hourly
        wd = wh[wh.date == ts].sort_values("hour") if wh is not None else pd.DataFrame()
        routes = []
        for i, r in enumerate(ROUTES):
            g = self.geo.get(r, {})
            routes.append({
                "route": r, "name": g.get("name", ""), "color": g.get("color", "#888"),
                "boardings": [round(float(v)) for v in y[i]], "vehicles": [float(v) for v in veh[i]],
                "ratio": [round(float(v), 3) for v in ratio[i]], "extra": [int(v) for v in extra[i]],
                "norm": round(float(self.target[i]), 1), "day_total": round(float(y[i].sum())),
                "peak_hour": int(y[i].argmax()) if y[i].max() > 0 else None,
                "place": self.depots["route_place"].get(str(r)) if self.depots else None,
                "pay_mix": self.paymix["routes"].get(str(r), {}).get("hours") if self.paymix else None,
            })
        return {
            "date": date, "dow": int(ts.dayofweek), "day_type": cal.day_type, "special": cal.special,
            "school_holiday": bool(cal.school_holiday), "is_working_weekend": bool(cal.is_working_weekend),
            "weather": None if wd.empty else {
                "temp": [round(float(v), 1) for v in wd.temperature_2m], "precip": [round(float(v), 1) for v in wd.precipitation],
                "snow": [round(float(v), 1) for v in wd.snowfall],
            },
            "routes": routes,
            "depots": self._depots_day(veh),
            "pay_cats": self.paymix["cats"] if self.paymix else None,
            "network": {"boardings": [round(float(v)) for v in y.sum(0)],
                        "max_ratio": [round(float(v), 3) for v in ratio.max(0)],
                        "problems": [int(v) for v in (ratio >= 1.0).sum(0)]},
        }

    def _depots_day(self, veh: np.ndarray) -> dict | None:
        """Площадки на сутки: сколько их вагонов на линии по прогнозу выпуска и сколько готовых стоит в парке.
        Готовые = пиковый выпуск площадки (p90 будней) − вагоны на линии в этот час: в пик ≈ 0, днём и вечером — резерв."""
        if not self.depots:
            return None
        out = {}
        for p, d in self.depots["places"].items():
            on_line = np.floor(veh[[self.ridx[r] for r in d["routes"]]]).sum(0)
            out[p] = {**d, "on_line": [int(v) for v in on_line],
                      "ready": [int(v) for v in np.maximum(0, d["peak_out"] - on_line)]}
        return out

    def recommendations(self, date: str, coef: Coefficients, min_ratio: float = 1.0) -> list[dict]:
        """Часы и маршруты, где прогноз посадок на вагон выше норматива → сколько вагонов добавить."""
        d = self._day(date)
        y = self.yhat_tensor(coef)[:, d, :]
        veh = self.T["vehicles"][:, d, :]
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = np.where(veh > 0, y / veh / self.target[:, None], 0.0)
        out = []
        for i, h in zip(*np.nonzero(ratio >= min_ratio)):
            lvl, title = load_level(float(ratio[i, h]))
            b, v, t = float(y[i, h]), float(veh[i, h]), float(self.target[i])
            out.append({"route": ROUTES[i], "hour": int(h), "boardings": round(b), "vehicles": v,
                        "per_vehicle": round(b / v, 1), "load_ratio": round(float(ratio[i, h]), 3), "level": lvl,
                        "level_title": title, "extra_vehicles": max(0, math.ceil(b / t) - int(v))})
        return sorted(out, key=lambda x: -x["load_ratio"])

    # ---------- модель ----------
    def model_info(self) -> dict:
        m = self.art.model
        prof = m.profile_[m.profile_.day_class == "mid"].pivot_table(index="route", columns="hour", values="base").fillna(0)
        season = (self.fc.groupby([self.fc.date.dt.to_period("M").astype(str), "route"]).season_mult.first()
                  .unstack().round(3))
        return {
            "params": PARAMS.__dict__,
            "formula": "ŷ = профиль[маршрут, тип дня, час] × тренд × календарь × погода × сезон × событие",
            "profile_weekday": {"routes": [int(r) for r in prof.index], "matrix": prof.round(0).to_numpy().tolist()},
            "holiday": {"first": round(m.holiday_first_, 3), "other": round(m.holiday_other_, 3)},
            "weather_effect": [{"bin": b, "range": r, "mult": round(math.exp(m.weather_effect_.get(i, 0.0)), 3)}
                               for i, (b, r) in enumerate([("сухо", "< 0.1 мм"), ("слабые осадки", "0.1–2 мм"),
                                                           ("умеренные", "2–6 мм"), ("сильные", "> 6 мм")])],
            "trend": {str(k): round(v, 4) for k, v in m.trend_.items()},
            "season_index": {"months": list(season.index), "routes": [str(c) for c in season.columns],
                             "matrix": season.to_numpy().tolist()},
            "backtest": {k: v for k, v in self.art.backtest.items() if k != "hourly"},
            "bpv_target": {str(k): round(v, 1) for k, v in self.art.bpv_target.items()},
            # результат `python -m app.ml.ml_compare` (LightGBM / MLP против профиля на том же бэктесте)
            "ml_compare": json.loads(p.read_text()) if (p := DATA_DIR / "ml_compare.json").exists() else None,
        }

    def backtest_hourly(self, route: int | None) -> list[dict]:
        h = self.art.backtest.get("hourly")
        if h is None:
            return []
        if route:
            h = h[h.route == route]
        g = h.groupby("hour")[["y", "yhat"]].sum()
        return [{"hour": int(k), "actual": int(r.y), "pred": round(float(r.yhat))} for k, r in g.iterrows()]

    def meta(self) -> dict:
        from app.ml.calendar import SOURCES
        routes = []
        tot = self.hist.groupby("route").y.sum()
        for r in ROUTES:
            g = self.geo.get(r, {})
            routes.append({"route": r, "name": g.get("name", ""), "color": g.get("color", "#888"),
                           "stops": len(g.get("stops", [])), "stops_source": g.get("stops_source"),
                           "history_total": int(tot.get(r, 0)), "active": bool(tot.get(r, 0) > 0)})
        return {
            "routes": routes,
            "horizons": HORIZONS,
            "history": {"from": HIST_START, "to": HIST_END},
            "forecast": {"from": FC_START, "to": FC_END, "submission_from": SUB_START, "submission_to": SUB_END},
            "months": sorted({f"{d:%Y-%m}" for d in self.days}),
            "coefficients": Coefficients().as_dict(),
            "stats": self.art.stats,
            "backtest_mean": self.art.backtest.get("mean", {}),
            "built_at": self.art.built_at,
            "sources": [
                {"name": "Производственный календарь РФ 2025", "kind": "календарь", "url": SOURCES["production_calendar"]},
                {"name": "Производственный календарь РФ 2026", "kind": "календарь", "url": SOURCES["production_calendar_2026"]},
                {"name": "Школьные каникулы Москвы", "kind": "календарь", "url": SOURCES["school_holidays"]},
                {"name": "Open-Meteo Historical Weather (ERA5)", "kind": "погода", "url": WEATHER_SOURCE},
                {"name": "OpenStreetMap — трамвайные маршруты (Overpass API)", "kind": "геоданные",
                 "url": "https://wiki.openstreetmap.org/wiki/Overpass_API"},
            ],
            "geo_note": f"Остановки: справочник хакатона для маршрутов {sorted(r for r, g in self.geo.items() if g.get('stops_source') == 'справочник хакатона')}, "
                        "для остальных — OpenStreetMap. Поток по остановкам — оценка (весовая модель).",
            "overpass": G.OVERPASS,
        }


def _with_keys(df: pd.DataFrame) -> pd.DataFrame:
    """Предвычисленные ключи агрегации — чтобы запрос не форматировал даты на лету."""
    df["k_day"] = df.date.dt.strftime("%Y-%m-%d")
    df["k_hour"] = df.k_day + " " + df.hour.astype(str).str.zfill(2) + ":00"
    df["k_month"] = df.date.dt.strftime("%Y-%m")
    df["k_hour_of_day"] = df.hour.astype(str).str.zfill(2)
    df["k_weekday"] = df.date.dt.dayofweek.map(dict(enumerate(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"])))
    for c in ("k_day", "k_hour", "k_month", "k_hour_of_day", "k_weekday"):
        df[c] = df[c].astype("category")
    return df


def _agg_key(df: pd.DataFrame, agg: str) -> pd.Series:
    if f"k_{agg}" in df.columns:
        return df[f"k_{agg}"]
    if agg == "hour":
        return df.date.dt.strftime("%Y-%m-%d") + " " + df.hour.astype(str).str.zfill(2) + ":00"
    if agg == "day":
        return df.date.dt.strftime("%Y-%m-%d")
    if agg == "month":
        return df.date.dt.strftime("%Y-%m")
    if agg == "hour_of_day":
        return df.hour.astype(str).str.zfill(2)
    if agg == "weekday":
        return df.date.dt.dayofweek.map(dict(enumerate(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"])))
    raise QueryError("agg: hour | day | month | hour_of_day | weekday")
