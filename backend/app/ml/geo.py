"""Геопривязка: линии маршрутов и остановки.

Источники:
  * Справочники хакатона (GTFS-подобные, остановки с координатами и порядком) — маршруты 1, 5, 7, 11, 12.
  * OpenStreetMap (Overpass API), relation route=tram — геометрия линий и остановки остальных маршрутов.
    https://wiki.openstreetmap.org/wiki/Overpass_API  (зеркало: https://maps.mail.ru/osm/tools/overpass/)

Разбивка потока маршрута по остановкам — оценочная (весовая модель), в валидациях остановки нет.
"""
from __future__ import annotations

import json
import math
import re

import httpx
import pandas as pd

from app.config import DATA_DIR, DATASET_DIR

OSM_CACHE = DATA_DIR / "osm_tram.json"
OVERPASS = "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
OVERPASS_QUERY = (
    '[out:json][timeout:120];rel(55.49,37.30,55.96,37.95)["route"="tram"]'
    '["ref"~"^(1|5|7|11|12|17|25|26|28|50)$"];out body;>;out body qt;'
)
SPRAV = DATASET_DIR / "spravochniki" / "Хакатон_справочники_трамвай_10_маршрутов.xlsx"
HUB_RE = re.compile(r"метро|мцк|мцд|вокзал|платформа|станция|рынок|парк|больниц|университет", re.I)
# Все трамвайные маршруты Москвы (OpenStreetMap, relation route=tram в границах Москвы, выгрузка 26.09.2026;
# без служебных т1/т2). Данные хакатона есть только по 10 из них — остальные показываются в интерфейсе неактивными.
ALL_TRAM_ROUTES = ["1", "1а", "2", "4", "5", "6", "7", "10", "11", "12", "13", "14", "15", "16", "17", "21", "23", "25",
                   "26", "27", "28", "29", "30", "31", "32", "36", "38", "39", "39а", "43", "46", "47", "47а", "49", "50", "А"]
# Цвета маршрутов по официальной схеме трамвайных маршрутов Москвы (Мосгортранс / Транспорт Москвы)
ROUTE_COLORS = {
    1: "#9b3b2f", 5: "#a3a3a3", 7: "#f39200", 11: "#8a5a3c", 12: "#8e8e93",
    17: "#f5b400", 25: "#7cc242", 26: "#0078c8", 28: "#a7a9ac", 50: "#00a661",
}


def fetch_osm() -> dict:
    if OSM_CACHE.exists():
        return json.loads(OSM_CACHE.read_text())
    r = httpx.post(OVERPASS, data={"data": OVERPASS_QUERY}, timeout=180,
                   headers={"User-Agent": "tramflow-hackathon/1.0"})
    r.raise_for_status()
    OSM_CACHE.write_text(r.text)
    return r.json()


def _osm_routes(osm: dict) -> dict[int, dict]:
    nodes = {e["id"]: e for e in osm["elements"] if e["type"] == "node"}
    ways = {e["id"]: e for e in osm["elements"] if e["type"] == "way"}
    rels = sorted((e for e in osm["elements"] if e["type"] == "relation"), key=lambda e: e["id"])
    out: dict[int, dict] = {}
    for rel in rels:
        ref = int(rel["tags"]["ref"])
        lines = []
        for m in rel["members"]:
            if m["type"] == "way" and m["role"] == "" and m["ref"] in ways:
                coords = [[nodes[n]["lon"], nodes[n]["lat"]] for n in ways[m["ref"]]["nodes"] if n in nodes]
                if len(coords) > 1:
                    lines.append(coords)
        stops, seen = [], set()
        for m in rel["members"]:
            if m["type"] == "node" and m["role"].startswith("stop") and m["ref"] in nodes:
                nd = nodes[m["ref"]]
                name = nd.get("tags", {}).get("name") or f"Остановка {m['ref']}"
                if name in seen:
                    continue
                seen.add(name)
                stops.append({"stop_id": f"osm{m['ref']}", "name": name, "lat": nd["lat"], "lon": nd["lon"]})
        r = out.setdefault(ref, {"lines": [], "stops": [], "name": rel["tags"].get("name", "")})
        r["lines"].extend(lines)
        if not r["stops"]:  # остановки — по первому направлению
            r["stops"] = stops
            r["name"] = rel["tags"].get("name", "")
    return out


