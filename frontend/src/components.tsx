import { TriangleAlert } from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import type { Coef, Meta, RouteGeo, Schema, Segment, Settings, Stage, LogEvent } from './api'

export type Ctx = {
  meta: Meta | null
  geo: RouteGeo[]
  segments: Segment[]
  allRoutes: string[]
  schema: Schema | null
  coef: Coef // сохранённые на сервере коэффициенты (страница «Настройки»)
  settings: Settings | null
  saveSettings: (s: Settings) => Promise<void>
  resetSettings: () => Promise<void>
  settingsRev: number // растёт при каждом сохранении — экраны перезапрашивают прогноз
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

export const COEF_INFO: { key: keyof Coef; title: string; desc: string; min: number; max: number; step: number }[] = [
  { key: 'weather', title: 'Погода', desc: 'Сила эффекта осадков: 0 — игнорировать, 2 — вдвое сильнее', min: 0, max: 3, step: 0.1 },
  { key: 'event', title: 'События', desc: 'Внешние события: перекрытия дорог, ремонт путей, массовые мероприятия и скопления людей', min: 0, max: 2, step: 0.05 },
  { key: 'season', title: 'Сезон', desc: 'Сезонная поправка уровня (1.05 — +5%)', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'trend', title: 'Тренд маршрутов', desc: 'Сила недавнего тренда маршрутов: 0 — без тренда', min: 0, max: 3, step: 0.1 },
  { key: 'holiday', title: 'Праздники', desc: 'Сила эффекта праздников и предновогодних дней', min: 0, max: 2, step: 0.1 },
]

/** Какие корректировки действуют сейчас (сохранены на сервере, общие для всех) и переход в «Настройки». */
export function SettingsHint() {
  const { settings, go } = useApp()
  const changed = settings?.defaults && (COEF_INFO.some((c) => settings.coef[c.key] !== settings.defaults!.coef[c.key]) || settings.norm_scale !== settings.defaults.norm_scale)
  return (
    <Card title="Корректировки прогноза" hint={changed ? 'действуют для всех' : 'как в модели'}>
      <div className="shint">
        {COEF_INFO.map((c) => (
          <div key={c.key} className={settings && settings.coef[c.key] !== 1 ? 'on' : ''}><span>{c.title}</span><b>×{(settings?.coef[c.key] ?? 1).toFixed(2)}</b></div>
        ))}
        <div className={settings && settings.norm_scale !== 1 ? 'on' : ''}><span>Норматив на вагон</span><b>×{(settings?.norm_scale ?? 1).toFixed(2)}</b></div>
        <button className="btn" onClick={() => go('settings')}>Изменить в настройках</button>
      </div>
    </Card>
  )
}

export const routeColor = (meta: Meta | null, r: number | string) =>
  meta?.routes.find((x) => String(x.route) === String(r))?.color ?? '#888'

export const tooltipStyle = {
  contentStyle: { background: 'var(--solid-2)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12, boxShadow: '0 6px 18px rgb(0 0 0 / .3)' },
  labelStyle: { color: 'var(--text)' },
  itemStyle: { padding: 0, color: 'var(--text)' }, // иначе recharts красит значение в цвет столбика — на фоне не читается
}
export const axis = { stroke: 'var(--muted)', fontSize: 11, tickLine: false }
/** цвета графиков — из токенов темы (styles.css): факт — нейтральный, прогноз и выделенное — акцент */
export const CH = { grid: 'var(--chart-grid)', fact: 'var(--chart-fact)', bar: 'var(--chart-bar)', accent: 'var(--accent)', strong: 'var(--strong)',
  cursor: 'rgb(var(--ink-rgb) / .08)' }
