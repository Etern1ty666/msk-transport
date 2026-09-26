import { ArrowLeft, BrainCircuit, LayoutDashboard, RefreshCw, Server, Table2, TriangleAlert, Workflow } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, DEFAULT_COEF, useSocket, type Coef, type LogEvent, type Meta, type RouteGeo, type Schema, type Segment, type Stage } from './api'
import { AppCtx } from './components'
import OpsScreen from './ops/OpsScreen'
import Overview from './pages/Overview'
import ForecastPage from './pages/ForecastPage'
import PipelinePage from './pages/PipelinePage'
import ModelPage from './pages/ModelPage'
import ServicePage from './pages/ServicePage'

const PAGES: Record<string, { title: string; sub: string; icon: typeof LayoutDashboard; el: () => React.ReactElement }> = {
  overview: { title: 'Сводка', sub: 'Ключевые показатели прогноза на ноябрь–декабрь 2025', icon: LayoutDashboard, el: Overview },
  forecast: { title: 'Прогноз и выгрузка', sub: 'День, месяц, год · маршрут, остановка, интервал · CSV и XLSX', icon: Table2, el: ForecastPage },
  pipeline: { title: 'Под капотом', sub: 'Конвейер обработки данных в реальном времени', icon: Workflow, el: PipelinePage },
  model: { title: 'Модель', sub: 'Компоненты модели, бэктест WAPE, вклад внешних источников', icon: BrainCircuit, el: ModelPage },
  service: { title: 'Сервис и API', sub: 'Производительность, метрики, точки входа API', icon: Server, el: ServicePage },
}

export default function App() {
  const hashKey = () => { const h = window.location.hash.slice(1); return h in PAGES ? h : null }
  const [drawer, setDrawer] = useState<string | null>(hashKey)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [geo, setGeo] = useState<RouteGeo[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [allRoutes, setAllRoutes] = useState<string[]>([])
  const [schema, setSchema] = useState<Schema | null>(null)
  const [coef, setCoef] = useState<Coef>(DEFAULT_COEF)
  const [stages, setStages] = useState<Stage[]>([])
  const [logs, setLogs] = useState<LogEvent[]>([])
  const [running, setRunning] = useState(false)
  const [version, setVersion] = useState(0)
  const [metaError, setMetaError] = useState<string | null>(null)

  // каждый раздел — отдельная страница со своим адресом (#overview …); «Назад» в браузере возвращает к карте
  const openDrawer = useCallback((k: string | null) => {
    if (k) { if (window.location.hash !== `#${k}`) window.location.hash = k }
    else if (window.location.hash) history.pushState(null, '', window.location.pathname)
    setDrawer(k)
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

  const ctx = useMemo(() => ({ meta, geo, segments, allRoutes, schema, coef, setCoef, stages, logs, running, pipelineConnected: connected, version, go: openDrawer }),
    [meta, geo, segments, allRoutes, schema, coef, stages, logs, running, connected, version, openDrawer])
  const d = drawer ? PAGES[drawer] : null
  const Page = d?.el

  return (
    <AppCtx.Provider value={ctx}>
      <OpsScreen drawer={drawer} openDrawer={openDrawer} />
      {metaError && !meta && <div className="float glass" style={{ bottom: 70, left: '50%', transform: 'translateX(-50%)', padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center' }}><TriangleAlert size={16} /> {metaError}. Повторяю подключение…</div>}
      {d && Page && (
        <div className="page">
          <header className="page-bar">
            <button className="pb-back" onClick={() => openDrawer(null)} title="К карте (Esc)"><ArrowLeft size={16} /> Карта</button>
            <nav className="pb-tabs">
              {Object.entries(PAGES).map(([k, v]) => (
                <button key={k} className={k === drawer ? 'on' : ''} onClick={() => openDrawer(k)}><v.icon size={15} strokeWidth={1.75} /><span>{v.title}</span></button>
              ))}
            </nav>
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
