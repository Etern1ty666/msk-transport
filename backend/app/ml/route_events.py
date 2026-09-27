"""Подтверждённые изменения движения и маска обучения по маршрутам и датам."""
from __future__ import annotations

import json

import pandas as pd

from app.config import DATA_DIR

EVENTS_PATH = DATA_DIR / "route_events.json"


def load() -> list[dict]:
    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    for event in events:
        start, end = pd.Timestamp(event["start_date"]), pd.Timestamp(event["end_date"])
        published = pd.Timestamp(event["published_at"])
        if start > end or published > start or not event["routes"] or not event["source_url"]:
            raise ValueError(f"Некорректное событие движения: {event['id']}")
    return events


def disrupted_mask(hist: pd.DataFrame, events: list[dict] | None = None) -> pd.Series:
    """True для строк route × date, затронутых подтверждённым событием (границы включены)."""
    mask = pd.Series(False, index=hist.index)
    for event in load() if events is None else events:
        mask |= (hist.route.isin(event["routes"])
                 & hist.date.between(pd.Timestamp(event["start_date"]), pd.Timestamp(event["end_date"])))
    return mask
