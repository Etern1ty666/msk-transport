"""Трассировка линий маршрутов по эталону официальной схемы (map-matching).

Коридоры (build_scheme.py + fit_scheme.py) дают ТОПОЛОГИЮ: какой маршрут где идёт и в каком порядке полос.
Этот шаг снимает ТОЧНУЮ ГЕОМЕТРИЮ: для каждого маршрута строится непрерывная примерная трасса (полосы коридоров,
склеенные в цепочки), затем каждая её точка смещается поперёк хода на центр полосы цвета маршрута на эталоне.
Места без совпадения (белые точки остановок, подписи, пересечения) достраиваются по соседям; результат сглаживается.

Итог — scheme.json["lanes"]: [{route, pts}] — непрерывные линии, которые рисуются как есть (без склейки на лету).
Запуск:  python3 build_scheme.py && python3 fit_scheme.py && python3 trace_lanes.py
"""
import json, math
from pathlib import Path
from PIL import Image

HERE = Path(__file__).parent
OUT = HERE.parents[1] / "frontend" / "src" / "ops" / "scheme" / "scheme.json"
d = json.loads(OUT.read_text())
LANE = d.get("lane", 4.4)
im = Image.open(HERE / "reference.png").convert("RGB"); px = im.load(); W, H = im.size
col = {r["num"]: tuple(int(r["color"][i:i + 2], 16) for i in (1, 3, 5)) for r in d["routes"]}

# ------------------------------------------------------------------ геометрия (как в SchemeView.tsx)
sub = lambda a, b: (a[0] - b[0], a[1] - b[1])
ln = lambda v: math.hypot(v[0], v[1])
def unit(v):
    l = ln(v) or 1.0
    return (v[0] / l, v[1] / l)
leftN = lambda u: (u[1], -u[0])

def offset(pts, off):
    n = len(pts); out = []
    for i, p in enumerate(pts):
        if i == 0: nv = leftN(unit(sub(pts[1], pts[0])))
        elif i == n - 1: nv = leftN(unit(sub(pts[-1], pts[-2])))
        else:
            n1, n2 = leftN(unit(sub(pts[i], pts[i - 1]))), leftN(unit(sub(pts[i + 1], pts[i])))
            m = unit((n1[0] + n2[0], n1[1] + n2[1])); k = 1 / max(0.35, m[0] * n1[0] + m[1] * n1[1])
            nv = (m[0] * k, m[1] * k)
        out.append((p[0] + nv[0] * off, p[1] + nv[1] * off))
    return out

def flatten(pts, rad):
    """Ломаная со скруглёнными углами → плотная ломаная."""
    poly = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        l1, l2 = ln(sub(b, a)), ln(sub(c, b))
        rr = min(rad[i], l1 if i == 1 else l1 / 2, l2 if i == len(pts) - 2 else l2 / 2)
        u1, u2 = unit(sub(b, a)), unit(sub(c, b))
        p0 = (b[0] - u1[0] * rr, b[1] - u1[1] * rr); p2 = (b[0] + u2[0] * rr, b[1] + u2[1] * rr)
        poly.append(p0)
        for k in range(1, 9):
            t = k / 8; m = 1 - t
            poly.append((m * m * p0[0] + 2 * m * t * b[0] + t * t * p2[0], m * m * p0[1] + 2 * m * t * b[1] + t * t * p2[1]))
    poly.append(pts[-1])
    return poly

