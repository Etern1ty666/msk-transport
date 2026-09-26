"""Проверка стыков: конец полосы маршрута в одном коридоре должен совпадать с началом полосы того же маршрута в соседнем."""
import json, math
from pathlib import Path
LANE = 3.8
d = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/ops/scheme/scheme.json").read_text())
def ends(c):
    n = len(c["routes"]); out = []
    for i, r in enumerate(c["routes"]):
        off = ((n - 1) / 2 - i) * LANE
        res = []
        for a, b, p in ((c["pts"][0], c["pts"][1], c["pts"][0]), (c["pts"][-2], c["pts"][-1], c["pts"][-1])):
            dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
            nx, ny = dy / L, -dx / L
            res.append((p[0] + nx * off, p[1] + ny * off))
        out.append((r, res))
    return out
E = []
for ci, c in enumerate(d["corridors"]):
    for r, (s, e) in ends(c):
        E.append((r, ci, s)); E.append((r, ci, e))
bad = 0
for r, ci, p in E:
    near = [math.dist(p, q) for r2, cj, q in E if r2 == r and cj != ci]
    m = min(near) if near else 99
    if 0.6 < m < 12:
        bad += 1; print(f"№{r:>3} коридор {ci:>3} точка ({p[0]:.1f},{p[1]:.1f}) — ближайший стык в {m:.1f}")
print("несостыковок:", bad)
