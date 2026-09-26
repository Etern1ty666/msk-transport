"""CLI: воспроизводимая сборка модели и submission.csv без веб-сервиса.

    python -m app.cli                       # конвейер → data/submission.csv
    python -m app.cli --scale 1.02          # вариант с поправкой уровня
    python -m app.cli --force-raw           # пересчитать агрегаты из сырых 10 ГБ
"""
from __future__ import annotations

import argparse
import shutil

from app.config import DATA_DIR
from app.events import bus
from app.pipeline import PARAMS, pipeline


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=PARAMS.scale, help="общий множитель уровня")
    ap.add_argument("--force-raw", action="store_true")
    ap.add_argument("--out", default=None, help="куда скопировать submission.csv")
    a = ap.parse_args()
    PARAMS.scale = a.scale
    pipeline.start(force_raw=a.force_raw, background=False)
    for e in bus.history:
        if e["kind"] == "log":
            print(f"[{e['stage']}] {e['message']}")
        elif e["kind"] == "run" and e.get("status") == "error":
            raise SystemExit(e.get("error"))
    if a.out:
        shutil.copy(DATA_DIR / "submission.csv", a.out)
        print("→", a.out)


if __name__ == "__main__":
    main()
