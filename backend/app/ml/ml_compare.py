"""Сравнение профильной модели с ML-моделями (LightGBM, нейросеть MLP) на честном бэктесте.

Каждая ML-модель обучается только на прогнозах, сделанных из прошлых точек, и только на датах
не позже точки прогноза окна — будущее скрыто так же, как у профильной модели.

    python -m app.ml.ml_compare          # ≈ 5 мин → data/ml_compare.json (читается экраном «Модель»)
"""
from __future__ import annotations

import json
import time
import warnings

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

from app.config import DATA_DIR, DATASET_DIR
from app.ml import calendar as C
from app.ml import weather as W
from app.ml.model import ROUTES, ModelParams, ProfileModel, full_grid, wape_score

OUT = DATA_DIR / "ml_compare.json"
H = 61  # горизонт = длина периода сабмита (ноябрь–декабрь)
ROLL = pd.date_range("2025-04-11", "2025-09-26", freq="14D")  # скользящие точки, горизонт 56 дней

FEAT = ["route", "hour", "dc", "dow", "prof_pred", "base", "trend_mult", "cal_mult", "weather_mult", "m7", "m56",
        "r7", "r56", "route_lvl_ratio", "is_holiday", "holiday_first", "is_pre_holiday", "is_working_weekend",
        "school_holiday", "sp", "t_mean", "t_app", "precip", "snowfall", "wind"]
LGB_DIRECT = dict(objective="l1", learning_rate=0.05, n_estimators=400, num_leaves=31, min_child_samples=100,
                  feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, verbose=-1, n_jobs=4, random_state=0)
LGB_CORR = dict(LGB_DIRECT, learning_rate=0.03, n_estimators=200, num_leaves=15, min_child_samples=500, reg_lambda=5.0)
COUNTS = ["prof_pred", "base", "m7", "m56"]

MODELS = {
    "profile": "Профиль × тренд × календарь × погода (в продакшене)",
    "lgb_corr": "LightGBM: поправка к профилю (L1 = WAPE, регуляризация)",
    "lgb_direct": "LightGBM: посадки напрямую (L1 = WAPE)",
    "mlp": "Нейросеть MLP 64×32: поправка к профилю",
    "ens": "Ансамбль 0.7 · профиль + 0.3 · LightGBM",
}


def build_features(hist: pd.DataFrame, weather_daily: pd.DataFrame, params: ModelParams,
                   origins: list[pd.Timestamp]) -> pd.DataFrame:
    """Для каждой точки прогноза o: прогноз и компоненты профильной модели + статистики окна на o+1..o+H."""
    calh = C.calendar_frame(pd.DatetimeIndex(hist.date.unique()))
    hc = hist.merge(calh[["date", "day_class", "is_holiday", "is_pre_holiday"]], on="date")
    hc = hc[(hc.is_holiday == 0) & (hc.is_pre_holiday == 0)]
    out = []
    for o in origins:
        g = ProfileModel(params).fit(hist, o, weather_daily).predict(
            pd.date_range(o + pd.Timedelta(days=1), o + pd.Timedelta(days=H)), weather_daily)
        g["origin"], g["prof_pred"] = o, g.yhat
        for name, days in (("m7", 7), ("m56", 56)):
            w = hc[(hc.date > o - pd.Timedelta(days=days)) & (hc.date <= o)]
            st = w.groupby(["route", "day_class", "hour"]).y.mean().rename(name).reset_index()
            g = g.merge(st.rename(columns={"day_class": "ref_class"}), on=["route", "ref_class", "hour"], how="left")
        dl = hc[(hc.date > o - pd.Timedelta(days=56)) & (hc.date <= o)].groupby(["route", "date"]).y.sum().reset_index()
        lvl = dl[dl.date > o - pd.Timedelta(days=7)].groupby("route").y.mean() / dl.groupby("route").y.mean()
        g["route_lvl_ratio"] = g.route.map(lvl).fillna(1.0)
        out.append(g)
    F = pd.concat(out, ignore_index=True).merge(weather_daily, on="date", how="left")
    F = F.merge(hist, on=["route", "date", "hour"], how="left")  # y = NaN за пределами истории
    F["dc"] = F.day_class.map({"mon": 0, "mid": 1, "fri": 2, "sat": 3, "sun": 4}).astype(int)
    F["sp"] = F.special.map({"": 0, "pre_new_year": 1, "new_year_eve": 2}).fillna(0).astype(int)
    for c in ("m7", "m56"):
        F[c] = F[c].fillna(F.base)
    F["r7"], F["r56"] = (F.m7 + 1) / (F.base + 1), (F.m56 + 1) / (F.base + 1)
    return F


