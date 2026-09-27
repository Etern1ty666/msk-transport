import { useEffect, useRef, useState } from 'react'

export type Coef = { weather: number; event: number; season: number; trend: number; holiday: number }
export const DEFAULT_COEF: Coef = { weather: 1, event: 1, season: 1, trend: 1, holiday: 1 }

export type RouteMeta = {
  route: number; name: string; color: string; stops: number; stops_source: string
  history_total: number; active: boolean
}
export type Meta = {
  routes: RouteMeta[]
  horizons: Record<string, { title: string; agg: string; desc: string }>
  history: { from: string; to: string }
  forecast: { from: string; to: string; submission_from: string; submission_to: string }
  months: string[]
  stats: Record<string, number | number[] | Record<string, number>>
  backtest_mean: Record<string, number>
  built_at: number
  sources: { name: string; kind: string; url: string }[]
  geo_note: string
}
export type Stop = { stop_id: string; name: string; lat: number; lon: number; weight: number }
export type RouteGeo = { route: number; name: string; color: string; lines: number[][][]; stops: Stop[]; stops_source: string }
export type Segment = { id: number; routes: number[]; coords: number[][] }
/** Выпрямленная сеть для режима «Схема»: участки и координаты остановок на них. */
export type Schema = { segments: Segment[]; stops: Record<string, Record<string, number[]>> }
export type SeriesPoint = { t: string; total: number; [route: string]: number | string }
export type Forecast = {
  horizon: string; agg: string; stop: string | null; stop_share: number; date_from: string; date_to: string
  total: number; by_route: Record<string, number>; peak_hour: number | null; series: SeriesPoint[]; rows: number
  note: string | null
}
export type RouteLoad = {
  route: number; boardings: number; vehicles: number; per_vehicle: number; norm_per_vehicle: number
  load_ratio: number; level: 'low' | 'mid' | 'high' | 'crit'; level_title: string; extra_vehicles: number
  day_total?: number; hourly?: number[]
}
export type Stage = {
  key: string; title: string; desc: string; status: 'pending' | 'running' | 'done' | 'error'
  progress: number; started: number | null; finished: number | null; duration: number | null
  message: string; metrics: Record<string, number | string>
}
export type LogEvent = { kind: 'log'; ts: number; stage: string; level: string; message: string; run_id: number }
export type SystemMetrics = {
  ts: number; uptime_s: number; rps: number; requests_60s: number; p50_ms: number; p95_ms: number; p99_ms: number
  errors_60s: number; cpu_percent: number; rss_mb: number
  cache: { hits: number; misses: number; currsize: number }
  endpoints: Record<string, { n: number; p95_ms: number }>
}

export class ApiError extends Error {}

export async function api<T>(path: string, params?: Record<string, unknown>, init?: RequestInit): Promise<T> {
  const url = new URL(path, window.location.origin)
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  let res: Response
  try {
    res = await fetch(url.toString().replace(window.location.origin, ''), init)
  } catch {
    throw new ApiError('Сервер недоступен — проверьте, что backend запущен')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(body.error ?? `Ошибка ${res.status}`)
  return body as T
}

export function exportUrl(params: Record<string, unknown>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v))
  return `/api/forecast/export?${u.toString()}`
}

