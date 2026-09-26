import { Download, Thermometer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { exportUrl, fmt, useApi, type Forecast } from '../api'
import { axis, Card, CoefPanel, ErrorBox, Kpi, RouteChips, routeColor, tooltipStyle, useApp } from '../components'

type Decomp = {
  route: number; date: string; day_type: string; special: string; school_holiday: boolean
  weather: { t_mean: number; precip: number; snowfall: number; wind: number } | null
  waterfall: { name: string; value: number }[]
}
const DT: Record<string, string> = { wd: 'будний', sat: 'суббота', sun: 'воскресенье', hol: 'праздник' }

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
  const fc = useApi<Forecast>('/api/forecast', { ...params, by_route: byRoute && !stop, v: version })
  const decRoute = routes[0] ?? 17
  const dec = useApi<Decomp>(horizon === 'day' ? '/api/decompose' : null, { route: decRoute, date, ...coef, v: version })

  const keys = useMemo(() => byRoute && !stop ? Object.keys(fc.data?.by_route ?? {}).filter((k) => (fc.data?.by_route[k] ?? 0) > 0) : ['total'], [fc.data, byRoute, stop])
  // водопад: ось начинается не с нуля, иначе вклады в ±1–20% не видны
  const waterfall = useMemo(() => {
    const w = dec.data?.waterfall ?? []
    let acc = 0
    const levels: number[] = []
    const rows = w.map((x, i) => {
      const edge = i === 0 || i === w.length - 1
      const from = edge ? 0 : acc
      acc = edge ? x.value : acc + x.value
      levels.push(acc)
      return { name: x.name, from, to: acc, raw: x.value, edge }
    })
    const lo = levels.length ? Math.floor(Math.min(...levels) * 0.85 / 1000) * 1000 : 0
    return rows.map((r) => {
      const a = r.edge ? lo : Math.min(r.from, r.to)
      const b = r.edge ? r.to : Math.max(r.from, r.to)
      return { ...r, base: a - lo, value: Math.max(b - a, 1), lo }
    })
  }, [dec.data])
  const wfLo = waterfall[0]?.lo ?? 0

  return (
    <>
      <Card>
        <div className="row" style={{ gap: 18, alignItems: 'end' }}>
          <label className="f">Горизонт
            <div className="seg">
              {(['day', 'month', 'year'] as const).map((h) => (
                <button key={h} className={horizon === h ? 'on' : ''} onClick={() => { setHorizon(h); setAgg('') }}>{meta?.horizons[h]?.title ?? h}</button>
              ))}
            </div>
          </label>
          {horizon === 'day' && <label className="f">Дата<input type="date" value={date} min="2025-11-01" max="2026-10-31" onChange={(e) => setDate(e.target.value)} /></label>}
          {horizon === 'month' && <label className="f">Месяц
            <select value={month} onChange={(e) => setMonth(e.target.value)}>{meta?.months.map((m) => <option key={m}>{m}</option>)}</select></label>}
          <label className="f">Часы с<input type="number" min={0} max={23} value={h0} onChange={(e) => setH0(Math.min(Number(e.target.value), h1))} /></label>
          <label className="f">по<input type="number" min={0} max={23} value={h1} onChange={(e) => setH1(Math.max(Number(e.target.value), h0))} /></label>
          <label className="f">Агрегация
            <select value={agg} onChange={(e) => setAgg(e.target.value)}>
              <option value="">авто ({meta?.horizons[horizon]?.agg})</option>
              <option value="hour">по часам</option><option value="day">по дням</option><option value="month">по месяцам</option>
              <option value="hour_of_day">профиль по часу суток</option><option value="weekday">по дню недели</option>
            </select></label>
          <label className="f">Остановка
            <select value={stop} disabled={routes.length !== 1} onChange={(e) => setStop(e.target.value)} style={{ maxWidth: 240 }}>
              <option value="">{routes.length === 1 ? 'весь маршрут' : 'выберите 1 маршрут'}</option>
              {stops.map((s) => <option key={s.stop_id} value={s.stop_id}>{s.name}</option>)}
            </select></label>
          <label className="f" style={{ flexDirection: 'row' }}><span>&nbsp;</span>
            <span className="row"><input type="checkbox" checked={byRoute} onChange={(e) => setByRoute(e.target.checked)} /> по маршрутам</span></label>
          <div className="spacer" />
          <a className="btn" href={exportUrl({ ...params, format: 'csv' })}><Download size={14} /> CSV</a>
          <a className="btn" href={exportUrl({ ...params, format: 'xlsx' })}><Download size={14} /> XLSX</a>
          <a className="btn primary" href="/api/submission" title="Файл для платформы хакатона: ноябрь–декабрь, 14 640 строк"><Download size={14} /> submission.csv</a>
        </div>
        <div style={{ marginTop: 12 }}><RouteChips value={routes} onChange={(v) => { setRoutes(v); setStop('') }} /></div>
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
        <CoefPanel />
      </div>

      <div className="grid g2">
        {horizon === 'day' && (
          <Card title={`Из чего складывается прогноз: маршрут №${decRoute}, ${date}`} hint={routes.length !== 1 ? 'выберите маршрут' : undefined}>
            <ErrorBox error={dec.error} />
            {dec.data && (
              <div className="row note" style={{ marginBottom: 8 }}>
                <span className="tag">{DT[dec.data.day_type] ?? dec.data.day_type}</span>
                {dec.data.special && <span className="tag run">{dec.data.special}</span>}
                {dec.data.school_holiday && <span className="tag">школьные каникулы</span>}
                {dec.data.weather ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Thermometer size={14} /> {dec.data.weather.t_mean}°C · осадки {dec.data.weather.precip} мм · снег {dec.data.weather.snowfall} см</span> : <span>погода: нет данных (нейтрально)</span>}
              </div>
            )}
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={waterfall}>
                <CartesianGrid stroke="#22314f" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" {...axis} />
                <YAxis {...axis} tickFormatter={(v) => `${Math.round((v + wfLo) / 1000)}k`} />
                <Tooltip {...tooltipStyle} formatter={(_v, _n, p: any) => [(p.payload.raw > 0 && !p.payload.edge ? '+' : '') + fmt(p.payload.raw), 'посадок']} cursor={{ fill: '#ffffff08' }} />
                <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]}>
                  {waterfall.map((w, i) => <Cell key={i} fill={w.edge ? '#22d3ee' : w.raw >= 0 ? '#22c55e' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
        <Card title="Таблица прогноза" hint={`${fc.data?.series.length ?? 0} строк`}>
          <div className="scroll">
            <table className="t">
              <thead><tr><th>Период</th>{keys.map((k) => <th key={k} className="num">{k === 'total' ? 'Посадки' : `№${k}`}</th>)}{keys.length > 1 && <th className="num">Всего</th>}</tr></thead>
              <tbody>
                {(fc.data?.series ?? []).map((p) => (
                  <tr key={p.t}><td className="mono">{p.t}</td>{keys.map((k) => <td key={k} className="num">{fmt(Number(p[k]))}</td>)}{keys.length > 1 && <td className="num"><b>{fmt(p.total)}</b></td>}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  )
}
