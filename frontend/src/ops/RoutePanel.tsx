import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowLeft, ArrowDownWideNarrow, ArrowLeftRight, RussianRuble, ChevronRight, Clock, EllipsisVertical, FileSpreadsheet, ListOrdered, Search, ShieldCheck, TrendingUp, TriangleAlert, User, Users, X } from 'lucide-react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { exportUrl, fmt, LEVEL_COLORS, LEVEL_TITLE, levelOf, problemWindows, TH, softExtra, freeWindow, type DayRoute, type Depot, type RouteGeo, type Stop } from '../api'
import { axis, tooltipStyle, useApp } from '../components'
import Fleet, { FleetCalm, FreeFleet, TramSide } from './Fleet'
import { hspan, Stat } from './Glyphs'
import FleetStrip from './FleetStrip'

type Props = {
  route: DayRoute; geo?: RouteGeo; allGeo: RouteGeo[]; list: DayRoute[]; depots?: Record<string, Depot> | null
  date: string; hour: number; stopId: string | null
  timeRef: RefObject<number> // минута ленты времени: оплаты с 00:00 растут вместе с ползунком
  payCats?: { key: string; title: string }[] | null
  keys: boolean // ↑/↓ листают, пока поверх карты ничего не открыто
  lr?: boolean // ← → тоже листают остановки (фокус на остановках, а не на ленте времени)
  onClose: () => void; onHour: (h: number) => void; onStop: (id: string | null) => void
  onRoute: (route: number, stopId: string | null) => void
}
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
const span = (w: { from: number; to: number }) => `${hh(w.from)}–${String(w.to + 1).padStart(2, '0')}:00`

// расстояние в метрах (для поиска пересадок на соседние маршруты и метро)
const dist = (a: Stop, b: Stop) => Math.hypot((a.lon - b.lon) * 62_600, (a.lat - b.lat) * 111_200)
// в данных кавычки вперемешку: «Метро "ВДНХ"» и «Метро «ВДНХ»» — показываем единообразно ёлочками
const nice = (s: string) => s.replace(/"([^"]*)"/g, '«$1»')
const meters = (m: number) => (m < 60 ? 'здесь' : `${Math.round(m / 10) * 10} м`)

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
function LiveSum({ vals, timeRef }: { vals: number[]; timeRef: RefObject<number> }) {
  const m = useMinute(timeRef)
  return <>{fmt(Math.round(cumAt(vals, m)))}</>
}

