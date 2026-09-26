import { BrainCircuit, ChevronDown, CircleHelp, Gauge, LayoutDashboard, Menu, Moon, Scale, Server, ShieldCheck, Table2, TrendingUp, TriangleAlert, Workflow, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_COEF, fmt, LEVEL_COLORS, levelOf, overLabel, useApi, type DayRoute, type DayView } from '../api'
import { CoefPanel, useApp } from '../components'
import OpsMap, { type MapMode } from './OpsMap'
import Intro from './Intro'
import RouteBar from './RouteBar'
import RoutePanel from './RoutePanel'
import { TramSide } from './Fleet'
import Timeline from './Timeline'

export const MENU = [
  { key: 'overview', i: LayoutDashboard, t: 'Сводка' },
  { key: 'forecast', i: Table2, t: 'Прогноз и выгрузка' },
  { key: 'pipeline', i: Workflow, t: 'Под капотом' },
  { key: 'model', i: BrainCircuit, t: 'Модель' },
  { key: 'service', i: Server, t: 'Сервис и API' },
]

export default function OpsScreen({ drawer, openDrawer }: { drawer: string | null; openDrawer: (k: string | null) => void }) {
  const { meta, geo, segments, allRoutes, schema, coef, setCoef, version } = useApp()
  // старт в режиме Live: сегодня и текущее время (если сегодня вне периода прогноза — Live сам выключится и вернёт демо-день)
  const [date, setDate] = useState(() => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` })
  const [minute, setMinute] = useState(() => { const t = new Date(); return t.getHours() * 60 + t.getMinutes() })
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [route, setRoute] = useState<number | null>(null)
  const [stop, setStop] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [menuAt, setMenuAt] = useState({ top: 72, left: 16 })
  // меню открывается прямо под нажатой кнопкой (в шкале времени или в углу на телефоне)
  const anchor = useRef<HTMLElement | null>(null)
  const openMenu = (e: React.MouseEvent<HTMLElement>) => { anchor.current = e.currentTarget; setMenu(true) }
  const menuBtn = (cls: string) => (
    <button className={cls} onClick={openMenu} title="Меню"><Menu size={cls.includes('tl-menu') ? 17 : 22} /></button>
  )
  const [showCoef, setShowCoef] = useState(false)
  const [live, setLive] = useState(true) // по умолчанию — реальное время
  const introRef = useRef(false)
  const [intro, setIntroState] = useState(() => { try { return !localStorage.getItem('tf-intro-seen') } catch { return true } })
  introRef.current = intro
  const setIntro = (v: boolean) => { setIntroState(v); if (!v) try { localStorage.setItem('tf-intro-seen', '1') } catch { /* без хранилища */ } }
  // пока меню или коэффициенты открыты — держим их под кнопкой, даже если шкала сдвигается
  useEffect(() => {
    if (!menu && !showCoef) return
    let raf = 0
    const tick = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (r && r.width) setMenuAt((p) => (p.top === Math.round(r.bottom + 8) && p.left === Math.round(r.left) ? p : { top: Math.round(r.bottom + 8), left: Math.round(r.left) }))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [menu, showCoef])
  const [probOpen, setProbOpen] = useState(false)
  // по умолчанию — схема маршрутов; сохранённый старый режим «схема по карте» тоже открывает схему
  const [mode, setModeState] = useState<MapMode>(() => { try { return localStorage.getItem('tf-map-mode') === 'map' ? 'map' : 'metro' } catch { return 'metro' } })
  const setMode = (m: MapMode) => { setModeState(m); try { localStorage.setItem('tf-map-mode', m) } catch { /* без хранилища — просто не запоминаем */ } }
  const stopRef = useRef<string | null>(null)
  stopRef.current = stop
  const showCoefRef = useRef(false)
  showCoefRef.current = showCoef
  const day = useApi<DayView>('/api/day', { date, ...coef, v: version })
  const hour = Math.floor(minute / 60)
  const timeRef = useRef(minute)
  timeRef.current = minute
  const min = meta?.forecast.from ?? '2025-11-01'
  const max = meta?.forecast.to ?? '2026-10-31'


  // горячие клавиши оператора
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (drawer || tag === 'INPUT' || tag === 'SELECT') return
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
      else if (e.key === 'Escape') { if (menu) setMenu(false); else if (showCoefRef.current) setShowCoef(false); else if (introRef.current) setIntro(false); else if (stopRef.current) setStop(null); else setRoute(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer, menu])

  const routes = useMemo(() => day.data?.routes ?? [], [day.data])
  const problems = useMemo(() => routes.filter((r) => r.vehicles[hour] > 0 && r.ratio[hour] >= 1).sort((a, b) => b.ratio[hour] - a.ratio[hour]), [routes, hour])
  const sel = routes.find((r) => r.route === route)
  // порядок перелистывания веток в карточке — как на панели маршрутов внизу
  const routeList = useMemo(() => geo.map((g) => routes.find((r) => r.route === g.route)).filter((r): r is DayRoute => r != null), [geo, routes])
  const select = (r: number | null, s?: string | null) => { setRoute(r); setStop(s ?? null); if (r != null) setIntro(false) }

  // бейджи проблемных веток в выбранный час — под шкалой времени
  const coefChanged = (Object.keys(DEFAULT_COEF) as (keyof typeof DEFAULT_COEF)[]).some((k) => coef[k] !== DEFAULT_COEF[k])
  const crit = problems.filter((r) => r.ratio[hour] >= 1.2).length

  // состояние сети «сейчас»: даже ночью и без проблем оператор видит, что прогноз посчитан и всё под контролем
  const [calc, setCalc] = useState(true)
  useEffect(() => {
    if (!day.data) return
    setCalc(true)
    const t = setTimeout(() => setCalc(false), 1600) // столько же идёт «волна пересчёта» по схеме
    return () => clearTimeout(t)
  }, [day.data])
  const calm = useMemo(() => {
    if (!routes.length) return null
    const running = routes.filter((r) => r.vehicles[hour] > 0)
    // ближайший час впереди, когда какая-то ветка выйдет за норматив
    let next: { h: number; route: number } | null = null
    for (let h = hour + 1; h < 24 && !next; h++) {
      const r = routes.filter((x) => x.vehicles[h] > 0 && x.ratio[h] >= 1).sort((a, b) => b.ratio[h] - a.ratio[h])[0]
      if (r) next = { h, route: r.route }
    }
    let firstOut: number | null = null
    if (!running.length) for (let h = hour + 1; h < 24 && firstOut == null; h++) if (routes.some((r) => r.vehicles[h] > 0)) firstOut = h
    return {
      night: !running.length, firstOut, next,
      vehicles: Math.round(running.reduce((a, r) => a + r.vehicles[hour], 0)),
      load: Math.round(Math.max(0, ...running.map((r) => r.ratio[hour])) * 100),
    }
  }, [routes, hour])
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
  const routeColor = (n: number) => routes.find((x) => x.route === n)?.color ?? '#64748b'
  const okChip = problems.length === 0 && calm && (
    calc || day.loading
      ? <div className="okchip calc" title="Пересчёт прогноза по сети…"><i /></div>
      : calm.night
        ? <div className="okchip night" title={`Ночной перерыв: трамваи не выходят на линию${calm.firstOut != null ? `, выпуск с ${hh(calm.firstOut)}` : ''}${calm.next ? `; внимание в ${hh(calm.next.h)} (№${calm.next.route})` : '; перегрузок не ожидается'}`}>
            <Moon size={14} />{calm.firstOut != null && <><TramSide size={14} /><b>{hh(calm.firstOut)}</b></>}
            {calm.next && <><TriangleAlert size={13} className="warn" /><span>{hh(calm.next.h)}</span><i className="rn" style={{ background: routeColor(calm.next.route) }}>{calm.next.route}</i></>}
          </div>
        : <div className="okchip" title={`Все ветки в норме: ${calm.vehicles} ваг. на линии, максимум ${calm.load}% норматива${calm.next ? `; рост к ${hh(calm.next.h)} (№${calm.next.route})` : '; до конца суток без перегрузок'}`}>
            <ShieldCheck size={14} /><TramSide size={14} /><b>{calm.vehicles}</b><Gauge size={13} /><span>{calm.load}%</span>
            {calm.next && <><TrendingUp size={13} className="warn" /><span>{hh(calm.next.h)}</span><i className="rn" style={{ background: routeColor(calm.next.route) }}>{calm.next.route}</i></>}
          </div>
  )
  const badges = (problems.length > 0 || coefChanged || okChip) && (
    <div className={`probwrap ${probOpen ? 'open' : ''}`}>
    {okChip}
    {/* на телефоне — одна плашка-сводка, по нажатию раскрывает все бейджи */}
    {problems.length > 0 && (
      <button className={`probsum ${crit ? 'crit' : ''}`} onClick={() => setProbOpen(!probOpen)} title={`Веток выше норматива: ${problems.length}`}>
        <TriangleAlert size={14} /><b>{problems.length}</b>
        <ChevronDown size={14} className="caret" />
      </button>
    )}
    <div className="probbadges">
      {coefChanged && (
        <span className="coefchip" title="Прогноз скорректирован коэффициентами">
          <button onClick={() => setShowCoef(true)} title="Прогноз скорректирован коэффициентами — открыть"><Scale size={14} /></button>
          <button onClick={() => setCoef(DEFAULT_COEF)} title="Сбросить"><X size={13} /></button>
        </span>
      )}
      {problems.map((r) => {
        const lvl = levelOf(r.ratio[hour])
        return (
          <button key={r.route} className={`pbadge ${lvl} ${route === r.route ? 'on' : ''}`} onClick={() => { setProbOpen(false); select(route === r.route ? null : r.route) }}
            title={`Трамвай №${r.route}: ${lvl === 'crit' ? 'перегрузка' : 'внимание'} — ${Math.round(r.ratio[hour] * 100)}% норматива, ${fmt(r.boardings[hour])} пос./ч на ${fmt(r.vehicles[hour])} ваг. — нужно +${r.extra[hour]} ваг.`}>
            <span className="n" style={{ background: r.color }}>{r.route}</span>
            <b style={{ color: LEVEL_COLORS[lvl] }}>{overLabel(r.ratio[hour])}</b>
          </button>
        )
      })}
    </div>
    </div>
  )

  // карта и панель зависят только от часа — при плавном проигрывании не перерисовываем их каждый кадр
  const mapEl = useMemo(() => <OpsMap geo={geo} segments={segments} schema={schema} day={day.data} hour={hour} selected={route} selectedStop={stop} onSelect={select} mode={mode} onMode={setMode} timeRef={timeRef} paused={drawer != null}
    help={<button className="mapbtn glass" onClick={() => { select(null); setIntro(true) }} title="О проекте и легенда"><CircleHelp size={20} strokeWidth={1.75} /></button>} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geo, segments, schema, day.data, hour, route, stop, mode, drawer])
  const panelEl = useMemo(() => sel && (
    <RoutePanel route={sel} geo={geo.find((g) => g.route === sel.route)} allGeo={geo} list={routeList} depots={day.data?.depots} date={date} hour={hour} stopId={stop} keys={!drawer && !menu && !showCoef}
      onClose={() => select(null)} onHour={(h) => { setPlaying(false); setLive(false); setMinute(h * 60) }} onStop={(s) => setStop(s)}
      onRoute={(r, s) => select(r, s)} />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [sel, geo, routeList, day.data, date, hour, stop, drawer, menu, showCoef])

  return (
    <div className={`ops ${sel ? 'side-open' : ''}`}>
      {mapEl}

      {menuBtn('float menubtn glass')}
      <Timeline lead={menuBtn('seg-solo tl-menu')} date={date} setDate={setDate} minute={minute} setMinute={setMinute} playing={playing} setPlaying={setPlaying}
        speed={speed} setSpeed={setSpeed} day={day.data} min={min} max={max} below={badges} keys={!drawer && !menu} live={live} setLive={setLive} />

      {showCoef && (
        <div className="float glass coef-pop" style={{ top: menuAt.top, left: menuAt.left }}>
          <button className="iconbtn coef-x" onClick={() => setShowCoef(false)} title="Закрыть"><X size={16} /></button>
          <CoefPanel />
        </div>
      )}
      {day.error && <div className="float glass" style={{ top: 110, left: '50%', transform: 'translateX(-50%)', padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center' }}><TriangleAlert size={16} /> {day.error}</div>}

      {panelEl}

      {intro && !sel && <Intro onClose={() => setIntro(false)} />}

      <RouteBar geo={geo} allRoutes={allRoutes} routes={routes} hour={hour} selected={route} onSelect={(r) => select(r)} />

      {menu && (
        <>
          <div className="menu-back" onClick={() => setMenu(false)} />
          <nav className="menupop glass" style={menuAt}>
            <div className="mp-head"><b>TramFlow</b><span className="note">ИИ-прогноз загрузки трамваев</span>
              <button className="iconbtn" onClick={() => setMenu(false)} title="Закрыть"><X size={18} /></button></div>
            {MENU.map((m) => (
              <button key={m.key} onClick={() => { setMenu(false); openDrawer(m.key) }}><m.i size={18} strokeWidth={1.75} />{m.t}</button>
            ))}
            <hr />
            <button onClick={() => { setMenu(false); setShowCoef(true) }}>
              <Scale size={18} strokeWidth={1.75} />Коэффициенты{coefChanged && <i className="mdot" />}
            </button>
            <button onClick={() => { setMenu(false); setIntro(true) }}><CircleHelp size={18} strokeWidth={1.75} />О проекте и легенда</button>
          </nav>
        </>
      )}
    </div>
  )
}
