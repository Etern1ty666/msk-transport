import { ChevronRight, Database, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, fmt } from '../api'
import { Card, ErrorBox, Kpi, useApp } from '../components'

const STATUS: Record<string, [string, string]> = {
  pending: ['ожидает', ''], running: ['выполняется', 'run'], done: ['готово', 'ok'], error: ['ошибка', 'bad'],
}
const ARCH = [
  ['Источники', ['train.csv / test.csv (10 ГБ)', 'labels/*.csv', 'Справочники GTFS', 'Open-Meteo', 'Календарь РФ', 'OpenStreetMap']],
  ['Приём и нормализация', ['DuckDB → Parquet', 'Полная сетка + нули', 'Сверка с labels']],
  ['Признаки и геопривязка', ['Профили × тип дня × час', 'Выпуск вагонов', 'Остановки и веса']],
  ['ML-прогноз', ['Профильная модель', 'Тренд · календарь · погода', 'Бэктест WAPE']],
  ['API (FastAPI)', ['REST /api/*', 'WS /ws/pipeline · live · system', 'CSV / XLSX']],
  ['Frontend (React)', ['Карта MapLibre', 'Дашборд и коэффициенты', 'Под капотом']],
] as const

export default function PipelinePage() {
  const { stages, logs, running, pipelineConnected, meta } = useApp()
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)

  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight }, [logs, follow])

  const run = (force_raw: boolean) =>
    api('/api/pipeline/run', { force_raw }, { method: 'POST' }).then(() => setErr(null)).catch((e) => setErr(e.message))

  const total = stages.reduce((s, x) => s + (x.duration ?? 0), 0)
  const st = meta?.stats ?? {}
  const shown = filter ? logs.filter((l) => l.stage === filter) : logs

  return (
    <>
      <Card title={<>Конвейер обработки <span className={`dot ${running ? 'run' : pipelineConnected ? 'ok' : 'bad'}`} /></>}
        hint={<div className="row">
          <span>{running ? 'выполняется…' : total ? `последний прогон: ${total.toFixed(2)} с` : ''}</span>
          <button className="btn" disabled={running} onClick={() => run(false)}><RotateCw size={14} /> Перезапустить</button>
          <button className="btn primary" disabled={running} onClick={() => run(true)} title="DuckDB заново читает train.csv + test.csv (~10 ГБ), ~20–60 с"><Database size={14} /> Пересчитать из сырых (10 ГБ)</button>
        </div>}>
        <ErrorBox error={err} />
        <div className="flow">
          {stages.map((s, i) => (
            <div key={s.key} className={`stage ${s.status}${filter === s.key ? ' sel' : ''}`} onClick={() => setFilter(filter === s.key ? '' : s.key)} style={{ cursor: 'pointer' }}>
              <div className="row"><span className="n">{String(i + 1).padStart(2, '0')}</span><div className="spacer" />
                <span className={`tag ${STATUS[s.status][1]}`}>{STATUS[s.status][0]}{s.duration != null ? ` · ${s.duration} с` : ''}</span></div>
              <div className="t">{s.title}</div>
              <div className="d">{s.status === 'running' && s.message ? s.message : s.desc}</div>
              <div className="bar"><i style={{ width: `${(s.status === 'done' ? 1 : s.progress) * 100}%` }} /></div>
              {Object.keys(s.metrics).length > 0 && (
                <div className="metrics">
                  {Object.entries(s.metrics).map(([k, v]) => <span key={k}>{k}: <b>{typeof v === 'number' ? fmt(v, Number.isInteger(v) ? 0 : Math.abs(v) < 1 ? 4 : 3) : v}</b></span>)}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="note" style={{ marginTop: 8 }}>Клик по стадии — фильтр логов. События приходят по WebSocket <span className="mono">/ws/pipeline</span>.</div>
      </Card>

      <div className="grid g-side">
        <Card title="Журнал обработки" hint={<div className="row">
          {filter && <button className="btn" onClick={() => setFilter('')}>фильтр: {filter} <X size={13} /></button>}
          <label className="row"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> автопрокрутка</label>
        </div>}>
          <div className="console" ref={box}>
            {shown.length === 0 && <span className="ts">Ожидание событий…</span>}
            {shown.map((l, i) => (
              <div key={i} className={l.level}>
                <span className="ts">{new Date(l.ts * 1000).toLocaleTimeString('ru-RU')}.{String(Math.floor((l.ts % 1) * 1000)).padStart(3, '0')} </span>
                <span className="st">[{l.stage}]</span> {l.message}
              </div>
            ))}
          </div>
        </Card>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Kpi label="Сырые данные" value={`${st.raw_size_gb ?? '—'} ГБ`} foot="train.csv + test.csv, январь–октябрь 2025" />
          <Kpi label="Валидаций всего" value={fmt(st.validations as number)} foot={`успешных посадок ${fmt(st.boardings as number)}`} />
          <Kpi label="Доля отказов" value={st.failure_rate != null ? `${((st.failure_rate as number) * 100).toFixed(2)}%` : '—'} foot="validation_result ≠ 1 — не считаются посадкой" />
          <Kpi label="Тарифы" value={st.pass_share != null ? `${Math.round((st.pass_share as number) * 100)}% проездные` : '—'}
            foot={st.wallet_share != null ? `кошелёк ${Math.round((st.wallet_share as number) * 100)}% · СКМ ${Math.round((st.social_share as number) * 100)}%` : ''} />
        </div>
      </div>

      <Card title="Архитектура решения" hint="модули и поток данных">
        <div className="arch" style={{ ['--n' as string]: ARCH.length }}>
          {ARCH.map(([t, items], i) => (
            <div key={t} style={{ position: 'relative' }}>
              <div className="stage" style={{ height: '100%' }}>
                <div className="n">{i + 1}</div>
                <div className="t">{t}</div>
                {items.map((x) => <div key={x} className="note">• {x}</div>)}
              </div>
              {i < ARCH.length - 1 && <div className="arch-arrow"><ChevronRight size={18} /></div>}
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}
