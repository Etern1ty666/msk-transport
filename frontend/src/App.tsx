import { ArrowLeft, BookOpenText, ChartNoAxesCombined, RefreshCw, Settings as Gear, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, DEFAULT_COEF, OFFLINE, TH, useSocket, type Coef, type LogEvent, type Meta, type RouteGeo, type Schema, type Segment, type Settings, type Stage } from './api'
import { AppCtx } from './components'
import OpsScreen from './ops/OpsScreen'
import AboutPage from './pages/AboutPage'
import SummaryPage from './pages/SummaryPage'
import SettingsPage from './pages/SettingsPage'

// меню — три раздела; прежние адреса (#overview, #model …) открывают раздел, куда вошла их страница
// side — открывается панелью слева поверх карты (как карточка ветки); иначе — страница на весь экран
const PAGES: Record<string, { title: string; sub: string; icon: typeof Gear; el: () => React.ReactElement; side?: boolean; wide?: boolean }> = {
  about: { title: 'О проекте', sub: 'Как пользоваться, как считается прогноз, данные и сервис', icon: BookOpenText, el: AboutPage },
  summary: { title: 'Сводка', sub: 'Показатели прогноза, где не хватает вагонов, таблица и выгрузка', icon: ChartNoAxesCombined, el: SummaryPage },
  settings: { title: 'Настройки', sub: 'Коэффициенты прогноза, норматив и пороги рекомендаций — сохраняются на сервере и действуют для всех', icon: Gear, el: SettingsPage, side: true },
}
const ALIAS: Record<string, string> = { overview: 'summary', forecast: 'summary', model: 'about', pipeline: 'about', service: 'about', use: 'about' }
const pageOf = (k: string) => ALIAS[k] ?? (k in PAGES ? k : null)

