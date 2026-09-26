"""Подгонка схемы к эталону: каждый отрезок каждого коридора сдвигается перпендикулярно (±6 px), чтобы полосы маршрутов
легли на линии своего цвета на эталонном изображении; вершины пересчитываются как пересечения сдвинутых отрезков
(углы 45°/90° сохраняются). Подбирается и общий шаг полос в пучке.

Запуск после build_scheme.py:  python3 fit_scheme.py   (эталон — reference.png рядом, в сборку не попадает)"""
import json, math
from pathlib import Path
from PIL import Image

HERE = Path(__file__).parent
OUT = HERE.parents[1] / "frontend" / "src" / "ops" / "scheme" / "scheme.json"
d = json.loads(OUT.read_text())
im = Image.open(HERE / "reference.png").convert("RGB"); px = im.load(); W, H = im.size
col = {r["num"]: tuple(int(r["color"][i:i + 2], 16) for i in (1, 3, 5)) for r in d["routes"]}

def match(x, y, c):
    xi, yi = int(round(x)), int(round(y))
    if not (0 <= xi < W and 0 <= yi < H): return 0
    q = px[xi, yi]
    return 1 if sum((q[i] - c[i]) ** 2 for i in range(3)) < 65 ** 2 else 0

def seg_score(a, b, routes, lane, shift):
    """Доля совпавших по цвету точек всех полос отрезка при сдвиге shift (центральные 70% отрезка)."""
    dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy)
    if L < 1: return 0, 0
    nx, ny = dy / L, -dx / L  # «влево по ходу»
    n = len(routes); hit = tot = 0
    steps = max(4, int(L))
    for i, r in enumerate(routes):
        off = ((n - 1) / 2 - i) * lane + shift
        for s in range(steps + 1):
            t = 0.15 + 0.7 * s / steps
            x = a[0] + dx * t + nx * off; y = a[1] + dy * t + ny * off
            hit += match(x, y, col[r]); tot += 1
    return hit, tot

def best_shift(a, b, routes, lane):
    L = math.dist(a, b)
    if L < 10: return 0.0, 0
    base = seg_score(a, b, routes, lane, 0)[0]
    best, bs = 0.0, base
    for k in range(-24, 25):
        sft = k * 0.25
        h, _ = seg_score(a, b, routes, lane, sft)
        if h > bs + 1 or (h == bs and abs(sft) < abs(best)): best, bs = sft, h
    return best, bs - base

def intersect(p1, d1, p2, d2):
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-6: return None
    t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
    return (p1[0] + d1[0] * t, p1[1] + d1[1] * t)

# 1. общий шаг полос: по многополосным отрезкам
def total(lane):
    h = t = 0
    for c in d["corridors"]:
        if len(c["routes"]) < 2: continue
        for a, b in zip(c["pts"], c["pts"][1:]):
            hh, tt = seg_score(a, b, c["routes"], lane, best_shift(a, b, c["routes"], lane)[0]); h += hh; t += tt
    return h / max(t, 1)
cands = [3.8, 4.0, 4.2, 4.4, 4.6, 4.8, 5.0]
sc = {l: total(l) for l in cands}; print({k: round(v, 3) for k, v in sc.items()})
lane = max(cands, key=sc.get)
print("шаг полос:", lane)

# 2. сдвиг отрезков — согласованно: каждый отрезок тянется к своему сдвигу по эталону (s0),
#    но на стыках продолжающихся параллельных линий одного маршрута полосы обязаны совпасть (наименьшие квадраты).
C = d["corridors"]
S0, FIXED = {}, set()
for ci, c in enumerate(C):
    for si, (a, b) in enumerate(zip(c["pts"], c["pts"][1:])):
        if c.get("nofit"): S0[(ci, si)] = 0.0; FIXED.add((ci, si)); continue
        sft, gain = best_shift(a, b, c["routes"], lane)
        S0[(ci, si)] = sft if gain > 0 else 0.0

def seg_dir(c, si):
    a, b = c["pts"][si], c["pts"][si + 1]; L = math.dist(a, b) or 1
    return ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
def lane_end(ci, r, e):
    """Точка конца e (0/1) полосы маршрута r в коридоре ci, нормаль «влево» концевого отрезка и индекс отрезка."""
    c = C[ci]; n = len(c["routes"]); off = ((n - 1) / 2 - c["routes"].index(r)) * lane
    si = 0 if e == 0 else len(c["pts"]) - 2
    u = seg_dir(c, si); nv = (u[1], -u[0]); p = c["pts"][0] if e == 0 else c["pts"][-1]
    return (p[0] + nv[0] * off, p[1] + nv[1] * off), nv, u, si
