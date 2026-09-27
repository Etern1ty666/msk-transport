"""Воспроизводимая оценка ремонта №7 и датированных сообщений о пробках.

Запуск из backend: python -m app.ml.external_analysis
Печатает JSON; не записывает прогноз и не меняет артефакты сервиса.
"""
from __future__ import annotations

import json
from math import comb
from dataclasses import asdict

import numpy as np
import pandas as pd

from app.config import DATA_DIR, DATASET_DIR
from app.ml import route_events as E
from app.ml import calendar as C
from app.ml import weather as W
from app.ml.model import ModelParams, ProfileModel, full_grid, wape_score


PARAMS = ModelParams(lookback_days=28, trend_alpha=1.0, trend_days=7,
                     weather_heavy_only=True, weather_shrink=0.5)


def history() -> pd.DataFrame:
    labels = pd.concat([pd.read_csv(DATASET_DIR / "labels" / f"labels_day_{part}.csv", sep=";")
                        for part in ("train", "test")], ignore_index=True)
    labels["date"] = pd.to_datetime(labels.date)
    return full_grid(labels[labels.date <= "2025-10-31"], "2025-01-01", "2025-10-31")


def score(pred: pd.DataFrame, hist: pd.DataFrame, weekdays_only: bool = False) -> dict:
    rows = pred.merge(hist, on=["route", "date", "hour"])
    if weekdays_only:
        rows = rows[rows.date.dt.dayofweek < 5]
    route = rows[rows.route == 7]
    return {"route_7": round(wape_score(route.y, route.yhat), 4),
            "network": round(wape_score(rows.y, rows.yhat), 4),
            "route_7_actual": int(route.y.sum()), "route_7_predicted": round(float(route.yhat.sum()))}


def repair_analysis(hist: pd.DataFrame, weather: pd.DataFrame) -> dict:
    periods = [("before", "2025-06-12", "2025-07-09"),
               ("during", "2025-07-10", "2025-08-10"),
               ("after", "2025-08-11", "2025-09-07")]
    actual = {}
    for name, start, end in periods:
        rows = hist[(hist.route == 7) & hist.date.between(start, end)]
        actual[name] = {"days": int(rows.date.nunique()),
                        "daily_mean": round(float(rows.y.sum() / rows.date.nunique())),
                        "total": int(rows.y.sum())}
    actual["during_vs_before_pct"] = round(100 * (actual["during"]["daily_mean"] /
                                                  actual["before"]["daily_mean"] - 1), 1)

    # На 9 июля публикация о сокращении уже доступна, но величина эффекта ещё неизвестна.
    july_model = ProfileModel(PARAMS).fit(hist, pd.Timestamp("2025-07-09"), weather)
    first_week = july_model.predict(pd.date_range("2025-07-10", "2025-07-16"), weather)
    first_week = first_week.merge(hist, on=["route", "date", "hour"])
    r7 = first_week[first_week.route == 7]
    multiplier = float(r7.y.sum() / r7.yhat.sum())
    july_base = july_model.predict(pd.date_range("2025-07-17", "2025-08-10"), weather)
    july_adjusted = july_base.copy()
    july_adjusted.loc[july_adjusted.route == 7, "yhat"] *= multiplier

    # На 17 августа сокращение уже закончилось: сравниваем очистку истории.
    recovery = {}
    for name, exclude in (("with_exclusion", True), ("without_exclusion", False)):
        params = ModelParams(**{**asdict(PARAMS), "exclude_disruptions": exclude})
        model = ProfileModel(params).fit(hist, pd.Timestamp("2025-08-17"), weather)
        pred = model.predict(pd.date_range("2025-08-18", "2025-08-31"), weather)
        recovery[name] = score(pred, hist, weekdays_only=True)

    return {"event_id": E.load()[0]["id"], "actual": actual,
            "july_holdout": {"fit_through": "2025-07-09", "effect_estimated_on": "2025-07-10/16",
                              "test": "2025-07-17/2025-08-10", "first_week_multiplier": round(multiplier, 4),
                              "without_adjustment": score(july_base, hist),
                              "with_adjustment": score(july_adjusted, hist)},
            "recovery_weekdays": {"fit_through": "2025-08-17", "test": "2025-08-18/31",
                                  **recovery}}