def _sprav_stops() -> dict[int, list[dict]]:
    if not SPRAV.exists():
        return {}
    x = pd.read_excel(SPRAV, sheet_name="Порядок_с_координатами")
    x = x[x.direction_id == 0].sort_values(["route_short_name", "stop_sequence"])
    out: dict[int, list[dict]] = {}
    for route, g in x.groupby("route_short_name"):
        seen, stops = set(), []
        for r in g.itertuples():
            if r.stop_name in seen:
                continue
            seen.add(r.stop_name)
            stops.append({"stop_id": str(r.stop_id), "name": r.stop_name,
                          "lat": float(r.stop_lat), "lon": float(r.stop_lon)})
        out[int(route)] = stops
    return out


def stop_weights(stops: list[dict]) -> list[float]:
    """Доля посадок на остановке: пересадочные узлы ×2.5, конечные ×1.8, прочие ×1."""
    w = []
    for i, s in enumerate(stops):
        k = 1.0
        if HUB_RE.search(s["name"]):
            k *= 2.5
        if i in (0, len(stops) - 1):
            k *= 1.8
        w.append(k)
    tot = sum(w) or 1.0
    return [x / tot for x in w]


def build_segments(routes: list[int], one_direction: bool = False) -> list[dict]:
    """Отрезки путей OSM с перечнем маршрутов на каждом — для «пучков» параллельных линий как на схеме.

    Направление отрезка нормализуем (запад → восток), чтобы смещение линий не «переворачивалось» на стыках.
    """
    osm = fetch_osm()
    nodes = {e["id"]: e for e in osm["elements"] if e["type"] == "node"}
    ways = {e["id"]: e for e in osm["elements"] if e["type"] == "way"}
    on_way: dict[int, set[int]] = {}
    taken: set[int] = set()
    for rel in sorted((e for e in osm["elements"] if e["type"] == "relation"), key=lambda e: e["id"]):
        ref = int(rel["tags"]["ref"])
        if ref not in routes or (one_direction and ref in taken):
            continue  # для схемы — один путь на маршрут: там, где «туда» и «обратно» идут по разным улицам, линия не двоится
        taken.add(ref)
        for m in rel["members"]:
            if m["type"] == "way" and m["role"] == "" and m["ref"] in ways:
                on_way.setdefault(m["ref"], set()).add(ref)
    out = []
    for wid, rs in on_way.items():
        coords = [[round(nodes[n]["lon"], 6), round(nodes[n]["lat"], 6)] for n in ways[wid]["nodes"] if n in nodes]
        if len(coords) < 2:
            continue
        dx, dy = coords[-1][0] - coords[0][0], coords[-1][1] - coords[0][1]
        if dx < 0 or (abs(dx) < 1e-9 and dy < 0):
            coords.reverse()
        out.append({"id": wid, "routes": sorted(rs), "coords": coords})
    return out


def build_geo(routes: list[int]) -> dict:
    osm = _osm_routes(fetch_osm())
    sprav = _sprav_stops()
    result = {}
    for r in routes:
        o = osm.get(r, {"lines": [], "stops": [], "name": ""})
        stops = sprav.get(r) or o["stops"]
        src = "справочник хакатона" if r in sprav else "OpenStreetMap"
        for s, w in zip(stops, stop_weights(stops)):
            s["weight"] = round(w, 5)
        result[r] = {
            "route": r, "name": o["name"], "color": ROUTE_COLORS.get(r, "#888"),
            "lines": o["lines"], "stops": stops, "stops_source": src,
        }
    return result


# ---------------------------------------------------------------- схема (как на официальной схеме маршрутов)
SCHEMA_GRID_M = 80      # привязка вершин к сетке, м — общие узлы у соседних участков остаются общими
SCHEMA_TOL_M = 230      # упрощение Дугласа — Пекера, м — убирает мелкие изгибы улиц
_KX = math.cos(math.radians(55.75)) * 111_320
_KY = 110_540


