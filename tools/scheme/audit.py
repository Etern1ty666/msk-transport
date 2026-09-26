"""Аудит схемы: вдоль каждой полосы маршрута сверяем цвет с эталонным изображением официальной схемы.
Запуск:  python3 audit.py path/to/scheme.png   — печатает участки, где полоса не лежит на линии своего цвета."""
import json, math, sys
from pathlib import Path
from PIL import Image
d = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/ops/scheme/scheme.json").read_text())
LANE = d.get("lane", 3.8)
col = {r["num"]: tuple(int(r["color"][i:i + 2], 16) for i in (1, 3, 5)) for r in d["routes"]}
im = Image.open(sys.argv[1]).convert("RGB"); px = im.load()

def offset(pts, off):
    out = []
    n = len(pts)
    for i, p in enumerate(pts):
        def nrm(a, b):
            dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
            return dy / L, -dx / L
        if i == 0: nx, ny = nrm(pts[0], pts[1])
        elif i == n - 1: nx, ny = nrm(pts[-2], pts[-1])
        else:
            a, b = nrm(pts[i - 1], pts[i]), nrm(pts[i], pts[i + 1])
            mx, my = a[0] + b[0], a[1] + b[1]; L = math.hypot(mx, my) or 1; mx, my = mx / L, my / L
            k = 1 / max(0.35, mx * a[0] + my * a[1]); nx, ny = mx * k, my * k
        out.append((p[0] + nx * off, p[1] + ny * off))
    return out

def ok(x, y, c):
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            q = px[int(round(x)) + dx, int(round(y)) + dy]
            if sum((q[i] - c[i]) ** 2 for i in range(3)) < 55 ** 2: return True
    return False

bad_total = 0
for ci, c in enumerate(d["corridors"]):
    n = len(c["routes"])
    for i, r in enumerate(c["routes"]):
        pts = offset(c["pts"], ((n - 1) / 2 - i) * LANE)
        samples = []
        for a, b in zip(pts, pts[1:]):
            L = math.dist(a, b); steps = max(1, int(L))
            for s in range(steps):
                t = s / steps; samples.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        # пропускаем концы (стыки, скругления) — по 6 px
        good = [ok(x, y, col[r]) for x, y in samples]
        run = []
        for k, (g, s) in enumerate(zip(good, samples)):
            if 6 < k < len(samples) - 6 and not g: run.append(s)
            else:
                if len(run) >= 6:
                    bad_total += 1
                    print(f"коридор {ci:>3} №{r:>3} ({c['routes']}): {len(run):>3} px мимо, от ({run[0][0]:.0f},{run[0][1]:.0f}) до ({run[-1][0]:.0f},{run[-1][1]:.0f})")
                run = []
print("участков с отклонением:", bad_total)
