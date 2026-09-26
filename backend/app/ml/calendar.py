"""Календарь РФ/Москвы на 2025 год — внешний источник «сезонность и календарь».

Источники:
  * Производственный календарь 2025 (Постановление Правительства РФ от 04.10.2024 № 1335):
    https://www.consultant.ru/law/ref/calendar/proizvodstvennye/2025/
  * Машиночитаемая версия: https://xmlcalendar.ru/data/ru/2025/calendar.json
  * Производственный календарь 2026: https://www.consultant.ru/law/ref/calendar/proizvodstvennye/2026/
  * Школьные каникулы Москвы: https://www.mos.ru/otvet-obrazovanie/kogda-kanikuly-v-shkolah-moskvy/
"""
from __future__ import annotations

import pandas as pd

SOURCES = {
    "production_calendar": "https://www.consultant.ru/law/ref/calendar/proizvodstvennye/2025/",
    "production_calendar_json": "https://xmlcalendar.ru/data/ru/2025/calendar.json",
    "production_calendar_2026": "https://www.consultant.ru/law/ref/calendar/proizvodstvennye/2026/",
    "school_holidays": "https://www.mos.ru/otvet-obrazovanie/kogda-kanikuly-v-shkolah-moskvy/",
}

# Нерабочие праздничные и перенесённые выходные дни, выпадающие на будни.
HOLIDAYS_2025 = [
    "2025-01-01", "2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07", "2025-01-08",
    "2025-05-01", "2025-05-02", "2025-05-08", "2025-05-09",
    "2025-06-12", "2025-06-13",
    "2025-11-03", "2025-11-04",
    "2025-12-31",
    # 2026 (Постановление Правительства РФ № 1466 от 24.09.2025) — для годового горизонта
    "2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
    "2026-02-23", "2026-03-09", "2026-05-01", "2026-05-11", "2026-06-12", "2026-11-04", "2026-12-31",
]
# Рабочие субботы (перенос).
WORKING_WEEKENDS_2025 = ["2025-11-01"]
# Сокращённые предпраздничные дни.
PRE_HOLIDAY_2025 = ["2025-03-07", "2025-04-30", "2025-05-07", "2025-06-11", "2025-11-01",
                    "2026-04-30", "2026-05-08", "2026-06-11", "2026-11-03"]

# Школьные каникулы Москвы (2024/25 и 2025/26 учебные годы).
SCHOOL_HOLIDAYS = [
    ("2024-12-28", "2025-01-08"),
    ("2025-03-22", "2025-03-30"),
    ("2025-05-27", "2025-08-31"),
    ("2025-10-25", "2025-11-02"),
    ("2025-12-27", "2026-01-11"),
    ("2026-03-21", "2026-03-29"),
    ("2026-05-26", "2026-08-31"),
]

# Особые дни, для которых отдельные множители к «опорному» профилю (оценены на Jan/May 2025).
SPECIAL_DAYS = {
    "2025-12-31": "new_year_eve",
    "2025-12-30": "pre_new_year",
    "2025-12-29": "pre_new_year",
}

_HOL = {pd.Timestamp(x) for x in HOLIDAYS_2025}
_WORK = {pd.Timestamp(x) for x in WORKING_WEEKENDS_2025}
_PRE = {pd.Timestamp(x) for x in PRE_HOLIDAY_2025}


def is_school_holiday(d: pd.Timestamp) -> bool:
    return any(pd.Timestamp(a) <= d <= pd.Timestamp(b) for a, b in SCHOOL_HOLIDAYS)


def day_type(d: pd.Timestamp) -> str:
    """Тип дня: wd (будни) / sat / sun / hol (праздник, ведёт себя как воскресенье)."""
    d = pd.Timestamp(d)
    if d in _HOL:
        return "hol"
    if d in _WORK:
        return "wd"
    if d.dayofweek == 5:
        return "sat"
    if d.dayofweek == 6:
        return "sun"
    return "wd"


def day_class(d: pd.Timestamp) -> str:
    """Класс дня для профиля: mon / mid (вт–чт) / fri / sat / sun. Праздники → sun."""
    t = day_type(d)
    if t in ("hol", "sun"):
        return "sun"
    if t == "sat":
        return "sat"
    d = pd.Timestamp(d)
    if d in _WORK:  # рабочая суббота — как пятница
        return "fri"
    return {0: "mon", 4: "fri"}.get(d.dayofweek, "mid")


def calendar_frame(dates: pd.DatetimeIndex) -> pd.DataFrame:
    dates = pd.DatetimeIndex(dates)
    df = pd.DataFrame({"date": dates})
    df["dow"] = dates.dayofweek
    df["day_type"] = [day_type(d) for d in dates]
    df["day_class"] = [day_class(d) for d in dates]
    df["is_holiday"] = df.day_type.eq("hol").astype(int)
    df["is_pre_holiday"] = dates.isin(list(_PRE)).astype(int)
    df["is_working_weekend"] = dates.isin(list(_WORK)).astype(int)
    df["school_holiday"] = [int(is_school_holiday(d)) for d in dates]
    df["special"] = [SPECIAL_DAYS.get(d.strftime("%Y-%m-%d"), "") for d in dates]
    # праздник сразу после рабочего дня — самый «пустой» (люди уезжают)
    prev_wd = [day_type(d - pd.Timedelta(days=1)) == "wd" for d in dates]
    df["holiday_first"] = (df.is_holiday.eq(1) & pd.Series(prev_wd)).astype(int)
    return df

