import { TriangleAlert } from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import type { Coef, Meta, RouteGeo, Schema, Segment, Stage, LogEvent } from './api'
import { DEFAULT_COEF } from './api'

export type Ctx = {
  meta: Meta | null
  geo: RouteGeo[]
  segments: Segment[]
  allRoutes: string[]
  schema: Schema | null
  coef: Coef
  setCoef: (c: Coef) => void
  stages: Stage[]
  logs: LogEvent[]
  running: boolean
  pipelineConnected: boolean
  version: number
  go: (page: string) => void
}
export const AppCtx = createContext<Ctx>(null as unknown as Ctx)
export const useApp = () => useContext(AppCtx)

export function Kpi({ label, value, foot, accent }: { label: string; value: ReactNode; foot?: ReactNode; accent?: boolean }) {
  return (
    <div className={`kpi ${accent ? 'accent' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  )
}

export function Card({ title, hint, children, style }: { title?: ReactNode; hint?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={style}>
      {title && <h3>{title}{hint && <span className="hint">{hint}</span>}</h3>}
      {children}
    </div>
  )
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="err"><TriangleAlert size={15} /> {error}</div> : null
}

export function RouteChips({ value, onChange, multi = true }: { value: number[]; onChange: (v: number[]) => void; multi?: boolean }) {
  const { meta } = useApp()
  if (!meta) return null
  const toggle = (r: number) => {
    if (!multi) return onChange(value[0] === r ? [] : [r])
    onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r].sort((a, b) => a - b))
  }
  return (
    <div className="chips">
      <button className={`chip ${value.length === 0 ? 'on' : ''}`} onClick={() => onChange([])}>Все маршруты</button>
      {meta.routes.map((r) => (
        <button key={r.route} className={`chip ${value.includes(r.route) ? 'on' : ''}`} style={{ color: value.includes(r.route) ? r.color : undefined }}
          onClick={() => toggle(r.route)} title={r.name + (r.active ? '' : ' — нет посадок в истории')}>
          <span className="sw" style={{ background: r.color, opacity: r.active ? 1 : 0.35 }} />
          <span style={{ color: 'var(--text)' }}>№{r.route}</span>
        </button>
      ))}
    </div>
  )
}

const COEF_INFO: { key: keyof Coef; title: string; desc: string; min: number; max: number; step: number }[] = [
  { key: 'weather', title: 'Погода', desc: 'Сила эффекта осадков: 0 — игнорировать, 2 — вдвое сильнее', min: 0, max: 3, step: 0.1 },
  { key: 'event', title: 'Событие / перекрытие', desc: 'Множитель на весь выбранный интервал (напр. 0.7 — перекрытие участка)', min: 0, max: 2, step: 0.05 },
  { key: 'season', title: 'Сезон', desc: 'Сезонная поправка горизонта (1.05 — +5% к уровню)', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'trend', title: 'Тренд маршрутов', desc: 'Сила недавнего тренда маршрутов', min: 0, max: 3, step: 0.1 },
  { key: 'holiday', title: 'Праздники', desc: 'Сила эффекта праздников и предновогодних дней', min: 0, max: 2, step: 0.1 },
]

export function CoefPanel() {
  const { coef, setCoef } = useApp()
  const changed = COEF_INFO.some((c) => coef[c.key] !== DEFAULT_COEF[c.key])
  return (
    <Card title="Корректирующие коэффициенты" hint={changed ? <button className="btn" onClick={() => setCoef(DEFAULT_COEF)}>Сбросить</button> : 'применяются ко всем экранам'}>
      <div className="coef">
        {COEF_INFO.map((c) => (
          <div key={c.key} className={`k ${coef[c.key] !== DEFAULT_COEF[c.key] ? 'changed' : ''}`} title={c.desc}>
            <div className="name"><span>{c.title}</span><b>×{coef[c.key].toFixed(2)}</b></div>
            <input type="range" min={c.min} max={c.max} step={c.step} value={coef[c.key]}
              onChange={(e) => setCoef({ ...coef, [c.key]: Number(e.target.value) })} />
            <input type="number" min={c.min} max={c.max} step={c.step} value={coef[c.key]}
              onChange={(e) => setCoef({ ...coef, [c.key]: Math.min(c.max, Math.max(c.min, Number(e.target.value))) })} />
          </div>
        ))}
        <div className="note">Прогноз пересчитывается на сервере сразу при изменении (≈10 мс).</div>
      </div>
    </Card>
  )
}

export const routeColor = (meta: Meta | null, r: number | string) =>
  meta?.routes.find((x) => String(x.route) === String(r))?.color ?? '#888'

export const tooltipStyle = {
  contentStyle: { background: '#111a2e', border: '1px solid #22314f', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#e2e8f0' },
  itemStyle: { padding: 0 },
}
export const axis = { stroke: '#8b9ab5', fontSize: 11, tickLine: false }
