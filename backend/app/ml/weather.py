"""Почасовая погода Москвы — внешний источник «погодные условия».

Источник: Open-Meteo Historical Weather API (ERA5), бесплатно, без ключа.
  https://open-meteo.com/en/docs/historical-weather-api
В продакшене на будущие даты подставляется прогноз: https://open-meteo.com/en/docs
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pandas as pd

from app.config import DATA_DIR

SOURCE = "https://open-meteo.com/en/docs/historical-weather-api"
URL = (
    "https://archive-api.open-meteo.com/v1/archive?latitude=55.7558&longitude=37.6173"
    "&start_date={start}&end_date={end}"
    "&hourly=temperature_2m,apparent_temperature,precipitation,rain,snowfall,snow_depth,"
    "wind_speed_10m,cloud_cover,weather_code&timezone=Europe%2FMoscow"
)
CACHE = DATA_DIR / "weather_raw.json"


def fetch(start: str = "2025-01-01", end: str = "2025-12-31", cache: Path = CACHE) -> dict:
    if cache.exists():
        return json.loads(cache.read_text())
    r = httpx.get(URL.format(start=start, end=end), timeout=60)
    r.raise_for_status()
    cache.write_text(r.text)
    return r.json()


def load_hourly() -> pd.DataFrame:
    h = pd.DataFrame(fetch()["hourly"])
    h["time"] = pd.to_datetime(h.time)
    h["date"] = h.time.dt.normalize()
    h["hour"] = h.time.dt.hour
    return h.drop(columns="time")


def daily(h: pd.DataFrame) -> pd.DataFrame:
    day = h[(h.hour >= 6) & (h.hour <= 21)]  # погода в часы работы трамвая
    return day.groupby("date").agg(
        t_mean=("temperature_2m", "mean"),
        t_app=("apparent_temperature", "mean"),
        precip=("precipitation", "sum"),
        snowfall=("snowfall", "sum"),
        wind=("wind_speed_10m", "mean"),
    ).reset_index()