joints = []
ends = [(ci, r, e) for ci, c in enumerate(C) for r in c["routes"] for e in (0, 1)]
for k, (ci, r, e) in enumerate(ends):
    pa, na, ua, sa = lane_end(ci, r, e)
    for cj, r2, f in ends[k + 1:]:
        if r2 != r or cj == ci: continue
        pb, nb, ub, sb = lane_end(cj, r, f)
        if math.dist(pa, pb) > 14: continue
        if abs(ua[0] * ub[1] - ua[1] * ub[0]) > 0.17: continue  # поворот — не ограничение
        g = (pb[0] - pa[0]) * na[0] + (pb[1] - pa[1]) * na[1]
        if abs(g) > lane * 0.75: continue  # настоящий сдвиг полосы в пучке
        joints.append(((ci, sa), (cj, sb), g, nb[0] * na[0] + nb[1] * na[1]))
# соседство: параллельные отрезки РАЗНЫХ коридоров рядом друг с другом — ближайшие полосы ровно на шаге полосы
adj = 0
segs = [(ci, si) for ci, c in enumerate(C) for si in range(len(c["pts"]) - 1)]
for k, (ci, si) in enumerate(segs):
    A = C[ci]; a0, a1 = A["pts"][si], A["pts"][si + 1]; LA = math.dist(a0, a1)
    if LA < 6: continue
    ua = seg_dir(A, si); na = (ua[1], -ua[0]); nA = len(A["routes"])
    for cj, sj in segs[k + 1:]:
        if cj == ci: continue
        B = C[cj]; b0, b1 = B["pts"][sj], B["pts"][sj + 1]
        if math.dist(b0, b1) < 6: continue
        ub = seg_dir(B, sj)
        if abs(ua[0] * ub[1] - ua[1] * ub[0]) > 0.03: continue
        # перекрытие проекций на ось A
        t0 = (b0[0] - a0[0]) * ua[0] + (b0[1] - a0[1]) * ua[1]; t1 = (b1[0] - a0[0]) * ua[0] + (b1[1] - a0[1]) * ua[1]
        if min(max(t0, t1), LA) - max(min(t0, t1), 0) < 8: continue
        D = (b0[0] - a0[0]) * na[0] + (b0[1] - a0[1]) * na[1]
        nB = len(B["routes"])
        half = (nA - 1) / 2 * lane + (nB - 1) / 2 * lane
        gap = abs(D) - half
        if not (-0.9 * lane < gap < 1.45 * lane) or abs(D) < 0.5: continue  # шире — между ними ещё линия; меньше — налезают (раздвигаем)
        if set(A["routes"]) & set(B["routes"]): continue  # продолжение того же маршрута — это стык, не соседство
        Dstar = math.copysign(half + lane, D)
        sgn = 1.0 if (ub[1] * na[0] - ub[0] * na[1]) > 0 else -1.0  # нормаль B сонаправлена нормали A?
        joints.append(((ci, si), (cj, sj), D - Dstar, sgn)); adj += 1
print(f"соседств (параллельные пучки рядом): {adj}")
X = dict(S0); W = 25.0
for _ in range(300):
    for v in X:
        if v in FIXED: continue
        num, den = S0[v], 1.0
        for A, B, g, sgn in joints:
            # m = g + sgn*xB - xA  → 0
            if A == v: num += W * (g + sgn * X[B]); den += W
            elif B == v: num += W * sgn * (X[A] - g); den += W  # из g + sgn·xB − xA = 0
        X[v] = num / den
res = [abs(g + sgn * X[B] - X[A]) for A, B, g, sgn in joints]
bad = sorted(((abs(g + sgn * X[B] - X[A]), A, B) for A, B, g, sgn in joints), reverse=True)[:8]
for r_, A, B in bad:
    if r_ > 0.6: print(f"  несогласовано {r_:.2f} px: {C[A[0]]['routes']}#{A[1]} {C[A[0]]['pts'][A[1]]} ↔ {C[B[0]]['routes']}#{B[1]} {C[B[0]]['pts'][B[1]]}")
print(f"стыков-ограничений: {len(joints)}, несовпадение до: {max(abs(j[2]) for j in joints):.2f}, после: {max(res):.2f} px")

moved = 0
for ci, c in enumerate(C):
    pts = c["pts"]
    shifts = [X[(ci, si)] for si in range(len(pts) - 1)]
    if not any(abs(x) > 1e-3 for x in shifts): continue
    dirs = [seg_dir(c, si) for si in range(len(pts) - 1)]
    sp = [(a[0] + dirs[i][1] * shifts[i], a[1] - dirs[i][0] * shifts[i]) for i, a in enumerate(pts[:-1])]
    new = [[round(sp[0][0], 2), round(sp[0][1], 2)]]
    for i in range(1, len(pts) - 1):
        q = intersect(sp[i - 1], dirs[i - 1], sp[i], dirs[i])
        if q is None: q = (pts[i][0] + dirs[i][1] * shifts[i], pts[i][1] - dirs[i][0] * shifts[i])
        new.append([round(q[0], 2), round(q[1], 2)])
    e = pts[-1]; new.append([round(e[0] + dirs[-1][1] * shifts[-1], 2), round(e[1] - dirs[-1][0] * shifts[-1], 2)])
    c["pts"] = new; moved += sum(1 for x in shifts if abs(x) > 1e-3)
d["lane"] = lane
OUT.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
print("сдвинуто отрезков:", moved)
