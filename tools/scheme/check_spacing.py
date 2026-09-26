"""Проверка зазоров между линиями разных маршрутов (по итоговым scheme.json["lanes"]):
параллельные соседние линии должны стоять ровно на шаге полосы; ближе — налезают, чуть дальше — «выбиваются»."""
import json, math
from pathlib import Path
D = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/ops/scheme/scheme.json").read_text())
L = D["lane"]
def samples(pts, step=3):
    for a, b in zip(pts, pts[1:]):
        l = math.dist(a, b)
        if l < 1e-6: continue
        u = ((b[0] - a[0]) / l, (b[1] - a[1]) / l)
        for k in range(int(l // step)):
            yield (a[0] + u[0] * k * step, a[1] + u[1] * k * step), u
segs = [(li, l["route"], a, b) for li, l in enumerate(D["lanes"]) for a, b in zip(l["pts"], l["pts"][1:]) if math.dist(a, b) > 1e-6]
issues = []
for li, l in enumerate(D["lanes"]):
    for p, u in samples(l["pts"]):
        best = None
        for lj, r2, a, b in segs:
            if r2 == l["route"]: continue
            ab = (b[0] - a[0], b[1] - a[1]); lab = math.hypot(*ab); v = (ab[0] / lab, ab[1] / lab)
            if abs(u[0] * v[1] - u[1] * v[0]) > 0.05: continue
            t = ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1])
            if t < 1 or t > lab - 1: continue
            dd = abs((p[0] - a[0]) * v[1] - (p[1] - a[1]) * v[0])
            if best is None or dd < best[0]: best = (dd, r2)
        if best and (best[0] < L * 0.9 or L * 1.1 < best[0] < L * 1.5):
            issues.append((l["route"], best[1], round(best[0], 1), p))
# склеим подряд идущие точки в места
places = []
for r1, r2, dd, p in issues:
    for pl in places:
        if {pl[0], pl[1]} == {r1, r2} and math.dist(pl[3], p) < 15: break
    else: places.append((r1, r2, dd, p))
print(f"шаг полосы {L}; мест с неровным зазором: {len(places)}")
for r1, r2, dd, p in places: print(f"  №{r1}–№{r2}: {dd} (норма {L}) около ({p[0]:.0f},{p[1]:.0f})")
