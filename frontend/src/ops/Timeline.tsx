import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, CloudRain, CloudSnow, CloudSun, Moon, Pause, Play, Snowflake, Sun, ThermometerSnowflake, type LucideIcon } from 'lucide-react'
import { at24, fetchDay, type DayView } from '../api'
import { useApp } from '../components'

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4, 8]
const WEEKDAY = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

type Props = {
  date: string; setDate: (d: string) => void; minute: number; setMinute: (m: number) => void
  playing: boolean; setPlaying: (p: boolean) => void; speed: number; setSpeed: (s: number) => void
  day: DayView | null; min: string; max: string; below?: ReactNode; keys?: boolean
  focused?: boolean // стрелки сейчас у ленты времени, хотя открыта остановка — подсвечиваем
  live: boolean; setLive: (v: boolean) => void
  lead?: ReactNode // кнопка меню — первой в строке управления
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const shift = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
const today = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()) }

// погода часа → иконка и подпись
function weatherOf(temp: number, precip: number, snow: number, h: number): { icon: LucideIcon; t: string } {
  if (snow > 0) return { icon: CloudSnow, t: `снегопад, ${snow} см/ч` }
  if (precip > 0) return temp <= 0 ? { icon: CloudSnow, t: `снег, ${precip} мм/ч` } : { icon: CloudRain, t: `дождь, ${precip} мм/ч` }
  if (temp <= -10) return { icon: ThermometerSnowflake, t: 'сильный мороз' }
  if (temp < 0) return { icon: Snowflake, t: 'мороз' }
  if (h < 6 || h >= 21) return { icon: Moon, t: 'ночь, без осадков' }
  if (temp >= 25) return { icon: Sun, t: 'жарко, без осадков' }
  return { icon: CloudSun, t: 'без осадков' }
}

/** Текущая погода в Москве для режима Live — Open-Meteo (https://open-meteo.com, без ключа), обновление раз в 10 минут. */
export function useLiveWeather(on: boolean) {
  const [w, setW] = useState<{ temp: number; precip: number; snow: number } | null>(null)
  useEffect(() => {
    if (!on) return
    let alive = true
    const load = () => fetch('https://api.open-meteo.com/v1/forecast?latitude=55.7558&longitude=37.6173&current=temperature_2m,precipitation,snowfall&timezone=Europe%2FMoscow')
      .then((r) => r.json())
      .then((j) => { if (alive && j?.current) setW({ temp: j.current.temperature_2m, precip: j.current.precipitation ?? 0, snow: j.current.snowfall ?? 0 }) })
      .catch(() => undefined)
    load()
    const t = setInterval(load, 10 * 60 * 1000)
    return () => { alive = false; clearInterval(t) }
  }, [on])
  return w
}

