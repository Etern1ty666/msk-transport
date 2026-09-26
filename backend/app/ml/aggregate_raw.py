"""Агрегация сырых валидаций (train.csv/test.csv, ~10 ГБ) в почасовые признаки через DuckDB.

Запуск: python -m app.ml.aggregate_raw  (из каталога backend)
Результат: data/raw_hourly.parquet — route × date × hour с признаками предложения/спроса.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import duckdb

from app.config import DATA_DIR, DATASET_DIR

SQL = """
COPY (
  SELECT
    CAST(regexp_extract(ngpt_route, '(\\d+)', 1) AS INTEGER)            AS route,
    CAST(ts AS DATE)                                                     AS date,
    hour(ts)                                                             AS hour,
    count(*) FILTER (WHERE vr = 1)                        AS boardings,
    count(*)                                                             AS validations,
    count(*) FILTER (WHERE vr <> 1)                       AS failures,
    count(DISTINCT crd_hashcode) FILTER (WHERE vr = 1)    AS unique_cards,
    count(DISTINCT garage_number)                                        AS vehicles,
    count(DISTINCT device_no)                                            AS devices,
    count(DISTINCT bus_exit_no)                                          AS exits,
    count(*) FILTER (WHERE vr = 1 AND good_type ILIKE '%КОШЕЛЕК%') AS wallet,
    count(*) FILTER (WHERE vr = 1 AND regexp_matches(good_type, '(дн|мес|год|ЕДИНЫЙ)', 'i')) AS pass_tickets,
    count(*) FILTER (WHERE vr = 1 AND good_type ILIKE '%СКМ%') AS social
  FROM (
    SELECT *, try_strptime(tran_date_time, '%Y-%m-%d %H:%M:%S') AS ts, TRY_CAST(validation_result AS INTEGER) AS vr
    FROM read_csv({files}, delim=';', header=true, all_varchar=true, quote='', escape='',
                  strict_mode=false, null_padding=true, ignore_errors=true, parallel=true)
  )
  WHERE ts IS NOT NULL AND ngpt_route IS NOT NULL
  GROUP BY ALL
) TO '{out}' (FORMAT PARQUET);
"""


def main() -> None:
    files = [str(DATASET_DIR / "train.csv"), str(DATASET_DIR / "test.csv")]
    out = DATA_DIR / "raw_hourly.parquet"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("SET threads TO 8; SET memory_limit='6GB'; SET preserve_insertion_order=false;")
    t0 = time.time()
    con.execute(SQL.format(files=files, out=out))
    n = con.execute(f"SELECT count(*), sum(boardings) FROM '{out}'").fetchone()
    print(f"done in {time.time() - t0:.0f}s rows={n[0]} boardings={n[1]} -> {out}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
