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
}
export type DayView = {
  date: string; dow: number; day_type: 'wd' | 'sat' | 'sun' | 'hol'; special: string; school_holiday: boolean
  is_working_weekend: boolean
  weather: { temp: number[]; precip: number[]; snow: number[] } | null
  routes: DayRoute[]
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