function DatePicker({ date, setDate, min, max }: { date: string; setDate: (d: string) => void; min: string; max: string }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => ({ y: +date.slice(0, 4), m: +date.slice(5, 7) - 1 }))
  const [level, setLevel] = useState<'days' | 'months' | 'years'>('days')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) { setView({ y: +date.slice(0, 4), m: +date.slice(5, 7) - 1 }); setLevel('days') } }, [open, date])
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    window.addEventListener('mousedown', h)
    window.addEventListener('keydown', k, true)
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k, true) }
  }, [open])

  const first = (new Date(Date.UTC(view.y, view.m, 1)).getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate()
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const move = (n: number) => setView((v) => { const m = v.m + n; return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 } })
  const canPrev = iso(view.y, view.m, 1) > min
  const canNext = iso(view.y, view.m, days) < max
  const t = today()
  const pick = (d: string) => { setDate(d); setOpen(false) }
  const minY = +min.slice(0, 4), maxY = +max.slice(0, 4)
  const monthOff = (y: number, m: number) => iso(y, m, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()) < min || iso(y, m, 1) > max
  const years = Array.from({ length: maxY - minY + 1 }, (_, i) => minY + i)

  return (
    <div className="dp" ref={ref}>
      <button className="dp-arrow" title="Предыдущий день" disabled={date <= min} onClick={() => setDate(shift(date, -1))}><ChevronLeft size={18} /></button>
      <button className={`dp-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)}>
        <CalendarDays size={15} className="dp-ico" />{+date.slice(8)} <span className="dp-mfull">{MONTHS_GEN[+date.slice(5, 7) - 1]}</span><span className="dp-mshort">{MONTHS_GEN[+date.slice(5, 7) - 1].slice(0, 3)}</span><span className="dp-year"> {date.slice(0, 4)}</span>
      </button>
      <button className="dp-arrow" title="Следующий день" disabled={date >= max} onClick={() => setDate(shift(date, 1))}><ChevronRight size={18} /></button>
      {open && (
        <div className="dp-pop glass">
          {level === 'days' && <>
            <div className="dp-head">
              <button className="dp-arrow" disabled={!canPrev} onClick={() => move(-1)}><ChevronLeft size={18} /></button>
              <button className="dp-title" onClick={() => setLevel('months')} title="Выбрать месяц">{MONTHS[view.m]} {view.y}</button>
              <button className="dp-arrow" disabled={!canNext} onClick={() => move(1)}><ChevronRight size={18} /></button>
            </div>
            <div className="dp-grid">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d, i) => <span key={d} className={`dp-dow ${i > 4 ? 'we' : ''}`}>{d}</span>)}
              {cells.map((d, i) => {
                if (d == null) return <span key={`e${i}`} />
                const v = iso(view.y, view.m, d)
                const off = v < min || v > max
                return (
                  <button key={v} disabled={off} onClick={() => pick(v)}
                    className={`dp-day ${v === date ? 'sel' : ''} ${v === t ? 'today' : ''} ${i % 7 > 4 ? 'we' : ''}`}>{d}</button>
                )
              })}
            </div>
          </>}
          {level === 'months' && <>
            <div className="dp-head">
              <button className="dp-arrow" disabled={view.y <= minY} onClick={() => setView((v) => ({ ...v, y: v.y - 1 }))}><ChevronLeft size={18} /></button>
              <button className="dp-title" onClick={() => setLevel('years')} title="Выбрать год">{view.y}</button>
              <button className="dp-arrow" disabled={view.y >= maxY} onClick={() => setView((v) => ({ ...v, y: v.y + 1 }))}><ChevronRight size={18} /></button>
            </div>
            <div className="dp-mgrid">
              {MONTHS.map((name, m) => (
                <button key={m} disabled={monthOff(view.y, m)} onClick={() => { setView({ y: view.y, m }); setLevel('days') }}
                  className={`dp-cell ${view.y === +date.slice(0, 4) && m === +date.slice(5, 7) - 1 ? 'sel' : ''}`}>{name.slice(0, 3)}</button>
              ))}
            </div>
          </>}
          {level === 'years' && <>
            <div className="dp-head"><span /><b>Год</b><span /></div>
            <div className="dp-mgrid">
              {years.map((y) => (
                <button key={y} onClick={() => { setView((v) => ({ ...v, y })); setLevel('months') }}
                  className={`dp-cell ${y === +date.slice(0, 4) ? 'sel' : ''}`}>{y}</button>
              ))}
            </div>
          </>}
          <div className="dp-foot">
            {t >= min && t <= max && <button className="dp-link" onClick={() => pick(t)}>Сегодня</button>}
          </div>
        </div>
      )}
    </div>
  )
}

const RATE = 20 // минут прогноза в секунду при ×1
const PAD = 360 // сколько минут соседних суток видно по краям ленты
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`
const shortDate = (d: string) => `${+d.slice(8)} ${MONTHS_GEN[+d.slice(5, 7) - 1].slice(0, 3)}`

// сглаженная кривая через точки (Catmull-Rom → кубические Безье)
function smooth(pts: [number, number][]) {
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
  }
  return d
}

/** Лента времени как в видеоредакторе: указатель неподвижен в центре, под ним прокручиваются часы. */
/** Кэш суток для ленты: текущие и соседние дни (±2) — график идёт непрерывно через полночь и не «мигает» при смене дня. */
function useDayCache(date: string, min: string, max: string) {
  const { coef, version, settings } = useApp()
  const norm = settings?.norm_scale ?? 1
  const key = JSON.stringify(coef) + version + '|' + norm
  const store = useRef<{ key: string; days: Record<string, DayView | null | 'loading'> }>({ key, days: {} })
  const [ver, bump] = useState(0)
  if (store.current.key !== key) store.current = { key, days: {} }
  useEffect(() => {
    const st = store.current
    for (const k of [-2, -1, 0, 1, 2]) {
      const d = shift(date, k)
      if (d < min || d > max || st.days[d] !== undefined) continue
      st.days[d] = 'loading'
      fetchDay(d, { ...coef, v: version, n: norm }) // тот же кэш и ключ, что у главного экрана
        .then((v) => { if (store.current === st) { st.days[d] = v; bump((x) => x + 1) } })
        .catch(() => { st.days[d] = null })
    }
  }, [date, min, max, key]) // eslint-disable-line react-hooks/exhaustive-deps
  // один и тот же объект, пока не пришли новые сутки: иначе лента пересобиралась бы каждый кадр проигрывания
  return useMemo(() => {
    const get = (d: string) => { const v = store.current.days[d]; return v && v !== 'loading' ? v : null }
    return { prev: get(shift(date, -1)), cur: get(date), next: get(shift(date, 1)), all: store.current.days }
  }, [date, key, ver]) // eslint-disable-line react-hooks/exhaustive-deps
}

// загрузка сети → цвет (зелёный → жёлтый → оранжевый → красный), приглушённый
const LOAD_STOPS: [number, [number, number, number]][] = [[0.55, [34, 197, 94]], [0.85, [234, 179, 8]], [1.02, [249, 115, 22]], [1.2, [239, 68, 68]]]
function loadRGB(r: number) {
  if (r <= LOAD_STOPS[0][0]) return LOAD_STOPS[0][1]
  for (let i = 1; i < LOAD_STOPS.length; i++) {
    const [r1, c1] = LOAD_STOPS[i]
    if (r <= r1) {
      const [r0, c0] = LOAD_STOPS[i - 1], t = (r - r0) / (r1 - r0)
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * t)) as [number, number, number]
    }
  }
  return LOAD_STOPS[LOAD_STOPS.length - 1][1]
}

