import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, FileSpreadsheet, MousePointerClick } from 'lucide-react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { exportUrl, fmt, LEVEL_COLORS, LEVEL_TITLE, levelOf, problemWindows, type DayRoute, type RouteGeo, type Stop } from '../api'
import { axis, tooltipStyle, useApp } from '../components'

type Props = {
  route: DayRoute; geo?: RouteGeo; allGeo: RouteGeo[]; list: DayRoute[]; date: string; hour: number; stopId: string | null
  keys: boolean // ↑/↓ листают, пока поверх карты ничего не открыто
  onClose: () => void; onHour: (h: number) => void; onStop: (id: string | null) => void
  onRoute: (route: number, stopId: string | null) => void
}
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
const span = (w: { from: number; to: number }) => `${hh(w.from)}–${String(w.to + 1).padStart(2, '0')}:00`

// расстояние в метрах (для поиска пересадок на соседние маршруты и метро)
const dist = (a: Stop, b: Stop) => Math.hypot((a.lon - b.lon) * 62_600, (a.lat - b.lat) * 111_200)
// в данных кавычки вперемешку: «Метро "ВДНХ"» и «Метро «ВДНХ»» — показываем единообразно ёлочками
const nice = (s: string) => s.replace(/"([^"]*)"/g, '«$1»')
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many
const meters = (m: number) => (m < 60 ? 'здесь' : `≈${Math.round(m / 10) * 10} м`)

