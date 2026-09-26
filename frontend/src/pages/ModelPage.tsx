import { Fragment, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, useApi } from '../api'
import { axis, Card, ErrorBox, Kpi, routeColor, tooltipStyle, useApp } from '../components'

type Model = {
  params: Record<string, number | boolean>
  formula: string
  profile_weekday: { routes: number[]; matrix: number[][] }
  holiday: { first: number; other: number }
  weather_effect: { bin: string; range: string; mult: number }[]
  trend: Record<string, number>
  season_index: { months: string[]; routes: string[]; matrix: number[][] }
  backtest: {
    folds: Record<string, string | number>[]; mean: Record<string, number>
    series: { date: string; actual: number; pred: number }[]; per_route: Record<string, number>; ceiling_note: string
  }
  bpv_target: Record<string, number>
  ml_compare: MlCompare | null
}
type MlCompare = {
  models: Record<string, string>
  folds: ({ set: string; title: string; train_rows: number } & Record<string, number | string>)[]
  mean: Record<string, Record<string, number>>
  winner: string
}
const VARIANTS = ['Полная модель', 'Без погоды', 'Без календаря', 'Без тренда']

export default function ModelPage() {
  const { meta, version } = useApp()
  const m = useApi<Model>('/api/model', { v: version })
  const [hr, setHr] = useState<number | ''>('')
  const hourly = useApi<{ hour: number; actual: number; pred: number }[]>('/api/backtest/hourly', { route: hr || undefined, v: version })
  const d = m.data
  if (!d) return <ErrorBox error={m.error} />
  const bt = d.backtest
  const perRoute = Object.entries(bt.per_route).map(([r, v]) => ({ r: `№${r}`, route: r, v }))
  const maxP = Math.max(...d.profile_weekday.matrix.flat())

  return (
    <>
      <div className="grid g4">
        <Kpi accent label={`WAPE-score, бэктест (среднее по ${bt.folds.length} окнам)`} value={bt.mean['Полная модель']?.toFixed(4)} foot="1 − Σ|y−ŷ| / Σy, больше — лучше" />
        <Kpi label="Baseline организаторов" value="0.48" foot={`прирост +${((bt.mean['Полная модель'] - 0.48) * 100).toFixed(1)} п.п.`} />
        <Kpi label="Потолок постановки" value="≈ 0.93" foot="профиль, подобранный на самом октябре (оракул)" />
        <Kpi label="Лучшее окно" value={Math.max(...bt.folds.map((f) => Number(f['Полная модель']))).toFixed(4)} foot="прогноз на 1 месяц вперёд" />
      </div>

      <Card title="Формула модели">
        <div className="mono" style={{ fontSize: 15, color: 'var(--accent)' }}>{d.formula}</div>
        <div className="note" style={{ marginTop: 8 }}>
          Профиль — усечённое среднее (trim {String(d.params.trim)}) за {String(d.params.lookback_days)} дней до точки прогноза по классам дня: пн / вт–чт / пт / сб / вс+праздники.
          Тренд — отношение последних {String(d.params.trend_days)} дней к окну в степени {String(d.params.trend_alpha)} (затухание).
          Праздники — множители к воскресному профилю, оценённые на майских и июньских праздниках 2025.
          Погода — лог-эффект осадков за день (06–21 ч), оценённый по остаткам к скользящей медиане.
        </div>
      </Card>

      <div className="grid g2">
        <Card title="Бэктест: факт и прогноз по дням" hint="окно «октябрь», прогноз с 30.09">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={bt.series}>
              <CartesianGrid stroke="#22314f" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" {...axis} tickFormatter={(t) => t.slice(5)} />
              <YAxis {...axis} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="actual" name="Факт" fill="#818cf8" radius={[3, 3, 0, 0]} />
              <Line dataKey="pred" name="Прогноз" stroke="#22d3ee" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Бэктест: суточный профиль" hint={<select value={hr} onChange={(e) => setHr(e.target.value ? Number(e.target.value) : '')}>
          <option value="">все маршруты</option>{meta?.routes.filter((r) => r.active).map((r) => <option key={r.route} value={r.route}>№{r.route}</option>)}</select>}>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={hourly.data ?? []}>
              <CartesianGrid stroke="#22314f" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="hour" {...axis} />
              <YAxis {...axis} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip {...tooltipStyle} formatter={(v) => fmt(Number(v))} labelFormatter={(h) => `${h}:00`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="actual" name="Факт" fill="#818cf8" radius={[3, 3, 0, 0]} />
              <Line dataKey="pred" name="Прогноз" stroke="#22d3ee" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Вклад внешних источников (абляция)" hint="WAPE-score без источника → разница">
          <table className="t">
            <thead><tr><th>Окно бэктеста</th>{VARIANTS.map((v) => <th key={v} className="num">{v}</th>)}</tr></thead>
            <tbody>
              {bt.folds.map((f) => (
                <tr key={String(f.origin)}><td>{f.title}</td>{VARIANTS.map((v) => <td key={v} className="num">{Number(f[v]).toFixed(4)}</td>)}</tr>
              ))}
              <tr className="best"><td>Среднее</td>{VARIANTS.map((v) => <td key={v} className="num">{bt.mean[v].toFixed(4)}</td>)}</tr>
              <tr><td className="note">Δ к полной модели</td>{VARIANTS.map((v) => {
                const x = bt.mean['Полная модель'] - bt.mean[v]
                return <td key={v} className="num" style={{ color: v === 'Полная модель' ? undefined : x > 0 ? 'var(--ok)' : 'var(--bad)' }}>{v === 'Полная модель' ? '' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)} п.п.`}</td>
              })}</tr>
            </tbody>
          </table>
          <div className="note" style={{ marginTop: 8 }}>Зелёный — источник улучшает прогноз. {bt.ceiling_note}.</div>
        </Card>
        <Card title="WAPE-score по маршрутам" hint="окно «октябрь»">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={perRoute}>
              <CartesianGrid stroke="#22314f" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="r" {...axis} />
              <YAxis {...axis} domain={[0.6, 1]} />
              <Tooltip {...tooltipStyle} formatter={(v) => Number(v).toFixed(4)} cursor={{ fill: '#ffffff08' }} />
              <ReferenceLine y={0.88} stroke="#22c55e" strokeDasharray="4 4" label={{ value: '0.88 — макс. балл', fill: '#22c55e', fontSize: 11, position: 'insideTopRight' }} />
              <Bar dataKey="v" radius={[3, 3, 0, 0]}>{perRoute.map((p) => <Cell key={p.route} fill={routeColor(meta, p.route)} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {d.ml_compare && <MlCompareCard r={d.ml_compare} />}

      <Card title="Профиль будней (вт–чт): посадки в час" hint="маршрут × час · основа прогноза">
        <div className="heat" style={{ gridTemplateColumns: `44px repeat(24, 1fr)` }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="lbl" style={{ justifyContent: 'center' }}>{h}</div>)}
          {d.profile_weekday.routes.map((r, i) => (
            <Fragment key={r}>
              <div className="lbl" style={{ color: routeColor(meta, r) }}>№{r}</div>
              {d.profile_weekday.matrix[i].map((v, h) => (
                <div key={`${r}-${h}`} className="c" title={`№${r}, ${h}:00 — ${fmt(v)} посадок`}
                  style={{ background: `rgba(34,211,238,${(v / maxP) ** 0.7})` }} />
              ))}
            </Fragment>
          ))}
        </div>
      </Card>

      <div className="grid g3">
        <Card title="Погода → множитель" hint="Open-Meteo, осадки 06–21 ч">
          <table className="t"><tbody>
            {d.weather_effect.map((w) => <tr key={w.bin}><td>{w.bin}</td><td className="note">{w.range}</td>
              <td className="num" style={{ color: w.mult >= 1 ? 'var(--ok)' : 'var(--bad)' }}>×{w.mult.toFixed(3)}</td></tr>)}
          </tbody></table>
        </Card>
        <Card title="Календарь → множитель" hint="к воскресному профилю">
          <table className="t"><tbody>
            <tr><td>Праздник после рабочего дня</td><td className="num">×{d.holiday.first.toFixed(3)}</td></tr>
            <tr><td>Прочие праздничные дни</td><td className="num">×{d.holiday.other.toFixed(3)}</td></tr>
            <tr><td>Рабочая суббота 01.11</td><td className="num">×0.850 к пятнице</td></tr>
            <tr><td>29–30.12 (предновогодние)</td><td className="num">×0.860 к пятнице</td></tr>
            <tr><td>31.12, вечер после 19:00</td><td className="num">×0.468 к субботе</td></tr>
          </tbody></table>
        </Card>
        <Card title="Тренд маршрутов" hint="последние 2 недели к окну">
          <div className="chips">
            {Object.entries(d.trend).map(([r, v]) => <span key={r} className="tag" style={{ color: v > 1 ? 'var(--ok)' : v < 1 ? 'var(--warn)' : undefined }}>№{r}: ×{v.toFixed(3)}</span>)}
          </div>
        </Card>
      </div>

      <div className="grid g2">
        <Card title="Сезонный индекс (горизонт «год»)" hint="месяц к октябрю, будни; 50% маршрут + 50% сеть">
          <div className="scroll"><table className="t">
            <thead><tr><th>Месяц</th>{d.season_index.routes.map((r) => <th key={r} className="num">№{r}</th>)}</tr></thead>
            <tbody>{d.season_index.months.map((mo, i) => (
              <tr key={mo}><td className="mono">{mo}</td>{d.season_index.matrix[i].map((v, j) =>
                <td key={j} className="num" style={{ color: v < 0.95 ? 'var(--warn)' : v > 1.02 ? 'var(--ok)' : undefined }}>{v.toFixed(2)}</td>)}</tr>
            ))}</tbody>
          </table></div>
        </Card>
        <Card title="Область применимости и ограничения">
          <div className="note" style={{ fontSize: 13, color: 'var(--text)', display: 'grid', gap: 8 }}>
            <div><b>Область определения.</b> 9 активных маршрутов (1, 7, 11, 12, 17, 25, 26, 28, 50) на уровне маршрут × час; маршрут 5 в истории без посадок → прогноз 0. Точность подтверждена на горизонте 1–2 месяца (WAPE-score 0.85–0.90).</div>
            <div><b>Горизонты.</b> День и месяц — количественный прогноз. Год — сценарный: профиль × сезонный индекс 2025, без погоды (на 2026 нет данных), для стратегического планирования.</div>
            <div><b>Зависимости.</b> Календарь (праздники, переносы, каникулы), погода (осадки), выпуск вагонов. Нарушение режима (ремонт путей, закрытие участка, как у №7 в июле) модель не предсказывает — задаётся коэффициентом «Событие».</div>
            <div><b>Адаптация.</b> Для нового маршрута нужно ≥ 4 недель валидаций (строится профиль); без истории — перенос профиля похожего маршрута × отношение выпуска вагонов. Для нового периода — обновить календарь и погоду, пересобрать конвейер (≈1 с).</div>
            <div><b>Остановки.</b> В валидациях нет остановки → разбивка по остановкам — оценочная (веса по пересадочным узлам и конечным).</div>
          </div>
        </Card>
      </div>
    </>
  )
}

function MlCompareCard({ r }: { r: MlCompare }) {
  const keys = Object.keys(r.models)
  const sets = Object.keys(r.mean)
  return (
    <Card title="Сравнение с ML-моделями" hint="тот же бэктест: ML обучается только на прошлом до точки прогноза">
      <table className="t">
        <thead><tr><th>Модель</th>{sets.map((s) => <th key={s} className="num">{s === '5 окон' ? '5 окон бэктеста' : 'скользящие окна, 56 дн'}</th>)}<th className="num">Δ к профилю</th></tr></thead>
        <tbody>
          {keys.map((k) => {
            const dx = sets.reduce((a, s) => a + r.mean[s][k] - r.mean[s].profile, 0) / sets.length
            return (
              <tr key={k} className={k === r.winner ? 'best' : undefined}>
                <td>{r.models[k]}</td>
                {sets.map((s) => <td key={s} className="num">{r.mean[s][k].toFixed(4)}</td>)}
                <td className="num" style={{ color: k === 'profile' ? undefined : dx >= 0 ? 'var(--ok)' : 'var(--bad)' }}>
                  {k === 'profile' ? '' : `${dx >= 0 ? '+' : ''}${(dx * 100).toFixed(2)} п.п.`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="note" style={{ marginTop: 8 }}>
        {r.winner === 'profile'
          ? 'Профильная модель точнее ML-моделей на обоих наборах окон. ML выучивает сезонные сдвиги прошлых окон (весенний спад, летний провал), которые на новом горизонте не повторяются: в 10 месяцах истории нет ни одного ноября–декабря. ML-контур оставлен как проверяемая альтернатива: python -m app.ml.ml_compare.'
          : `Лучшая модель на бэктесте: ${r.models[r.winner]}.`}
        {' '}Окон: {r.folds.length}.
      </div>
    </Card>
  )
}