export default function App() {
  const hashKey = () => pageOf(window.location.hash.slice(1))
  const [drawer, setDrawer] = useState<string | null>(hashKey)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [geo, setGeo] = useState<RouteGeo[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [allRoutes, setAllRoutes] = useState<string[]>([])
  const [schema, setSchema] = useState<Schema | null>(null)
  const [coef, setCoef] = useState<Coef>(DEFAULT_COEF)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [settingsRev, setSettingsRev] = useState(0)
  const [stages, setStages] = useState<Stage[]>([])
  const [logs, setLogs] = useState<LogEvent[]>([])
  const [running, setRunning] = useState(false)
  const [version, setVersion] = useState(0)
  const [metaError, setMetaError] = useState<string | null>(null)

  // каждый раздел — отдельная страница со своим адресом (#overview …); «Назад» в браузере возвращает к карте
  const openDrawer = useCallback((k: string | null) => {
    if (k) { if (window.location.hash !== `#${k}`) window.location.hash = k }
    else if (window.location.hash) history.pushState(null, '', window.location.pathname)
    setDrawer(k && pageOf(k))
    window.scrollTo(0, 0)
  }, [])
  useEffect(() => {
    const h = () => setDrawer(hashKey())
    window.addEventListener('hashchange', h)
    window.addEventListener('popstate', h)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && hashKey()) openDrawer(null) }
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('hashchange', h); window.removeEventListener('popstate', h); window.removeEventListener('keydown', esc) }
  }, [openDrawer])

  const loadMeta = useCallback(() => {
    api<Meta>('/api/meta').then((m) => { setMeta(m); setMetaError(null) }).catch((e) => setMetaError(e.message))
    api<{ routes: RouteGeo[]; segments: Segment[]; all_routes?: string[]; schema?: Schema }>('/api/geo').then((g) => { setGeo(g.routes); setSegments(g.segments ?? []); setAllRoutes(g.all_routes ?? []); setSchema(g.schema ?? null) }).catch(() => undefined)
  }, [])
  useEffect(loadMeta, [loadMeta, version])

  // настройки сервиса: коэффициенты, норматив и пороги — с сервера, общие для всех
  const applySettings = useCallback((st: Settings) => {
    Object.assign(TH, { soft: st.soft, free: st.free, freeTarget: st.free_target })
    setSettings(st)
    setCoef(st.coef)
    setSettingsRev((v) => v + 1)
  }, [])
  useEffect(() => { api<Settings>('/api/settings').then(applySettings).catch(() => undefined) }, [applySettings, version, metaError])
  const saveSettings = useCallback(async (st: Settings) => {
    const { coef: c, norm_scale, soft, free, free_target } = st
    applySettings(await api<Settings>('/api/settings', undefined, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coef: c, norm_scale, soft, free, free_target }) }))
  }, [applySettings])
  const resetSettings = useCallback(async () => { applySettings(await api<Settings>('/api/settings/reset', undefined, { method: 'POST' })) }, [applySettings])
  useEffect(() => { if (metaError) { const t = setTimeout(loadMeta, 2000); return () => clearTimeout(t) } }, [metaError, loadMeta])

  const { connected } = useSocket<any>('/ws/pipeline', (ev) => {
    if (ev.kind === 'snapshot') { setStages(ev.stages); setRunning(ev.running); setLogs(ev.logs ?? []) }
    else if (ev.kind === 'stage') setStages((s) => s.map((x) => (x.key === ev.stage.key ? ev.stage : x)))
    else if (ev.kind === 'log') setLogs((l) => [...l.slice(-800), ev])
    else if (ev.kind === 'run') {
      if (ev.status === 'started') { setRunning(true); if (ev.snapshot) setStages(ev.snapshot.stages); setLogs([]) }
      else { setRunning(false); if (ev.status === 'done') setVersion((v) => v + 1) }
    }
  })

  // ветки без истории (сейчас — №5: в данных ни одной успешной валидации) не показываем в выборе и не открываем
  const geoActive = useMemo(() => (meta ? geo.filter((g) => meta.routes.find((r) => r.route === g.route)?.active !== false) : geo), [meta, geo])
  const ctx = useMemo(() => ({ meta, geo: geoActive, segments, allRoutes, schema, coef, settings, saveSettings, resetSettings, settingsRev,
    stages, logs, running, pipelineConnected: connected, version, go: openDrawer }),
  [meta, geoActive, segments, allRoutes, schema, coef, settings, saveSettings, resetSettings, settingsRev, stages, logs, running, connected, version, openDrawer])
  const d = drawer ? PAGES[drawer] : null
  const Page = d?.el

  return (
    <AppCtx.Provider value={ctx}>
      <OpsScreen drawer={drawer} openDrawer={openDrawer} sideWide={!!d?.wide}
        sidePage={d?.side && Page ? (
          <div className="ops-side sd side-page">
            <div className="sd-top">
              <div className="sd-bar">
                <button className="sd-close" onClick={() => openDrawer(null)} title="Закрыть (Esc)" aria-label="Закрыть"><X size={20} /></button>
                <span className="sd-id"><span className="sd-name"><span className="t">{d.title}</span></span></span>
              </div>
            </div>
            <div className="sd-body">
              <div className="note side-sub">{d.sub}</div>
              <Page key={drawer} />
            </div>
          </div>
        ) : null} />
      {metaError && !meta && d && !d.side && <div className="float glass" style={{ bottom: 70, left: '50%', transform: 'translateX(-50%)', padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center' }}><TriangleAlert size={16} /> {metaError === OFFLINE ? `${OFFLINE}. Повторяю подключение…` : metaError}</div>}
      {d && Page && !d.side && (
        <div className="page">
          <header className="page-bar">
            <button className="pb-back" onClick={() => openDrawer(null)} title="К карте (Esc)"><ArrowLeft size={16} /> Карта</button>
            {running && <span className="pb-run"><RefreshCw size={13} className="spin" /> пересборка модели</span>}
          </header>
          <main className="page-body">
            <div className="page-head"><h1>{d.title}</h1><div className="note">{d.sub}</div></div>
            <Page key={drawer} />
          </main>
        </div>
      )}
    </AppCtx.Provider>
  )
}