/** Загрузка данных с учётом отмены устаревших запросов. */
export function useApi<T>(path: string | null, params?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const key = path ? path + JSON.stringify(params ?? {}) : null
  useEffect(() => {
    if (!path) return
    let alive = true
    setLoading(true)
    api<T>(path, params)
      .then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e: Error) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { data, error, loading }
}

/** WebSocket с автопереподключением. */
export function useSocket<T>(path: string, onMessage: (msg: T) => void) {
  const [connected, setConnected] = useState(false)
  const ref = useRef<WebSocket | null>(null)
  const handler = useRef(onMessage)
  handler.current = onMessage
  useEffect(() => {
    let stop = false
    let timer: number | undefined
    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}${path}`)
      ref.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = (e) => handler.current(JSON.parse(e.data))
      ws.onclose = () => {
        setConnected(false)
        if (!stop) timer = window.setTimeout(connect, 1500)
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => { stop = true; window.clearTimeout(timer); ref.current?.close() }
  }, [path])
  const send = (msg: unknown) => {
    if (ref.current?.readyState === WebSocket.OPEN) ref.current.send(JSON.stringify(msg))
  }
  return { connected, send }
}

export const fmt = (n: number | undefined | null, digits = 0) =>
  n === undefined || n === null || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits })

export const LEVEL_COLORS: Record<string, string> = {
  low: '#22c55e', mid: '#eab308', high: '#f97316', crit: '#ef4444',
}
export const loadColor = (ratio: number) =>
  ratio < 0.7 ? LEVEL_COLORS.low : ratio < 1.0 ? LEVEL_COLORS.mid : ratio < 1.2 ? LEVEL_COLORS.high : LEVEL_COLORS.crit

export type DayRoute = {
  route: number; name: string; color: string; boardings: number[]; vehicles: number[]; ratio: number[]
  extra: number[]; norm: number; day_total: number; peak_hour: number | null
  pay_mix?: number[][] | null // доли типов оплаты по часам (порядок — DayView.pay_cats)
  place: string | null // площадка (депо), к которой приписан маршрут
}
/** Площадка на сутки: парк, пиковый выпуск (p90 будней), вагоны её маршрутов на линии и готовые в парке по часам. */
export type Depot = {
  name: string; fleet: number; multi_route: number; peak_out: number; routes: number[]
  on_line: number[]; ready: number[]
}
export type DayView = {
  date: string; dow: number; day_type: 'wd' | 'sat' | 'sun' | 'hol'; special: string; school_holiday: boolean
  is_working_weekend: boolean
  weather: { temp: number[]; precip: number[]; snow: number[] } | null
  routes: DayRoute[]
  depots: Record<string, Depot> | null
  pay_cats?: { key: string; title: string }[] | null
  network: { boardings: number[]; max_ratio: number[]; problems: number[] }
}
export const levelOf = (r: number): 'low' | 'mid' | 'high' | 'crit' => (r < 0.7 ? 'low' : r < 1 ? 'mid' : r < 1.2 ? 'high' : 'crit')
/** Превышение норматива коротко: 1.29 → «+29%» (для бейджей, где базой всегда 100%). */
export const overLabel = (r: number) => `+${Math.max(1, Math.ceil((r - 1) * 100 - 1e-9))}%`
/** Значение ряда по 24 часам в дробный момент времени: весь час — значение этого часа (как на бейджах),
 *  а за последние 20 минут оно плавно перетекает в следующий час — эффект таймлапса без скачков. */
export const at24 = (a: number[], minute: number) => {
  const h = Math.min(23, Math.floor(minute / 60)), pos = minute - h * 60
  if (pos <= 40 || h === 23) return a[h] ?? 0
  const x = (pos - 40) / 20, f = x * x * (3 - 2 * x)
  return (a[h] ?? 0) * (1 - f) + (a[h + 1] ?? 0) * f
}
export const LEVEL_TITLE: Record<string, string> = { low: 'свободно', mid: 'норма', high: 'внимание', crit: 'перегрузка' }

/** Непрерывные окна часов, где загрузка ≥ порога. */
export function problemWindows(r: DayRoute, thr = 1.0) {
  const out: { from: number; to: number; max: number; extra: number }[] = []
  let cur: { from: number; to: number; max: number; extra: number } | null = null
  r.ratio.forEach((v, h) => {
    if (v >= thr) {
      if (!cur) cur = { from: h, to: h, max: v, extra: r.extra[h] }
      else { cur.to = h; cur.max = Math.max(cur.max, v); cur.extra = Math.max(cur.extra, r.extra[h]) }
    } else if (cur) { out.push(cur); cur = null }
  })
  if (cur) out.push(cur)
  return out
}

/** Выше этой загрузки ветке уже предлагаем свободные вагоны (если перегруженным хватает). */
export const SOFT = 0.8
/** Донор отдаёт вагоны, только если сам остаётся не выше этой доли норматива во все часы окна —
 *  не выше порога «предложить вагоны», чтобы донор сам не стал кандидатом. */
export const DONOR_MAX = SOFT
/** Сколько вагонов добавить, чтобы в час h загрузка стала не выше SOFT. */
export const softExtra = (r: DayRoute, h: number) =>
  r.vehicles[h] > 0 ? Math.max(0, Math.ceil(r.boardings[h] / (SOFT * r.norm)) - Math.floor(r.vehicles[h])) : 0
export type VehicleSource =
  | { kind: 'depot'; place: string; name: string; avail: number; take: number; own: boolean }
  | { kind: 'route'; route: number; color: string; place: string; own: boolean; avail: number; take: number; before: number; after: number }

export type VehiclePlan = { key: string; title: string; sources: VehicleSource[]; left: number }
export type Reserved = { route: number; color: string; take: number }

/** Откуда взять `need` вагонов на маршрут `r` в часы from..to — несколько вариантов:
 *  «быстрее всего» — сначала готовые в парке своей площадки, затем ветки той же площадки с запасом, затем другие площадки;
 *  «одним источником» — один парк или одна ветка закрывают всё сразу; «без парка» — только снять с веток с запасом. */
export function vehicleVariants(r: DayRoute, list: DayRoute[], depots: Record<string, Depot> | null | undefined,
  from: number, to: number, need: number, soft = false): { plans: VehiclePlan[]; reserved: Reserved[] } {
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const cands: VehicleSource[] = []
  for (const [p, d] of Object.entries(depots ?? {})) {
    const avail = Math.min(...hours.map((h) => d.ready[h]))
    if (avail > 0) cands.push({ kind: 'depot', place: p, name: d.name, avail, take: 0, own: p === r.place })
  }
  for (const x of list) {
    if (x.route === r.route || !x.place || hours.some((h) => x.vehicles[h] <= 0 || x.extra[h] > 0)) continue
    const avail = Math.min(...hours.map((h) => Math.floor(Math.floor(x.vehicles[h]) - x.boardings[h] / (DONOR_MAX * x.norm))))
    if (avail <= 0) continue
    const before = Math.max(...hours.map((h) => x.ratio[h]))
    cands.push({ kind: 'route', route: x.route, color: x.color, place: x.place, own: x.place === r.place, avail, take: 0, before, after: before })
  }
  const rank = (s: VehicleSource) => (s.own ? 0 : 2) + (s.kind === 'depot' ? 0 : 1)
  cands.sort((a, b) => rank(a) - rank(b) || b.avail - a.avail)
  // ветке выше 80%, но в пределах норматива, даём только то, что останется после перегруженных веток этих же часов
  const reserved: Reserved[] = []
  if (soft) {
    const hot = list.filter((x) => x.route !== r.route && hours.some((h) => x.vehicles[h] > 0 && x.ratio[h] >= 1))
      .sort((a, b) => Math.max(...hours.map((h) => b.ratio[h])) - Math.max(...hours.map((h) => a.ratio[h])))
    for (const x of hot) {
      let left = Math.max(...hours.map((h) => x.extra[h]))
      const want = left
      const own = (c: VehicleSource) => (c.place === x.place ? 0 : 2) + (c.kind === 'depot' ? 0 : 1)
      for (const c of [...cands].sort((a, b) => own(a) - own(b) || b.avail - a.avail)) {
        if (left <= 0) break
        const t = Math.min(c.avail, left)
        c.avail -= t
        left -= t
      }
      if (want - left > 0) reserved.push({ route: x.route, color: x.color, take: want - left })
    }
    for (let i = cands.length - 1; i >= 0; i--) if (cands[i].avail <= 0) cands.splice(i, 1)
  }
  const plan = (key: string, title: string, pool: VehicleSource[]): VehiclePlan => {
    let left = need
    const sources: VehicleSource[] = []
    for (const c of pool) {
      if (left <= 0) break
      const s = { ...c, take: Math.min(c.avail, left) }
      left -= s.take
      if (s.kind === 'route') {
        const x = list.find((q) => q.route === s.route)!
        s.after = Math.max(...hours.map((h) => x.boardings[h] / ((Math.floor(x.vehicles[h]) - s.take) * x.norm)))
      }
      sources.push(s)
    }
    return { key, title, sources, left: Math.max(0, left) }
  }
  const id = (s: VehicleSource) => (s.kind === 'depot' ? `d${s.place}` : `r${s.route}`)
  const all = [plan('fast', 'Быстрее', cands)]
  const single = cands.filter((c) => c.avail >= need)
  for (const c of [...single.filter((c) => c.kind === 'route'), ...single.filter((c) => c.kind === 'depot')].slice(0, 2))
    all.push(plan(`one-${id(c)}`, c.kind === 'route' ? `Только №${c.route}` : 'Только парк', [c]))
  const routesOnly = cands.filter((c) => c.kind === 'route')
  if (routesOnly.length) all.push(plan('routes', 'Ветками', [...routesOnly].sort((a, b) => b.avail - a.avail)))
  // одинаковые по составу варианты не повторяем; неполные — только если полных нет
  const seen = new Set<string>()
  const uniq = all.filter((p) => {
    const sig = p.sources.map((s) => `${id(s)}:${s.take}`).sort().join()
    if (!p.sources.length || seen.has(sig)) return false
    seen.add(sig)
    return true
  })
  const full = uniq.filter((p) => p.left === 0)
  return { plans: (full.length ? full : uniq.slice(0, 1)).slice(0, 3), reserved }
}

/** Ниже этой загрузки ветку можно разгрузить: снять лишние вагоны. */
export const FREE = 0.5
/** После снятия загрузка не выше этой доли норматива, а на линии остаётся не меньше половины вагонов (интервал не рвётся). */
export const FREE_TARGET = 0.7
/** Сколько вагонов можно снять в час h. */
export const spareAt = (r: DayRoute, h: number) => {
  const v = Math.floor(r.vehicles[h])
  if (v <= 0 || r.ratio[h] >= FREE) return 0
  return Math.max(0, Math.min(v - Math.ceil(r.boardings[h] / (FREE_TARGET * r.norm)), Math.floor(v / 2)))
}
/** Окно «можно снять»: сейчас или со следующего часа, пока загрузка низкая; снимаем столько, сколько можно во все часы окна. */
export function freeWindow(r: DayRoute, hour: number): { from: number; to: number; spare: number } | null {
  const from = spareAt(r, hour) > 0 ? hour : hour < 23 && spareAt(r, hour + 1) > 0 ? hour + 1 : -1
  if (from < 0) return null
  let to = from
  while (to < 23 && spareAt(r, to + 1) > 0) to++
  let spare = Infinity
  for (let h = from; h <= to; h++) spare = Math.min(spare, spareAt(r, h))
  return { from, to, spare }
}

export type FreeDest =
  | { kind: 'route'; route: number; color: string; own: boolean; give: number; before: number; after: number }
  | { kind: 'depot'; place: string | null; name: string; give: number }
export type FreePlan = { key: string; title: string; dests: FreeDest[] }

/** Куда деть снятые с `r` вагоны в часы from..to: сначала веткам, которым их не хватает (перегруженным, затем выше 80%),
 *  своей площадке — в первую очередь; остальное — в парк. Второй вариант — всё в парк. */
export function freeVariants(r: DayRoute, list: DayRoute[], depots: Record<string, Depot> | null | undefined,
  from: number, to: number, spare: number): FreePlan[] {
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const park: FreeDest = { kind: 'depot', place: r.place, name: (r.place && depots?.[r.place]?.name) || 'парк', give: spare }
  const needs = list.filter((x) => x.route !== r.route && x.place).map((x) => {
    const run = hours.filter((h) => x.vehicles[h] > 0)
    const need = Math.max(0, ...run.map((h) => (x.ratio[h] >= 1 ? x.extra[h] : x.ratio[h] >= SOFT ? softExtra(x, h) : 0)))
    return { x, run, need, max: Math.max(0, ...run.map((h) => x.ratio[h])) }
  }).filter((n) => n.need > 0)
    .sort((a, b) => +(b.max >= 1) - +(a.max >= 1) || +(b.x.place === r.place) - +(a.x.place === r.place) || b.max - a.max)
  const dests: FreeDest[] = []
  let left = spare
  for (const n of needs) {
    if (left <= 0) break
    const give = Math.min(left, n.need)
    left -= give
    const after = Math.max(...n.run.map((h) => n.x.boardings[h] / ((Math.floor(n.x.vehicles[h]) + give) * n.x.norm)))
    dests.push({ kind: 'route', route: n.x.route, color: n.x.color, own: n.x.place === r.place, give, before: n.max, after })
  }
  if (left > 0) dests.push({ ...park, give: left } as FreeDest)
  const plans: FreePlan[] = []
  if (dests.some((d) => d.kind === 'route')) plans.push({ key: 'help', title: 'Нуждающимся', dests })
  plans.push({ key: 'park', title: 'В парк', dests: [park] })
  return plans
}
