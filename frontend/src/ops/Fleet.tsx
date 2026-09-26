import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, Clock, Info, Route, TriangleAlert, Warehouse } from 'lucide-react'
import { LEVEL_COLORS, levelOf, vehicleSources, DONOR_MAX, type DayRoute, type Depot } from '../api'
import { hspan } from './Glyphs'

type Win = { from: number; to: number; extra: number }

/** Трамвайный вагон сбоку: пантограф, корпус с тремя окнами, два колеса — в стиле иконок lucide (обводка currentColor). */
export function TramSide({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size * 1.5} height={size} viewBox="0 0 36 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 7 18 2.5 22 7" />
      <rect x="3" y="7" width="30" height="12" rx="4" />
      <rect x="7" y="10" width="5" height="4" rx="1" />
      <rect x="15.5" y="10" width="5" height="4" rx="1" />
      <rect x="24" y="10" width="5" height="4" rx="1" />
      <circle cx="10" cy="21" r="1.6" />
      <circle cx="26" cy="21" r="1.6" />
    </svg>
  )
}
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
const span = (w: Win) => `${hh(w.from)}–${String(w.to + 1).padStart(2, '0')}:00`
const pct = (r: number) => `${Math.round(r * 100)}%`
const vag = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'вагон' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'вагона' : 'вагонов')

/** Если в окне перегрузки не хватает вагонов — кнопка «+N откуда взять» и список источников. */
export default function Fleet({ r, list, depots, win }: {
  r: DayRoute; list: DayRoute[]; depots: Record<string, Depot> | null | undefined; win: Win | null
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [r.route, win?.from])
  const need = win?.extra ?? 0
  const src = useMemo(() => (win && need > 0 ? vehicleSources(r, list, depots, win.from, win.to, need) : null), [r, list, depots, win, need])
  const home = r.place ? depots?.[r.place] : undefined
  if (!src || !win) return null

  const was = Math.floor(r.vehicles[win.from])
  const note = `${home ? `${home.name}: за октябрь ${home.multi_route} из ${home.fleet} её вагонов работали на нескольких маршрутах. ` : ''}`
    + `Готовые в парке = пиковый выпуск площадки (p90 будней) − вагоны на линии. Ветка-донор отдаёт вагоны, только если сама остаётся ≤ ${pct(DONOR_MAX)} норматива.`
  const short = (name: string) => name.replace(/^площадка\s+/i, '')

  return (
    <div className="fleet">
      <button className={`fleet-add ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}
        title={`На ${span(win)} не хватает ${need} ${vag(need)} — откуда их взять`}>
        <span className="plus">+{need}</span><TramSide size={15} /><ChevronDown size={14} className="caret" />
      </button>

      {open && (
        <div className="fleet-src">
          <div className="fs-head" title={`Нужно +${need} ${vag(need)} на ${span(win)}: было ${was}, станет ${was + need}`}>
            <Clock size={13} /><span>{hspan(win)}</span>
            <TramSide size={15} /><span>{was}</span><ArrowRight size={13} /><b>{was + need}</b>
            <span className="fs-info" title={note}><Info size={14} /></span>
          </div>
          {src.sources.map((s) => s.kind === 'depot' ? (
            <div key={`d${s.place}`} className={`fs-row ${s.own ? '' : 'far'}`}
              title={`Из парка (${s.name}): готовы ${s.avail} ${vag(s.avail)}${s.own ? ' — своя площадка' : ' — другая площадка, перегон дольше'}`}>
              <span className="fs-ico"><Warehouse size={15} /></span>
              <span className="fs-t"><b>{short(s.name)}</b>{!s.own && <Route size={13} className="far-ico" />}
                <span className="fs-avail"><TramSide size={12} />{s.avail}</span></span>
              <b className="fs-take">+{s.take}</b>
            </div>
          ) : (
            <div key={`r${s.route}`} className={`fs-row ${s.own ? '' : 'far'}`}
              title={`С ветки №${s.route}${s.own ? ' (та же площадка)' : ' (другая площадка)'}: загрузка ${pct(s.before)} → ${pct(s.after)}`}>
              <span className="rnum" style={{ background: s.color }}>{s.route}</span>
              <span className="fs-t">{!s.own && <Route size={13} className="far-ico" />}
                <span className="fs-load">{pct(s.before)}<ArrowRight size={11} /><em style={{ color: LEVEL_COLORS[levelOf(s.after)] }}>{pct(s.after)}</em></span></span>
              <b className="fs-take">+{s.take}</b>
            </div>
          ))}
          {src.left > 0 && (
            <div className="fs-left" title={`Ещё ${src.left} ${vag(src.left)} взять неоткуда: все площадки выпустили пиковый состав, у веток нет запаса. Сдвинуть выпуск раньше или сократить интервал на соседних часах.`}>
              <TriangleAlert size={14} /><b>−{src.left}</b><TramSide size={14} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
