import { BookOpenText, ChartNoAxesCombined, ChevronDown, CircleMinus, CloudRain, CloudSnow, CloudSun, Gauge, Menu, Scale, Settings as Gear, ShieldCheck, TrendingUp, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_COEF, freeWindow, OFFLINE, overLabel, TH, useDay, type DayRoute } from '../api'
import { useApp } from '../components'
import OpsMap, { type MapMode } from './OpsMap'
import Intro from './Intro'
import RouteBar from './RouteBar'
import RoutePanel from './RoutePanel'
import Timeline, { useLiveWeather } from './Timeline'
import WeatherFx, { type Precip } from './WeatherFx'

export const MENU = [
  { key: 'summary', i: ChartNoAxesCombined, t: 'Сводка' },
  { key: 'about', i: BookOpenText, t: 'О проекте' },
  { key: 'settings', i: Gear, t: 'Настройки' },
]

export default function OpsScreen({ drawer, openDrawer, sidePage, sideWide }: {
  drawer: string | null; openDrawer: (k: string | null) => void
  sidePage?: React.ReactNode; sideWide?: boolean // «Сводка» / «Настройки» — панелью слева, карта при этом работает
}) {
  const full = drawer != null && !sidePage // страница на весь экран («О проекте») — карта на паузе, клавиши ей не нужны
  const { meta, geo, segments, schema, coef, settings, version } = useApp()
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
  const [live, setLive] = useState(true) // по умолчанию — реальное время
  const introRef = useRef(false)
  const [intro, setIntroState] = useState(() => { try { return !localStorage.getItem('tf-intro-seen') } catch { return true } })
  introRef.current = intro
  const setIntro = (v: boolean) => { setIntroState(v); if (!v) try { localStorage.setItem('tf-intro-seen', '1') } catch { /* без хранилища */ } }
  // пока меню или коэффициенты открыты — держим их под кнопкой, даже если шкала сдвигается
  useEffect(() => {
    if (!menu) return
    let raf = 0
    const tick = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (r && r.width) setMenuAt((p) => (p.top === Math.round(r.bottom + 8) && p.left === Math.round(r.left) ? p : { top: Math.round(r.bottom + 8), left: Math.round(r.left) }))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [menu])
  // по умолчанию — схема маршрутов; сохранённый старый режим «схема по карте» тоже открывает схему
  const [mode, setModeState] = useState<MapMode>(() => { try { return localStorage.getItem('tf-map-mode') === 'map' ? 'map' : 'metro' } catch { return 'metro' } })
  const setMode = (m: MapMode) => { setModeState(m); try { localStorage.setItem('tf-map-mode', m) } catch { /* без хранилища — просто не запоминаем */ } }
  const stopRef = useRef<string | null>(null)
  stopRef.current = stop
  // куда идут стрелки ← →: выбрали остановку (или кликнули по её карточке) — листаем остановки; кликнули по ленте времени — время;
  // кликнули по нижней панели маршрутов — маршруты
  const [focus, setFocus] = useState<'time' | 'stops' | 'routes'>('time')
  useEffect(() => { setFocus((f) => (stop ? 'stops' : f === 'stops' ? 'time' : f)) }, [stop])
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('.ops-time')) setFocus('time')
      else if (t.closest('.routebar')) setFocus('routes')
      else if (stopRef.current && t.closest('.ops-side')) setFocus('stops')
    }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [])
  const stopKeys = focus === 'stops' && stop != null
  const routeKeys = focus === 'routes'
  // ответ /api/day зависит от коэффициентов и норматива (пороги — только в интерфейсе): они и есть ключ кэша
  const norm = settings?.norm_scale ?? 1
  const day = useDay(date, { ...coef, v: version, n: norm }, { min: meta?.forecast.from ?? '2025-11-01', max: meta?.forecast.to ?? '2026-10-31' })
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
      else if (e.key === 'Escape') { if (menu) setMenu(false); else if (introRef.current) setIntro(false); else if (stopRef.current) setStop(null); else setRoute(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer, menu])

  const routes = useMemo(() => day.data?.routes ?? [], [day.data])
  const sel = routes.find((r) => r.route === route)
  // порядок перелистывания веток в карточке — как на панели маршрутов внизу
  const routeList = useMemo(() => geo.map((g) => routes.find((r) => r.route === g.route)).filter((r): r is DayRoute => r != null), [geo, routes])
  const select = (r: number | null, s?: string | null) => { setRoute(r); setStop(s ?? null); if (r != null) { setIntro(false); if (sidePage) openDrawer(null) } }
  const routeNav = useRef<(d: -1 | 1) => void>(() => {})
  routeNav.current = (d) => {
    const ids = routeList.map((x) => x.route)
    const i = route == null ? (d > 0 ? -1 : ids.length) : ids.indexOf(route)
    const n = ids[i + d]
    if (n != null) select(n)
  }
  useEffect(() => {
    if (!routeKeys || full || menu) return
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      e.preventDefault()
      routeNav.current(e.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [routeKeys, full, menu])

  // прогноз скорректирован в «Настройках» (коэффициенты или норматив отличаются от модели)
  const coefChanged = (Object.keys(DEFAULT_COEF) as (keyof typeof DEFAULT_COEF)[]).some((k) => coef[k] !== DEFAULT_COEF[k]) || (settings?.norm_scale ?? 1) !== 1

  // состояние сети «сейчас»: даже ночью и без проблем оператор видит, что прогноз посчитан и всё под контролем
  const [calc, setCalc] = useState(false)
  const recalcKey = JSON.stringify(coef) + version + '|' + norm
  const prevCalc = useRef(recalcKey)
  useEffect(() => {
    if (prevCalc.current === recalcKey) return // не менялось (в т. ч. повторный запуск эффекта) — не пересчитываем
    prevCalc.current = recalcKey
    setCalc(true)
    const t = setTimeout(() => setCalc(false), 1600) // столько же идёт «волна пересчёта» по схеме
    return () => clearTimeout(t)
  }, [recalcKey])
  // лента событий под шкалой времени: всё, что оператору нужно заметить в выбранный час.
  // События одного типа на нескольких ветках складываются в колоду; по нажатию раскрываются, по ветке — открывается её карточка.
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
  const [deck, setDeck] = useState<string | null>(null)
  useEffect(() => { setDeck(null) }, [hour])
  const events = useMemo(() => {
    const on = (r: DayRoute, h: number) => h < 24 && r.vehicles[h] > 0
    const list: { key: string; title: string; tone: 'crit' | 'soon' | 'high' | 'free'; icon: typeof TriangleAlert; items: { r: DayRoute; note: string; tip: string }[] }[] = [
      { key: 'over', title: 'Перегрузка', tone: 'crit', icon: TriangleAlert, items: [] },
      { key: 'soon', title: 'Скоро перегрузка', tone: 'soon', icon: TrendingUp, items: [] },
      { key: 'high', title: 'Загрузка выше 80%', tone: 'high', icon: Gauge, items: [] },
      { key: 'free', title: 'Можно снять вагоны', tone: 'free', icon: CircleMinus, items: [] },
    ]
    const [over, soon, high, free] = list
    for (const r of [...routes].sort((a, b) => b.ratio[hour] - a.ratio[hour])) {
      if (!on(r, hour)) continue
      const q = r.ratio[hour]
      if (q >= 1) over.items.push({ r, note: overLabel(q), tip: `№${r.route}: ${Math.round(q * 100)}% норматива — перегрузка` })
      else if (on(r, hour + 1) && r.ratio[hour + 1] >= 1) soon.items.push({ r, note: hh(hour + 1), tip: `№${r.route}: в ${hh(hour + 1)} загрузка ${Math.round(r.ratio[hour + 1] * 100)}% — перегрузка` })
      else if (q >= TH.soft) high.items.push({ r, note: `${Math.round(q * 100)}%`, tip: `№${r.route}: ${Math.round(q * 100)}% норматива — на грани` })
      else if (freeWindow(r, hour)?.from === hour) free.items.push({ r, note: `${Math.round(q * 100)}%`, tip: `№${r.route}: загрузка ${Math.round(q * 100)}% — лишние вагоны можно отдать` })
    }
    return list.filter((e) => e.items.length)
  }, [routes, hour])
  const openRoute = (n: number) => { setDeck(null); select(n) }
  // блок событий виден всегда — и пока данные ещё грузятся (там индикатор «Загрузка данных…»)
  const badges = (
    <div className="probwrap">
      <div className="evbar">
        {(calc || day.loading || !day.data)
          ? <div className="ev busy"><span className="ev-h"><i className="spin-dot" /><span className="ev-t">{calc ? 'Обновляем прогноз…' : 'Загрузка данных…'}</span></span></div>
          : events.map((e) => {
          const one = e.items.length === 1 ? e.items[0] : null
          const open = deck === e.key
          return (
            <div key={e.key} className={`ev ${e.tone} ${e.items.length > 1 ? 'deck' : ''} ${open ? 'open' : ''}`}>
              <button className="ev-h" onClick={() => (one ? openRoute(one.r.route) : setDeck(open ? null : e.key))}
                title={one ? `${one.tip} — открыть` : `${e.title}: ${e.items.length} ${e.items.length < 5 ? 'ветки' : 'веток'} — ${open ? 'свернуть' : 'развернуть'}`}>
                <e.icon size={14} /><span className="ev-t">{e.title}</span>
                {one ? <><i className="rn" style={{ background: one.r.color }}>{one.r.route}</i><b>{one.note}</b></>
                  : <><span className="ev-dots">{e.items.slice(0, 4).map((it) => <i key={it.r.route} style={{ background: it.r.color }} />)}</span><b className="ev-n">{e.items.length}</b>
                    <ChevronDown size={13} className="caret" /></>}
              </button>
              {open && (
                <div className="ev-list">
                  {e.items.map((it) => (
                    <button key={it.r.route} onClick={() => openRoute(it.r.route)} title={`${it.tip} — открыть`}>
                      <i className="rn" style={{ background: it.r.color }}>{it.r.route}</i><b>{it.note}</b>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {coefChanged && (
          <div className="ev info">
            <button className="ev-h" onClick={() => openDrawer('settings')} title="Прогноз скорректирован в «Настройках» — открыть"><Scale size={14} /><span className="ev-t">Прогноз скорректирован</span></button>
          </div>
        )}
        {!calc && !day.loading && !events.length && !coefChanged && <div className="ev calm"><span className="ev-h"><ShieldCheck size={14} /><span className="ev-t">Всё спокойно</span></span></div>}
      </div>
      {day.error && <div className="ev crit"><span className="ev-h"><TriangleAlert size={14} /><span className="ev-t">{day.error === OFFLINE ? `${OFFLINE}. Повторяю подключение…` : day.error}</span></span></div>}
    </div>
  )

  // погода для эффекта: в Live — текущая (Open-Meteo), иначе — архив/прогноз погоды выбранного часа
  const liveW = useLiveWeather(live)
  const [wxOn, setWxOn] = useState(() => { try { return localStorage.getItem('tf-wx') !== '0' } catch { return true } })
  const toggleWx = () => setWxOn((v) => { try { localStorage.setItem('tf-wx', v ? '0' : '1') } catch { /* без хранилища */ } return !v })
  const wd = day.data?.weather
  const wNow = live && liveW ? liveW : wd ? { temp: wd.temp[hour], precip: wd.precip[hour], snow: wd.snow[hour] } : null
  const wKind: 'rain' | 'snow' | null = wNow && wNow.precip > 0.05 ? (wNow.snow > 0 || wNow.temp <= 0.5 ? 'snow' : 'rain') : null
  const fx: Precip = wxOn && wKind ? { kind: wKind, k: Math.min(1, (wNow?.precip ?? 0) / 2) } : null
  const WxIcon = wKind === 'snow' ? CloudSnow : wKind === 'rain' ? CloudRain : CloudSun
  const wxBtn = (
    <button className={`mapbtn glass ${wxOn ? 'on' : ''}`} onClick={toggleWx} aria-pressed={wxOn} aria-label="Эффекты погоды"
      title={wxOn ? (wKind ? `Эффект погоды: ${wKind === 'snow' ? 'снег' : 'дождь'} — выключить` : 'Эффекты погоды включены (сейчас без осадков) — выключить') : 'Включить эффекты погоды: дождь и снег на схеме'}>
      <WxIcon size={20} strokeWidth={1.75} />
    </button>
  )

  // карта и панель зависят только от часа — при плавном проигрывании не перерисовываем их каждый кадр
  const mapEl = useMemo(() => <OpsMap geo={geo} segments={segments} schema={schema} day={day.data} hour={hour} selected={route} selectedStop={stop} onSelect={select} mode={mode} onMode={setMode} timeRef={timeRef} paused={full} wxBtn={wxBtn}
 />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geo, segments, schema, day.data, hour, route, stop, mode, full, wxOn, wKind])
  const panelEl = useMemo(() => sel && (
    <RoutePanel route={sel} geo={geo.find((g) => g.route === sel.route)} allGeo={geo} list={routeList} depots={day.data?.depots} date={date} hour={hour} stopId={stop} timeRef={timeRef} payCats={day.data?.pay_cats} keys={!full && !menu} lr={stopKeys && !full && !menu}
      onClose={() => select(null)} onHour={(h) => { setPlaying(false); setLive(false); setMinute(h * 60) }} onStop={(s) => setStop(s)}
      onRoute={(r, s) => select(r, s)} />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [sel, geo, routeList, day.data, date, hour, stop, full, menu, stopKeys])

  return (
    <div className={`ops ${sel || sidePage ? 'side-open' : ''} ${sidePage && sideWide ? 'side-wide' : ''}`}>
      {mapEl}
      <WeatherFx fx={fx} />

      {menuBtn('float menubtn glass')}
      <Timeline lead={menuBtn('seg-solo tl-menu')} date={date} setDate={setDate} minute={minute} setMinute={setMinute} playing={playing} setPlaying={setPlaying}
        speed={speed} setSpeed={setSpeed} day={day.data} min={min} max={max} below={badges} keys={!full && !menu && !stopKeys && !routeKeys} focused={focus === 'time' && stop != null} live={live} setLive={setLive} />


      {sidePage ?? panelEl}

      {intro && !sel && <Intro onClose={() => setIntro(false)} />}

      <RouteBar focused={routeKeys} geo={geo} selected={route} onSelect={(r) => select(r)} />

      {menu && (
        <>
          <div className="menu-back" onClick={() => setMenu(false)} />
          <nav className="menupop glass" style={menuAt}>
            <div className="mp-head"><b>TramFlow</b><span className="note">ИИ-прогноз загрузки трамваев</span>
              <button className="iconbtn" onClick={() => setMenu(false)} title="Закрыть"><X size={18} /></button></div>
            {MENU.map((m) => (
              <button key={m.key} onClick={() => { setMenu(false); openDrawer(m.key) }}>
                <m.i size={18} strokeWidth={1.75} />{m.t}{m.key === 'settings' && coefChanged && <i className="mdot" title="Прогноз скорректирован" />}
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  )
}