JOIN = 14
def chain(pcs):
    """Полосы одного маршрута → непрерывные цепочки (как в SchemeView.tsx, но с запасом по порогу)."""
    pieces = [p["pts"] for p in pcs]
    end = lambda p, e: pieces[p][0] if e == 0 else pieces[p][-1]
    cands = []
    for i in range(len(pieces)):
        for j in range(i + 1, len(pieces)):
            for ei in (0, 1):
                for ej in (0, 1):
                    dd = ln(sub(end(i, ei), end(j, ej)))
                    if dd < JOIN: cands.append((dd, (i, ei), (j, ej)))
    cands.sort()
    link = {}
    for dd, a, b in cands:
        if a not in link and b not in link: link[a] = b; link[b] = a
    used, out = set(), []
    def walk(p, e):
        path, rad = [], []
        while True:
            used.add(p)
            seg = pieces[p] if e == 0 else pieces[p][::-1]; r = pcs[p]["r"]
            if path:
                a, a0, b, b1 = path[-1], path[-2], seg[0], seg[1]
                ua, ub, ab = unit(sub(a, a0)), unit(sub(b1, b)), sub(b, a)
                cr = ua[0] * ub[1] - ua[1] * ub[0]
                X = None
                if abs(cr) > 0.17:
                    t = (ab[0] * ub[1] - ab[1] * ub[0]) / cr
                    X = (a[0] + ua[0] * t, a[1] + ua[1] * t)
                if X and ln(sub(X, a)) < 20 and ln(sub(X, b)) < 20:
                    path[-1] = X; rad[-1] = min(r, rad[-1], 8)
                else:
                    path.append(b); rad.append(3)
                path += seg[1:]; rad += [r] * (len(seg) - 1)
            else:
                path, rad = list(seg), [r] * len(seg)
            nx = link.get((p, 1 - e))
            if not nx or nx[0] in used: break
            p, e = nx
        out.append((path, rad))
    for i in range(len(pieces)):
        for e in (0, 1):
            if i not in used and (i, e) not in link: walk(i, e)
    for i in range(len(pieces)):
        if i not in used: walk(i, 0)
    return out

