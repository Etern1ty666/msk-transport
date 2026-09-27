"""Настройки сервиса, общие для всех пользователей и сохраняемые на сервере.

* корректирующие коэффициенты прогноза (погода, события, сезон, тренд, праздники) — по умолчанию подставляются
  во все эндпоинты, если клиент не прислал свои (карта, сводка, XLSX, API);
* множитель норматива посадок на вагон — от него считаются загрузка, дефицит и рекомендации;
* пороги рекомендаций по вагонам — ими пользуется интерфейс.

submission.csv для платформы хакатона настройки не меняют: он остаётся чистым выходом модели.
Файл — SETTINGS_PATH (по умолчанию data/settings.json); в Docker лежит в томе и переживает пересборку.
"""
from __future__ import annotations

import json
import os
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path

from app.config import DATA_DIR

PATH = Path(os.getenv("SETTINGS_PATH", DATA_DIR / "settings.json"))

# допустимые диапазоны: (мин, макс)
COEF_RANGE = {"weather": (0, 3), "event": (0, 3), "season": (0.3, 2), "trend": (0, 3), "holiday": (0, 3)}
LIMITS = {"norm_scale": (0.5, 1.5), "soft": (0.5, 0.99), "free": (0.1, 0.8), "free_target": (0.3, 0.95)}


@dataclass
class Settings:
    coef: dict = field(default_factory=lambda: {k: 1.0 for k in COEF_RANGE})
    norm_scale: float = 1.0   # множитель норматива посадок на вагон (1 — как в модели)
    soft: float = 0.8         # выше этой загрузки предлагаем свободные вагоны
    free: float = 0.5         # ниже этой загрузки можно снять вагоны
    free_target: float = 0.7  # после снятия загрузка не выше этой

    def as_dict(self) -> dict:
        return asdict(self)


DEFAULTS = Settings()
_lock = threading.Lock()
_cur = Settings()


class SettingsError(ValueError):
    pass


def _validate(d: dict) -> Settings:
    s = Settings(**{**asdict(DEFAULTS), **{k: v for k, v in d.items() if k in asdict(DEFAULTS)}})
    s.coef = {k: float(s.coef.get(k, 1.0)) for k in COEF_RANGE}
    for k, (lo, hi) in COEF_RANGE.items():
        if not lo <= s.coef[k] <= hi:
            raise SettingsError(f"Коэффициент {k} должен быть в диапазоне {lo}…{hi}")
    for k, (lo, hi) in LIMITS.items():
        v = float(getattr(s, k))
        if not lo <= v <= hi:
            raise SettingsError(f"{k} должен быть в диапазоне {lo}…{hi}")
        setattr(s, k, v)
    if s.free >= s.soft or s.free_target > s.soft:
        raise SettingsError("Пороги: «снимать ниже» и «после снятия не выше» должны быть меньше порога «добавлять от»")
    return s


def load() -> Settings:
    global _cur
    try:
        _cur = _validate(json.loads(PATH.read_text()))
    except FileNotFoundError:
        _cur = Settings()
    except (ValueError, TypeError, SettingsError):
        _cur = Settings()  # битый файл — работаем на настройках модели
    return _cur


def get() -> Settings:
    return _cur


def save(d: dict) -> Settings:
    global _cur
    s = _validate(d)
    with _lock:
        PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(s.as_dict(), ensure_ascii=False, indent=1))
        tmp.replace(PATH)
        _cur = s
    return s


load()