/** Раскрытая плитка: строка на всю ширину под плитками — заголовок и «название — значение». */
function Detail({ title, sub, lead, rows, foot, plain }: {
  plain?: boolean // без разделителей между строками
  title?: ReactNode; sub?: ReactNode; lead?: ReactNode; rows: { k: string; v: ReactNode; share?: number; color?: string }[]; foot?: ReactNode
}) {
  return (
    <div className={`tdet ${plain ? 'plain' : ''}`}>
      {title != null && <div className="td-h"><b>{title}</b>{sub && <span>{sub}</span>}</div>}
      {lead}
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
  return <Detail plain title={`Успешные оплаты${where ? ` ${where}` : ''} за ${ddmm(date)}`} sub={`00:00–${hm(m)}`} rows={rows} />
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

export default function RoutePanel({ route: r, geo, allGeo, list, depots, date, hour, stopId, timeRef, payCats, keys, lr = false, onClose, onHour, onStop, onRoute }: Props) {
  const [tile, setTile] = useState<'now' | 'pay' | 'veh' | null>(null)
  const tap = (k: 'now' | 'pay' | 'veh') => () => setTile((t) => (t === k ? null : k))
  // раздел «Станции» в карточке ветки: поиск и сортировка по пассажирам
  const [q, setQ] = useState('')
  const [byLoad, setByLoad] = useState(false)
  // меню «⋮» в шапке: закрывается кликом мимо, Esc (раньше, чем Esc закроет саму карточку) и при смене ветки / остановки
  const [more, setMore] = useState(false)
  useEffect(() => { setMore(false) }, [r.route, stopId])
  useEffect(() => {
    if (!more) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setMore(false) } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [more])
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
  // ↑ / ↓ — предыдущая / следующая; ← → — тоже, когда фокус на остановках (иначе ← → листают ленту времени)
  useEffect(() => {
    if (!keys) return
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const back = e.key === 'ArrowUp' || (lr && e.key === 'ArrowLeft')
      const fwd = e.key === 'ArrowDown' || (lr && e.key === 'ArrowRight')
      if (!back && !fwd) return
      e.preventDefault()
      goRef.current(back ? -1 : 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [keys, lr])

  // на другой ветке или при переходе ветка ↔ остановка — тело карточки с начала; при листании остановок остаётся на месте
  const body = useRef<HTMLDivElement>(null)
  // разделитель под закреплённой шапкой — только когда содержимое уехало под неё
  const [scrolled, setScrolled] = useState(false)
  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => setScrolled(e.currentTarget.scrollTop > 0)
  useEffect(() => { body.current?.scrollTo({ top: 0 }) }, [r.route, stop == null])

  const xlsx = exportUrl({ format: 'xlsx', horizon: 'day', date, route: r.route, ...(stop ? { stop_id: stop.stop_id } : {}), ...coef })

  // ---------- шапка: закрыть (у остановки — назад к ветке) · номер и название ветки · меню «⋮» ----------
  const head = (
    <div className="sd-top">
      <div className="sd-bar">
        <button className="sd-close" onClick={() => (stop ? onStop(null) : onClose())} title={stop ? `К ветке №${r.route} (Esc)` : 'Закрыть (Esc)'}
          aria-label={stop ? `К ветке №${r.route}` : 'Закрыть'}>{stop ? <ArrowLeft size={20} /> : <X size={20} />}</button>
        <span className="sd-id" title={stop ? `${nice(stop.name)} — трамвай №${r.route}: ${terminals}` : `Трамвай №${r.route}: ${terminals}`}>
          <span className="rnum lg" style={{ background: r.color }}>{r.route}</span>
          {stop
            ? <span className="sd-name"><span className="t">Остановка «{nice(stop.name)}»</span></span>
            : <span className="sd-name"><span className="t">{nice(termA)}{termB && '\u00a0—'}</span>{termB && <> <span className="t">{nice(termB)}</span></>}</span>}
        </span>
        <div className="sd-more">
          <button className={`sd-close ${more ? 'on' : ''}`} onClick={() => setMore(!more)} title="Ещё" aria-label="Ещё" aria-haspopup="menu" aria-expanded={more}>
            <EllipsisVertical size={20} /></button>
          {more && <>
            <div className="sd-more-back" onClick={() => setMore(false)} />
            <div className="sd-menu" role="menu">
              <a role="menuitem" href={xlsx} onClick={() => setMore(false)}>
                <FileSpreadsheet size={17} />
                <span><b>Выгрузить XLSX</b><em>{stop ? `Остановка «${nice(stop.name)}»` : `Трамвай №${r.route}`} · прогноз на {ddmm(date)}</em></span>
              </a>
            </div>
          </>}
        </div>
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
      <div className={`ops-side sd ${scrolled ? 'scrolled' : ''}`}>
        {head}
        <div className="sd-body" ref={body} onScroll={onBodyScroll}>
          {/* три главных параметра остановки — каждый раскрывается, как в карточке ветки */}
          <div className="facts-box" data-tab={tile ? { now: 0, pay: 1, veh: 2 }[tile] : undefined}>
          <div className="facts glyph-facts">
            <Stat big icon={Users} v={fmt(vals[hour])} on={tile === 'now'} onClick={tap('now')}
              tip={`${fmt(vals[hour])} посадок на остановке в ${hh(hour)} — нажмите, чтобы раскрыть`} />
            <Stat big icon={RussianRuble} v={<LiveSum vals={vals} timeRef={timeRef} />} on={tile === 'pay'} onClick={tap('pay')}
              tip="Успешных оплат на остановке с 00:00 до времени на ленте (прогноз; одна успешная валидация = одна посадка) — нажмите, чтобы раскрыть" />
            <Stat big icon={TrendingUp} v={hh(peak)} on={tile === 'veh'} onClick={tap('veh')}
              tip={`Час пик на остановке: ${fmt(vals[peak])} посадок — нажмите, чтобы раскрыть`} />
          </div>
          {tile === 'now' && (
            <Detail title={`Пассажиры в ${hh(hour)}–${hh((hour + 1) % 24)}`} rows={[
              { k: 'Посадок на остановке', v: fmt(vals[hour]) },
              { k: 'Доля в потоке маршрута', v: `${(stop.weight * 100).toFixed(1)}%` },
              { k: 'Место по посадкам', v: `${rank} из ${stops.length}` },
              { k: 'За сутки', v: fmt(r.day_total * stop.weight) },
              ...(hour < 23 ? [{ k: `Следующий час, ${hh(hour + 1)}`, v: `${fmt(vals[hour + 1])}${vals[hour] ? ` (${vals[hour + 1] >= vals[hour] ? '+' : ''}${Math.round((vals[hour + 1] / vals[hour] - 1) * 100)}%)` : ''}` }] : []),
            ]} />
          )}
          {tile === 'pay' && <PayDetail vals={vals} mix={r.pay_mix} cats={payCats} date={date} timeRef={timeRef} where="на остановке" />}
          {tile === 'veh' && (() => {
            // утренний и вечерний пик на остановке, самые загруженные часы
            const pk = (from: number, to: number) => { let b = from; for (let h = from; h < to; h++) if (vals[h] > vals[b]) b = h; return b }
            const am = pk(5, 12), pm = pk(12, 24)
            const top = vals.map((v, h) => [v, h]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, h]) => hh(h)).join(', ')
            return (
              <Detail title={`Час пик ${hh(peak)}–${hh((peak + 1) % 24)}`} rows={[
                { k: 'Посадок в пик', v: fmt(vals[peak]) },
                { k: 'Доля суток', v: `${Math.round(vals[peak] / (vals.reduce((a, b) => a + b, 0) || 1) * 100)}%` },
                { k: 'Утренний пик', v: `${hh(am)} · ${fmt(vals[am])}` },
                { k: 'Вечерний пик', v: `${hh(pm)} · ${fmt(vals[pm])}` },
                { k: 'Самые загруженные часы', v: top },
              ]} foot={peak !== hour && <button className="td-go" onClick={() => onHour(peak)}>К {hh(peak)}<ChevronRight size={14} /></button>} />
            )
          })()}
          </div>

          <DayBars values={vals} levels={levels} hour={hour} onHour={onHour} unit="пос." />

          {(railList.length > 0 || transfers.length > 0) && (
            <div>
              <h4 className="ih sec-title" title="Пересадки рядом: метро, МЦК и МЦД в радиусе ~400 м, другие трамваи — в ~250 м"><ArrowLeftRight size={15} />Пересадки</h4>
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
        </div>
      </div>
    )
  }

  // ---------- режим ветки: общая информация ----------
  const cur = wins.find((w) => hour >= w.from && hour <= w.to)
  const next = wins.find((w) => w.from > hour)
  // блок переброски виден всегда: сначала то, что актуально сейчас (перегрузка / выше 80% — сейчас или через час, иначе можно снять),
  // затем ближайшее впереди по суткам; если ничего — спокойная карточка
  const sws = problemWindows(r, TH.soft)
  const trimSoft = (sw: { from: number; to: number }) => {
    const to = next && next.from <= sw.to ? next.from - 1 : sw.to // выше 80% — только до первого часа перегрузки
    if (to < sw.from) return null
    const extra = Math.max(0, ...Array.from({ length: to - sw.from + 1 }, (_, i) => softExtra(r, sw.from + i)))
    return extra > 0 ? { from: sw.from, to, extra } : null
  }
  let hardWin = cur ?? (next && next.from - hour <= 1 ? next : null)
  let softWin: { from: number; to: number; extra: number } | null = null
  if (!hardWin) {
    const sw = sws.find((w) => hour >= w.from && hour <= w.to) ?? sws.find((w) => w.from > hour && w.from - hour <= 1)
    const t = sw && trimSoft(sw)
    if (t && t.to >= hour) softWin = t
  }
  // загрузка ниже 50% — можно освободить линию: снять вагоны туда, где их не хватает, или в парк
  const freeWin = hardWin || softWin ? null : freeWindow(r, hour)
  if (!hardWin && !softWin && !freeWin) {
    const ns = sws.filter((w) => w.from > hour).map(trimSoft).find((w) => w != null) ?? null
    if (next && (!ns || next.from <= ns.from)) hardWin = next
    else softWin = ns
  }
  const planWin = hardWin ?? softWin
  const peak = r.peak_hour
  return (
    <div className={`ops-side sd ${scrolled ? 'scrolled' : ''}`}>
      {head}
      <div className="sd-body" ref={body} onScroll={onBodyScroll}>
        {/* плитки и раскрытая подробность — одна карточка */}
        <div className="facts-box" data-tab={tile ? { now: 0, pay: 1, veh: 2 }[tile] : undefined}>
        <div className="facts glyph-facts">
          <Stat big icon={Users} v={fmt(r.boardings[hour])} on={tile === 'now'} onClick={tap('now')} tip={`Посадок в ${hh(hour)} — нажмите, чтобы раскрыть`} />
          <Stat big icon={RussianRuble} v={<LiveSum vals={r.boardings} timeRef={timeRef} />} on={tile === 'pay'} onClick={tap('pay')}
            tip="Успешных оплат с 00:00 до времени на ленте (прогноз; одна успешная валидация = одна посадка) — нажмите, чтобы раскрыть" />
          <Stat big icon={TramSide} v={on ? Math.floor(r.vehicles[hour]) : 0} on={tile === 'veh'} onClick={tap('veh')} tip={`Вагонов на линии в ${hh(hour)} — нажмите, чтобы раскрыть`} />
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
        {tile === 'veh' && (() => {
          const v = on ? Math.floor(r.vehicles[hour]) : 0
          const need = on ? Math.ceil(r.boardings[hour] / r.norm) : 0 // столько вагонов держат норматив
          const home = r.place ? depots?.[r.place] : undefined
          const run = r.vehicles.map((x, h) => [Math.floor(x), h]).filter(([x]) => x > 0)
          const most = run.reduce((a, b) => (b[0] > a[0] ? b : a), [0, 0])
          // выпуск — от конца ночного перерыва до начала следующего (работа после полуночи — хвост тех же суток)
          const up = (h: number) => Math.floor(r.vehicles[(h + 24) % 24]) > 0
          const first = Array.from({ length: 24 }, (_, h) => h).find((h) => up(h) && !up(h - 1))
          let last = first ?? 0
          while (first != null && up(last + 1) && (last + 1) % 24 !== first) last++
          return (
            <Detail lead={<div className="td-lead">
                <div className="big">
                  <b style={{ color }} title={on ? `${Math.round(r.ratio[hour] * 100)}% норматива посадок на вагон — ${LEVEL_TITLE[lvl]}` : 'В этот час вагонов на линии нет'}>
                    {on ? `${Math.round(r.ratio[hour] * 100)}%` : '—'}</b>
                  <Stat icon={Clock} v={hh(hour)} tip="Выбранный час" />
                </div>
                <FleetStrip vehicles={r.vehicles[hour]} ratio={r.ratio[hour]} extra={on ? (cur ? r.extra[hour] : planWin && planWin.from - hour <= 1 ? planWin.extra : 0) : 0}
                  spare={freeWin && freeWin.from === hour ? freeWin.spare : 0} />
                <div className="hero-row">
                  {cur ? <span className={`wchip ${levelOf(cur.max)}`} title={`Перегрузка ${span(cur)}: нужно +${cur.extra} ваг.`}><TriangleAlert size={14} />{hspan(cur)}</span>
                    : next ? <span className={`wchip ${levelOf(next.max)}`} title={`Сейчас в норме. Перегрузка ожидается ${span(next)}, нужно +${next.extra} ваг.`}><TrendingUp size={14} />{hspan(next)}</span>
                      : <span className="wchip ok" title="За день перегрузок не ожидается"><ShieldCheck size={14} />24 ч</span>}
                </div>
              </div>} rows={[
              ...(on ? [
                { k: 'Нужно по нормативу', v: need },
                { k: v >= need ? 'Запас' : 'Не хватает', v: v >= need ? `+${v - need}` : `−${need - v}`, color: v >= need ? '#86efac' : '#fca5a5' },
                { k: 'Посадок на вагон', v: `${fmt(r.boardings[hour] / v)} из ${fmt(r.norm)}` },
              ] : []),
              ...(home ? [
                { k: 'Площадка', v: home.name.replace(/^площадка\s+/i, '') },
                { k: 'Готовы в парке площадки', v: home.ready[hour] },
                { k: 'Парк площадки', v: `${home.fleet} ваг.` },
              ] : []),
              ...(run.length ? [
                { k: 'Больше всего за сутки', v: `${most[0]} в ${hh(most[1])}` },
                { k: 'Выпуск', v: first == null ? 'круглосуточно' : `${hh(first)}–${hh((last + 1) % 24)}` },
              ] : []),
              ...(peak != null ? [{ k: `В час пик, ${hh(peak)}`, v: `${Math.floor(r.vehicles[peak])} · ${Math.round(r.ratio[peak] * 100)}%`,
                color: r.vehicles[peak] > 0 ? LEVEL_COLORS[levelOf(r.ratio[peak])] : undefined }] : []),
            ]} foot={peak != null && peak !== hour && <button className="td-go" onClick={() => onHour(peak)}>К часу пик {hh(peak)}<ChevronRight size={14} /></button>} />
          )
        })()}
        </div>

        {/* переброска вагонов: добавить / можно снять / всё спокойно */}
        <div className="fleetbox">
          <Fleet r={r} list={list} depots={depots} win={planWin} hour={hour} soft={!hardWin && softWin != null} />
          <FreeFleet r={r} list={list} depots={depots} win={freeWin} hour={hour} />
          {!planWin && !freeWin && <FleetCalm r={r} hour={hour} />}
        </div>

        <div>
          <DayBars values={r.boardings} levels={levels} hour={hour} onHour={onHour} unit="посадок" />
        </div>

        {/* все станции ветки: поиск по названию, порядок по линии или по пассажирам в выбранный час */}
        <div className="stlist">
          <div className="st-head">
            <h4>Станции</h4>
            <button className={`st-sort ${byLoad ? 'on' : ''}`} onClick={() => setByLoad(!byLoad)} aria-pressed={byLoad}
              title={byLoad ? `По пассажирам в ${hh(hour)} — нажмите, чтобы по порядку линии` : 'По порядку линии — нажмите, чтобы по пассажирам'}>
              {byLoad ? <ArrowDownWideNarrow size={15} /> : <ListOrdered size={15} />}{byLoad ? 'по пассажирам' : 'по порядку'}
            </button>
          </div>
          <label className="st-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск станции" aria-label="Поиск станции" />
            {q && <button onClick={() => setQ('')} title="Очистить" aria-label="Очистить"><X size={14} /></button>}
          </label>
          <div className="sd-list">
            {stops
              .filter((s) => !q.trim() || nice(s.name).toLowerCase().includes(q.trim().toLowerCase()))
              .sort((a, b) => (byLoad ? b.weight - a.weight : 0))
              .map((s) => {
                const rl = railOf(s.name)
                return (
                  <div key={s.stop_id} className="toprow" onClick={() => onStop(s.stop_id)} title={`${nice(s.name)}: ${fmt(r.boardings[hour] * s.weight)} посадок в ${hh(hour)}`}>
                    {rl ? <RailMark kind={rl.kind} /> : <span className="stopdot sm" style={{ borderColor: r.color }} />}
                    <span>{nice(s.name)}</span>
                    <span className="num"><User size={13} />{fmt(r.boardings[hour] * s.weight)}</span>
                  </div>
                )
              })}
            {q.trim() && !stops.some((s) => nice(s.name).toLowerCase().includes(q.trim().toLowerCase())) && <div className="st-empty">Ничего не найдено</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
