import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowDown, ArrowLeftRight, Banknote, ChartPie, ChevronRight, Clock, FileSpreadsheet, Info, ListOrdered, ShieldCheck, TrendingUp, TriangleAlert, Users, X } from 'lucide-react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { exportUrl, fmt, LEVEL_COLORS, LEVEL_TITLE, levelOf, problemWindows, SOFT, softExtra, type DayRoute, type Depot, type RouteGeo, type Stop } from '../api'
import { axis, tooltipStyle, useApp } from '../components'
import Fleet, { TramSide } from './Fleet'
import { hspan, Stat } from './Glyphs'
import FleetStrip from './FleetStrip'

type Props = {
  route: DayRoute; geo?: RouteGeo; allGeo: RouteGeo[]; list: DayRoute[]; depots?: Record<string, Depot> | null
  date: string; hour: number; stopId: string | null
  timeRef: RefObject<number> // минута ленты времени: оплаты с 00:00 растут вместе с ползунком
  payCats?: { key: string; title: string }[] | null
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

const p2 = (n: number) => String(n).padStart(2, '0')
const hm = (m: number) => `${p2(Math.floor(m / 60))}:${p2(Math.floor(m % 60))}`
const ddmm = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`

/** Минута ленты времени: читаем ref каждый кадр и перерисовываем только того, кто её показывает (не всю карточку). */
function useMinute(timeRef: RefObject<number>) {
  const [m, setM] = useState(() => Math.floor(timeRef.current ?? 0))
  useEffect(() => {
    let raf = 0
    const tick = () => { const v = Math.floor(timeRef.current ?? 0); setM((p) => (p === v ? p : v)); raf = requestAnimationFrame(tick) }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [timeRef])
  return m
}
/** Накоплено с 00:00 до минуты: целые часы + доля текущего часа. */
const cumAt = (vals: number[], minute: number) => {
  const m = Math.max(0, Math.min(24 * 60, minute)), h = Math.floor(m / 60)
  let s = 0
  for (let i = 0; i < h; i++) s += vals[i]
  return h < 24 ? s + vals[h] * (m % 60) / 60 : s
}
function LiveSum({ vals, timeRef, approx }: { vals: number[]; timeRef: RefObject<number>; approx?: boolean }) {
  const m = useMinute(timeRef)
  return <>{approx ? '≈' : ''}{fmt(Math.round(cumAt(vals, m)))}</>
}

/** Раскрытая плитка: строка на всю ширину под плитками — заголовок и «название — значение». */
function Detail({ title, sub, rows, foot }: { title: ReactNode; sub?: ReactNode; rows: { k: string; v: ReactNode; share?: number; color?: string }[]; foot?: ReactNode }) {
  return (
    <div className="tdet">
      <div className="td-h"><b>{title}</b>{sub && <span>{sub}</span>}</div>
      {rows.map((r) => (
        <div key={r.k} className="td-r">
          <span className="td-k">{r.k}</span>
          <b className="td-v" style={r.color ? { color: r.color } : undefined}>{r.v}</b>
          {r.share != null && <i className="td-bar"><i style={{ width: `${Math.round(r.share * 100)}%` }} /></i>}
        </div>
      ))}
      {foot}
    </div>
  )
}

/** Успешные оплаты с 00:00 до минуты ленты — по типам оплаты (доли из истории по маршруту и часу). */
function PayDetail({ vals, mix, cats, date, timeRef, where }: {
  vals: number[]; mix?: number[][] | null; cats?: { key: string; title: string }[] | null; date: string; timeRef: RefObject<number>; where?: string
}) {
  const m = useMinute(timeRef)
  const total = Math.round(cumAt(vals, m))
  const rows: { k: string; v: ReactNode; share?: number }[] = []
  if (mix && cats?.length) {
    const raw = cats.map((_, k) => cumAt(vals.map((v, h) => v * (mix[h]?.[k] ?? 0)), m))
    // округляем так, чтобы сумма по типам совпала с итогом
    const n = raw.map(Math.floor)
    let rest = total - n.reduce((a, b) => a + b, 0)
    for (const k of raw.map((v, k) => [v - Math.floor(v), k]).sort((a, b) => b[0] - a[0]).map(([, k]) => k)) { if (rest <= 0) break; n[k]++; rest-- }
    cats.forEach((c, k) => rows.push({ k: c.title, v: fmt(n[k]), share: total ? n[k] / total : 0 }))
  }
  rows.push({ k: 'Всего', v: fmt(total) })
  return <Detail title={`Успешные оплаты${where ? ` ${where}` : ''} за ${ddmm(date)}`} sub={`00:00–${hm(m)}`} rows={rows}
    foot={<p className="td-note" title="Наличных в трамвае нет: оплата картой «Тройка», банковской картой, проездным, льготной картой или билетом. Доли — по валидациям последних 4 недель этого маршрута в этот час">
      <Info size={12} />наличных в валидациях нет — только карты и билеты</p>} />
}

const GAP = 54 // шаг между остановками на ленте, px — диагональные подписи в 2–3 строки не наезжают

/** Лента остановок — как табло над дверьми в метро: выбранная станция по центру и подписана снизу, пройденная часть линии
 *  в цвете ветки, следующая станция мигает. Листается перетаскиванием, колесом и кликом; края затухают — там ещё станции. */
function StopStrip({ stops, color, sel, onPick }: { stops: Stop[]; color: string; sel: number; onPick: (i: number) => void }) {
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
  const x = (i: number) => w / 2 + (i - sel) * GAP + drag
  const at = (px: number) => Math.max(0, Math.min(n - 1, Math.round(sel + (px - w / 2 - drag) / GAP)))
  // затухание только с той стороны, где за краем ещё есть станции
  const moreL = x(0) < 0, moreR = x(n - 1) > w

  // колесо/тачпад над лентой — листаем остановки по одной
  const acc = useRef(0)
  const pick = useRef(onPick)
  pick.current = onPick
  useEffect(() => {
    const el = box.current!
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      acc.current += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (Math.abs(acc.current) < 50) return
      const next = Math.max(0, Math.min(n - 1, sel + Math.sign(acc.current)))
      acc.current = 0
      if (next !== sel) pick.current(next)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [sel, n])

  const cur = railOf(stops[sel].name)
  return (
    <div ref={box} className={`sd-strip focus ${moreL ? 'more-l' : ''} ${moreR ? 'more-r' : ''} ${d.current && drag ? 'dragging' : ''}`}
      onPointerDown={(e) => { e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); d.current = { x: e.clientX, moved: 0 } }}
      onPointerMove={(e) => {
        const s = d.current
        if (!s) return
        s.moved += Math.abs(e.clientX - s.x)
        if (s.moved > 4) { const dx = e.clientX - s.x; setDrag((v) => Math.max(-(n - 1 - sel) * GAP, Math.min(sel * GAP, v + dx))) }
        s.x = e.clientX
      }}
      onPointerUp={(e) => {
        const s = d.current
        d.current = null
        if (!s) return
        const r = box.current!.getBoundingClientRect()
        const i = s.moved > 4 ? at(w / 2) : at(e.clientX - r.left)
        setDrag(0)
        if (i !== sel) onPick(i)
      }}
      onPointerCancel={() => { d.current = null; setDrag(0) }}>
      {/* выбранная станция — горизонтально под точкой */}
      <div className="sd-down"><ArrowDown size={13} strokeWidth={2.5} /></div>
      <div className="sd-cur">
        <b key={sel}>{cur && <em className={cur.kind === 'М' ? 'm' : 'd'}>{cur.kind}</em>}{nice(stops[sel].name)}</b>
      </div>
      {w > 0 && n > 0 && <>
        {/* пройденная часть линии — в цвет ветки, впереди — приглушённая */}
        <i className="sd-line rest" style={{ left: x(0), width: x(n - 1) - x(0) }} />
        <i className="sd-line fill" style={{ left: x(0), width: Math.max(0, x(sel) - x(0)), background: color }} />
        {stops.map((s, i) => {
          const rail = railOf(s.name)
          return (
            <span key={s.stop_id} className={`sd-stop ${i === sel ? 'on' : ''} ${i > sel ? 'ahead' : ''} ${i === sel + 1 ? 'next' : ''}`}
              style={{ transform: `translate3d(${x(i)}px,0,0)` }} title={nice(s.name)}>
              <b className="dot" style={{ borderColor: color, ['--c' as string]: color }} />
              {<span className="lb">{rail && <em className={rail.kind === 'М' ? 'm' : 'd'}>{rail.kind}</em>}{rail ? rail.name : nice(s.name)}</span>}
            </span>
          )
        })}
      </>}
    </div>
  )
}

export default function RoutePanel({ route: r, geo, allGeo, list, depots, date, hour, stopId, timeRef, payCats, keys, onClose, onHour, onStop, onRoute }: Props) {
  const [tile, setTile] = useState<'now' | 'pay' | 'peak' | null>(null)
  const tap = (k: 'now' | 'pay' | 'peak') => () => setTile((t) => (t === k ? null : k))
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
  const [termA, termB] = r.name.replace(/^Трамвай \d+: /, '').split(/\s*=>\s*/)

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

  const xlsx = exportUrl({ format: 'xlsx', horizon: 'day', date, route: r.route, ...(stop ? { stop_id: stop.stop_id } : {}), ...coef })

  // ---------- шапка: номер и название ветки · закрыть ----------
  const head = (
    <div className="sd-top">
      <div className="sd-bar">
        <span className="sd-id" title={`Трамвай №${r.route}: ${terminals}`}>
          <span className="rnum lg" style={{ background: r.color }}>{r.route}</span>
          <span className="sd-name"><span className="t">{nice(termA)}{termB && '\u00a0—'}</span>{termB && <> <span className="t">{nice(termB)}</span></>}</span>
        </span>
        <button className="sd-close" onClick={() => (stop ? onStop(null) : onClose())} title={stop ? 'Ко всей ветке (Esc)' : 'Закрыть (Esc)'}
          aria-label={stop ? 'Ко всей ветке' : 'Закрыть'}><X size={20} /></button>
      </div>

      {/* у остановки название — на самой ленте, под указателем; у ветки — сводка по линии */}

      {stop && <StopStrip key={r.route} stops={stops} color={r.color} sel={idx} onPick={(i) => onStop(stops[i].stop_id)} />}
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
          <div className="facts-box" data-tab={tile === 'pay' ? 0 : undefined}>
          <div className="facts glyph-facts">
            <Stat big icon={Banknote} v={<LiveSum vals={vals} timeRef={timeRef} approx />} on={tile === 'pay'} onClick={tap('pay')}
              tip="Успешных оплат на остановке с 00:00 до времени на ленте (прогноз; одна успешная валидация = одна посадка) — нажмите, чтобы раскрыть" />
            <Stat big icon={TrendingUp} v={hh(peak)} tip={`Пик на остановке: ≈${fmt(vals[peak])} посадок в час`} />
            <Stat big icon={ListOrdered} v={`${rank}/${stops.length}`} tip={`${rank}-я из ${stops.length} остановок по посадкам`} />
          </div>
          {tile === 'pay' && <PayDetail vals={vals} mix={r.pay_mix} cats={payCats} date={date} timeRef={timeRef} where="на остановке" />}
          </div>

          <div className="hero" style={{ borderColor: `${color}66`, background: `${color}14` }}>
            <div className="big">
              <span className="bigv" title={`≈${fmt(vals[hour])} посадок на остановке в ${span({ from: hour, to: hour })}`}><Users size={22} /><b>≈{fmt(vals[hour])}</b></span>
              <Stat icon={Clock} v={hh(hour)} tip="Выбранный час" />
              <span className="hero-info" title="Оценка: поток маршрута × доля остановки (по OpenStreetMap; пересадочные узлы и конечные весят больше)"><Info size={15} /></span>
            </div>
            <div className="glyphs">
              <Stat icon={ChartPie} v={`${(stop.weight * 100).toFixed(1)}%`} tip="Доля остановки в потоке маршрута" />
              {on
                ? <span className="stat" title={`Вагоны №${r.route} в ${hh(hour)}: ${Math.round(r.ratio[hour] * 100)}% норматива — ${LEVEL_TITLE[lvl]}`}>
                    <TramSide size={14} /><b style={{ color }}>{Math.round(r.ratio[hour] * 100)}%</b></span>
                : <span className="stat off" title="Маршрут в этот час не работает"><TramSide size={14} /><b>—</b></span>}
            </div>
            <FleetStrip vehicles={r.vehicles[hour]} ratio={r.ratio[hour]} extra={0} />
          </div>

          <DayBars values={vals} levels={levels} hour={hour} onHour={onHour} unit="пос." />

          {(railList.length > 0 || transfers.length > 0) && (
            <div>
              <h4 className="ih" title="Пересадки рядом: метро, МЦК, МЦД и другие трамваи"><ArrowLeftRight size={15} /></h4>
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

          <a className="sd-xlsx wide" href={xlsx} title={stop ? `Прогноз остановки «${nice(stop.name)}» на день (XLSX)` : `Прогноз трамвая №${r.route} на день (XLSX)`}>
          <FileSpreadsheet size={16} /><span>XLSX</span>
          </a>
        </div>
      </div>
    )
  }

  // ---------- режим ветки: общая информация ----------
  const cur = wins.find((w) => hour >= w.from && hour <= w.to)
  const next = wins.find((w) => w.from > hour)
  // схема переброски — за час до перегрузки и пока она идёт
  const hardWin = cur ?? (next && next.from - hour <= 1 ? next : null)
  // выше 80%, но в нормативе — тоже предлагаем свободные вагоны (за час до и пока держится), до первого часа перегрузки
  let softWin: { from: number; to: number; extra: number } | null = null
  if (!hardWin) {
    const sws = problemWindows(r, SOFT)
    const sw = sws.find((w) => hour >= w.from && hour <= w.to) ?? sws.find((w) => w.from > hour && w.from - hour <= 1)
    if (sw) {
      const to = next && next.from <= sw.to ? next.from - 1 : sw.to
      const hrs = Array.from({ length: to - sw.from + 1 }, (_, i) => sw.from + i)
      const extra = Math.max(0, ...hrs.map((h) => softExtra(r, h)))
      if (to >= sw.from && to >= hour && extra > 0) softWin = { from: sw.from, to, extra }
    }
  }
  const planWin = hardWin ?? softWin
  const peak = r.peak_hour
  const top = [...stops].sort((a, b) => b.weight - a.weight).slice(0, 5)
  return (
    <div className="ops-side sd">
      {head}
      <div className="sd-body" ref={body}>
        {/* плитки и раскрытая подробность — одна карточка */}
        <div className="facts-box" data-tab={tile ? { now: 0, pay: 1, peak: 2 }[tile] : undefined}>
        <div className="facts glyph-facts">
          <Stat big icon={Users} v={fmt(r.boardings[hour])} on={tile === 'now'} onClick={tap('now')} tip={`Посадок в ${hh(hour)} — нажмите, чтобы раскрыть`} />
          <Stat big icon={Banknote} v={<LiveSum vals={r.boardings} timeRef={timeRef} />} on={tile === 'pay'} onClick={tap('pay')}
            tip="Успешных оплат с 00:00 до времени на ленте (прогноз; одна успешная валидация = одна посадка) — нажмите, чтобы раскрыть" />
          <Stat big icon={TrendingUp} v={peak != null ? hh(peak) : '—'} on={tile === 'peak'} onClick={tap('peak')} tip="Час пик — нажмите, чтобы раскрыть" />
        </div>
        {tile === 'now' && (
          <Detail title={`Пассажиры в ${hh(hour)}–${hh((hour + 1) % 24)}`} rows={[
            { k: 'Посадок за час', v: fmt(r.boardings[hour]) },
            { k: 'Вагонов на линии', v: on ? Math.floor(r.vehicles[hour]) : '—' },
            { k: 'На вагон', v: on ? `${fmt(r.boardings[hour] / Math.floor(r.vehicles[hour] || 1))} из ${fmt(r.norm)}` : '—' },
            { k: 'Загрузка', v: on ? `${Math.round(r.ratio[hour] * 100)}%` : '—', color: on ? color : undefined },
            ...(hour < 23 ? [{ k: `Следующий час, ${hh(hour + 1)}`, v: `${fmt(r.boardings[hour + 1])} (${r.boardings[hour] ? `${r.boardings[hour + 1] >= r.boardings[hour] ? '+' : ''}${Math.round((r.boardings[hour + 1] / r.boardings[hour] - 1) * 100)}%` : '—'})` }] : []),
          ]} />
        )}
        {tile === 'pay' && <PayDetail vals={r.boardings} mix={r.pay_mix} cats={payCats} date={date} timeRef={timeRef} />}
        {tile === 'peak' && peak != null && (
          <Detail title={`Час пик ${hh(peak)}–${hh((peak + 1) % 24)}`} rows={[
            { k: 'Посадок в пик', v: fmt(r.boardings[peak]) },
            { k: 'Доля суток', v: `${Math.round(r.boardings[peak] / (r.day_total || 1) * 100)}%` },
            { k: 'Вагонов в пик', v: r.vehicles[peak] > 0 ? Math.floor(r.vehicles[peak]) : '—' },
            { k: 'Загрузка в пик', v: r.vehicles[peak] > 0 ? `${Math.round(r.ratio[peak] * 100)}%` : '—', color: r.vehicles[peak] > 0 ? LEVEL_COLORS[levelOf(r.ratio[peak])] : undefined },
          ]} foot={peak !== hour && <button className="td-go" onClick={() => onHour(peak)}>К {hh(peak)}<ChevronRight size={14} /></button>} />
        )}
        </div>

        <div className="hero" style={{ borderColor: `${color}66`, background: `${color}14` }}>
          <div className="big">
            <b style={{ color }} title={on ? `${Math.round(r.ratio[hour] * 100)}% норматива посадок на вагон — ${LEVEL_TITLE[lvl]}` : 'В этот час вагонов на линии нет'}>
              {on ? `${Math.round(r.ratio[hour] * 100)}%` : '—'}</b>
            <Stat icon={Clock} v={hh(hour)} tip="Выбранный час" />
          </div>
          <FleetStrip vehicles={r.vehicles[hour]} ratio={r.ratio[hour]} extra={on ? (cur ? r.extra[hour] : planWin?.extra ?? 0) : 0} />
          <div className="hero-row">
            {cur ? <span className={`wchip ${levelOf(cur.max)}`} title={`Перегрузка ${span(cur)}: нужно +${cur.extra} ваг.`}><TriangleAlert size={14} />{hspan(cur)}</span>
              : next ? <span className={`wchip ${levelOf(next.max)}`} title={`Сейчас в норме. Перегрузка ожидается ${span(next)}, нужно +${next.extra} ваг.${next.from - hour > 1 ? ` Схема, откуда взять вагоны, появится в ${hh(next.from - 1)}.` : ''}`}><TrendingUp size={14} />{hspan(next)}</span>
                : <span className="wchip ok" title="За день перегрузок не ожидается"><ShieldCheck size={14} />24 ч</span>}
          </div>
          <Fleet r={r} list={list} depots={depots} win={planWin} hour={hour} soft={!hardWin && softWin != null} />
        </div>

        <div>
          <DayBars values={r.boardings} levels={levels} hour={hour} onHour={onHour} unit="посадок" />
          {wins.length > 0 && (
            <div className="chips" style={{ marginTop: 6 }}>
              {wins.map((w) => (
                <button key={w.from} className={`winchip ${levelOf(w.max)}`} onClick={() => onHour(w.from)}
                  title={`Перегрузка ${span(w)}: нужно +${w.extra} ваг.`}>
                  <TriangleAlert size={12} />{hspan(w)}<b>+{w.extra}</b><TramSide size={12} /></button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h4 className="ih" title={`Больше всего садятся в ${hh(hour)}`}><Users size={15} />{hh(hour)}</h4>
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

        <a className="sd-xlsx wide" href={xlsx} title={`Прогноз трамвая №${r.route} на день (XLSX)`}>
          <FileSpreadsheet size={16} /><span>XLSX</span>
        </a>
      </div>
    </div>
  )
}
