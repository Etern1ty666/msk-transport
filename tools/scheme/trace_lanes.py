"""Сборка линий маршрутов из коридоров (после fit_scheme.py): непрерывные, геометрически чистые линии.

Коридоры — осевые линии пучков, уже подогнанные к эталону по цвету (fit_scheme.py). Здесь для каждого маршрута
его полосы из всех коридоров склеиваются в непрерывные цепочки, а стыки обрабатываются по правилам схем метро:
  • поворот            → общая вершина в точке пересечения линий (без ступенек и «пузырей»);
  • та же прямая       → слияние, нахлёст срезается;
  • сдвиг в пучке      → переход под 45° длиной, равной сдвигу (как на официальной схеме);
Радиусы скругления в пучке концентрические: у внутренней полосы поворота меньше, у внешней больше.
(Пиксельная трассировка по эталону — в trace_pixels.py; она даёт «дрожание», поэтому для отрисовки не используется.)

Итог — scheme.json["lanes"]: [{route, pts, rad}] — рисуется как есть (SchemeView.tsx), плюс отчёт по стыкам.
Запуск:  python3 build_scheme.py && python3 fit_scheme.py && python3 trace_lanes.py
"""
import json, math
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE.parents[1] / "frontend" / "src" / "ops" / "scheme" / "scheme.json"
d = json.loads(OUT.read_text())
LANE = d.get("lane", 4.4)

sub = lambda a, b: (a[0] - b[0], a[1] - b[1])
add = lambda a, b: (a[0] + b[0], a[1] + b[1])
mul = lambda a, k: (a[0] * k, a[1] * k)
dot = lambda a, b: a[0] * b[0] + a[1] * b[1]
cross = lambda a, b: a[0] * b[1] - a[1] * b[0]
ln = lambda v: math.hypot(v[0], v[1])
def unit(v):
    l = ln(v) or 1.0
    return (v[0] / l, v[1] / l)
leftN = lambda u: (u[1], -u[0])  # «слева по ходу» (ось y вниз)

def offset(pts, off):
    n = len(pts); out = []
    for i, p in enumerate(pts):
        if i == 0: nv = leftN(unit(sub(pts[1], pts[0])))
        elif i == n - 1: nv = leftN(unit(sub(pts[-1], pts[-2])))
        else:
            n1, n2 = leftN(unit(sub(pts[i], pts[i - 1]))), leftN(unit(sub(pts[i + 1], pts[i])))
            m = unit(add(n1, n2)); k = 1 / max(0.35, dot(m, n1))
            nv = mul(m, k)
        out.append(add(p, mul(nv, off)))
    return out

def radii(pts, r, off):
    """Концентрические радиусы: при повороте влево левые полосы внутри (меньше радиус), вправо — наоборот."""
    out = [r] * len(pts)
    for i in range(1, len(pts) - 1):
        t = cross(sub(pts[i], pts[i - 1]), sub(pts[i + 1], pts[i]))
        out[i] = max(1.5, r - off if t < 0 else r + off)  # ось y вниз: cross < 0 — поворот влево
    return out

pieces = {}
for c in d["corridors"]:
    n = len(c["routes"]); r = max(2.0, c.get("r", 9))
    for i, route in enumerate(c["routes"]):
        off = ((n - 1) / 2 - i) * LANE
        pieces.setdefault(route, []).append({"pts": offset(c["pts"], off), "rad": radii(c["pts"], r, off)})

JOIN = 20  # концы полос одного маршрута ближе этого — стык (поворот/продолжение)
report = []

