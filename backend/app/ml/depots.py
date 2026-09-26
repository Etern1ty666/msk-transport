"""Площадки (депо) и парк вагонов — из сырых валидаций: откуда можно взять вагоны на перегруженный маршрут.

В валидации `place_id` — площадка трамвайного управления, `garage_number` — бортовой номер вагона. По последним 4 неделям:
  * маршрут → его площадка (где совершено > 90 % посадок);
  * парк площадки — вагоны, чья основная площадка эта; сколько из них за месяц работали на 2+ маршрутах (переброска — обычная практика);
  * выпуск: сколько вагонов площадки одновременно на линии в час пик (p90 по будням) — столько площадка реально может выпустить.

    python -m app.ml.depots        # ≈ 10 с по test.csv → data/depots.json (в образе — готовый кэш)
"""
from __future__ import annotations

import json
import time

import duckdb

from app.config import DATA_DIR, DATASET_DIR

OUT = DATA_DIR / "depots.json"
WINDOW = ("2025-10-04", "2025-11-01")  # последние 4 недели истории
# название известно только для одной площадки — из примера валидаций организаторов («Место прохода»)
NAMES = {"39707": "площадка Русакова"}

SRC = """
CREATE TABLE v AS
SELECT CAST(regexp_extract(ngpt_route, '(\\d+)', 1) AS INTEGER) AS route, place_id AS place, garage_number AS car,
       try_strptime(tran_date_time, '%Y-%m-%d %H:%M:%S') AS ts
FROM read_csv('{src}', delim=';', header=true, all_varchar=true, quote='', escape='',
              strict_mode=false, null_padding=true, ignore_errors=true, parallel=true)
WHERE validation_result = '1' AND ngpt_route IS NOT NULL AND garage_number IS NOT NULL
  AND tran_date_time >= '{d0}' AND tran_date_time < '{d1}'
"""


def build() -> dict:
    t0 = time.time()
    con = duckdb.connect()
    con.execute(SRC.format(src=DATASET_DIR / "test.csv", d0=WINDOW[0], d1=WINDOW[1]))
    route_place = {int(r): p for r, p, _ in con.execute("""
        SELECT route, arg_max(place, n), max(n) / sum(n) FROM
          (SELECT route, place, count(*) n FROM v GROUP BY ALL) GROUP BY route""").fetchall()}
    # основная площадка вагона и сколько маршрутов он обслужил за окно
    con.execute("""CREATE TABLE cars AS SELECT car, arg_max(place, n) AS place, count(DISTINCT route) AS routes
                   FROM (SELECT car, place, route, count(*) n FROM v GROUP BY ALL) GROUP BY car""")
    fleet = {p: (int(n), int(multi)) for p, n, multi in con.execute(
        "SELECT place, count(*), count(*) FILTER (WHERE routes >= 2) FROM cars GROUP BY place").fetchall()}
    # пик выпуска: вагонов площадки на линии в самый загруженный час дня, p90 по будням
    peak = dict(con.execute("""
        SELECT place, quantile_cont(mx, 0.9) FROM (
          SELECT place, d, max(n) mx FROM (
            SELECT c.place, CAST(v.ts AS DATE) d, hour(v.ts) h, count(DISTINCT v.car) n
            FROM v JOIN cars c USING (car) WHERE isodow(v.ts) <= 5 GROUP BY ALL) GROUP BY ALL)
        GROUP BY place""").fetchall())
    places = {}
    for p in sorted(set(route_place.values())):
        n, multi = fleet.get(p, (0, 0))
        places[p] = {"name": NAMES.get(p, f"площадка {p}"), "fleet": n, "multi_route": multi,
                     "peak_out": int(round(peak.get(p, 0))), "routes": sorted(r for r, q in route_place.items() if q == p)}
    res = {"window": WINDOW, "route_place": {str(r): p for r, p in route_place.items()}, "places": places,
           "source": "test.csv: place_id, garage_number, ngpt_route успешных валидаций"}
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(f"{time.time() - t0:.0f}s → {OUT}\n" + json.dumps(places, ensure_ascii=False, indent=1))
    return res


def load() -> dict | None:
    return json.loads(OUT.read_text()) if OUT.exists() else None


if __name__ == "__main__":
    build()
