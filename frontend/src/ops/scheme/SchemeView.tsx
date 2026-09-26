import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { at24, levelOf, overLabel, type DayView, type RouteGeo } from '../../api'
import raw from './scheme.json'

/** Интерактивная схема трамвайных маршрутов (по официальной схеме «Транспорта Москвы»), SVG. */

type Pt = [number, number]
type Corridor = { routes: string[]; pts: Pt[]; r?: number }
type Stop = { n: string; p: Pt; a: string; b?: 1; m?: 1; rot?: number; lp?: Pt }
type Term = { routes: string[]; p: Pt }
type RouteInfo = { num: string; color: string; from: string; to: string; interval: string }
type Background = { water: string[]; parks: string[]; white: string[] }
type Scheme = { size: [number, number]; routes: RouteInfo[]; corridors: Corridor[]; stops: Stop[]; terms: Term[]; bg?: Background; lanes?: { route: string; pts: Pt[]; rad?: number[] }[] }

export const SCHEME = raw as unknown as Scheme
export const SCHEME_ROUTES = Object.fromEntries(SCHEME.routes.map((r) => [r.num, r]))

const LANE: number = (raw as { lane?: number }).lane ?? 3.8 // шаг полос в пучке (подобран по эталону)
const STROKE = LANE * 0.92 // толщина линии: полосы пучка идут почти вплотную, как на оригинале
const BOX = { x: 30, y: 90, w: 1400, h: 1590 } // рамка всей сети — дальше отдалять и уводить нельзя
const HOME_WIDE = { x: 250, y: 300, w: 950, h: 820 } // стартовый вид: центр сети крупнее, края — прокруткой
const HOME_PHONE = { x: 430, y: 380, w: 620, h: 720 }
const homeBox = () => (typeof window !== 'undefined' && window.innerWidth <= 720 ? HOME_PHONE : HOME_WIDE)

// ---------------------------------------------------------------- геометрия
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
const len = (v: Pt) => Math.hypot(v[0], v[1])
const unit = (v: Pt): Pt => { const l = len(v) || 1; return [v[0] / l, v[1] / l] }
const leftN = (d: Pt): Pt => [d[1], -d[0]] // «слева по ходу» при оси y вниз

/** Параллельный сдвиг ломаной на d (положительно — влево по ходу), с митрой в углах. */
function offset(pts: Pt[], d: number): Pt[] {
  if (!d) return pts
  const n = pts.length
  return pts.map((p, i) => {
    let nv: Pt
    if (i === 0) nv = leftN(unit(sub(pts[1], pts[0])))
    else if (i === n - 1) nv = leftN(unit(sub(pts[n - 1], pts[n - 2])))
    else {
      const n1 = leftN(unit(sub(pts[i], pts[i - 1]))), n2 = leftN(unit(sub(pts[i + 1], pts[i])))
      const m = unit([n1[0] + n2[0], n1[1] + n2[1]])
      const k = 1 / Math.max(0.35, m[0] * n1[0] + m[1] * n1[1])
      nv = [m[0] * k, m[1] * k]
    }
    return [p[0] + nv[0] * d, p[1] + nv[1] * d]
  })
}

/** Ломаная со скруглёнными углами: в каждой вершине — дуга окружности радиуса R (свой у каждой вершины).
 *  Касательная длина = R·tg(θ/2), поэтому у полос пучка, смещённых на ±d и с радиусами R∓d, дуги концентрические
 *  при любом угле поворота (45°, 90°, 135°) — зазоры между полосами на поворотах не «гуляют». */