# ------------------------------------------------------------------ сопоставление с эталоном
def match(x, y, c, tol=62):
    xi, yi = int(round(x)), int(round(y))
    if not (0 <= xi < W and 0 <= yi < H): return False
    q = px[xi, yi]
    return (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2 < tol * tol

def resample(poly, step=1.0):
    out = [poly[0]]; carry = 0.0
    for a, b in zip(poly, poly[1:]):
        L = ln(sub(b, a))
        if L == 0: continue
        t = step - carry
        while t <= L:
            out.append((a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L)); t += step
        carry = L - (t - step)
    if ln(sub(out[-1], poly[-1])) > 0.3: out.append(poly[-1])
    return out

SCAN = 7.0
# зоны, где эталон неоднозначен (тесные петли, наложения одного цвета) — геометрия берётся из коридоров как есть
FIXED = [(1070, 780, 1112, 818),  # кольцо №12 у Авиамоторной
         ]
def fixed(p): return any(x0 <= p[0] <= x1 and y0 <= p[1] <= y1 for x0, y0, x1, y1 in FIXED)
def runs_at(samples, i, c):
    """Центры полос цвета c поперёк хода в точке i (в пределах ±SCAN)."""
    n = len(samples)
    a, b = samples[max(0, i - 3)], samples[min(n - 1, i + 3)]
    nv = leftN(unit(sub(b, a)))
    hits = [k * 0.5 for k in range(int(-SCAN * 2), int(SCAN * 2) + 1)
            if match(samples[i][0] + nv[0] * k * 0.5, samples[i][1] + nv[1] * k * 0.5, c)]
    if not hits: return []
    runs, cur = [], [hits[0]]
    for h in hits[1:]:
        if h - cur[-1] <= 0.51: cur.append(h)
        else: runs.append(cur); cur = [h]
    runs.append(cur)
    return [(r[0] + r[-1]) / 2 for r in runs if r[-1] - r[0] >= 1.5]

def track(cands, order):
    """Проход с отслеживанием: смещение меняется плавно (не больше ~0.6 px на 1 px хода), без прыжков на соседние полосы."""
    out = [None] * len(cands); last, gap = 0.0, 0
    for i in order:
        cs = cands[i]
        if cs:
            best = min(cs, key=lambda v: abs(v - last))
            if abs(best - last) <= 1.6 + 0.6 * gap:
                out[i] = best; last = best; gap = 0; continue
        gap += 1
    return out

def snap(samples, c):
    cands = [[0.0] if fixed(samples[i]) else runs_at(samples, i, c) for i in range(len(samples))]
    f = track(cands, range(len(cands))); b = track(cands, range(len(cands) - 1, -1, -1))
    out = []
    for x, y in zip(f, b):
        if x is None: out.append(y)
        elif y is None: out.append(x)
        elif abs(x - y) < 1.2: out.append((x + y) / 2)
        else: out.append(x if abs(x) < abs(y) else y)  # спорно — ближе к топологической трассе
    return out

def fill_smooth(offs):
    n = len(offs); known = [i for i, o in enumerate(offs) if o is not None]
    if not known: return [0.0] * n, 0.0
    out = [0.0] * n
    for i in range(n):  # линейная интерполяция пропусков, края — ближайшим значением
        if offs[i] is not None: out[i] = offs[i]; continue
        l = max((k for k in known if k < i), default=None); r = min((k for k in known if k > i), default=None)
        if l is None: out[i] = offs[r]
        elif r is None: out[i] = offs[l]
        else: out[i] = offs[l] + (offs[r] - offs[l]) * (i - l) / (r - l)
    med = [sorted(out[max(0, i - 4):i + 5])[len(out[max(0, i - 4):i + 5]) // 2] for i in range(n)]  # медиана убирает выбросы
    sm = [sum(med[max(0, i - 3):i + 4]) / len(med[max(0, i - 3):i + 4]) for i in range(n)]
    return sm, len(known) / n

def dp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; ab = sub(b, a); L = ln(ab) or 1e-9
    best, idx = -1, 0
    for i in range(1, len(pts) - 1):
        dd = abs(ab[0] * (a[1] - pts[i][1]) - ab[1] * (a[0] - pts[i][0])) / L if L > 1e-6 else ln(sub(pts[i], a))
        if dd > best: best, idx = dd, i
    if best <= tol: return [a, b]
    return dp(pts[:idx + 1], tol)[:-1] + dp(pts[idx:], tol)

# ------------------------------------------------------------------ сборка
pieces = {}
for c in d["corridors"]:
    n = len(c["routes"])
    for i, r in enumerate(c["routes"]):
        pieces.setdefault(r, []).append({"pts": offset(c["pts"], ((n - 1) / 2 - i) * LANE), "r": max(2, c.get("r", 9))})
lanes, report, sus = [], [], []
for r, pcs in pieces.items():
    for path, rad in chain(pcs):
        samples = resample(flatten(path, rad), 1.0)
        offs, cov = fill_smooth(snap(samples, col[r]))
        pts = []
        n = len(samples)
        for i, s in enumerate(samples):
            a, b = samples[max(0, i - 3)], samples[min(n - 1, i + 3)]
            nv = leftN(unit(sub(b, a)))
            pts.append((s[0] + nv[0] * offs[i], s[1] + nv[1] * offs[i]))
        pts = dp(pts, 0.25)
        lanes.append({"route": r, "pts": [[round(x, 2), round(y, 2)] for x, y in pts]})
        report.append((cov, r, len(samples)))
        # подозрительные места: окно 30 px, где линия почти не совпала с цветом маршрута на эталоне
        raw = snap(samples, col[r]); k = 0
        while k < n - 30:
            w = sum(1 for o in raw[k:k + 30] if o is not None) / 30
            if w < 0.25:
                sus.append((r, samples[k + 15])); k += 30
            else: k += 5
d["lanes"] = lanes
OUT.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
report.sort()
print(f"линий: {len(lanes)}, точек: {sum(len(l['pts']) for l in lanes)}")
print("хуже всего совпали с эталоном (доля длины):")
for cov, r, n in report[:12]: print(f"  №{r:>3}: {cov:.0%} из {n} px")
print(f"подозрительных мест (окно 30 px, совпадение < 25%): {len(sus)}")
for r, p in sus: print(f"  №{r:>3} около ({p[0]:.0f},{p[1]:.0f})")
