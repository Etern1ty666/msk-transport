"""Чем платят пассажиры: доли типов оплаты по маршруту и часу — из сырых успешных валидаций.

Наличных в валидациях нет (в трамвае оплата только картой или билетом), поэтому разбивка по носителю / тарифу `good_type`:
  * «Тройка» — кошелёк (`КОШЕЛЕК`);
  * банковская карта — `ББК МГТ`;
  * проездные — «N дней», ТАТ, студенческие / школьные «ММ+МГТ …»;
  * льготные — социальные карты (СКМ, СКМО, СК ГУВД, БСК …);
  * билеты — разовые и суточные («ЕДИНЫЙ», ВЕСБ, «сутки», «поездок»).
Доли считаются по последним 4 неделям истории; прогноз посадок в сервисе делится по ним.

    python -m app.ml.paymix        # ≈ 10 с по test.csv → data/paymix.json (в образе — готовый кэш)
"""
from __future__ import annotations

import json
import time

import duckdb

from app.config import DATA_DIR, DATASET_DIR

OUT = DATA_DIR / "paymix.json"
WINDOW = ("2025-10-04", "2025-11-01")  # последние 4 недели истории
CATS = [("troika", "Тройка"), ("bank", "Банковская карта"), ("pass", "Проездные"), ("social", "Льготные"), ("single", "Билеты")]
MIN_N = 200  # меньше валидаций в часе за окно — берём доли маршрута за весь день

SQL = """
SELECT CAST(regexp_extract(ngpt_route, '(\\d+)', 1) AS INTEGER) AS route, hour(ts) AS hour,
  CASE WHEN good_type ILIKE '%КОШЕЛЕК%' THEN 'troika'
       WHEN good_type ILIKE 'ББК%' THEN 'bank'
       WHEN regexp_matches(good_type, '(ЕДИН|ЕД\\.|ВЕСБ|сут|поезд)', 'i') THEN 'single'
       WHEN regexp_matches(good_type, '^\\s*(СК|БСК)', 'i') THEN 'social'
       ELSE 'pass' END AS cat,
  count(*) AS n
FROM (SELECT *, try_strptime(tran_date_time, '%Y-%m-%d %H:%M:%S') AS ts
      FROM read_csv('{src}', delim=';', header=true, all_varchar=true, quote='', escape='',
                    strict_mode=false, null_padding=true, ignore_errors=true, parallel=true))
WHERE validation_result = '1' AND ngpt_route IS NOT NULL AND ts IS NOT NULL
  AND tran_date_time >= '{d0}' AND tran_date_time < '{d1}'
GROUP BY ALL
"""


def build() -> dict:
    t0 = time.time()
    rows = duckdb.connect().execute(SQL.format(src=DATASET_DIR / "test.csv", d0=WINDOW[0], d1=WINDOW[1])).fetchall()
    keys = [k for k, _ in CATS]
    cnt: dict[int, list[list[int]]] = {}
    for r, h, c, n in rows:
        cnt.setdefault(int(r), [[0] * len(keys) for _ in range(24)])[int(h)][keys.index(c)] += int(n)
    routes = {}
    for r, hours in sorted(cnt.items()):
        day = [sum(h[k] for h in hours) for k in range(len(keys))]
        tot = sum(day) or 1
        day_share = [round(v / tot, 4) for v in day]
        routes[str(r)] = {"day": day_share,
                          "hours": [[round(v / sum(h), 4) for v in h] if sum(h) >= MIN_N else day_share for h in hours]}
    res = {"window": WINDOW, "cats": [{"key": k, "title": t} for k, t in CATS], "routes": routes,
           "source": "test.csv: good_type успешных валидаций"}
    OUT.write_text(json.dumps(res, ensure_ascii=False))
    print(f"{time.time() - t0:.0f}s → {OUT}\n" + json.dumps({r: v["day"] for r, v in routes.items()}, ensure_ascii=False, indent=1))
    return res


def load() -> dict | None:
    return json.loads(OUT.read_text()) if OUT.exists() else None


if __name__ == "__main__":
    build()