def chain(route, pcs):
    ends = lambda p, e: pcs[p]["pts"][0] if e == 0 else pcs[p]["pts"][-1]
    cands = []
    for i in range(len(pcs)):
        for j in range(i + 1, len(pcs)):
            for ei in (0, 1):
                for ej in (0, 1):
                    dd = ln(sub(ends(i, ei), ends(j, ej)))
                    if dd < JOIN: cands.append((dd, (i, ei), (j, ej)))
    cands.sort()
    link = {}
    for dd, a, b in cands:
        if a not in link and b not in link: link[a] = b; link[b] = a
    used, out = set(), []

    def join(path, rad, seg, srad):
        a, a0, b, b1 = path[-1], path[-2], seg[0], seg[1]
        ua, ub, ab = unit(sub(a, a0)), unit(sub(b1, b)), sub(b, a)
        cr = cross(ua, ub)
        if abs(cr) > 0.17:  # поворот: общая вершина в пересечении линий
            t = cross(ab, ub) / cr
            X = add(a, mul(ua, t))
            if ln(sub(X, a)) < 30 and ln(sub(X, b)) < 30:
                path[-1] = X; rad[-1] = srad[0] if srad[0] > 2 else rad[-1]
                report.append((route, "поворот", round(max(ln(sub(X, a)), ln(sub(X, b))), 1), a))
                return path + seg[1:], rad + srad[1:]
            report.append((route, "!ПОВОРОТ-ДАЛЕКО", round(ln(ab), 1), a))
            return path + seg, rad + srad
        along, perp = dot(ab, ua), cross(ua, ab)
        if abs(perp) < 0.9:  # та же прямая
            if along < 0: report.append((route, "нахлёст", round(-along, 1), a))
            path[-1] = b if along < 0 else mul(add(a, b), 0.5)
            return path + seg[1:], rad + srad[1:]
        # сдвиг полосы в пучке: переход под 45°, по центру стыка
        s = abs(perp)
        la, lb = ln(sub(a, a0)), ln(sub(b1, b))
        # настоящий сдвиг полосы (≥ ~¾ полосы) — переход под 45°; мелкая погрешность — пологий, незаметный глазу
        L = s if s >= LANE * 0.75 else min(10 * s, 0.8 * (la + lb))
        t1 = max(along / 2 - L / 2, -la * 0.8)
        P1 = add(a, mul(ua, t1))
        nrm = unit(sub(b, add(a, mul(ua, along))))
        P2 = add(add(P1, mul(ua, L)), mul(nrm, s))
        report.append((route, "сдвиг 45°" if L == s else "плавный сдвиг", round(s, 1), a))
        rr = 3 if L == s else L
        return path[:-1] + [P1, P2] + seg[1:], rad[:-1] + [rr, rr] + srad[1:]

    def walk(p, e):
        path = rad = None
        while True:
            used.add(p)
            seg = pcs[p]["pts"] if e == 0 else pcs[p]["pts"][::-1]
            srad = pcs[p]["rad"] if e == 0 else pcs[p]["rad"][::-1]
            if path is None: path, rad = list(seg), list(srad)
            else: path, rad = join(path, rad, list(seg), list(srad))
            nx = link.get((p, 1 - e))
            if not nx or nx[0] in used: break
            p, e = nx
        out.append((path, rad))
    for i in range(len(pcs)):
        for e in (0, 1):
            if i not in used and (i, e) not in link: walk(i, e)
    for i in range(len(pcs)):
        if i not in used: walk(i, 0)
    return out

def t_junctions(route, chains):
    """Т-стык: свободный конец цепочки упирается в середину другой цепочки того же маршрута (не в её конец).
    Конец обрезается/продлевается до пересечения с той линией — без торчащих «огрызков» и зазоров."""
    for ci, (path, rad) in enumerate(chains):
        for end in (0, 1):
            P = path if end == 1 else path[::-1]
            e, e0 = P[-1], P[-2]; ue = unit(sub(e, e0))
            best = None
            for cj, (q, _) in enumerate(chains):
                for k in range(len(q) - 1):
                    if cj == ci and k >= len(q) - 3 and end == 1: continue
                    if cj == ci and k <= 1 and end == 0: continue
                    a, b = q[k], q[k + 1]; v = unit(sub(b, a)); L = ln(sub(b, a))
                    cr = cross(ue, v)
                    if abs(cr) < 0.3: continue
                    t = cross(sub(a, e), v) / cr  # e + ue*t на прямой a-b
                    X = add(e, mul(ue, t)); s_ = dot(sub(X, a), v)
                    if -1 <= s_ <= L + 1 and -14 < t < 14 and (best is None or abs(t) < abs(best[0])): best = (t, X)
            if best:
                P[-1] = best[1]; report.append((route, "Т-стык", round(best[0], 1), e))
                chains[ci] = (P if end == 1 else P[::-1], rad)
                path = chains[ci][0]
    return chains

lanes = []
for route, pcs in pieces.items():
    for path, rad in t_junctions(route, chain(route, pcs)):
        P, R = [path[0]], [rad[0]]
        for p, r in zip(path[1:], rad[1:]):
            if ln(sub(p, P[-1])) > 0.05: P.append(p); R.append(r)
        # убрать промежуточные точки на прямой (стыки участков): иначе они урезают радиус соседнего скругления
        k = 1
        while k < len(P) - 1:
            u1, u2 = unit(sub(P[k], P[k - 1])), unit(sub(P[k + 1], P[k]))
            if abs(cross(u1, u2)) < 0.01 and dot(u1, u2) > 0:
                del P[k]; del R[k]
            else: k += 1
        lanes.append({"route": route, "pts": [[round(x, 2), round(y, 2)] for x, y in P], "rad": [round(r, 2) for r in R]})
d["lanes"] = lanes
OUT.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
print(f"линий: {len(lanes)};  стыков:", dict(Counter(k for _, k, _, _ in report)))
for route, kind, v, a in report:
    if kind.startswith("!") or (kind == "сдвиг 45°" and v > 6) or (kind == "нахлёст" and v > 8) or (kind == "поворот" and v > 12):
        print(f"  №{route:>3} {kind} {v} около ({a[0]:.0f},{a[1]:.0f})")