def _dp(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-9
    best, idx = -1.0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / norm if norm > 1e-9 else math.hypot(pts[i][0] - x1, pts[i][1] - y1)
        if d > best:
            best, idx = d, i
    if best <= tol:
        return [pts[0], pts[-1]]
    return _dp(pts[: idx + 1], tol)[:-1] + _dp(pts[idx:], tol)


def _octilinear(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Каждый отрезок — под 0/45/90°: сначала диагональ, затем прямая (как на схемах метро)."""
    out = [pts[0]]
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        ax, ay = abs(dx), abs(dy)
        if min(ax, ay) > 0.2 * max(ax, ay) and abs(ax - ay) > 0.2 * max(ax, ay):
            d = min(ax, ay)
            out.append((x1 + math.copysign(d, dx), y1 + math.copysign(d, dy)))
        out.append((x2, y2))
    return out


def build_schema(segments: list[dict], geo: dict[int, dict]) -> dict:
    """Схематичная сеть: сливаем участки в цепочки с одинаковым набором маршрутов, привязываем к сетке,
    упрощаем и выпрямляем под 45°/90°. Остановки проецируются на выпрямленные линии своего маршрута."""
    key = lambda p: (round(p[0], 6), round(p[1], 6))
    ends: dict[tuple, list[tuple[int, int]]] = {}
    for i, s in enumerate(segments):
        ends.setdefault(key(s["coords"][0]), []).append((i, 0))
        ends.setdefault(key(s["coords"][-1]), []).append((i, 1))
    visited: set[int] = set()

    def extend(pts: list, routes: list) -> None:
        while True:
            around = ends.get(key(pts[-1]), [])
            if len(around) != 2:
                return
            nxt = [(j, e) for j, e in around if j not in visited]
            if len(nxt) != 1 or segments[nxt[0][0]]["routes"] != routes:
                return
            j, e = nxt[0]
            visited.add(j)
            c = segments[j]["coords"] if e == 0 else segments[j]["coords"][::-1]
            pts.extend(c[1:])

    snap = lambda v: round(v / SCHEMA_GRID_M) * SCHEMA_GRID_M
    out, by_route_xy = [], {}
    for i, s in enumerate(segments):
        if i in visited:
            continue
        visited.add(i)
        pts = list(s["coords"])
        extend(pts, s["routes"])
        pts.reverse()
        extend(pts, s["routes"])
        xy = []
        for lon, lat in pts:
            p = (snap(lon * _KX), snap(lat * _KY))
            if not xy or p != xy[-1]:
                xy.append(p)
        if len(xy) < 2:
            continue
        xy = _octilinear(_dp(xy, SCHEMA_TOL_M))
        if xy[-1][0] < xy[0][0] or (xy[-1][0] == xy[0][0] and xy[-1][1] < xy[0][1]):
            xy.reverse()
        out.append({"id": s["id"], "routes": s["routes"],
                    "coords": [[round(x / _KX, 6), round(y / _KY, 6)] for x, y in xy]})
        for r in s["routes"]:
            by_route_xy.setdefault(r, []).append(xy)

    def project(px: float, py: float, lines: list) -> tuple[float, float]:
        best, bp = float("inf"), (px, py)
        for xy in lines:
            for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
                dx, dy = x2 - x1, y2 - y1
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / ((dx * dx + dy * dy) or 1e-9)))
                qx, qy = x1 + t * dx, y1 + t * dy
                d = (qx - px) ** 2 + (qy - py) ** 2
                if d < best:
                    best, bp = d, (qx, qy)
        return bp

    stops = {}
    for r, g in geo.items():
        lines = by_route_xy.get(r, [])
        stops[r] = {}
        for st in g["stops"]:
            x, y = project(st["lon"] * _KX, st["lat"] * _KY, lines) if lines else (st["lon"] * _KX, st["lat"] * _KY)
            stops[r][st["stop_id"]] = [round(x / _KX, 6), round(y / _KY, 6)]
    return {"segments": out, "stops": stops}
