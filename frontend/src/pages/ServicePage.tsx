import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { fmt, useSocket, type SystemMetrics } from '../api'
import { axis, Card, Kpi, tooltipStyle, CH } from '../components'

const ENDPOINTS = [
  ['GET', '/api/forecast', 'Прогноз: horizon=day|month|year, date, month, date_from/date_to, route, stop_id, hour_from/hour_to, agg, by_route, коэффициенты'],
  ['GET', '/api/forecast/export', 'Выгрузка прогноза: format=csv|xlsx + те же параметры'],
  ['GET', '/api/load', 'Снимок загрузки маршрутов на дату и час (посадки, вагоны, норматив, уровень)'],
  ['GET', '/api/recommendations', 'Перегруженные часы и сколько вагонов добавить'],
  ['GET', '/api/decompose', 'Разложение прогноза дня на компоненты'],
  ['GET', '/api/history', 'Фактические посадки (январь–октябрь 2025)'],
  ['GET', '/api/geo', 'Линии маршрутов, остановки и их веса'],
  ['GET', '/api/model', 'Параметры модели, бэктест, абляция'],
  ['GET', '/api/submission', 'submission.csv для платформы'],
  ['POST', '/api/pipeline/run', 'Перезапуск конвейера (force_raw=true — из сырых 10 ГБ)'],
  ['WS', '/ws/pipeline', 'События конвейера: стадии, прогресс, логи'],
  ['WS', '/ws/live', 'Симуляция суток: загрузка маршрутов каждые 5 минут модельного времени'],
  ['WS', '/ws/system', 'Метрики сервиса раз в секунду'],
]

type LT = { n: number; ok: number; secs: number; rps: number; p50: number; p95: number; p99: number }

export default function ServicePage() {
  const [hist, setHist] = useState<(SystemMetrics & { t: string })[]>([])
  const [cur, setCur] = useState<SystemMetrics | null>(null)
  const { connected } = useSocket<SystemMetrics>('/ws/system', (m) => {
    setCur(m)
    setHist((h) => [...h.slice(-120), { ...m, t: new Date(m.ts * 1000).toLocaleTimeString('ru-RU') }])
  })
  const [lt, setLt] = useState<LT | null>(null)
  const [busy, setBusy] = useState(false)

  // Нагрузочный тест из браузера: случайные запросы прогноза с параллелизмом 32
  const loadTest = async (total = 2000, conc = 32) => {
    setBusy(true)
    const routes = [1, 7, 11, 12, 17, 25, 26, 28, 50]
    const lat: number[] = []
    let ok = 0, i = 0
    const t0 = performance.now()
    const worker = async () => {
      while (i < total) {
        i++
        const d = new Date(Date.UTC(2025, 10, 1) + Math.floor(Math.random() * 61) * 864e5).toISOString().slice(0, 10)
        const r = routes[Math.floor(Math.random() * routes.length)]
        const url = `/api/forecast?horizon=day&date=${d}&route=${r}&weather=${(0.5 + Math.random()).toFixed(1)}`
        const s = performance.now()
        const res = await fetch(url).catch(() => null)
        lat.push(performance.now() - s)
        if (res?.ok) ok++
      }
    }
    await Promise.all(Array.from({ length: conc }, worker))
    const secs = (performance.now() - t0) / 1000
    lat.sort((a, b) => a - b)
    const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]
    setLt({ n: total, ok, secs, rps: total / secs, p50: q(0.5), p95: q(0.95), p99: q(0.99) })
    setBusy(false)
  }

  return (
    <>
      <div className="grid g4">
        <Kpi accent label="Запросов в секунду (60 с)" value={fmt(cur?.rps, 1)} foot={<><span className={`dot ${connected ? 'ok' : 'bad'}`} /> /ws/system</>} />
        <Kpi label="Латентность p50 / p95" value={cur ? `${fmt(cur.p50_ms, 1)} / ${fmt(cur.p95_ms, 1)} мс` : '—'} foot={`p99 ${fmt(cur?.p99_ms, 1)} мс`} />
        <Kpi label="CPU / память процесса" value={cur ? `${fmt(cur.cpu_percent)}% · ${fmt(cur.rss_mb)} МБ` : '—'} foot={`аптайм ${fmt((cur?.uptime_s ?? 0) / 60)} мин`} />
        <Kpi label="Кэш прогнозов" value={cur ? `${fmt(cur.cache.hits)} / ${fmt(cur.cache.misses)}` : '—'} foot="попадания / промахи (LRU 4096)" />
      </div>

      <div className="grid g-side">
        <Card title="Метрики в реальном времени" hint="обновление раз в секунду">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={hist}>
              <CartesianGrid stroke={CH.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" {...axis} minTickGap={40} />
              <YAxis yAxisId="l" {...axis} />
              <YAxis yAxisId="r" orientation="right" {...axis} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="l" dataKey="rps" name="RPS" stroke={CH.accent} dot={false} isAnimationActive={false} />
              <Line yAxisId="r" dataKey="p95_ms" name="p95, мс" stroke="#f97316" dot={false} isAnimationActive={false} />
              <Line yAxisId="l" dataKey="cpu_percent" name="CPU, %" stroke={CH.fact} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Нагрузочный тест из браузера" hint="2000 запросов, 32 параллельно">
          <button className="btn primary" disabled={busy} onClick={() => loadTest()}>{busy ? 'Идёт тест…' : 'Запустить'}</button>
          {lt && (
            <table className="t" style={{ marginTop: 12 }}><tbody>
              <tr><td>Успешных</td><td className="num">{lt.ok} / {lt.n}</td></tr>
              <tr><td>Время</td><td className="num">{lt.secs.toFixed(1)} с</td></tr>
              <tr><td>Пропускная способность</td><td className="num"><b>{fmt(lt.rps)} RPS</b></td></tr>
              <tr><td>p50 / p95 / p99</td><td className="num">{lt.p50.toFixed(1)} / {lt.p95.toFixed(1)} / {lt.p99.toFixed(1)} мс</td></tr>
            </tbody></table>
          )}
          <div className="note" style={{ marginTop: 8 }}>Браузер ограничивает число соединений, поэтому это нижняя оценка. Серверный замер (wrk/hey) — в README.</div>
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Точки входа API" hint={<a href="/docs" target="_blank">Swagger UI →</a>}>
          <table className="t"><tbody>
            {ENDPOINTS.map(([m, p, d]) => (
              <tr key={p}><td><span className={`tag ${m === 'WS' ? 'run' : m === 'POST' ? 'bad' : 'ok'}`}>{m}</span></td><td className="mono">{p}</td><td className="note">{d}</td></tr>
            ))}
          </tbody></table>
        </Card>
        <Card title="Латентность по эндпоинтам" hint="последние 60 с">
          <table className="t">
            <thead><tr><th>Эндпоинт</th><th className="num">Запросов</th><th className="num">p95, мс</th></tr></thead>
            <tbody>
              {Object.entries(cur?.endpoints ?? {}).sort((a, b) => b[1].n - a[1].n).map(([p, v]) => (
                <tr key={p}><td className="mono">{p}</td><td className="num">{fmt(v.n)}</td><td className="num">{v.p95_ms.toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  )
}
