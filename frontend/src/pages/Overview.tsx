import { useMemo, useState } from 'react'
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, LEVEL_COLORS, useApi, type Forecast } from '../api'
import { axis, Card, SettingsHint, ErrorBox, Kpi, routeColor, tooltipStyle, useApp } from '../components'

type Rec = { route: number; hour: number; boardings: number; vehicles: number; per_vehicle: number; load_ratio: number; level: string; extra_vehicles: number }

export default function Overview() {
  const { meta, coef, version, go } = useApp()
  const [recDate, setRecDate] = useState('2025-11-12')
  const c = { ...coef, v: version }
  const fc = useApi<Forecast>('/api/forecast', { date_from: '2025-11-01', date_to: '2025-12-31', agg: 'day', by_route: true, ...c })
  const hist = useApi<{ series: { t: string; total: number }[] }>('/api/history', { date_from: '2025-09-01', agg: 'day', v: version })
  const hours = useApi<Forecast>('/api/forecast', { date_from: '2025-11-01', date_to: '2025-12-31', agg: 'hour_of_day', ...c })
  const recs = useApi<Rec[]>('/api/recommendations', { date: recDate, ...c })

  const series = useMemo(() => {
    const h = (hist.data?.series ?? []).map((p) => ({ t: p.t, fact: p.total }))
    const f = (fc.data?.series ?? []).map((p) => ({ t: p.t, forecast: p.total }))
    return [...h, ...f]
  }, [hist.data, fc.data])

  const wd = fc.data?.series.filter((p) => { const d = new Date(p.t).getDay(); return d > 0 && d < 6 }) ?? []
  const avgWd = wd.length ? wd.reduce((s, p) => s + p.total, 0) / wd.length : 0
  const byRoute = Object.entries(fc.data?.by_route ?? {}).map(([r, v]) => ({ r: `№${r}`, route: r, v })).sort((a, b) => b.v - a.v)
  const bt = meta?.backtest_mean?.['Полная модель']

  return (
    <>
      <ErrorBox error={fc.error || hist.error} />
      <div className="grid g4">
        <Kpi accent label="Прогноз посадок, ноябрь–декабрь 2025" value={fmt(fc.data?.total)} foot="10 маршрутов · 61 день · по часам" />
        <Kpi label="Средний будний день" value={fmt(avgWd)} foot="посадок в сутки по сети" />
        <Kpi label="Пиковый час" value={hours.data?.peak_hour != null ? `${hours.data.peak_hour}:00` : '—'} foot="максимум посадок за период" />
        <Kpi label="Качество на бэктесте (WAPE-score)" value={bt ? bt.toFixed(3) : '—'}
          foot={<>baseline 0.48 · <a onClick={() => go('model')} style={{ cursor: 'pointer' }}>подробнее →</a></>} />
      </div>

      <div className="grid g-side">
        <Card title="Посадки по дням: факт (сентябрь–октябрь) и прогноз (ноябрь–декабрь)" hint="с учётом коэффициентов">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={series}>
              <CartesianGrid stroke="#22314f" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" {...axis} tickFormatter={(t) => t.slice(5)} minTickGap={24} />
              <YAxis {...axis} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} />
              <ReferenceLine x="2025-11-01" stroke="#22d3ee" strokeDasharray="4 4" label={{ value: 'точка прогноза', fill: '#22d3ee', fontSize: 11, position: 'insideTopLeft' }} />
              <Area dataKey="fact" name="Факт" stroke="#818cf8" fill="#818cf833" strokeWidth={1.5} dot={false} />
              <Line dataKey="forecast" name="Прогноз" stroke="#22d3ee" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <SettingsHint />
      </div>

      <div className="grid g3">
        <Card title="Прогноз по маршрутам" hint="ноябрь–декабрь">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byRoute} layout="vertical" margin={{ left: 0 }}>
              <XAxis type="number" {...axis} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <YAxis type="category" dataKey="r" {...axis} width={40} />
              <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} cursor={{ fill: '#ffffff08' }} />
              <Bar dataKey="v" name="Посадки" radius={[0, 4, 4, 0]}
                shape={(p: any) => <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={3} fill={routeColor(meta, p.payload.route)} />} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Суточный профиль" hint="сумма за период по часам">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={hours.data?.series ?? []}>
              <CartesianGrid stroke="#22314f" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" {...axis} />
              <YAxis {...axis} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} cursor={{ fill: '#ffffff08' }} />
              <Bar dataKey="total" name="Посадки" fill="#22d3ee" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Где не хватает вагонов" hint={<input type="date" value={recDate} min="2025-11-01" max="2026-10-31" onChange={(e) => setRecDate(e.target.value)} />}>
          <ErrorBox error={recs.error} />
          <div className="scroll" style={{ maxHeight: 280 }}>
            <table className="t">
              <thead><tr><th>Маршрут</th><th>Час</th><th className="num">Посадок/ТС</th><th className="num">+ТС</th></tr></thead>
              <tbody>
                {(recs.data ?? []).slice(0, 14).map((r) => (
                  <tr key={`${r.route}-${r.hour}`}>
                    <td><span className="tag" style={{ color: routeColor(meta, r.route) }}>№{r.route}</span></td>
                    <td>{r.hour}:00</td>
                    <td className="num" style={{ color: LEVEL_COLORS[r.level] }}>{fmt(r.per_vehicle)} <span className="note">({Math.round(r.load_ratio * 100)}%)</span></td>
                    <td className="num"><b>+{r.extra_vehicles}</b></td>
                  </tr>
                ))}
                {recs.data?.length === 0 && <tr><td colSpan={4} className="note">Перегруженных часов нет</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="note" style={{ marginTop: 8 }}>Норматив — 90-й перцентиль посадок на вагон в час по маршруту. «+ТС» — сколько вагонов добавить на выпуск, чтобы уложиться в норматив.</div>
        </Card>
      </div>
    </>
  )
}
