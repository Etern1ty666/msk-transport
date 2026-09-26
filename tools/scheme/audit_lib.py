import json, math
from pathlib import Path
def offset(pts, off):
    out = []; n = len(pts)
    def nrm(a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
        return dy / L, -dx / L
    for i, p in enumerate(pts):
        if i == 0: nx, ny = nrm(pts[0], pts[1])
        elif i == n - 1: nx, ny = nrm(pts[-2], pts[-1])
        else:
            a, b = nrm(pts[i - 1], pts[i]), nrm(pts[i], pts[i + 1])
            mx, my = a[0] + b[0], a[1] + b[1]; L = math.hypot(mx, my) or 1; mx, my = mx / L, my / L
            k = 1 / max(0.35, mx * a[0] + my * a[1]); nx, ny = mx * k, my * k
        out.append((p[0] + nx * off, p[1] + ny * off))
    return out
def lanes():
    d = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/ops/scheme/scheme.json").read_text())
    LANE = d.get("lane", 3.8)
    for ci, c in enumerate(d["corridors"]):
        n = len(c["routes"])
        for i, r in enumerate(c["routes"]):
            yield ci, r, offset(c["pts"], ((n - 1) / 2 - i) * LANE)