function geom(pts: Pt[], rad: number | number[]): { d: string; poly: Pt[] } {
  const f = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`
  let d = `M${f(pts[0])}`
  const poly: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1]
    const l1 = len(sub(b, a)), l2 = len(sub(c, b))
    const u1 = unit(sub(b, a)), u2 = unit(sub(c, b))
    const cosT = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])), theta = Math.acos(cosT)
    if (theta < 0.02) { d += ` L${f(b)}`; poly.push(b); continue }
    const R = typeof rad === 'number' ? rad : rad[i] ?? 7
    const tg = Math.tan(theta / 2)
    let t = R * tg
    t = Math.min(t, i === 1 ? l1 : l1 / 2, i === pts.length - 2 ? l2 : l2 / 2)
    const Re = t / tg
    const p0: Pt = [b[0] - u1[0] * t, b[1] - u1[1] * t], p2: Pt = [b[0] + u2[0] * t, b[1] + u2[1] * t]
    const cr = u1[0] * u2[1] - u1[1] * u2[0]
    d += ` L${f(p0)} A${Re.toFixed(2)},${Re.toFixed(2)} 0 0 ${cr > 0 ? 1 : 0} ${f(p2)}`
    // точки дуги (для постановки остановок на линию)
    let nIn: Pt = [-u1[1], u1[0]]
    if (nIn[0] * (p2[0] - p0[0]) + nIn[1] * (p2[1] - p0[1]) < 0) nIn = [-nIn[0], -nIn[1]]
    const cx = p0[0] + nIn[0] * Re, cy = p0[1] + nIn[1] * Re
    const a0 = Math.atan2(p0[1] - cy, p0[0] - cx), a2 = Math.atan2(p2[1] - cy, p2[0] - cx)
    let da = a2 - a0
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    poly.push(p0)
    for (let k = 1; k <= 8; k++) { const an = a0 + (da * k) / 8; poly.push([cx + Math.cos(an) * Re, cy + Math.sin(an) * Re]) }
  }
  poly.push(pts[pts.length - 1])
  return { d: d + ` L${f(pts[pts.length - 1])}`, poly }
}
const rounded = (pts: Pt[], rad: number | number[]) => geom(pts, rad).d

/** Ближайшая точка ломаной. */
function project(poly: Pt[], p: Pt): { q: Pt; dist: number } {
  let best = { q: poly[0], dist: Infinity }
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], ab = sub(poly[i + 1], a)
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1)))
    const q: Pt = [a[0] + ab[0] * t, a[1] + ab[1] * t], dist = len(sub(p, q))
    if (dist < best.dist) best = { q, dist }
  }
  return best
}

/** Нормализация названий остановок для сопоставления схемы с данными (OSM). */
const ABBR: Record<string, string> = { им: 'имени', ул: 'улица', пер: 'переулок', пл: 'площадь', дк: 'дом культуры', пр: 'проспект' }
const DROP = new Set(['метро', 'мцк', 'мцд', 'платформа', 'станция', 'усадьба'])
export function normName(s: string) {
  // (\b в JS не работает с кириллицей — поэтому по словам)
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\(.*?\)/g, ' ').replace(/дворец культуры/g, 'дк')
    .split(/[\s«»"“”„.,—–\-]+/).filter(Boolean).filter((w) => !DROP.has(w)).map((w) => ABBR[w] ?? w).join(' ')
}

type Lane = { route: string; d: string; color: string; pts: Pt[]; rad: number[]; poly: Pt[] }
type Piece = { pts: Pt[]; r: number }

/** Склейка полос одного маршрута из соседних коридоров в непрерывные цепочки (без «пузырей» на стыках).
 *  Концы, ближе JOIN друг к другу, сводятся в общую точку; ветки и петли дают несколько цепочек. */
const JOIN = 12
function chain(pcs: Piece[]): { pts: Pt[]; rad: number[] }[] {
  const pieces = pcs.map((p) => p.pts)
  type End = { p: number; e: 0 | 1 }
  const pt = (x: End) => (x.e === 0 ? pieces[x.p][0] : pieces[x.p][pieces[x.p].length - 1])
  const cands: { a: End; b: End; d: number }[] = []
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++)
    for (const ei of [0, 1] as const) for (const ej of [0, 1] as const) {
      const d = len(sub(pt({ p: i, e: ei }), pt({ p: j, e: ej })))
      if (d < JOIN) cands.push({ a: { p: i, e: ei }, b: { p: j, e: ej }, d })
    }
  cands.sort((x, y) => x.d - y.d)
  const link = new Map<string, End>()
  const key = (x: End) => `${x.p}:${x.e}`
  for (const c of cands) if (!link.has(key(c.a)) && !link.has(key(c.b))) { link.set(key(c.a), c.b); link.set(key(c.b), c.a) }
  const used = new Set<number>(), out: { pts: Pt[]; rad: number[] }[] = []
  const walk = (start: number, fromEnd: 0 | 1) => {
    // идём от конца fromEnd: кусок ориентируем так, чтобы fromEnd был началом
    let p = start, e = fromEnd
    let path: Pt[] = [], rad: number[] = []
    for (;;) {
      used.add(p)
      const seg = e === 0 ? pieces[p] : [...pieces[p]].reverse()
      const r = pcs[p].r
      if (path.length) {
        const a = path[path.length - 1], a0 = path[path.length - 2], b = seg[0], b1 = seg[1]
        const ua = unit(sub(a, a0)), ub = unit(sub(b1, b)), ab = sub(b, a)
        const cr = ua[0] * ub[1] - ua[1] * ub[0]
        const X = Math.abs(cr) > 0.17 ? (() => { // пересечение прямых последнего и первого отрезков
          const t = (ab[0] * ub[1] - ab[1] * ub[0]) / cr
          return [a[0] + ua[0] * t, a[1] + ua[1] * t] as Pt
        })() : null
        if (X && len(sub(X, a)) < 20 && len(sub(X, b)) < 20) {
          path[path.length - 1] = X; rad[rad.length - 1] = Math.min(r, rad[rad.length - 1] ?? 7, 8)
          path = path.concat(seg.slice(1)); rad = rad.concat(seg.slice(1).map(() => r))
        } else {
          const along = ab[0] * ua[0] + ab[1] * ua[1], perp = ua[0] * ab[1] - ua[1] * ab[0]
          if (Math.abs(perp) < 0.8) { // на одной прямой: убираем нахлёст/зазор
            path[path.length - 1] = along < 0 ? b : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          } else { // параллельный сдвиг: короткий плавный переход
            const L = Math.max(4, Math.abs(perp) * 2.5) / 2
            const back = Math.min(L, len(sub(a, a0)) * 0.45), fwd = Math.min(L, len(sub(b1, b)) * 0.45)
            path[path.length - 1] = [a[0] - ua[0] * (back - Math.min(0, along)), a[1] - ua[1] * (back - Math.min(0, along))]
            path.push([b[0] + ub[0] * fwd, b[1] + ub[1] * fwd]); rad.push(3)
            rad[rad.length - 2] = 3
          }
          if (path.length && Math.abs(perp) < 0.8) rad[rad.length - 1] = 7
          path = path.concat(seg.slice(1)); rad = rad.concat(seg.slice(1).map(() => r))
        }
      } else { path = seg.slice(); rad = seg.map(() => r) }
      const nx = link.get(key({ p, e: (1 - e) as 0 | 1 }))
      if (!nx || used.has(nx.p)) break
      p = nx.p; e = nx.e
    }
    out.push({ pts: path, rad })
  }
  // сначала — от свободных концов (конечные), потом оставшиеся петли
  for (let i = 0; i < pieces.length; i++) for (const e of [0, 1] as const)
    if (!used.has(i) && !link.has(key({ p: i, e }))) walk(i, e)
  for (let i = 0; i < pieces.length; i++) if (!used.has(i)) walk(i, 0)
  return out
}
type SStop = Stop & { q: Pt; dots: Pt[]; hw: number; routes: string[] }

/** Полосы всех коридоров + для каждой остановки — точки на полосах ближайшего коридора. */
function build(s: Scheme) {
  const color = Object.fromEntries(s.routes.map((r) => [r.num, r.color]))
  const pieces = new Map<string, Piece[]>()
  for (const c of s.corridors) {
    const n = c.routes.length
    c.routes.forEach((route, i) => {
      const off = ((n - 1) / 2 - i) * LANE
      // радиус у внешних полос пучка чуть больше, у внутренних — меньше: скругление концентрическое
      pieces.set(route, [...(pieces.get(route) ?? []), { pts: offset(c.pts, off), r: Math.max(2, (c.r ?? 9)) }])
    })
  }
  const lanes: Lane[] = []
  // порядок наложения как на официальной схеме: эти маршруты «ныряют» под пучки, кольцо №12 — поверх
  const Z: Record<string, number> = { '11': -3, '43': -2, '4': -2, '46': -1, '12': 2 }
  if (s.lanes?.length) {
    // линии, снятые с эталона (tools/scheme/trace_lanes.py): рисуем как есть — непрерывные, без склейки на лету
    for (const l of s.lanes) {
      const rad = l.rad ?? l.pts.map(() => 7), g = geom(l.pts, rad)
      lanes.push({ route: l.route, color: color[l.route] ?? '#888', pts: l.pts, rad, d: g.d, poly: g.poly })
    }
  } else {
    for (const [route, ps] of pieces) for (const ch of chain(ps)) { const g = geom(ch.pts, ch.rad); lanes.push({ route, color: color[route] ?? '#888', pts: ch.pts, rad: ch.rad, d: g.d, poly: g.poly }) }
  }
  const stops: SStop[] = s.stops.map((st) => {
    let best = { dist: Infinity, q: st.p as Pt, nv: [0, -1] as Pt, n: 1, routes: [] as string[] }
    for (const c of s.corridors) {
      for (let i = 0; i < c.pts.length - 1; i++) {
        const a = c.pts[i], b = c.pts[i + 1], ab = sub(b, a)
        const t = Math.max(0, Math.min(1, ((st.p[0] - a[0]) * ab[0] + (st.p[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1)))
        const q: Pt = [a[0] + ab[0] * t, a[1] + ab[1] * t]
        const dist = len(sub(st.p, q))
        if (dist < best.dist) best = { dist, q, nv: leftN(unit(ab)), n: c.routes.length, routes: c.routes }
      }
    }
    if (best.dist >= 16) return { ...st, q: st.p, dots: [st.p], hw: 3, routes: [] }
    const dots: Pt[] = [], routes: string[] = []
    for (const r of best.routes) {
      let pr = { q: best.q, dist: Infinity }
      for (const l of lanes) if (l.route === r) { const x = project(l.poly, best.q); if (x.dist < pr.dist) pr = x }
      if (pr.dist < 12) { dots.push(pr.q); routes.push(r) }
    }
    if (!dots.length) return { ...st, q: best.q, dots: [best.q], hw: 3, routes: [] }
    const q: Pt = [dots.reduce((a, d) => a + d[0], 0) / dots.length, dots.reduce((a, d) => a + d[1], 0) / dots.length]
    const hw = Math.max(...dots.map((d) => len(sub(d, q)))) + LANE * 0.5 + 1
    return { ...st, q, dots, hw, routes }
  })
  lanes.sort((a, b) => (Z[a.route] ?? 0) - (Z[b.route] ?? 0))
  return { lanes, stops }
}

const LABEL_POS: Record<string, [number, number, 'start' | 'middle' | 'end']> = {
  r: [1, 0, 'start'], l: [-1, 0, 'end'], t: [0, -1, 'middle'], b: [0, 1, 'middle'],
  tr: [0.75, -0.75, 'start'], tl: [-0.75, -0.75, 'end'], br: [0.75, 0.75, 'start'], bl: [-0.75, 0.75, 'end'],
}


// ---------------------------------------------------------------- живой слой: свечение, трамваи, сигналы (canvas)
// Статичная схема (SVG) не перерисовывается при анимации: всё, что движется, рисуется на двух canvas —
// под линиями (свечение спроса, «волна проверки») и над ними (трамваи, кольца-сигналы, выбранная остановка).
type Track = { pts: Pt[]; cum: number[]; L: number }
function toTrack(pts: Pt[]): Track {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1])))
  return { pts, cum, L: cum[cum.length - 1] || 1 }
}
/** Точка ломаной на расстоянии s от начала и направление в ней. */
function pointAt(tr: Track, s: number): [number, number, number] {
  const { pts, cum } = tr
  let lo = 0, hi = cum.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m }
  const a = pts[lo], b = pts[hi], f = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1)
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0])]
}
/** Мягкое пятно света: градиент рисуется один раз, дальше штампуется drawImage — это дёшево. */
function sprite(rgb: string, core: number) {
  const c = document.createElement('canvas')
  c.width = c.height = 96
  const g = c.getContext('2d')!, gr = g.createRadialGradient(48, 48, 0, 48, 48, 48)
  gr.addColorStop(0, `rgba(${rgb},${core})`); gr.addColorStop(0.4, `rgba(${rgb},${core * 0.45})`); gr.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = gr; g.fillRect(0, 0, 96, 96)
  return c
}
type HaloPath = { p: Path2D; lv: number; route: string; id: string }
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 1000) / 1000 }
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const SWEEP_SPEED = 110, SWEEP_TAIL = 90, SWEEP_GAP = 4500 // «волна проверки», пробегающая по ветке
const SCAN_MS = 1600 // волна пересчёта по всей сети при загрузке/смене суток или коэффициентов
/** Толщина линии: при отдалении — чуть толще, пучки читаются цельной лентой. */
const strokeOf = (k: number) => Math.max(STROKE * (1 + 0.3 * clamp01((1.3 - k) / 0.8)), Math.min(LANE, 1.9 / k))

/** Цвет наполненности вагона: пусто — светло-зелёный, 30–60% — темнеет зелёный, с 65% — оранжевеет,
 *  дальше краснеет, от 100% — полностью красный. */
const FILL_STOPS: [number, [number, number, number]][] = [
  [0, [74, 222, 128]], [0.3, [34, 197, 94]], [0.6, [21, 128, 61]], [0.65, [21, 128, 61]],
  [0.8, [245, 140, 20]], [0.9, [239, 90, 30]], [1, [220, 38, 38]],
]
export function fillRGB(f: number): [number, number, number] {
  if (f <= 0) return FILL_STOPS[0][1]
  for (let i = 1; i < FILL_STOPS.length; i++) {
    const [f1, c1] = FILL_STOPS[i]
    if (f <= f1) {
      const [f0, c0] = FILL_STOPS[i - 1], t = (f - f0) / (f1 - f0 || 1)
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * t)) as [number, number, number]
    }
  }
  return FILL_STOPS[FILL_STOPS.length - 1][1]
}
const FILL_STEPS = 32 // палитра пятен света по наполненности 0…100%

// ---------------------------------------------------------------- симуляция движения трамваев
// Вагон ходит по полосе маршрута «туда-обратно»: разгон, ход, торможение, стоянка на каждой остановке, разворот на конечной.
// Положение — чистая функция времени (без накопленного состояния), поэтому не «уплывает» при пропуске кадров и паузах вкладки.
// Наполненность меняется на стоянках: входят пропорционально весу остановки (из данных), выходят к концу рейса.
const V_MAX = 15, ACCEL = 10 // ед. схемы/с и ед./с² — визуальный масштаб, не реальный
const DWELL = 1.8, TERM_DWELL = 4.5 // стоянка на остановке и на конечной, с
type Leg = { t0: number; t1: number; run: boolean; a: number; b: number; o0: number; o1: number } // run: перегон a→b, иначе стоянка в a
type Sim = { tr: Track; legs: Leg[]; T: number }
const runTime = (d: number) => (d >= (V_MAX * V_MAX) / ACCEL ? d / V_MAX + V_MAX / ACCEL : 2 * Math.sqrt(d / ACCEL))
function runPos(d: number, T: number, t: number) { // трапециевидный профиль скорости
  const ta = Math.min(V_MAX / ACCEL, T / 2), vp = ACCEL * ta, sa = 0.5 * ACCEL * ta * ta
  if (t < ta) return 0.5 * ACCEL * t * t
  if (t > T - ta) return d - 0.5 * ACCEL * (T - t) ** 2
  return sa + vp * (t - ta)
}
/** Наполненность по доле уже вошедших пассажиров рейса B: у конечных — полупусто, к середине маршрута — больше среднего. */
const shape = (B: number) => 0.7 + 0.45 * 4 * B * (1 - B) // среднее по рейсу ≈ 1, в середине — до +15%
function buildSim(tr: Track, halts: { s: number; w: number }[]): Sim {
  const W = halts.reduce((a, h) => a + h.w, 0) || 1, m = halts.length - 1
  const fwd: number[] = [], back: number[] = [] // наполненность после посадки на остановке i (туда / обратно)
  let acc = 0
  for (let i = 0; i <= m; i++) { acc += halts[i].w; fwd[i] = shape(acc / W) }
  acc = 0
  for (let i = m; i >= 0; i--) { acc += halts[i].w; back[i] = shape(acc / W) }
  const legs: Leg[] = []
  let t = 0
  const push = (run: boolean, a: number, b: number, dur: number, o0: number, o1: number) => { legs.push({ t0: t, t1: t + dur, run, a, b, o0, o1 }); t += dur }
  push(false, halts[0].s, halts[0].s, TERM_DWELL, back[Math.min(1, m)], fwd[0]) // приехал обратным рейсом → высадка, посадка
  for (let i = 0; i < m; i++) {
    const a = halts[i].s, b = halts[i + 1].s
    push(true, a, b, runTime(Math.abs(b - a)), fwd[i], fwd[i])
    const last = i + 1 === m
    push(false, b, b, last ? TERM_DWELL : DWELL, fwd[i], last ? back[m] : fwd[i + 1])
  }
  for (let i = m; i > 0; i--) {
    const a = halts[i].s, b = halts[i - 1].s
    push(true, a, b, runTime(Math.abs(b - a)), back[i], back[i])
    if (i - 1 > 0) push(false, b, b, DWELL, back[i], back[i - 1])
  }
  return { tr, legs, T: t }
}
/** Положение вагона в момент τ цикла: расстояние по полосе, направление (+1/−1) и наполненность (доля от средней по рейсу). */
function simAt(sim: Sim, tau: number): { s: number; dir: number; occ: number; stopped: boolean } {
  const L = sim.legs
  let lo = 0, hi = L.length - 1
  while (lo < hi) { const md = (lo + hi + 1) >> 1; if (L[md].t0 <= tau) lo = md; else hi = md - 1 }
  const g = L[lo], dt = tau - g.t0, dur = g.t1 - g.t0
  if (!g.run) {
    const next = L[(lo + 1) % L.length]
    const f = clamp01((dt - 0.25) / Math.max(0.1, dur - 0.5)) // пассажиры выходят и входят за время стоянки
    return { s: g.a, dir: next.run ? Math.sign(next.b - next.a) || 1 : 1, occ: g.o0 + (g.o1 - g.o0) * f, stopped: true }
  }
  const d = Math.abs(g.b - g.a), dir = Math.sign(g.b - g.a) || 1
  return { s: g.a + dir * runPos(d, dur, dt), dir, occ: g.o0, stopped: false }
}
/** Ван-дер-Корпут: любые первые n фаз распределены по кругу почти равномерно — вагоны не сбиваются в кучу, когда выпуск меняется. */
const vdc = (n: number) => { let v = 0, d = 1; while (n) { d *= 2; v += (n & 1) / d; n >>= 1 } return v }
/** Ближайшая точка ломаной: расстояние вдоль неё и от неё. */
function locate(tr: Track, p: Pt): { s: number; dist: number } {
  let best = { s: 0, dist: Infinity }
  for (let i = 0; i < tr.pts.length - 1; i++) {
    const a = tr.pts[i], ab = sub(tr.pts[i + 1], a), L2 = ab[0] ** 2 + ab[1] ** 2 || 1
    const t = clamp01(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2)
    const dist = len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]))
    if (dist < best.dist) best = { s: tr.cum[i] + t * (tr.cum[i + 1] - tr.cum[i]), dist }
  }
  return best
}

export type SchemeApi = { zoom: (d: number) => void; fit: () => void; focus: (route: string | null, stopId?: string | null) => void }
type Props = {
  selected: string | null
  selectedStop: string | null
  onSelect: (route: string | null, stopId?: string | null) => void
  alerts: Record<string, number> // 1 — внимание, 2 — перегрузка
  dataRoutes: Set<string> // маршруты, по которым есть прогноз
  pad: { top: number; bottom: number; left: number; right: number }
  geo: RouteGeo[]
  day: DayView | null
  hour: number
  timeRef?: React.MutableRefObject<number>
  paused?: boolean // схема закрыта страницей раздела — анимацию не крутим
}

const SchemeView = forwardRef<SchemeApi, Props>(function SchemeView({ selected, selectedStop, onSelect, alerts, dataRoutes, pad, geo, day, hour, timeRef, paused = false }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const gBg = useRef<SVGGElement>(null)
  const gFg = useRef<SVGGElement>(null)
  const glowCv = useRef<HTMLCanvasElement>(null)
  const fxCv = useRef<HTMLCanvasElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const pin = useRef<HTMLDivElement>(null)
  const pinAt = useRef<Pt | null>(null)
  const pinR = useRef(4) // радиус кольца выбранной остановки (ед. схемы) — метка встаёт над ним
  const t = useRef({ x: 0, y: 0, k: 0.5 })
  // вид, с которым последний раз рисовались холсты: между кадрами живого слоя они сдвигаются CSS-трансформом (без перерисовки)
  const drawnT = useRef<{ x: number; y: number; k: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [zoomCls, setZoomCls] = useState('z0')
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const debugMode = params?.get('ref') ?? null
  const debug = debugMode != null && debugMode !== '0'
  const { lanes, stops } = useMemo(() => build(SCHEME), [])
  const padRef = useRef(pad)
  padRef.current = pad

  // ---------- сопоставление остановок схемы с остановками данных (по названию и маршруту)
  const match = useMemo(() => {
    const byName = new Map<string, number[]>()
    stops.forEach((s, i) => { const k = normName(s.n); byName.set(k, [...(byName.get(k) ?? []), i]) })
    const toScheme = new Map<string, number>() // `${route}|${stop_id}` → индекс остановки схемы
    const toData = new Map<string, string>() // `${route}|${idx}` → stop_id
    for (const g0 of geo) {
      const r = String(g0.route)
      for (const s of g0.stops) {
        const cand = byName.get(normName(s.name)) ?? []
        const i = cand.find((c) => stops[c].routes.includes(r)) ?? cand[0]
        if (i == null) continue
        toScheme.set(`${r}|${s.stop_id}`, i)
        if (!toData.has(`${r}|${i}`)) toData.set(`${r}|${i}`, s.stop_id)
      }
    }
    // ~15% остановок данных не нашлись на схеме по названию — ставим их на линию маршрута
    // между соседними найденными (по порядку следования), чтобы выбор остановки всегда был виден
    const approx = new Map<string, Pt>()
    for (const g0 of geo) {
      const r = String(g0.route)
      const own = lanes.filter((l) => l.route === r)
      if (!own.length) continue
      const idx = g0.stops.map((s) => toScheme.get(`${r}|${s.stop_id}`))
      g0.stops.forEach((s, i) => {
        if (idx[i] != null) return
        let a = i - 1
        while (a >= 0 && idx[a] == null) a--
        let b = i + 1
        while (b < idx.length && idx[b] == null) b++
        if (a < 0 || b >= idx.length) return
        const pa = stops[idx[a]!].q, pb = stops[idx[b]!].q, f = (i - a) / (b - a)
        const p: Pt = [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f]
        let best = { q: p, dist: Infinity }
        for (const l of own) { const x = project(l.poly, p); if (x.dist < best.dist) best = x }
        approx.set(`${r}|${s.stop_id}`, best.q)
      })
    }
    return { toScheme, toData, approx }
  }, [geo, stops, lanes])

  // узлы свечения: остановка схемы ← вклады маршрутов с данными
  const nodes = useMemo(() => {
    const m = new Map<number, { r: string; w: number; top: boolean }[]>()
    for (const g0 of geo) {
      const r = String(g0.route)
      const top = new Set([...g0.stops].sort((a, b) => b.weight - a.weight).slice(0, 4).map((s) => s.stop_id))
      for (const s of g0.stops) {
        const i = match.toScheme.get(`${r}|${s.stop_id}`)
        if (i == null) continue
        m.set(i, [...(m.get(i) ?? []), { r, w: s.weight, top: top.has(s.stop_id) }])
      }
    }
    return [...m.entries()].map(([i, contrib]) => ({ i, q: stops[i].q, contrib }))
  }, [geo, match, stops])

  // расписания вагонов по полосам маршрутов с прогнозом: остановки схемы + ненайденные на схеме остановки данных,
  // вес остановки (доля посадок) — из данных; по этим же полосам бегут «волны проверки»
  const tracks = useMemo(() => {
    const weight = new Map<string, number>()
    for (const g0 of geo) for (const s of g0.stops) weight.set(`${g0.route}|${s.stop_id}`, s.weight)
    const m = new Map<string, Sim[]>()
    for (const l of lanes) {
      if (!dataRoutes.has(l.route) || l.poly.length < 2) continue
      const r = l.route, tr = toTrack(l.poly)
      const own = geo.find((g0) => String(g0.route) === r)?.stops ?? []
      const wDef = own.length ? own.reduce((a, s) => a + s.weight, 0) / own.length : 1
      const raw: { s: number; w: number }[] = []
      stops.forEach((st, i) => {
        const j = st.routes.indexOf(r)
        if (j < 0) return
        const at = locate(tr, st.dots[j])
        if (at.dist > 4) return
        const id = match.toData.get(`${r}|${i}`)
        raw.push({ s: at.s, w: (id && weight.get(`${r}|${id}`)) || wDef * 0.6 })
      })
      for (const s of own) {
        const p = match.approx.get(`${r}|${s.stop_id}`)
        if (!p) continue
        const at = locate(tr, p)
        if (at.dist < 4) raw.push({ s: at.s, w: s.weight })
      }
      raw.sort((a, b) => a.s - b.s)
      // соседние точки ближе 6 ед. — одна остановка; концы полосы — конечные
      const halts: { s: number; w: number }[] = []
      for (const h of raw) { const last = halts[halts.length - 1]; if (last && h.s - last.s < 6) last.w += h.w; else halts.push({ ...h }) }
      if (!halts.length || halts[0].s > 6) halts.unshift({ s: 0, w: wDef * 0.5 }); else halts[0].s = 0
      if (tr.L - halts[halts.length - 1].s > 6) halts.push({ s: tr.L, w: wDef * 0.5 }); else halts[halts.length - 1].s = tr.L
      m.set(r, [...(m.get(r) ?? []), buildSim(tr, halts)])
    }
    return m
  }, [lanes, dataRoutes, stops, match, geo])

  const minK = () => fitBox(BOX).k * 0.92
  const clamp = () => {
    const el = box.current
    if (!el) return
    const p = padRef.current, W = el.clientWidth, H = el.clientHeight
    const c = t.current
    c.k = Math.max(minK(), Math.min(8, c.k))
    // край сети не уходит дальше края видимой области (небольшой запас); если сеть меньше экрана — по центру
    const axis = (pos: number, b0: number, bw: number, v0: number, v1: number) => {
      const lo = pos + b0 * c.k, size = bw * c.k, slack = 48
      if (size <= v1 - v0) return pos + ((v0 + v1) / 2 - (lo + size / 2))
      if (lo > v0 + slack) return pos - (lo - v0 - slack)
      if (lo + size < v1 - slack) return pos + (v1 - slack - lo - size)
      return pos
    }
    c.x = axis(c.x, BOX.x, BOX.w, p.left, W - p.right)
    c.y = axis(c.y, BOX.y, BOX.h, p.top, H - p.bottom)
  }
  const apply = () => {
    clamp()
    const { x, y, k } = t.current
    const tr = `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${k.toFixed(4)})`
    for (const gg of [gBg, gFg]) gg.current?.setAttribute('transform', tr)
    const dt = drawnT.current
    const ct = dt ? `translate(${(x - dt.x * (k / dt.k)).toFixed(2)}px,${(y - dt.y * (k / dt.k)).toFixed(2)}px) scale(${(k / dt.k).toFixed(5)})` : ''
    for (const c of [glowCv.current, fxCv.current]) if (c) c.style.transform = ct
    const el = box.current
    el?.style.setProperty('--sw', String(strokeOf(k)))
    el?.style.setProperty('--hw', String(Math.max(LANE, 10 / k)))
    // остановки выбранной ветки не мельче ~4 px (зона нажатия ~11 px) при любом отдалении — по ним легко попасть
    el?.style.setProperty('--ds', (Math.max(1, 4.5 / (1.05 * k))).toFixed(3))
    el?.style.setProperty('--hs', (Math.max(1, 11 / (LANE * 0.5 * k))).toFixed(3))
    const p = pinAt.current
    if (pin.current && p) {
      pin.current.style.transform = `translate(${(p[0] * k + x).toFixed(1)}px,${(p[1] * k + y).toFixed(1)}px)`
      pin.current.style.setProperty('--pin-off', `${(pinR.current * k + 10).toFixed(0)}px`)
    }
    const z = k < 0.9 ? 'z0' : k < 1.8 ? 'z1' : 'z2'
    setZoomCls((q) => (q === z ? q : z))
  }
  const fitBox = (bx: { x: number; y: number; w: number; h: number }, maxK = 6) => {
    const el = box.current
    if (!el) return t.current
    const W = el.clientWidth, H = el.clientHeight, p = padRef.current
    const k = Math.min(maxK, (W - p.left - p.right) / bx.w, (H - p.top - p.bottom) / bx.h)
    return { k, x: p.left + (W - p.left - p.right - bx.w * k) / 2 - bx.x * k, y: p.top + (H - p.top - p.bottom - bx.h * k) / 2 - bx.y * k }
  }
  const sizeCanvas = () => {
    const el = box.current
    if (!el) return
    // свечение мягкое — ему хватает разрешения CSS-пикселей (на retina в 4 раза меньше работы видеокарте); трамваям и кольцам — чёткость
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    for (const [c, sc] of [[glowCv.current, Math.min(1, dpr)], [fxCv.current, dpr]] as const) {
      const w = Math.round(el.clientWidth * sc), h = Math.round(el.clientHeight * sc)
      if (c && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; drawnT.current = null }
    }
  }
  const anim = useRef(0)
  const animateTo = (to: { x: number; y: number; k: number }, ms = 700) => {
    cancelAnimationFrame(anim.current)
    const from = { ...t.current }, t0 = performance.now()
    const step = (now: number) => {
      const e = Math.min(1, (now - t0) / ms), q = e < 0.5 ? 4 * e ** 3 : 1 - (-2 * e + 2) ** 3 / 2
      // масштаб интерполируем в логарифме — ощущается равномерно
      const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * q)
      t.current = { k, x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q }
      apply()
      if (e < 1) anim.current = requestAnimationFrame(step)
    }
    anim.current = requestAnimationFrame(step)
  }
  const zoomAt = (px: number, py: number, f: number) => {
    const { x, y, k } = t.current
    const k2 = Math.max(minK(), Math.min(8, k * f)), r = k2 / k
    t.current = { k: k2, x: px - (px - x) * r, y: py - (py - y) * r }
    apply()
  }

  useImperativeHandle(ref, () => ({
    zoom: (d) => {
      const el = box.current!
      const { x, y, k } = t.current, k2 = Math.max(minK(), Math.min(8, k * (d > 0 ? 1.6 : 1 / 1.6))), cx = el.clientWidth / 2, cy = el.clientHeight / 2
      animateTo({ k: k2, x: cx - (cx - x) * (k2 / k), y: cy - (cy - y) * (k2 / k) }, 300)
    },
    fit: () => animateTo(fitBox(homeBox())),
    focus: (route, stopId) => {
      if (!route) { animateTo(fitBox(homeBox())); return }
      const si = stopId ? match.toScheme.get(`${route}|${stopId}`) : undefined
      const q = si != null ? stops[si].q : stopId ? match.approx.get(`${route}|${stopId}`) : undefined
      if (q) { // остановка — крупно, в центре видимой области
        animateTo(fitBox({ x: q[0] - 45, y: q[1] - 45, w: 90, h: 90 }, 4.2), 800)
        return
      }
      const pts = SCHEME.corridors.filter((c) => c.routes.includes(route)).flatMap((c) => c.pts)
      if (!pts.length) return
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
      const bx = { x: Math.min(...xs) - 30, y: Math.min(...ys) - 30, w: Math.max(...xs) - Math.min(...xs) + 60, h: Math.max(...ys) - Math.min(...ys) + 60 }
      animateTo(fitBox(bx, 3.2), 900)
    },
  }))

  // старт: вписать сеть; при изменении размера — вписать заново (если ничего не выбрано)
  useEffect(() => {
    sizeCanvas()
    t.current = fitBox(homeBox())
    apply()
    const ro = new ResizeObserver(() => { sizeCanvas(); if (!selectedRef.current) t.current = fitBox(homeBox()); apply() })
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  // отладка (?ref): переход к точке схемы — window.__sch(x, y, k)
  useEffect(() => {
    if (!debug) return
    ;(window as unknown as { __sch: (x: number, y: number, k: number) => void }).__sch = (x, y, k) => {
      const el = box.current!
      t.current = { k, x: el.clientWidth / 2 - x * k, y: el.clientHeight / 2 - y * k }
      apply()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debug])

  // жесты: перетаскивание, колесо, щипок; клик — по линии или остановке
  const clearHover = useRef<() => void>(() => undefined)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const matchRef = useRef(match)
  matchRef.current = match
  useEffect(() => {
    const el = box.current!
    const pts = new Map<number, { x: number; y: number }>()
    let moved = 0, pinch = 0
    const down = (e: PointerEvent) => { cancelAnimationFrame(anim.current); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; clearHover.current() }
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId)
      if (!p) return
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d0 = Math.hypot(a.x - b.x, a.y - b.y)
        p.x = e.clientX; p.y = e.clientY
        const [a2, b2] = [...pts.values()]
        const d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y)
        const r = el.getBoundingClientRect()
        if (pinch && d0) zoomAt((a2.x + b2.x) / 2 - r.left, (a2.y + b2.y) / 2 - r.top, d1 / d0)
        pinch = 1
        moved += 10
        return
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX; p.y = e.clientY
      moved += Math.abs(dx) + Math.abs(dy)
      if (moved > 4 && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId)
      t.current.x += dx; t.current.y += dy
      apply()
    }
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId) }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      cancelAnimationFrame(anim.current)
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || (Math.abs(e.deltaY) > Math.abs(e.deltaX) * 1.5 && !e.shiftKey)) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)))
      else { t.current.x -= e.deltaX; t.current.y -= e.deltaY; apply() }
    }
    const click = (e: MouseEvent) => {
      if (moved > 6) return
      const target = e.target as Element
      const stopEl = target.closest('[data-stop]')
      if (stopEl) { // остановка: выбираем маршрут (текущий, если он через неё проходит) и её прогноз
        const i = Number(stopEl.getAttribute('data-stop'))
        const rs = stopsRef.current[i].routes
        const cur = selectedRef.current
        const lane = target.getAttribute('data-lane') || null
        const r = lane ?? (cur && rs.includes(cur) ? cur : rs.find((x) => matchRef.current.toData.has(`${x}|${i}`)) ?? rs[0])
        if (r) onSelectRef.current(r, matchRef.current.toData.get(`${r}|${i}`) ?? null)
        return
      }
      const route = target.closest('[data-route]')?.getAttribute('data-route')
      onSelectRef.current(route ?? null)
    }
    const dbl = (e: MouseEvent) => { const r = el.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 1.8) }
    const hoverMove = (e: PointerEvent) => { // подсказка следует за курсором (без перерисовки React)
      const r = el.getBoundingClientRect()
      if (tip.current) tip.current.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointermove', hoverMove)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('click', click)
    el.addEventListener('dblclick', dbl)
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointermove', hoverMove)
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel)
      el.removeEventListener('click', click); el.removeEventListener('dblclick', dbl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const stopsRef = useRef(stops)
  stopsRef.current = stops

  const selStop = selected && selectedStop ? match.toScheme.get(`${selected}|${selectedStop}`) : undefined
  const selPt: Pt | null = selStop != null ? stops[selStop].q : selected && selectedStop ? match.approx.get(`${selected}|${selectedStop}`) ?? null : null
  const selColor = selected ? SCHEME_ROUTES[selected]?.color ?? '#111' : '#111'
  pinAt.current = selPt
  pinR.current = selStop != null ? stops[selStop].hw + 2.6 : 4.2
  useLayoutEffect(() => { if (selPt) apply() }) // метка выбранной остановки встаёт на место до отрисовки кадра

  const [hoverStop, setHoverStop] = useState<number | null>(null)
  clearHover.current = () => { setHover(null); setHoverStop(null) }
  const focusRoute = hover ?? selected

  // ---------- живой слой: один цикл кадров, всё рисуется на canvas (SVG схемы при этом не перерисовывается)
  const live = useRef({ day, focus: focusRoute, nodes, tracks, selPt, selColor, halos: [] as HaloPath[] })
  live.current = { day, focus: focusRoute, nodes, tracks, selPt, selColor, halos: live.current.halos }
  useEffect(() => {
    const gc = glowCv.current?.getContext('2d'), fc = fxCv.current?.getContext('2d')
    if (!gc || !fc) return
    const wipe = () => {
      for (const c of [gc, fc]) { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, c.canvas.width, c.canvas.height) }
    }
    if (paused) { wipe(); return }
    const spr = { ok: sprite('16,185,129', 0.75), high: sprite('249,115,22', 0.85), crit: sprite('239,68,68', 0.9) }
    // пятна света по шкале наполненности (зелёный → тёмно-зелёный → оранжевый → красный)
    const fillSpr = Array.from({ length: FILL_STEPS + 1 }, (_, i) => sprite(fillRGB(i / FILL_STEPS).join(','), 0.85))
    const byFill = (f: number) => fillSpr[Math.round(clamp01(f) * FILL_STEPS)]
    // подсветка проблемных веток: рисуется в отдельный буфер только при сдвиге/масштабе/смене тревог,
    // а на экран кладётся одной картинкой с общей прозрачностью — пересечения не «накладываются» друг на друга
    const hc = document.createElement('canvas'), hx = hc.getContext('2d')!
    let hKey = ''
    let raf = 0, seen: DayView | null = null, seenNodes: unknown = null, peak = 1, scan0 = -1e9, lastDraw = -1e9
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      // ~30 кадров в секунду, при перетаскивании/масштабе — ~60: плавности хватает, а видеокарта (особенно на 120 Гц) не греется.
      // Между кадрами холсты «догоняют» схему CSS-трансформом в apply()
      const T = t.current, dT = drawnT.current
      const moved = !dT || dT.x !== T.x || dT.y !== T.y || dT.k !== T.k
      if (now - lastDraw < (moved ? 15 : 32)) return
      lastDraw = now
      wipe()
      drawnT.current = { ...T }
      gc.canvas.style.transform = fc.canvas.style.transform = ''
      const L = live.current, d = L.day
      const el = box.current
      if (!d || !el) return
      if (d !== seen || L.nodes !== seenNodes) { // новые сутки / коэффициенты — пересчитываем пик и пускаем волну пересчёта по сети
        if (d !== seen) scan0 = now
        seen = d; seenNodes = L.nodes; peak = 1
        const byR = new Map(d.routes.map((r) => [String(r.route), r]))
        for (const n of L.nodes) for (const c of n.contrib) { const r = byR.get(c.r); if (r) peak = Math.max(peak, Math.max(...r.boardings) * c.w) }
      }
      const W = fc.canvas.width, H = fc.canvas.height, dpr = W / Math.max(1, el.clientWidth)
      const gs = gc.canvas.width / Math.max(1, W) // свечение — в пониженном разрешении, координаты те же
      gc.setTransform(gs, 0, 0, gs, 0, 0)
      const { x, y, k } = T
      const SX = (p: number) => (p * k + x) * dpr, SY = (p: number) => (p * k + y) * dpr
      const pad = 90 * dpr
      const onScreen = (sx: number, sy: number) => sx > -pad && sy > -pad && sx < W + pad && sy < H + pad
      const minute = timeRef?.current ?? 0
      const focus = L.focus
      const st = new Map<string, { b: number; veh: number; ratio: number }>()
      for (const r of d.routes) {
        const veh = at24(r.vehicles, minute)
        st.set(String(r.route), { b: at24(r.boardings, minute), veh, ratio: veh > 0.05 ? at24(r.ratio, minute) : 0 })
      }
      const zr = Math.min(1.6, Math.max(0.75, k)) * dpr // размер пятен света от масштаба (в разумных пределах)
      const breathe = 0.5 + 0.5 * Math.sin(now / 1300) // медленное «дыхание»
      const pulse = 0.5 + 0.5 * Math.sin(now / 255) // быстрый пульс тревоги (~1,6 с)
      const hot: { sx: number; sy: number; fade: number; sev: number }[] = []

      // 1) спрос у остановок: мягкое свечение (размер — поток посадок, цвет — загрузка проходящих веток по той же шкале,
      //    что у вагонов); ночью — тихое зелёное «дежурное» мерцание. Главное свечение — у самих вагонов (ниже)
      for (const n of L.nodes) {
        const sx = SX(n.q[0]), sy = SY(n.q[1])
        if (!onScreen(sx, sy)) continue
        let v = 0, fade = 0, sev = 0, load = 0
        for (const c of n.contrib) {
          const s = st.get(c.r)
          if (!s) continue
          v += s.b * c.w
          load = Math.max(load, s.ratio)
          if (c.top && (focus == null || focus === c.r)) {
            const f = clamp01((s.ratio - 0.96) / 0.08)
            if (f > fade) { fade = f; sev = clamp01((s.ratio - 1) / 0.3) }
          }
        }
        const dim = focus != null && !n.contrib.some((c) => c.r === focus) ? 0.22 : 1
        const w = Math.min(1, Math.sqrt(v / peak))
        const idle = 0.15 + 0.08 * breathe
        // у каждой остановки своя фаза «дыхания» — сеть мерцает вразнобой, как живая, а не мигает целиком
        const own = 0.5 + 0.5 * Math.sin(now / 1100 + n.i * 1.7)
        const ww = Math.max(w, idle)
        const r = (9 + 32 * ww) * zr * (0.9 + 0.2 * own)
        gc.globalAlpha = Math.min(1, (0.22 + 0.4 * ww) * (0.85 + 0.15 * own)) * dim
        gc.drawImage(byFill(load), sx - r, sy - r, 2 * r, 2 * r)
        if (fade > 0) {
          const rr = (22 + 22 * sev) * zr * (0.88 + 0.24 * pulse)
          gc.globalAlpha = fade * (0.65 + 0.35 * pulse)
          gc.drawImage(sev > 0.66 ? spr.crit : spr.high, sx - rr, sy - rr, 2 * rr, 2 * rr)
          hot.push({ sx, sy, fade, sev })
        }
      }

      // 2) «волна проверки»: после загрузки суток — одна общая волна по всей сети (видно, что прогноз пересчитан);
      //    дальше — только по веткам, где сейчас нет вагонов (ночью): сеть под наблюдением, хоть трамваи и в депо
      const scan = (now - scan0) / SCAN_MS
      const glowR = Math.max(9 * dpr, 3.4 * strokeOf(k) * k * dpr)
      for (const [route, sims] of L.tracks) {
        const s = st.get(route)
        if (scan >= 1 && s && s.veh >= 0.5) continue
        const dim = focus != null && focus !== route ? 0.12 : 1
        const img = !s || s.ratio < 1 ? spr.ok : s.ratio < 1.2 ? spr.high : spr.crit
        sims.forEach(({ tr }, i) => {
          let head: number, a: number
          if (scan < 1) { head = (1 - (1 - scan) ** 2) * (tr.L + SWEEP_TAIL); a = 0.95 }
          else {
            const period = ((tr.L + SWEEP_TAIL) / SWEEP_SPEED) * 1000 + SWEEP_GAP
            head = (((now - scan0 - SCAN_MS + hash(route + ':' + i) * period) % period) / 1000) * SWEEP_SPEED
            a = 0.6
            if (head > tr.L + SWEEP_TAIL) return
          }
          for (let j = 0; j < 14; j++) {
            const sj = head - (j / 14) * SWEEP_TAIL
            if (sj < 0 || sj > tr.L) continue
            const [px, py] = pointAt(tr, sj)
            const sx = SX(px), sy = SY(py)
            if (!onScreen(sx, sy)) continue
            gc.globalAlpha = a * (1 - j / 14) * dim
            gc.drawImage(img, sx - glowR, sy - glowR, 2 * glowR, 2 * glowR)
          }
        })
      }

      // подсветка проблемных веток (пульс ~1,6 с), поверх свечения и под линиями схемы
      const hs = L.halos.filter((h) => focus == null || h.route === focus)
      if (hs.length) {
        const key = `${x},${y},${k},${gc.canvas.width}x${gc.canvas.height},${focus},${hs.length},${hs[0].id}`
        if (key !== hKey) {
          hKey = key
          if (hc.width !== gc.canvas.width || hc.height !== gc.canvas.height) { hc.width = gc.canvas.width; hc.height = gc.canvas.height }
          const sc = gs * dpr
          hx.setTransform(1, 0, 0, 1, 0, 0); hx.clearRect(0, 0, hc.width, hc.height)
          hx.setTransform(k * sc, 0, 0, k * sc, x * sc, y * sc)
          hx.lineWidth = strokeOf(k) * 2.6; hx.lineCap = 'round'; hx.lineJoin = 'round'
          for (const h of hs) { hx.strokeStyle = h.lv === 2 ? '#ef4444' : '#f97316'; hx.stroke(h.p) }
        }
        gc.setTransform(1, 0, 0, 1, 0, 0)
        gc.globalAlpha = 0.35 + 0.15 * Math.cos((now / 1600) * Math.PI * 2)
        gc.drawImage(hc, 0, 0)
      }

      // 3) кольца-сигналы у перегруженных остановок
      fc.lineWidth = 2.2 * dpr
      for (const h of hot) {
        fc.strokeStyle = h.sev > 0.66 ? '#ef4444' : '#f97316'
        for (const off of [0, 0.5]) {
          const ph = (now / 1600 + off) % 1
          fc.globalAlpha = h.fade * (1 - ph) * 0.9
          fc.beginPath(); fc.arc(h.sx, h.sy, (7 + 30 * ph) * zr, 0, Math.PI * 2); fc.stroke()
        }
      }

      // 4) вагоны: число — прогнозный выпуск маршрута в этот момент; едут по расписанию с остановками и разворотом.
      //    Вокруг каждого — свечение по его наполненности (загрузка ветки × где он сейчас на маршруте):
      //    зелёный — свободно, тёмно-зелёный — 30–60%, с 65% оранжевеет, от 100% — красный. Чем полнее, тем ярче и шире.
      const sw = strokeOf(k)
      // размер вагона растёт с масштабом, но в пределах: при сильном приближении не превращается в «таблетку»
      const tl = Math.min(18, Math.max(8, 2.9 * sw * k)) * dpr, tw = Math.min(8, Math.max(4, 1.35 * sw * k)) * dpr
      const side = Math.max(1.4, 0.32 * sw * k) * dpr // встречные вагоны — по разные стороны оси (правостороннее движение)
      const tsec = now / 1000
      fc.lineWidth = 1.4 * dpr
      for (const [route, sims] of L.tracks) {
        const s = st.get(route)
        if (!s || s.veh <= 0.02) continue
        const dim = focus != null && focus !== route ? 0.12 : 1
        const color = SCHEME_ROUTES[route]?.color ?? '#555'
        const n = Math.ceil(s.veh), base = hash(route)
        for (let j = 0; j < n; j++) {
          const sim = sims[j % sims.length]
          const tau = (tsec + ((base + vdc(Math.floor(j / sims.length) + 1)) % 1) * sim.T) % sim.T
          const at = simAt(sim, tau)
          const [px, py, ang0] = pointAt(sim.tr, at.s)
          const ang = at.dir < 0 ? ang0 + Math.PI : ang0
          const c = Math.cos(ang), sn = Math.sin(ang)
          const sx = SX(px) - sn * side, sy = SY(py) + c * side
          if (!onScreen(sx, sy)) continue
          const vis = clamp01(s.veh - j) * dim // дробный выпуск — вагон плавно появляется/исчезает
          const fill = s.ratio * at.occ * (0.94 + 0.12 * hash(route + ':' + j))
          // свечение — на нижнем холсте (под линиями), едет вместе с вагоном
          const g = Math.min(1.2, fill), gr = (9 + 14 * g) * zr // пустой вагон тоже светится (зелёным) — видно, что он на линии
          gc.setTransform(gs, 0, 0, gs, 0, 0)
          gc.globalAlpha = Math.min(1, 0.55 + 0.35 * g) * vis
          gc.drawImage(byFill(fill), sx - gr, sy - gr, 2 * gr, 2 * gr)
          fc.setTransform(c, sn, -sn, c, sx, sy)
          fc.globalAlpha = vis
          fc.fillStyle = fill >= 1 ? '#fecaca' : '#ffffff'
          fc.strokeStyle = color
          fc.beginPath(); fc.roundRect(-tl / 2, -tw / 2, tl, tw, tw / 2); fc.fill(); fc.stroke()
        }
      }
      fc.setTransform(1, 0, 0, 1, 0, 0)

      // 5) выбранная остановка — расходящиеся волны цвета маршрута
      if (L.selPt) {
        const sx = SX(L.selPt[0]), sy = SY(L.selPt[1])
        fc.strokeStyle = L.selColor
        fc.lineWidth = 2.6 * dpr
        for (const off of [0, 0.5]) {
          const ph = (now / 1500 + off) % 1
          fc.globalAlpha = 0.85 * (1 - ph) ** 1.5
          fc.beginPath(); fc.arc(sx, sy, (9 + 34 * ph) * dpr, 0, Math.PI * 2); fc.stroke()
        }
      }
      gc.globalAlpha = 1; fc.globalAlpha = 1
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); wipe() }
  }, [paused, timeRef])

  // ---------- прогресс по маршруту «как в метро»: линия закрашена от начала до выбранной остановки
  const progRef = useRef<SVGPathElement>(null)
  const progress = useMemo(() => {
    if (!selected || !selPt) return null
    const q = selPt
    const own = lanes.filter((l) => l.route === selected)
    const distTo = (pts: Pt[]) => {
      let m = Infinity
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], ab = sub(pts[i + 1], a)
        const t2 = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1)))
        m = Math.min(m, len(sub(q, [a[0] + ab[0] * t2, a[1] + ab[1] * t2])))
      }
      return m
    }
    const lane = own.reduce<Lane | null>((b, l) => (!b || distTo(l.pts) < distTo(b.pts) ? l : b), null)
    if (!lane) return null
    // начало — конец цепочки, ближайший к первой остановке маршрута в данных
    const g0 = geo.find((x) => String(x.route) === selected)
    const firstStop = g0?.stops.find((st) => match.toScheme.has(`${selected}|${st.stop_id}`))
    const first = firstStop ? match.toScheme.get(`${selected}|${firstStop.stop_id}`) : undefined
    let pts = lane.pts
    if (first != null) {
      const f = stops[first].q
      if (len(sub(pts[pts.length - 1], f)) < len(sub(pts[0], f))) pts = [...pts].reverse()
    }
    const rad = pts === lane.pts ? lane.rad : [...lane.rad].reverse()
    return { d: rounded(pts, rad), color: lane.color, q, key: `${selected}:${lanes.indexOf(lane)}` }
  }, [selected, selPt, lanes, stops, geo, match])
  useEffect(() => {
    const el = progRef.current
    if (!el || !progress) return
    const L = el.getTotalLength()
    let best = 0, bd = Infinity
    for (let s0 = 0; s0 <= L; s0 += 1.5) {
      const p = el.getPointAtLength(s0), d = (p.x - progress.q[0]) ** 2 + (p.y - progress.q[1]) ** 2
      if (d < bd) { bd = d; best = s0 }
    }
    el.style.strokeDasharray = `${L} ${L}`
    if (!el.dataset.init) { el.style.transition = 'none'; el.style.strokeDashoffset = String(L); el.getBoundingClientRect(); el.dataset.init = '1' }
    el.style.transition = 'stroke-dashoffset .9s cubic-bezier(.65,0,.35,1)'
    el.style.strokeDashoffset = String(L - best)
  }, [progress])

  // ---------- статичные слои: пересобираются только при выборе/смене данных, но не при наведении мыши
  // (приглушение «чужих» маршрутов при наведении — через CSS ниже, без перерисовки тысяч элементов)
  const halos = useMemo(() => {
    const id = Math.random().toString(36).slice(2) // новый набор — перерисовать буфер подсветки
    return [1, 2].flatMap((lv) => lanes.filter((l) => alerts[l.route] === lv && !(progress && l.route === selected))
      .map((l): HaloPath => ({ p: new Path2D(l.d), lv, route: l.route, id })))
  }, [lanes, alerts, progress, selected])
  live.current.halos = halos

  const fg = useMemo(() => {
    const rc = (rs: string[]) => (rs.length ? `hasr ${rs.map((r) => `sr-${r}`).join(' ')}` : '')
    return (
      <>
        {lanes.map((l, i) => (
          <path key={`l${i}`} d={l.d} stroke={progress && l.route === selected ? '#c9ccd2' : l.color}
            className={`sch-lane r-${l.route} ${dataRoutes.has(l.route) ? '' : 'nodata'}`} />
        ))}
        {progress && <path key={progress.key} ref={progRef} d={progress.d} stroke={progress.color} className={`sch-lane sch-prog r-${selected}`} />}
        {/* невидимые широкие полосы для наведения/клика */}
        {lanes.map((l, i) => (
          <path key={`x${i}`} d={l.d} data-route={l.route} className="sch-hit"
            onPointerEnter={(e) => { if (e.pointerType === 'mouse' && !e.buttons) setHover(l.route) }} onPointerLeave={() => setHover((h) => (h === l.route ? null : h))} />
        ))}
        {stops.map((s, i) => (
          <g key={`s${i}`} data-stop={i} onPointerEnter={(e) => { if (e.pointerType === 'mouse' && !e.buttons) setHoverStop(i) }} onPointerLeave={() => setHoverStop((h) => (h === i ? null : h))}
            className={`sch-stop ${rc(s.routes)}`}>
            {s.dots.map((d, j) => <circle key={j} className={`ln-${s.routes[j] ?? ''}`} cx={d[0]} cy={d[1]} r={1.05} />)}
            {/* своя зона нажатия у каждой точки: клик выбирает маршрут этой полосы и остановку */}
            {s.dots.map((d, j) => <circle key={`h${j}`} className={`sch-stop-hit ln-${s.routes[j] ?? ''}`} data-lane={s.routes[j] ?? ''} cx={d[0]} cy={d[1]} r={LANE * 0.5} />)}
          </g>
        ))}
        {selPt && (
          <g className="sch-selmark">
            <circle className="sch-sel" cx={selPt[0]} cy={selPt[1]} r={selStop != null ? stops[selStop].hw + 2.6 : 4.2} stroke={selColor} />
            <circle cx={selPt[0]} cy={selPt[1]} r={1.5} fill={selColor} />
          </g>
        )}
        {stops.map((s, i) => {
          const [dx, dy, anchor] = LABEL_POS[s.a] ?? LABEL_POS.r
          const off = s.hw + 1.2
          const base = s.lp ?? [s.q[0] + dx * off, s.q[1] + dy * off]
          const x = base[0], y = base[1] + (dy > 0 ? 3.2 : dy < 0 ? -0.6 : 1.6)
          return (
            <text key={`t${i}`} x={x} y={y} textAnchor={anchor}
              className={`sch-label ${s.b ? 'bold' : ''} ${rc(s.routes)} ${i === selStop ? 'sel' : ''}`}
              transform={s.rot ? `rotate(${s.rot} ${x} ${y})` : undefined}>
              {s.n.split('\n').map((line, j, arr) => (
                <tspan key={j} x={x} dy={j === 0 ? (dy === 0 ? -(arr.length - 1) * (s.b ? 3.1 : 2.6) : dy < 0 ? -(arr.length - 1) * (s.b ? 6.2 : 5.2) : 0) : s.b ? 6.2 : 5.2}>
                  {j === 0 && s.m ? <tspan className="sch-m">М </tspan> : null}{line}
                </tspan>
              ))}
            </text>
          )
        })}
        {SCHEME.terms.map((tm, i) => (
          <g key={`b${i}`} className={`sch-term ${tm.routes.map((r) => `sr-${r}`).join(' ')}`}>
            {tm.routes.map((r, j) => (
              <g key={r} data-route={r} transform={`translate(${tm.p[0] + j * 12},${tm.p[1]})`}>
                <rect width={11} height={8} rx={1.4} fill={SCHEME_ROUTES[r]?.color ?? '#888'} />
                <text x={5.5} y={6} textAnchor="middle">{r}</text>
              </g>
            ))}
          </g>
        ))}
      </>
    )
  }, [lanes, stops, dataRoutes, progress, selected, selStop, selPt, selColor])

  const bg = SCHEME.bg
  const bgEl = useMemo(() => (
    <>
      <rect x={-3000} y={-3000} width={8000} height={8000} className="sch-bg" />
      {(debugMode === 'img' || debugMode === 'thin') && <image href="/scheme-ref.png" x={0} y={0} width={1454} height={2000} opacity={debugMode === 'thin' ? 1 : 0.5} />}
      {bg?.parks.map((d, i) => <path key={`p${i}`} className="sch-park" d={d} />)}
      {bg?.white.map((d, i) => <path key={`w${i}`} className="sch-white" d={d} />)}
      {bg?.water.map((d, i) => <path key={`r${i}`} className="sch-river" d={d} />)}
    </>
  ), [bg, debugMode])

  const f = focusRoute ? CSS.escape(focusRoute) : null
  const dimCss = f
    ? `.scheme .sch-lane:not(.r-${f}){opacity:.14}.scheme .sch-stop.hasr:not(.sr-${f}){opacity:.3}`
      + `.scheme .sch-label.hasr:not(.sr-${f}){opacity:.35}.scheme .sch-term:not(.sr-${f}){opacity:.25}`
    : ''
  // выбранная ветка: её остановки крупнее, с обводкой в цвет линии, и шире зона нажатия (масштаб — --ds/--hs от приближения)
  const sel = selected ? CSS.escape(`ln-${selected}`) : null
  const selCss = sel
    ? `.scheme .sch-stop circle.${sel}:not(.sch-stop-hit){transform:scale(var(--ds,1));stroke:${SCHEME_ROUTES[selected!]?.color ?? '#333'};stroke-width:.42px}`
      + `.scheme .sch-stop .sch-stop-hit.${sel}{transform:scale(var(--hs,1))}`
    : ''
  const hoverInfo = hover ? SCHEME_ROUTES[hover] : null
  const hoverData = hover ? day?.routes.find((r) => String(r.route) === hover) : undefined
  const pinName = selected && selectedStop ? geo.find((g0) => String(g0.route) === selected)?.stops.find((s) => s.stop_id === selectedStop)?.name : undefined

  return (
    <div ref={box} className={`scheme ${zoomCls} ${focusRoute ? 'focus' : ''} ${debugMode === 'thin' ? 'dbg-thin' : ''}`}>
      <style>{dimCss + selCss}</style>
      <svg className="sch-layer" width="100%" height="100%"><g ref={gBg}>{bgEl}</g></svg>
      <canvas ref={glowCv} className="sch-layer sch-cv" />
      <svg className="sch-layer sch-fg" width="100%" height="100%"><g ref={gFg}>{fg}</g></svg>
      <canvas ref={fxCv} className="sch-layer sch-cv" />
      {selPt && (
        <div ref={pin} className="sch-pin">
          <div><span className="st-n" style={{ background: selColor }}>{selected}</span>{pinName ?? (selStop != null ? stops[selStop].n.replace('\n', ' ') : '')}</div>
        </div>
      )}
      {/* подсказка о маршруте под курсором */}
      <div ref={tip} className={`sch-tip ${hoverInfo || hoverStop != null ? 'on' : ''}`}>
        {hoverStop != null && !hoverInfo && (
          <>
            <div className="st-h"><b>{stops[hoverStop].m ? <span className="sch-mm">М </span> : null}{stops[hoverStop].n.replace('\n', ' ')}</b></div>
            <div className="st-r">{stops[hoverStop].routes.map((r) => <span key={r} className="st-n" style={{ background: SCHEME_ROUTES[r]?.color }}>{r}</span>)}</div>
            <div className="st-s">{stops[hoverStop].routes.some((r) => matchRef.current.toData.has(`${r}|${hoverStop}`)) ? 'Нажмите — прогноз по остановке' : 'Нет прогноза по этой остановке'}</div>
          </>
        )}
        {hoverInfo && (
          <>
            <div className="st-h"><span className="st-n" style={{ background: hoverInfo.color }}>{hoverInfo.num}</span>
              <b>{hoverInfo.from} — {hoverInfo.to}</b></div>
            <div className="st-s">интервал {hoverInfo.interval} мин{hoverData && hoverData.vehicles[hour] > 0
              ? <> · загрузка <b className={`lv-${levelOf(hoverData.ratio[hour])}`}>{Math.round(hoverData.ratio[hour] * 100)}%{hoverData.ratio[hour] >= 1 ? ` (${overLabel(hoverData.ratio[hour])})` : ''}</b></>
              : dataRoutes.has(hoverInfo.num) ? <> · нет выпуска в этот час</> : <> · нет данных</>}</div>
          </>
        )}
      </div>
    </div>
  )
})

export default SchemeView