def fit_predict(tr: pd.DataFrame, te: pd.DataFrame) -> dict[str, np.ndarray]:
    w, wt = np.maximum(tr.prof_pred.to_numpy(), 1.0), np.maximum(te.prof_pred.to_numpy(), 1.0)
    ratio = (tr.y / w).clip(0, 3)
    out = {"profile": te.prof_pred.to_numpy()}
    m = lgb.LGBMRegressor(**LGB_CORR).fit(tr[FEAT], ratio, sample_weight=w, categorical_feature=["route"])
    out["lgb_corr"] = m.predict(te[FEAT]).clip(0) * wt
    m = lgb.LGBMRegressor(**LGB_DIRECT).fit(tr[FEAT], tr.y, categorical_feature=["route"])
    out["lgb_direct"] = m.predict(te[FEAT]).clip(0)

    num = [c for c in FEAT if c != "route"]
    def X(d: pd.DataFrame) -> pd.DataFrame:
        x = d[num].copy()
        x[COUNTS] = np.log1p(x[COUNTS].clip(lower=0))
        return x
    sc = StandardScaler().fit(X(tr))
    cat = pd.CategoricalDtype(ROUTES)
    enc = lambda d: np.hstack([sc.transform(X(d)), pd.get_dummies(d.route.astype(cat)).to_numpy(float)])
    mask = tr.prof_pred.to_numpy() >= 5  # отношение осмысленно там, где есть поток
    nn = MLPRegressor(hidden_layer_sizes=(64, 32), alpha=1e-2, learning_rate_init=1e-3, max_iter=40,
                      early_stopping=True, random_state=0).fit(enc(tr[mask]), ratio[mask])
    out["mlp"] = nn.predict(enc(te)).clip(0, 3) * wt
    out["ens"] = 0.7 * out["profile"] + 0.3 * out["lgb_corr"]
    return out


def run(log=print) -> dict:
    from app.pipeline import BACKTEST_FOLDS, HIST_END, HIST_START, PARAMS
    warnings.filterwarnings("ignore")
    t0 = time.time()
    lab = pd.concat([pd.read_csv(DATASET_DIR / "labels" / f"labels_day_{s}.csv", sep=";") for s in ("train", "test")])
    lab["date"] = pd.to_datetime(lab.date)
    hist = full_grid(lab[lab.date <= HIST_END], HIST_START, HIST_END)
    wd = W.daily(W.load_hourly())
    folds = [(pd.Timestamp(o), pd.Timestamp(s), pd.Timestamp(e), t, "5 окон") for o, s, e, t in BACKTEST_FOLDS]
    folds += [(o, o + pd.Timedelta(days=1), min(o + pd.Timedelta(days=56), pd.Timestamp(HIST_END)),
               f"скользящее {o:%d.%m} + 56 дн", "скользящие") for o in ROLL]
    origins = sorted(set(pd.date_range("2025-01-31", HIST_END, freq="7D")) | {f[0] for f in folds})
    F = build_features(hist, wd, PARAMS, origins)
    log(f"признаки: {len(origins)} точек прогноза, {len(F):,} строк".replace(",", " "))

    rows = []
    for O, s, e, title, kind in folds:
        tr = F[(F.origin < O) & (F.date <= O) & F.y.notna()]
        te = F[(F.origin == O) & (F.date >= s) & (F.date <= e)]
        preds = fit_predict(tr, te)
        rows.append({"set": kind, "title": title, "train_rows": len(tr),
                     **{k: round(wape_score(te.y.to_numpy(), v), 4) for k, v in preds.items()}})
        log(f"{title}: " + ", ".join(f"{k} {rows[-1][k]:.4f}" for k in MODELS))
    R = pd.DataFrame(rows)
    mean = {kind: {k: round(float(g[k].mean()), 4) for k in MODELS} for kind, g in R.groupby("set")}
    res = {"models": MODELS, "folds": rows, "mean": mean, "seconds": round(time.time() - t0),
           "winner": max(MODELS, key=lambda k: mean["5 окон"][k] + mean["скользящие"][k])}
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1))
    log(f"среднее: {mean} → {OUT}")
    return res


if __name__ == "__main__":
    run()