function Ruler({ date, day, days, minute, span, live, onMove, onZoom, onJump, onGrab }: {
  date: string; day: DayView | null; days: { prev: DayView | null; cur: DayView | null; next: DayView | null; all: Record<string, unknown> }
  minute: number; span: number; live: boolean
  onMove: (delta: number) => void; onZoom: (k: number) => void; onJump: (delta: number, ms?: number) => void; onGrab: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const ppm = w / span // пикселей на минуту
  const H = 56
  const x = (m: number) => (m + PAD) * ppm

  // сама лента перерисовывается только при смене дня/масштаба; при проигрывании двигается transform'ом
  const strip = useMemo(() => {
    const els: ReactNode[] = []
    const labelEvery = ppm * 60 >= 48 ? 60 : ppm * 120 >= 48 ? 120 : ppm * 180 >= 48 ? 180 : 360 // подписи не слипаются на узких экранах
    const minorEvery = ppm * 15 >= 7 ? 15 : ppm * 30 >= 7 ? 30 : 60
    for (let m = -PAD; m <= 1440 + PAD; m += minorEvery) {
      const major = m % 60 === 0
      const edge = m === 0 || m === 1440
      els.push(<line key={`t${m}`} x1={x(m)} x2={x(m)} y1={edge ? 6 : major ? 20 : 25} y2={H - 2}
        className={edge ? 'r-edge' : major ? 'r-major' : 'r-minor'} />)
      const nearEdge = Math.min(Math.abs(m), Math.abs(m - 1440)) * ppm < 66 // рядом с подписью даты — не пишем час
      if (major && !edge && !nearEdge && ((m % 1440) + 1440) % labelEvery === 0)
        els.push(<text key={`l${m}`} x={x(m) + 4} y={16} className="r-label">{hhmm(((m % 1440) + 1440) % 1440)}</text>)
    }
    els.push(<text key="dprev" x={x(0) - 6} y={16} className="r-day" textAnchor="end">{shortDate(shift(date, -1))}</text>)
    els.push(<text key="dcur" x={x(0) + 6} y={16} className="r-day">{shortDate(date)}</text>)
    els.push(<text key="dnext" x={x(1440) + 6} y={16} className="r-day">{shortDate(shift(date, 1))}</text>)
    // «волна» пассажиропотока по сети: вчера + сегодня + завтра одной непрерывной кривой (без провала в полночь),
    // цвет по часам — загрузка сети (зелёный → красный), приглушённо
    const cur = day ?? days.cur
    const b = cur?.network.boardings ?? []
    const three = [days.prev, cur, days.next]
    let top = 1
    for (const v of Object.values(days.all)) if (v && typeof v === 'object') top = Math.max(top, ...(v as DayView).network.boardings)
    top = Math.max(top, ...b)
    const hrs: { m: number; v: number; r: number }[] = []
    three.forEach((dv, k) => {
      for (let h = 0; h < 24; h++) {
        const m = (k - 1) * 1440 + h * 60 + 30
        if (m < -PAD - 60 || m > 1440 + PAD + 60) continue
        hrs.push({ m, v: dv?.network.boardings[h] ?? 0, r: dv && dv.network.max_ratio[h] > 0 ? dv.network.max_ratio[h] : 0 })
      }
    })
    if (hrs.length > 2 && cur) {
      const pts: [number, number][] = hrs.map((p) => [x(p.m), H - 2 - (p.v / top) * 24])
      const x0 = x(-PAD), x1 = x(1440 + PAD)
      const d = smooth(pts) + ` L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`
      const gid = `rg-${date}`
      els.push(
        <defs key="wdefs">
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={x0} x2={x1} y1={0} y2={0}>
            {hrs.map((p) => {
              const c = p.r > 0 ? loadRGB(p.r) : [148, 163, 184]
              return <stop key={p.m} offset={Math.max(0, Math.min(1, (x(p.m) - x0) / (x1 - x0)))} stopColor={`rgb(${c.join(',')})`} />
            })}
          </linearGradient>
        </defs>,
        <path key="wave" d={d} className="r-wave" style={{ fill: `url(#${gid})`, stroke: `url(#${gid})` }} />,
      )
    }
    // перегрузка на делениях по 15 минут: значок, если хотя бы одна ветка выше норматива более чем на 1%
    // (значения часа интерполируются так же, как в анимации карты); на соседних сутках — тоже, для непрерывности
    let lastX = -1e9
    three.forEach((dv, k) => {
      if (!dv) return
      for (let t = 0; t < 1440; t += 15) {
        const m = (k - 1) * 1440 + t
        if (m < -PAD || m > 1440 + PAD) continue
        const over = dv.routes.filter((r) => at24(r.vehicles, t + 7.5) > 0.05 && at24(r.ratio, t + 7.5) > 1.01)
        if (!over.length) continue
        const px = x(m + 7.5)
        if (px - lastX < 15) continue // при сильном отдалении значки не слипаются
        lastX = px
        const worst = Math.max(...over.map((r) => at24(r.ratio, t + 7.5)))
        // высота — по кривой (линейно между серединами часов), чтобы значок сидел на графике
        const hf = Math.max(0, Math.min(23, (t + 7.5) / 60 - 0.5)), h0 = Math.floor(hf), nb = dv.network.boardings
        const hv = nb[h0] + (nb[Math.min(23, h0 + 1)] - nb[h0]) * (hf - h0)
        els.push(
          <g key={`w${m}`} transform={`translate(${px - 7},${H - 2 - (hv / top) * 24 - 17})`} className={`r-warn ${worst >= 1.2 ? 'crit' : ''}`}>
            <title>{`${hhmm(t)}–${hhmm(t + 15)} — выше норматива: ${over.map((r) => '№' + r.route).join(', ')} (до ${Math.round(worst * 100)}%)`}</title>
            <path d="M7 1 .8 12.2h12.4L7 1Z" /><path d="M7 5v3.4" /><circle cx="7" cy="10.2" r=".8" />
          </g>)
      }
    })
    return <svg width={x(1440 + PAD)} height={H} className="r-svg">
      <rect x={0} y={0} width={x(0)} height={H} className="r-out" />
      <rect x={x(1440)} y={0} width={x(1440 + PAD) - x(1440)} height={H} className="r-out" />
      {els}
    </svg>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, days, date, ppm, span])

  // перетаскивание с инерцией; короткий клик — плавный переход к точке; колесо — прокрутка, Ctrl/⌘+колесо — масштаб
  const drag = useRef<{ x: number; t: number; v: number; moved: number; start: number } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault() // не выделять текст вокруг при перетаскивании
    onGrab()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, t: performance.now(), v: 0, moved: 0, start: e.clientX }
  }
  const onPMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const now = performance.now(), dx = e.clientX - d.x
    d.v = 0.7 * d.v + 0.3 * (dx / Math.max(1, now - d.t))
    d.moved += Math.abs(dx); d.x = e.clientX; d.t = now
    onMove(-dx / ppm)
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved < 4) {
      const r = box.current!.getBoundingClientRect()
      onJump((e.clientX - r.left - r.width / 2) / ppm)
    } else if (Math.abs(d.v) > 0.05 && performance.now() - d.t < 80) {
      const v = Math.max(-3, Math.min(3, d.v)) // px/мс, без рывков от резких жестов
      onJump(Math.max(-span / 3, Math.min(span / 3, (-v * 220) / ppm)), 600) // инерция: докатываемся по скорости жеста
    }
  }
  useEffect(() => {
    const el = box.current!
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      onGrab()
      if (e.ctrlKey || e.metaKey) onZoom(Math.exp(e.deltaY * 0.01))
      else onMove((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / ppm)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [ppm, onMove, onZoom, onGrab])

  return (
    <div className={`ruler ${live ? 'live' : ''}`} ref={box} onPointerDown={onDown} onPointerMove={onPMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null }}>
      <div className="r-strip" style={{ transform: `translate3d(${w / 2 - x(minute)}px,0,0)` }}>{strip}</div>
      <div className="r-head"><span>{hhmm(minute)}</span></div>
    </div>
  )
}

