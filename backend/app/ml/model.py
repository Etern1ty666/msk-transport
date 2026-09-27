"""Модель прогноза посадок route × date × hour.

ŷ = P[route, day_class, hour]          — робастный профиль за последние N недель до точки прогноза
    × trend[route]                     — затухающий тренд маршрута (последние 2 недели к окну)
    × cal[date]                        — календарь: праздники, перенос, предновогодние дни
    × weather[date]                    — осадки/снегопад (Open-Meteo), эффект оценён на истории
    × season                           — сезонный коэффициент горизонта (по умолчанию 1.0)
    × gbm[route, date, hour]           — LightGBM-поправка на остаток (опционально)
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict

import numpy as np
import pandas as pd

from app.ml import calendar as C
from app.ml import route_events as E

ROUTES = [1, 5, 7, 11, 12, 17, 25, 26, 28, 50]
HOURS = list(range(24))

# Приоры для дней, которых нет в истории (оценка по аналогии с январскими/майскими праздниками).
SPECIAL_PRIORS = {
    "new_year_eve": {"base": "sat", "mult": 0.85, "evening_mult": 0.55},
    "pre_new_year": {"base": "fri", "mult": 0.86, "evening_mult": 1.0},
}
PRECIP_BINS = [-1.0, 0.1, 2.0, 6.0, 1e9]


@dataclass
class Coefficients:
    """Корректирующие коэффициенты — меняются из интерфейса."""
    weather: float = 1.0   # сила погодного эффекта (0 — выключить, 2 — удвоить)
    event: float = 1.0     # поправка на событие / перекрытие (множитель на весь интервал)
    season: float = 1.0    # сезонная поправка горизонта
    trend: float = 1.0     # сила тренда маршрутов
    holiday: float = 1.0   # сила праздничного эффекта

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class ModelParams:
    lookback_days: int = 42
    trend_days: int = 14
    trend_alpha: float = 0.5
    trim: float = 0.2
    use_weather: bool = True
    use_calendar: bool = True
    use_trend: bool = True
    scale: float = 1.0
    blend_lookbacks: tuple = ()     # доп. окна для усреднения профиля, напр. (21, 56)
    weather_shrink: float = 1.0     # доверие к оценке погодного эффекта
    weather_heavy_only: bool = False  # учитывать только сильные осадки (> 6 мм за день)
    dow_classes: bool = False       # 7 классов (каждый день недели) вместо 5
    trend_skip_school: bool = True  # не считать тренд по неделе школьных каникул (провал спроса)
    profile_skip_school: bool = False
    exclude_disruptions: bool = True


def full_grid(labels: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    idx = pd.MultiIndex.from_product(
        [ROUTES, pd.date_range(start, end), HOURS], names=["route", "date", "hour"]
    )
    y = labels.set_index(["route", "date", "hour"]).boardings.reindex(idx, fill_value=0)
    return y.rename("y").reset_index()


def _trimmed_mean(x: np.ndarray, trim: float) -> float:
    x = np.sort(x)
    k = int(len(x) * trim)
    return float(x[k: len(x) - k].mean()) if len(x) > 2 * k else float(x.mean())


@dataclass
class ProfileModel:
    params: ModelParams = field(default_factory=ModelParams)

    def fit(self, hist: pd.DataFrame, origin: pd.Timestamp, weather_daily: pd.DataFrame) -> "ProfileModel":
        p = self.params
        origin = pd.Timestamp(origin)
        hist = hist[hist.date <= origin]
        cal = C.calendar_frame(pd.DatetimeIndex(hist.date.unique()))
        hist = hist.merge(cal[["date", "day_class", "is_holiday", "is_pre_holiday", "holiday_first", "school_holiday"]], on="date")
        if p.exclude_disruptions:
            hist = hist.loc[~E.disrupted_mask(hist)].copy()
        normal = (hist.is_holiday == 0) & (hist.is_pre_holiday == 0)
        in_school = hist.school_holiday.eq(1) & (hist.date.dt.month.isin([1, 3, 4, 10, 11, 12]))  # короткие каникулы, не лето

        if p.dow_classes:
            hist["day_class"] = [_dow_class(d, c) for d, c in zip(hist.date, hist.day_class)]
        win = hist[normal & (hist.date > origin - pd.Timedelta(days=p.lookback_days))]
        profs = []
        for lb in (p.lookback_days, *p.blend_lookbacks):
            w = hist[normal & (hist.date > origin - pd.Timedelta(days=lb)) & ~(in_school if p.profile_skip_school else False)]
            profs.append(w.groupby(["route", "day_class", "hour"]).y
                         .apply(lambda s: _trimmed_mean(s.to_numpy(), p.trim)).rename("base"))
        prof = pd.concat(profs, axis=1).mean(axis=1).rename("base").reset_index()
        self.profile_ = prof

        # тренд: средний дневной объём последних trend_days к окну, по будням
        tw = win[~in_school.loc[win.index]] if p.trend_skip_school else win
        daily = tw.groupby(["route", "date", "day_class"]).y.sum().reset_index()
        wd = daily[daily.day_class.isin(["mon", "mid", "tue", "wed", "thu", "fri"])]
        last = sorted(wd.date.unique())[-max(1, round(p.trend_days * 5 / 7)):]  # последние N рабочих дней вне каникул
        recent = wd[wd.date.isin(last)].groupby("route").y.mean()
        overall = wd.groupby("route").y.mean()
        ratio = (recent / overall).replace([np.inf, -np.inf], np.nan).fillna(1.0).clip(0.8, 1.25)
        self.trend_ = ratio.pow(p.trend_alpha).to_dict()

        # праздничные множители к воскресному профилю, оценка по истории
        tot = hist.groupby(["date"]).y.sum()
        sun = tot[[d for d in tot.index if C.day_class(d) == "sun" and C.day_type(d) == "sun"]]
        hol_rows = cal[cal.is_holiday == 1]
        ratios_first, ratios_other = [], []
        for _, r in hol_rows.iterrows():
            near = sun[(sun.index > r.date - pd.Timedelta(days=28)) & (sun.index < r.date + pd.Timedelta(days=28))]
            if len(near) and r.date.month != 1:  # январские каникулы — особый режим
                (ratios_first if r.holiday_first else ratios_other).append(tot[r.date] / near.median())
        self.holiday_first_ = float(np.median(ratios_first)) if ratios_first else 0.85
        self.holiday_other_ = float(np.median(ratios_other)) if ratios_other else 0.97

        # погода: средний лог-остаток дневного объёма по корзинам осадков
        self.weather_effect_ = self._fit_weather(hist, normal, weather_daily)
        return self

    def _fit_weather(self, hist, normal, weather_daily) -> dict:
        d = hist[normal].groupby(["route", "date", "day_class"]).y.sum().reset_index().sort_values("date")
        d["base"] = d.groupby(["route", "day_class"]).y.transform(lambda s: s.shift(1).rolling(5, min_periods=3).median())
        d = d.dropna().merge(weather_daily, on="date")
        d = d[d.base > 0]
        with np.errstate(divide="ignore", invalid="ignore"):
            d["lr"] = np.log(d.y / d.base)
        d = d[d.lr.abs() < 0.5]
        per_day = d.groupby("date").agg(lr=("lr", "mean"), precip=("precip", "first"))
        per_day["bin"] = pd.cut(per_day.precip, PRECIP_BINS, labels=False)
        eff = per_day.groupby("bin").lr.mean()
        eff = eff - per_day.lr.mean()  # центрируем: средний день = 1.0
        keep = {len(PRECIP_BINS) - 2} if self.params.weather_heavy_only else set(eff.index.astype(int))
        return {int(k): float(v) * self.params.weather_shrink if int(k) in keep else 0.0 for k, v in eff.items()}

    def predict(self, dates: pd.DatetimeIndex, weather_daily: pd.DataFrame,
                coef: Coefficients | None = None, routes=ROUTES) -> pd.DataFrame:
        p, coef = self.params, coef or Coefficients()
        dates = pd.DatetimeIndex(dates)
        cal = C.calendar_frame(dates)
        if p.dow_classes:
            cal["day_class"] = [_dow_class(d, c) for d, c in zip(cal.date, cal.day_class)]
        grid = pd.MultiIndex.from_product([routes, dates, HOURS], names=["route", "date", "hour"]).to_frame(index=False)
        g = grid.merge(cal, on="date")

        # опорный класс дня: праздники → sun, особые дни → свой приор
        g["ref_class"] = g.day_class
        g["cal_mult"] = 1.0
        if p.use_calendar:
            hol = g.is_holiday.eq(1)
            hol_mult = np.where(g.holiday_first.eq(1), self.holiday_first_, self.holiday_other_)
            g.loc[hol, "cal_mult"] = 1 + (hol_mult[hol] - 1) * coef.holiday
            g.loc[g.is_working_weekend.eq(1), "cal_mult"] = 0.85
            for key, pr in SPECIAL_PRIORS.items():
                m = g.special.eq(key)
                g.loc[m, "ref_class"] = pr["base"]
                mult = pr["mult"] * np.where(g.loc[m, "hour"] >= 19, pr["evening_mult"], 1.0)
                g.loc[m, "cal_mult"] = 1 + (mult - 1) * coef.holiday

        g = g.merge(self.profile_.rename(columns={"day_class": "ref_class"}), on=["route", "ref_class", "hour"], how="left")
        g["base"] = g.base.fillna(0.0)

        g["trend_mult"] = g.route.map(self.trend_).fillna(1.0) if p.use_trend else 1.0
        g["trend_mult"] = 1 + (g.trend_mult - 1) * coef.trend

        g["weather_mult"] = 1.0
        if p.use_weather and weather_daily is not None:
            w = weather_daily.set_index("date").precip.reindex(dates)
            bins = pd.cut(w, PRECIP_BINS, labels=False)
            eff = bins.map(self.weather_effect_).fillna(0.0)
            g["weather_mult"] = g.date.map(np.exp(eff * coef.weather)).astype(float)

        g["yhat"] = (g.base * g.trend_mult * g.cal_mult * g.weather_mult
                     * coef.season * coef.event * p.scale).clip(lower=0)
        return g


def _dow_class(d: pd.Timestamp, cls: str) -> str:
    """Будни раздельно по дням недели (вт, ср, чт — свои профили)."""
    return {1: "tue", 2: "wed", 3: "thu"}.get(pd.Timestamp(d).dayofweek, cls) if cls == "mid" else cls


def wape_score(y: np.ndarray, yhat: np.ndarray) -> float:
    y, yhat = np.asarray(y, float), np.asarray(yhat, float)
    return max(0.0, 1 - np.abs(y - np.round(yhat)).sum() / y.sum())