// остановка у метро / МЦК / МЦД: «Метро «ВДНХ»» → { kind: 'М', name: 'ВДНХ' }
const RAIL = /^(Метро|МЦК|МЦД)\s+[«"]?([^»"]+)[»"]?\s*$/
function railOf(name: string): { kind: string; name: string } | null {
  const m = RAIL.exec(name.trim())
  return m ? { kind: m[1] === 'Метро' ? 'М' : m[1], name: m[2] } : null
}
const RailMark = ({ kind }: { kind: string }) => <span className={`rail ${kind === 'М' ? 'm' : 'd'}`}>{kind}</span>

// мини-график суток: столбики посадок, цвет — загрузка маршрута в этот час; клик — перейти к часу
function DayBars({ values, levels, hour, onHour, unit }: { values: number[]; levels: string[]; hour: number; onHour: (h: number) => void; unit: string }) {
  const data = values.map((v, h) => ({ h, v }))
  return (
    <ResponsiveContainer width="100%" height={96}>
      <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} onClick={(e: any) => e?.activeLabel != null && onHour(Number(e.activeLabel))}>
        <XAxis dataKey="h" {...axis} interval={2} tickFormatter={(h) => `${h}`} />
        <Tooltip {...tooltipStyle} labelFormatter={(h) => hh(Number(h))} formatter={(v) => [`${fmt(Number(v))} ${unit}`, '']} separator="" cursor={{ fill: '#ffffff10' }} />
        <ReferenceLine x={hour} stroke="#fff" strokeWidth={1.5} />
        <Bar dataKey="v" radius={[2, 2, 0, 0]}>
          {data.map((d) => <Cell key={d.h} fill={levels[d.h] === 'high' || levels[d.h] === 'crit' ? LEVEL_COLORS[levels[d.h]] : '#2dd4bf'} fillOpacity={d.h === hour ? 1 : 0.75} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

const GAP = 54 // шаг между остановками на ленте в режиме остановки, px — диагональные подписи в 2–3 строки не наезжают
const PAD = 14 // левое поле ленты в режиме ветки
// ширина подписи в px — чтобы у всей ветки лента подстраивалась под самые длинные названия и ничего не обрезалось
let ctx2d: CanvasRenderingContext2D | null = null
function textW(t: string, font = '10px Inter, system-ui, sans-serif') {
  ctx2d ??= document.createElement('canvas').getContext('2d')
  if (!ctx2d) return t.length * 5.6
  ctx2d.font = font
  return ctx2d.measureText(t).width + 24 // + значок М/МЦК
}
const labelOf = (name: string) => { const r = railOf(name); return r ? r.name : nice(name) }

/** Лента остановок — как лента времени: в режиме остановки указатель неподвижен в центре, под ним едет линия маршрута
 *  (перетаскивание, колесо, клик). В режиме ветки — вся линия целиком. Столбики — сколько садится на остановке в выбранный час. */
function StopStrip({ stops, color, values, sel, onPick }: {
  stops: Stop[]; color: string; values: number[]; sel: number; onPick: (i: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  const [drag, setDrag] = useState(0) // смещение пальцем/мышью, px
  const d = useRef<{ x: number; moved: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current!
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const n = stops.length
  const focus = sel >= 0
  // при переходе ветка ↔ остановка лента сразу встаёт на выбранную станцию, без проезда
  // (ширина ленты при этом меняется — появляются стрелки; перемеряем до отрисовки и пару кадров держим без анимации)
  const prevFocus = useRef(focus)
  const [snapping, setSnapping] = useState(false)
  const snap = snapping || prevFocus.current !== focus
  useLayoutEffect(() => {
    if (prevFocus.current === focus) return
    prevFocus.current = focus
    setW(box.current!.clientWidth)
    setSnapping(true)
    let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setSnapping(false)) })
    return () => cancelAnimationFrame(raf)
  }, [focus])
  // у всей ветки: подписи в одну строку под 45°; правое поле — под подпись последней станции, высота — под самую длинную
  const padR = focus || !n ? PAD : Math.max(PAD, textW(labelOf(stops[n - 1].name)) * 0.71 + 12)
  const gap = focus ? GAP : n > 1 ? (w - PAD - padR) / (n - 1) : 0
  const x = (i: number) => (focus ? w / 2 + (i - sel) * gap + drag : n > 1 ? PAD + i * gap : w / 2)
  const top = Math.max(1e-9, ...values)
  // подписи по диагонали: у остановки — каждая; на всей ветке — через одну-две, чтобы не наезжали друг на друга
  const every = focus ? 1 : Math.max(1, Math.ceil(14 / Math.max(1, gap * 0.71)))
  const shown = (i: number): boolean => (focus ? i !== sel : i === n - 1 || (i % every === 0 && n - 1 - i >= every))
  const rise = focus ? 0 : Math.max(40, ...stops.map((s, i) => (shown(i) ? textW(labelOf(s.name)) * 0.71 : 0)))
  const at = (px: number) => Math.max(0, Math.min(n - 1, Math.round(focus ? sel + (px - w / 2 - drag) / gap : (px - PAD) / (gap || 1))))

  // колесо/тачпад над лентой — листаем остановки по одной
  const acc = useRef(0)
  const pick = useRef(onPick)
  pick.current = onPick
  useEffect(() => {
    const el = box.current!
    const wheel = (e: WheelEvent) => {
      if (!focus) return
      e.preventDefault()
      acc.current += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (Math.abs(acc.current) < 50) return
      const next = Math.max(0, Math.min(n - 1, sel + Math.sign(acc.current)))
      acc.current = 0
      if (next !== sel) pick.current(next)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [focus, sel, n])

  return (
    <div className={`sd-stripwrap ${focus ? 'focus' : ''}`}>
    {focus && <button className="sd-arr l" disabled={sel <= 0} onClick={() => onPick(sel - 1)} title={sel > 0 ? nice(stops[sel - 1].name) : 'Начало линии'}><ChevronLeft size={18} /></button>}
    <div ref={box} className={`sd-strip ${focus ? 'focus' : ''} ${(d.current && drag) || snap ? 'dragging' : ''}`}
      style={focus ? undefined : { ['--ly' as string]: `${Math.round(rise + 20)}px`, height: Math.round(rise + 46) }}
      onPointerDown={(e) => { e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); d.current = { x: e.clientX, moved: 0 } }}
      onPointerMove={(e) => {
        const s = d.current
        if (!s) return
        s.moved += Math.abs(e.clientX - s.x)
        if (focus && s.moved > 4) { const dx = e.clientX - s.x; setDrag((v) => Math.max(-(n - 1 - sel) * gap, Math.min(sel * gap, v + dx))) }
        s.x = e.clientX
      }}
      onPointerUp={(e) => {
        const s = d.current
        d.current = null
        if (!s) return
        const r = box.current!.getBoundingClientRect()
        const i = s.moved > 4 && focus ? at(w / 2) : at(e.clientX - r.left)
        setDrag(0)
        if (i !== sel) onPick(i)
      }}
      onPointerCancel={() => { d.current = null; setDrag(0) }}>
      {focus && <>
        {/* выбранная станция — горизонтально под точкой, как на табло над дверьми в метро */}
        <div className="sd-cur">
          <b>{railOf(stops[sel].name) && <em className={railOf(stops[sel].name)!.kind === 'М' ? 'm' : 'd'}>{railOf(stops[sel].name)!.kind}</em>}{nice(stops[sel].name)}</b>
        </div>
      </>}
      {w > 0 && n > 0 && <>
        {/* как в метро: пройденная часть линии — в цвет ветки, впереди — приглушённая */}
        <i className={`sd-line ${focus ? 'rest' : ''}`} style={{ left: x(0), width: x(n - 1) - x(0), background: focus ? undefined : color }} />
        {focus && <i className="sd-line fill" style={{ left: x(0), width: Math.max(0, x(sel) - x(0)), background: color }} />}
        {stops.map((s, i) => {
          const rail = railOf(s.name)
          return (
            <span key={s.stop_id} className={`sd-stop ${i === sel ? 'on' : ''} ${focus && i > sel ? 'ahead' : ''} ${focus && i === sel + 1 ? 'next' : ''}`} style={{ transform: `translate3d(${x(i)}px,0,0)` }}
              title={`${nice(s.name)} — ≈${fmt(values[i])} пос./ч`}>
              {!focus && <i className="bar" style={{ height: Math.max(2, (values[i] / top) * 16), background: color, width: focus ? 10 : Math.max(3, Math.min(10, gap * 0.55)) }} />}
              <b className="dot" style={{ borderColor: color, ['--c' as string]: color }} />
              {shown(i) && (
                <span className="lb">{rail && <em className={rail.kind === 'М' ? 'm' : 'd'}>{rail.kind}</em>}{labelOf(s.name)}</span>
              )}
            </span>
          )
        })}
      </>}
    </div>
    {focus && <>
      <button className="sd-arr r" disabled={sel >= n - 1} onClick={() => onPick(sel + 1)} title={sel < n - 1 ? nice(stops[sel + 1].name) : 'Конец линии'}><ChevronRight size={18} /></button>
    </>}
    </div>
  )
}

export default function RoutePanel({ route: r, geo, allGeo, list, date, hour, stopId, keys, onClose, onHour, onStop, onRoute }: Props) {
  const { coef } = useApp()
  const on = r.vehicles[hour] > 0
  const lvl = levelOf(r.ratio[hour])
  const color = on ? LEVEL_COLORS[lvl] : '#64748b'
  const levels = r.ratio.map((x, h) => (r.vehicles[h] > 0 ? levelOf(x) : 'low'))
  const wins = problemWindows(r)
  const stops = geo?.stops ?? []
  const idx = stops.findIndex((s) => s.stop_id === stopId)
  const stop = idx >= 0 ? stops[idx] : null
  const terminals = r.name.replace(/^Трамвай \d+: /, '').replace(/\s*=>\s*/, ' → ')
  const perStop = stops.map((s) => r.boardings[hour] * s.weight)

  // перелистывание: в режиме остановки — остановки ветки, в режиме ветки — сами ветки
  const routeIds = list.map((x) => x.route)
  const ri = routeIds.indexOf(r.route)
  const prevStop = idx > 0 ? stops[idx - 1] : null, nextStop = idx >= 0 && idx < stops.length - 1 ? stops[idx + 1] : null
  const prevRoute = ri > 0 ? routeIds[ri - 1] : null, nextRoute = ri >= 0 && ri < routeIds.length - 1 ? routeIds[ri + 1] : null
  const go = (dir: -1 | 1) => {
    if (stop) { const s = dir < 0 ? prevStop : nextStop; if (s) onStop(s.stop_id) }
    else { const q = dir < 0 ? prevRoute : nextRoute; if (q != null) onRoute(q, null) }
  }
  const goRef = useRef(go)
  goRef.current = go
  // ↑ / ↓ — предыдущая / следующая (← → заняты лентой времени)
  useEffect(() => {
    if (!keys) return
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      e.preventDefault()
      goRef.current(e.key === 'ArrowUp' ? -1 : 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [keys])

  // на другой ветке или при переходе ветка ↔ остановка — тело карточки с начала; при листании остановок остаётся на месте
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => { body.current?.scrollTo({ top: 0 }) }, [r.route, stop == null])

  // выпадающий список всех веток — по нажатию на номер ветки в шапке
  const [pick, setPick] = useState(false)
  const pickRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setPick(false) }, [r.route, stop == null])
  useEffect(() => {
    if (!pick) return
    const down = (e: MouseEvent) => { if (!pickRef.current?.contains(e.target as Node)) setPick(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPick(false) } }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', esc, true)
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', esc, true) }
  }, [pick])
  const metro = stops.filter((s) => railOf(s.name)).length

  const xlsx = exportUrl({ format: 'xlsx', horizon: 'day', date, route: r.route, ...(stop ? { stop_id: stop.stop_id } : {}), ...coef })

  // ---------- шапка: ← назад · номер и название ветки (список всех веток) · выгрузка XLSX ----------
  const head = (
    <div className="sd-top">
      <div className="sd-bar">
        <button className="seg-solo" onClick={() => (stop ? onStop(null) : onClose())} title={stop ? 'Ко всей ветке (Esc)' : 'Закрыть (Esc)'}><ArrowLeft size={17} /></button>
        <div className="sd-pickwrap" ref={pickRef}>
          <button className={`sd-back sd-pick ${pick ? 'on' : ''}`} onClick={() => setPick(!pick)} title={`Трамвай №${r.route}: ${terminals} — выбрать другую ветку`}>
            <span className="rnum lg" style={{ background: r.color }}>{r.route}</span><span className="t">{terminals}</span><ChevronDown size={15} className="caret" />
          </button>
          {pick && (
            <div className="sd-drop">
              {list.map((x) => {
                const g = allGeo.find((q) => q.route === x.route)
                const xon = x.vehicles[hour] > 0, xl = levelOf(x.ratio[hour])
                return (
                  <button key={x.route} className={x.route === r.route ? 'on' : ''} onClick={() => { setPick(false); if (x.route !== r.route || stop) onRoute(x.route, null) }}>
                    <span className="rnum lg" style={{ background: g?.color ?? x.color }}>{x.route}</span>
                    <span className="dn"><b>Трамвай №{x.route}</b><span>{x.name.replace(/^Трамвай \d+: /, '').replace(/\s*=>\s*/, ' → ')}</span></span>
                    <span className="ld" style={{ color: xon ? LEVEL_COLORS[xl] : undefined }}>{xon ? `${Math.round(x.ratio[hour] * 100)}%` : '—'}</span>
                    {x.route === r.route ? <Check size={15} className="ck" /> : <i className="ck" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <a className="sd-xlsx" href={xlsx} title={stop ? `Прогноз остановки «${nice(stop.name)}» на день (XLSX)` : `Прогноз трамвая №${r.route} на день (XLSX)`}>
          <FileSpreadsheet size={16} /><span>XLSX</span>
        </a>
      </div>

      {/* остановка: уровнем ниже — соседние станции, кнопки постоянной ширины */}
      {stop && (
        <div className="sd-steps">
          <button disabled={!prevStop} onClick={() => go(-1)} title={prevStop ? `${prevStop.name} · ↑` : undefined}>
            <ChevronLeft size={16} /><span>{prevStop ? nice(prevStop.name) : 'начало линии'}</span>
          </button>
          <button disabled={!nextStop} onClick={() => go(1)} title={nextStop ? `${nextStop.name} · ↓` : undefined}>
            <span>{nextStop ? nice(nextStop.name) : 'конец линии'}</span><ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* у остановки название — на самой ленте, под указателем; у ветки — сводка по линии */}
      {!stop && (
        <div className="sd-title">
          <div className="n">
            <span className="note">{`${stops.length} ${plural(stops.length, 'остановка', 'остановки', 'остановок')}${metro ? ` · ${metro} у метро, МЦК и МЦД` : ''}`}</span>
          </div>
        </div>
      )}

      <StopStrip key={r.route} stops={stops} color={r.color} values={perStop} sel={idx} onPick={(i) => onStop(stops[i].stop_id)} />
    </div>
  )

  // ---------- режим остановки: точный прогноз по выбранной точке ----------
  if (stop) {
    const vals = r.boardings.map((b) => b * stop.weight)
    const rank = [...stops].sort((a, b) => b.weight - a.weight).findIndex((s) => s.stop_id === stop.stop_id) + 1
    const peak = vals.reduce((best, v, h) => (v > vals[best] ? h : best), 0)
    const transfers = allGeo.filter((g) => g.route !== r.route && g.route !== 5)
      .map((g) => ({ g, s: g.stops.reduce<Stop | null>((best, s) => (dist(s, stop) < 250 && (!best || dist(s, stop) < dist(best, stop)) ? s : best), null) }))
      .filter((x): x is { g: RouteGeo; s: Stop } => x.s != null)
    // метро, МЦК и МЦД рядом — по названиям остановок всех веток в радиусе ~400 м
    const rails = new Map<string, { kind: string; name: string; m: number }>()
    for (const g of allGeo) for (const s of g.stops) {
      const rl = railOf(s.name), m = dist(s, stop)
      if (!rl || m > 400) continue
      const key = `${rl.kind}|${rl.name.toLowerCase()}`
      if (!rails.has(key) || rails.get(key)!.m > m) rails.set(key, { ...rl, m })
    }
    const railList = [...rails.values()].sort((a, b) => a.m - b.m)
    return (
      <div className="ops-side sd">
        {head}
        <div className="sd-body" ref={body}>
          <div className="hero" style={{ borderColor: `${color}66`, background: `${color}14` }}>
            <div className="big"><b>≈{fmt(vals[hour])}</b><span>посадок в {span({ from: hour, to: hour })}</span></div>
            <div className="note">
              {(stop.weight * 100).toFixed(1)}% потока маршрута. {on
                ? <>Вагоны №{r.route} в этот час загружены на <b style={{ color }}>{Math.round(r.ratio[hour] * 100)}%</b> ({LEVEL_TITLE[lvl]}).</>
                : <>Маршрут в этот час не работает.</>}
            </div>
          </div>

          <div className="facts">
            <div><b>≈{fmt(r.day_total * stop.weight)}</b><span>посадок за сутки</span></div>
            <div><b>{hh(peak)}</b><span>пик, ≈{fmt(vals[peak])}/ч</span></div>
            <div><b>{rank}-я</b><span>из {stops.length} по посадкам</span></div>
          </div>

          <div>
            <h4>По часам на остановке</h4>
            <DayBars values={vals} levels={levels} hour={hour} onHour={onHour} unit="пос." />
          </div>

          {(railList.length > 0 || transfers.length > 0) && (
            <div>
              <h4>Пересадки рядом</h4>
              <div className="sd-list">
                {railList.map((m) => (
                  <div key={`${m.kind}|${m.name}`} className="toprow static">
                    <RailMark kind={m.kind} />
                    <span>{m.kind === 'М' ? 'Метро' : m.kind} «{m.name}»</span>
                    <span className="num">{meters(m.m)}</span>
                  </div>
                ))}
                {transfers.map(({ g, s }) => (
                  <div key={g.route} className="toprow" onClick={() => onRoute(g.route, s.stop_id)} title={`Открыть эту остановку на трамвае №${g.route}`}>
                    <span className="rnum" style={{ background: g.color }}>{g.route}</span>
                    <span>{nice(s.name)}</span>
                    <span className="num">{meters(dist(s, stop))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="note">Оценка: поток маршрута × доля остановки (по OpenStreetMap; пересадочные узлы и конечные весят больше).</div>
        </div>
      </div>
    )
  }

  // ---------- режим ветки: общая информация ----------
  const cur = wins.find((w) => hour >= w.from && hour <= w.to)
  const next = wins.find((w) => w.from > hour)
  const top = [...stops].sort((a, b) => b.weight - a.weight).slice(0, 5)
  return (
    <div className="ops-side sd">
      {head}
      <div className="sd-body" ref={body}>
        <div className="hero" style={{ borderColor: `${color}66`, background: `${color}14` }}>
          <div className="big"><b style={{ color }}>{on ? `${Math.round(r.ratio[hour] * 100)}%` : '—'}</b>
            <span>{on ? LEVEL_TITLE[lvl] : 'нет выпуска'} в {hh(hour)}</span></div>
          <div className="say">
            {cur ? <>Добавить <b>+{cur.extra} ваг.</b> на {span(cur)}{on && <> ({fmt(r.vehicles[hour])} → {fmt(r.vehicles[hour] + r.extra[hour])})</>}</>
              : next ? <>Сейчас в норме. Перегрузка ожидается {span(next)}, нужно <b>+{next.extra} ваг.</b></>
                : <>За день перегрузок не ожидается.</>}
          </div>
        </div>

        <div className="facts">
          <div><b>{fmt(r.day_total)}</b><span>посадок за сутки</span></div>
          <div><b>{r.peak_hour != null ? hh(r.peak_hour) : '—'}</b><span>час пик</span></div>
          <div><b>{fmt(r.boardings[hour])}</b><span>посадок в этот час</span></div>
        </div>

        <div>
          <h4>Сутки</h4>
          <DayBars values={r.boardings} levels={levels} hour={hour} onHour={onHour} unit="посадок" />
          {wins.length > 0 && (
            <div className="chips" style={{ marginTop: 6 }}>
              {wins.map((w) => (
                <button key={w.from} className={`winchip ${levelOf(w.max)}`} onClick={() => onHour(w.from)}>{span(w)} · +{w.extra} ваг.</button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4>Больше всего садятся в {hh(hour)}</h4>
          <div className="sd-list">
            {top.map((s) => {
              const rl = railOf(s.name)
              return (
                <div key={s.stop_id} className="toprow" onClick={() => onStop(s.stop_id)}>
                  {rl ? <RailMark kind={rl.kind} /> : <span className="stopdot sm" style={{ borderColor: r.color }} />}
                  <span>{nice(s.name)}</span>
                  <span className="num">≈{fmt(r.boardings[hour] * s.weight)}/ч</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="hint"><MousePointerClick size={16} /> Нажмите на остановку на ленте выше или на схеме — покажем прогноз именно по ней</div>
      </div>
    </div>
  )
}