export default function Timeline({ date, setDate, minute, setMinute, playing, setPlaying, speed, setSpeed, day, min, max, below, keys = true, focused, live, setLive, lead }: Props) {
  const [span, setSpan] = useState(420)
  const st = useRef({ date, minute })
  st.current.date = date
  st.current.minute = minute
  const anim = useRef(0)
  const stopAnim = useCallback(() => cancelAnimationFrame(anim.current), [])

  // сдвиг во времени с переходом через полночь на соседние сутки
  const moveBy = useCallback((delta: number) => {
    let m = st.current.minute + delta, d = st.current.date
    while (m >= 1440) { if (d >= max) { m = 1439.9; break } d = shift(d, 1); m -= 1440 }
    while (m < 0) { if (d <= min) { m = 0; break } d = shift(d, -1); m += 1440 }
    if (d !== st.current.date) { st.current.date = d; setDate(d) }
    st.current.minute = m
    setMinute(m)
    return m
  }, [min, max, setDate, setMinute])

  // плавный переход на delta минут (клик по ленте, инерция, «Сейчас»)
  const glide = useCallback((delta: number, ms = 420) => {
    stopAnim()
    let done = 0
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      moveBy(delta * e - done)
      done = delta * e
      if (k < 1) anim.current = requestAnimationFrame(step)
    }
    anim.current = requestAnimationFrame(step)
  }, [moveBy, stopAnim])

  const grab = useCallback(() => { stopAnim(); setPlaying(false); setLive(false) }, [stopAnim, setPlaying, setLive])

  // LIVE: лента идёт вместе с реальными часами; любое ручное действие выходит из режима
  useEffect(() => { if (playing) setLive(false) }, [playing, setLive])
  useEffect(() => {
    if (!live) return
    stopAnim()
    const tick = () => {
      const n = new Date(), d = today()
      if (d < min || d > max) { setLive(false); if (st.current.date < min || st.current.date > max) { setDate('2025-11-12'); setMinute(8 * 60) } return }
      if (d !== st.current.date) { st.current.date = d; setDate(d) }
      const m = n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60
      st.current.minute = m
      setMinute(m)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [live, min, max, setDate, setMinute, setLive, stopAnim])
  const zoom = useCallback((k: number) => setSpan((s) => Math.min(1440, Math.max(120, s * k))), [])

  // проигрывание: плавно, кадр за кадром, через полночь — в следующий день
  useEffect(() => {
    if (!playing) return
    stopAnim()
    let last = performance.now(), raf = 0
    const tick = (t: number) => {
      const m = moveBy(((t - last) / 1000) * RATE * speed)
      last = t
      if (st.current.date >= max && m >= 1439.9) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, moveBy, max, setPlaying, stopAnim])

  // стрелки ← →: короткое нажатие — шаг 15 минут; удержание — плавная прокрутка, как перемотка видео, через полночь в соседние сутки
  useEffect(() => {
    if (!keys) return
    let dir = 0, hold = 0, raf = 0, last = 0, held = 0
    const loop = (t: number) => {
      const dt = t - last
      last = t; held += dt
      moveBy((dir * Math.min(180, 30 + held * 0.05) * dt) / 1000) // от 30 до 180 мин/с, плавно разгоняясь
      raf = requestAnimationFrame(loop)
    }
    const stop = () => { dir = 0; clearTimeout(hold); cancelAnimationFrame(raf) }
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      e.preventDefault()
      if (e.repeat || dir) return
      dir = e.key === 'ArrowRight' ? 1 : -1
      setPlaying(false)
      setLive(false)
      const m = st.current.minute
      const target = dir > 0 ? Math.floor(m / 15 + 1e-6) * 15 + 15 : Math.ceil(m / 15 - 1e-6) * 15 - 15
      glide(target - m, 160)
      hold = window.setTimeout(() => { stopAnim(); held = 0; last = performance.now(); raf = requestAnimationFrame(loop) }, 260)
    }
    const up = (e: KeyboardEvent) => { if ((e.key === 'ArrowRight' && dir > 0) || (e.key === 'ArrowLeft' && dir < 0)) stop() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', stop)
    return () => { stop(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', stop) }
  }, [keys, moveBy, glide, stopAnim, setPlaying, setLive])

  const dayCache = useDayCache(date, min, max)
  const nextSpeed = () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])
  const h = Math.floor(minute / 60)
  const w = day?.weather
  const liveW = useLiveWeather(live)
  const temp = live && liveW ? liveW.temp : w?.temp[h]
  const wx = live && liveW ? weatherOf(liveW.temp, liveW.precip, liveW.snow, h) : w && temp != null ? weatherOf(temp, w.precip[h], w.snow[h], h) : null
  const nowDate = today()
  const canLive = nowDate >= min && nowDate <= max
  const secs = live ? `:${String(Math.floor((minute % 1) * 60 + 1e-6)).padStart(2, '0')}` : ''

  return (
    <div className={`float ops-time ${focused ? 'kfocus' : ''}`}>
      <div className="glass ops-time-in">
        <div className="row1">
          {lead}
          <div className="seg">
            <button className="seg-b play" title="Пробел — старт/пауза" onClick={() => { setLive(false); setPlaying(!playing) }}>
              {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            </button>
            <button className="seg-b speed" title="Скорость проигрывания — нажмите, чтобы сменить" onClick={nextSpeed}>
              ×{String(speed).replace('.', ',')}
            </button>
          </div>
          <DatePicker date={date} setDate={(d) => { stopAnim(); setLive(false); setDate(d) }} min={min} max={max} />
          {canLive && (
            <button className={`livebtn ${live ? 'on' : ''}`} onClick={() => { setPlaying(false); setLive(!live) }}
              title={live ? 'Выйти из режима реального времени' : 'Показывать в реальном времени'}><i />Live</button>
          )}
          <div className="spacer" />
          <div className="now">
            <span className="dow">{day ? WEEKDAY[day.dow] : ''}</span>
            <b className="tnum">{hhmm(minute)}{secs}</b>
            {wx && temp != null && (
              <span className="wx" title={wx.t}>{temp > 0 ? '+' : temp < 0 ? '−' : ''}{Math.abs(Math.round(temp))}°<wx.icon size={20} strokeWidth={1.75} className="wx-i" /></span>
            )}
          </div>
        </div>
        <Ruler date={date} day={day} days={dayCache} minute={minute} span={span} live={live} onMove={moveBy} onZoom={zoom} onJump={glide} onGrab={grab} />
      </div>
      {below}
    </div>
  )
}