def traffic_analysis(hist: pd.DataFrame, weather: pd.DataFrame) -> dict:
    """Временной бэктест окон публикаций; единица статистики — дата сообщения."""
    observations = json.loads((DATA_DIR / "traffic_observations.json").read_text(encoding="utf-8"))
    event_dates = {pd.Timestamp(o["date"]) for o in observations if o["score"] >= 7}
    available_dates = set(hist.date.unique())
    precip = weather.set_index("date").precip
    actual = hist.groupby(["date", "hour"]).y.sum()
    forecast_cache: dict[pd.Timestamp, pd.Series] = {}

    def ratio(date: pd.Timestamp, hours: list[int]) -> float:
        if date not in forecast_cache:
            model = ProfileModel(PARAMS).fit(hist, date - pd.Timedelta(days=1), weather)
            pred = model.predict(pd.DatetimeIndex([date]), weather)
            forecast_cache[date] = pred.groupby("hour").yhat.sum()
        denominator = float(forecast_cache[date].reindex(hours).sum())
        numerator = float(actual.loc[(date, hours)].sum())
        if denominator <= 0:
            raise ValueError(f"Нулевой прогноз: {date.date()}")
        return numerator / denominator

    def precip_bin(date: pd.Timestamp) -> int:
        # Те же пороги, что в погодном компоненте модели.
        return int(np.searchsorted([-1.0, 0.1, 2.0, 6.0, np.inf], precip.loc[date], side="right") - 1)

    def summary(effects: list[float]) -> dict:
        if not effects:
            return {"n": 0, "mean_effect_pct": None, "bootstrap_95_pct": None, "sign_test_p": None}
        values = np.asarray(effects)
        rng = np.random.default_rng(2025)
        draws = values[rng.integers(0, len(values), (10000, len(values)))].mean(axis=1)
        ci = np.percentile(np.expm1(draws) * 100, [2.5, 97.5])
        positive = int((values > 0).sum())
        nonzero = int((values != 0).sum())
        tail = min(positive, nonzero - positive)
        p = min(1.0, 2 * sum(comb(nonzero, j) for j in range(tail + 1)) / 2 ** nonzero)
        return {"n": len(values), "mean_effect_pct": round(float(np.expm1(values.mean()) * 100), 2),
                "bootstrap_95_pct": [round(float(x), 2) for x in ci],
                "sign_test_p": round(p, 4), "positive_days": positive}

    rows = []
    effects, weather_matched_effects = [], []
    for obs in observations:
        row = {"id": obs["id"], "date": obs["date"], "score": obs["score"],
               "source_url": obs["source_url"], "observed_at": obs["observed_at"],
               "published_at": obs["published_at"]}
        if obs["score"] < 7:
            row["status"] = "below_7"
            rows.append(row)
            continue
        date = pd.Timestamp(obs["date"])
        if date not in available_dates:
            row["status"] = "missing_labels"
            rows.append(row)
            continue
        if len(obs["published_at"]) == 10 and obs["observed_at"] is None:
            row["status"] = "no_hour"
            rows.append(row)
            continue
        published = pd.Timestamp(obs["published_at"])
        measured = pd.Timestamp(obs["observed_at"]) if obs["observed_at"] else None
        if measured is not None and measured > published:
            raise ValueError(f"Измерение позже публикации: {obs['id']}")
        hour = (measured or published).hour
        hours = [h for h in (hour - 1, hour, hour + 1) if 0 <= h <= 23]
        candidates = [date + pd.Timedelta(days=offset) for offset in (-14, -7, 7, 14)]
        controls = [d for d in candidates if d in available_dates and d not in event_dates
                    and C.day_type(d) == C.day_type(date) and d.dayofweek == date.dayofweek]
        if not controls:
            row["status"] = "no_controls"
            rows.append(row)
            continue
        event_ratio = ratio(date, hours)
        control_ratios = [ratio(d, hours) for d in controls]
        effect = float(np.log(event_ratio) - np.log(control_ratios).mean())
        matched = [d for d in controls if precip_bin(d) == precip_bin(date)]
        row.update({"status": "evaluated", "hour_msk": hour,
                    "hour_precision": "measured" if measured is not None else "publication_hour_proxy",
                    "hours_compared": hours, "actual_over_forecast": round(event_ratio, 4),
                    "control_dates": [str(d.date()) for d in controls],
                    "control_actual_over_forecast": round(float(np.exp(np.log(control_ratios).mean())), 4),
                    "effect_pct": round(float(np.expm1(effect) * 100), 2),
                    "precip_mm_day": round(float(precip.loc[date]), 2),
                    "weather_matched_control_dates": [str(d.date()) for d in matched]})
        effects.append(effect)
        if matched:
            matched_effect = float(np.log(event_ratio) - np.log([ratio(d, hours) for d in matched]).mean())
            row["weather_matched_effect_pct"] = round(float(np.expm1(matched_effect) * 100), 2)
            weather_matched_effects.append(matched_effect)
        rows.append(row)
    all_result, matched_result = summary(effects), summary(weather_matched_effects)
    significant = (all_result["n"] >= 5 and matched_result["n"] >= 5
                   and all_result["sign_test_p"] < 0.05 and matched_result["sign_test_p"] < 0.05
                   and all_result["bootstrap_95_pct"][0] > 0 and matched_result["bootstrap_95_pct"][0] > 0)
    return {"observations": rows, "summary": all_result,
            "weather_matched_summary": matched_result,
            "positive_effect_confirmed": significant,
            "method": "Прогноз для каждой даты обучен по предшествующий день включительно; "
                      "остаток = факт/прогноз сети за три часа. Контроли: тот же день недели "
                      "и тип дня в пределах ±14 дней без других дат с подтверждёнными 7+ баллами. "
                      "Эффект — геометрическое среднее отношения остатка к контролям. "
                      "Погодный контроль — та же корзина суточных осадков плюс погодный компонент прогноза. "
                      "При неизвестной минуте измерения используется час публикации только для ретроспективной проверки; "
                      "для более раннего прогноза сообщение недоступно."}


def run() -> dict:
    hist = history()
    weather = W.daily(W.load_hourly())
    return {"repair": repair_analysis(hist, weather), "traffic": traffic_analysis(hist, weather)}


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False, indent=2))
