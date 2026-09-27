import { Clock3, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { exportUrl, fmt, useApi, type Forecast } from '../api'
import { axis, Card, SettingsHint, ErrorBox, Kpi, routeColor, tooltipStyle, useApp } from '../components'
import { DatePicker } from '../ops/Timeline'

export default function ForecastPage() {
  const { meta, geo, coef, version } = useApp()
  const [horizon, setHorizon] = useState<'day' | 'month' | 'year'>('day')
  const [date, setDate] = useState('2025-11-12')
  const [month, setMonth] = useState('2025-11')
  const [routes, setRoutes] = useState<number[]>([])
  const [stop, setStop] = useState('')
  const [h0, setH0] = useState(0)
  const [h1, setH1] = useState(23)
  const [agg, setAgg] = useState('')
  const [byRoute, setByRoute] = useState(true)

  const stops = routes.length === 1 ? geo.find((g) => g.route === routes[0])?.stops ?? [] : []
  const params = {
    horizon, date: horizon === 'day' ? date : undefined, month: horizon === 'month' ? month : undefined,
    route: routes.join(',') || undefined, stop_id: stop || undefined, hour_from: h0, hour_to: h1,
    agg: agg || undefined, ...coef,
  }
  const view = { ...params, by_route: byRoute && !stop }
  const fc = useApi<Forecast>('/api/forecast', { ...view, v: version })
  const keys = useMemo(() => byRoute && !stop ? Object.keys(fc.data?.by_route ?? {}).filter((k) => (fc.data?.by_route[k] ?? 0) > 0) : ['total'], [fc.data, byRoute, stop])

  return (
    <>
      <Card>
        <div className="forecast-panel">
          <div className="forecast-controls">
            <label className="f">Период
              <div className="seg" aria-label="Горизонт прогноза">
                {(['day', 'month', 'year'] as const).map((h) => (
                  <button key={h} type="button" aria-pressed={horizon === h} className={horizon === h ? 'on' : ''} onClick={() => { setHorizon(h); setAgg('') }}>{meta?.horizons[h]?.title ?? h}</button>
                ))}
              </div>
            </label>
            {horizon === 'day' && <div className="forecast-date"><span>Дата</span><DatePicker date={date} setDate={setDate} min={meta?.forecast.from ?? '2025-11-01'} max={meta?.forecast.to ?? '2026-10-31'} /></div>}
            {horizon === 'month' && <label className="f">Месяц<select value={month} onChange={(e) => setMonth(e.target.value)}>{meta?.months.map((m) => <option key={m}>{m}</option>)}</select></label>}
            <div className="f forecast-time-field">
              <span>Интервал</span>
              <div className="forecast-time-range">
                <Clock3 size={16} aria-hidden="true" />
                <select aria-label="Начало интервала" value={h0} onChange={(e) => setH0(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h} disabled={h > h1}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
                <span className="forecast-time-separator">—</span>
                <select aria-label="Конец интервала" value={h1} onChange={(e) => setH1(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h} disabled={h < h0}>{String(h + 1).padStart(2, '0')}:00</option>)}
                </select>
              </div>
            </div>
            <label className="f">Агрегация
              <select value={agg} onChange={(e) => setAgg(e.target.value)}>
                <option value="">{horizon === 'day' ? 'По часам' : horizon === 'month' ? 'По дням' : 'По месяцам'}</option>
                <option value="hour">По часам</option><option value="day">По дням</option><option value="month">По месяцам</option>
                <option value="hour_of_day">По часу суток</option><option value="weekday">По дню недели</option>
              </select>
            </label>
          </div>
          <div className="forecast-route-row">
            <label className="f">Маршрут
              <select value={routes[0] ?? ''} onChange={(e) => { setRoutes(e.target.value ? [Number(e.target.value)] : []); setStop('') }}>
                <option value="">Все маршруты</option>
                {meta?.routes.map((r) => <option key={r.route} value={r.route}>№{r.route}</option>)}
              </select>
            </label>
            {routes.length === 1 && <label className="f">Остановка
              <select value={stop} onChange={(e) => setStop(e.target.value)}>
                <option value="">Весь маршрут</option>
                {stops.map((s) => <option key={s.stop_id} value={s.stop_id}>{s.name}</option>)}
              </select>
            </label>}
            <label className="forecast-check"><input type="checkbox" checked={byRoute} onChange={(e) => setByRoute(e.target.checked)} /> По маршрутам</label>
          </div>
          <div className="forecast-downloads">
            <a className="btn primary" href={exportUrl({ ...view, format: 'csv' })} download><Download size={18} /> Скачать CSV</a>
            <a className="btn primary" href={exportUrl({ ...view, format: 'xlsx' })} download><Download size={18} /> Скачать XLSX</a>
            <a className="btn forecast-submission-link" href="/api/submission" download><Download size={16} /> submission.csv</a>
          </div>
        </div>
      </Card>

      <ErrorBox error={fc.error} />
      <div className="grid g4">
        <Kpi accent label="Посадок за интервал" value={fmt(fc.data?.total)} foot={`${fc.data?.date_from ?? ''} … ${fc.data?.date_to ?? ''}, ${h0}:00–${h1}:59`} />
        <Kpi label="Пиковый час" value={fc.data?.peak_hour != null ? `${fc.data.peak_hour}:00` : '—'} />
        <Kpi label="Детализация" value={fc.data?.stop ? 'Остановка' : routes.length ? `${routes.length} марш.` : 'Сеть'} foot={fc.data?.stop ?? (routes.length ? routes.map((r) => `№${r}`).join(', ') : 'все 10 маршрутов')} />
        <Kpi label="Строк в выборке" value={fmt(fc.data?.rows)} foot="маршрут × дата × час" />
      </div>

      <div className="grid g-side">
        <Card title="Динамика прогноза" hint={fc.loading ? 'обновление…' : fc.data?.note}>
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={fc.data?.series ?? []}>
              <CartesianGrid stroke="#22314f" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" {...axis} minTickGap={20} tickFormatter={(t: string) => (t.length > 10 ? t.slice(11) : t.length === 10 ? t.slice(5) : t)} />
              <YAxis {...axis} tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v))} />
              <Tooltip {...tooltipStyle} formatter={(v, n) => [fmt(Number(v)), n === 'total' ? 'Всего' : `№${n}`]} />
              {keys.length > 1 && <Legend formatter={(v) => `№${v}`} wrapperStyle={{ fontSize: 12 }} />}
              {keys.map((k) => (
                <Area key={k} dataKey={k} stackId="a" type="monotone" stroke={k === 'total' ? '#22d3ee' : routeColor(meta, k)}
                  fill={k === 'total' ? '#22d3ee33' : routeColor(meta, k) + '66'} strokeWidth={1.5} isAnimationActive={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </Card>
        <SettingsHint />
      </div>

    </>
  )
}
