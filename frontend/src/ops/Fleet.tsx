import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Clock, Info, Route, ShieldCheck, TriangleAlert, Warehouse } from 'lucide-react'
import { LEVEL_COLORS, levelOf, vehicleVariants, DONOR_MAX, SOFT, type DayRoute, type Depot } from '../api'
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

/** Схема переброски вагонов: за час до перегрузки (и пока она идёт) — несколько вариантов, откуда взять вагоны.
 *  Каждая строка: источник (ветка-донор или парк) → эта ветка, сколько вагонов; вагончик бежит по стрелке.
 *  soft — загрузка выше 80%, но в нормативе: предлагаем свободные вагоны, только оставшиеся после перегруженных веток. */
export default function Fleet({ r, list, depots, win, hour, soft = false }: {
  r: DayRoute; list: DayRoute[]; depots: Record<string, Depot> | null | undefined; win: Win | null; hour: number; soft?: boolean
}) {
  const [pick, setPick] = useState(0)
  useEffect(() => { setPick(0) }, [r.route, win?.from])
  const need = win?.extra ?? 0
  const { plans, reserved } = useMemo(() => (win && need > 0 ? vehicleVariants(r, list, depots, win.from, win.to, need, soft) : { plans: [], reserved: [] }),
    [r, list, depots, win, need, soft])
  const home = r.place ? depots?.[r.place] : undefined
  if (!win || need <= 0) return null

  const soon = hour < win.from
  const was = Math.floor(r.vehicles[win.from])
  const plan = plans[Math.min(pick, plans.length - 1)]
  const left = plan ? plan.left : need
  const note = `${home ? `${home.name}: за октябрь ${home.multi_route} из ${home.fleet} её вагонов работали на нескольких маршрутах. ` : ''}`
    + `Готовые в парке = пиковый выпуск площадки (p90 будней) − вагоны на линии. Ветка-донор отдаёт вагоны, только если сама остаётся ≤ ${pct(DONOR_MAX)} норматива.`
  const short = (name: string) => name.replace(/^площадка\s+/i, '')

  return (
    <div className={`fplan ${soon ? 'soon' : 'now'} ${soft ? 'soft' : ''}`}>
      <div className="fp-head" title={soft
        ? `${soon ? 'Через час' : 'Сейчас'} загрузка выше ${pct(SOFT)} (${span(win)}): можно подогнать +${need} ${vag(need)} из свободных — было ${was}, станет ${was + need}. Перегруженным веткам вагоны оставлены.`
        : `${soon ? 'Через час' : 'Сейчас'} перегрузка ${span(win)}: нужно +${need} ${vag(need)} — было ${was}, станет ${was + need}`}>
        <span className="fp-when">{soon ? <Clock size={13} /> : <TriangleAlert size={13} />}{soon ? 'через 1 ч' : 'сейчас'}{soft && <em>&gt;{pct(SOFT)}</em>}</span>
        <span className="fp-span">{hspan(win)}</span>
        <span className="fp-need"><TramSide size={14} />{was}<ArrowRight size={12} /><b>{was + need}</b></span>
        <span className="fs-info" title={note}><Info size={14} /></span>
      </div>

      {plans.length > 1 && (
        <div className="fp-tabs" role="tablist">
          {plans.map((p, i) => (
            <button key={p.key} role="tab" aria-selected={i === pick} className={i === pick ? 'on' : ''} onClick={() => setPick(i)}
              title={`Вариант ${i + 1}: ${p.title.toLowerCase()} — ${p.sources.map((s) => (s.kind === 'depot' ? short(s.name) : `№${s.route}`) + ` +${s.take}`).join(', ')}`}>
              <i>{i + 1}</i>
              {p.key.startsWith('one-') ? p.sources.map((s) => s.kind === 'depot'
                ? <span key="d" className="fp-tchip depot"><Warehouse size={11} />{short(s.name)}</span>
                : <span key="r" className="fp-tchip rnum" style={{ background: s.color }}>{s.route}</span>)
                : <span className="fp-tt">{p.title}</span>}
            </button>
          ))}
        </div>
      )}

      {plan && (
        <div className="fp-rows" key={plan.key}>
          {plan.sources.map((s, i) => (
            <div key={s.kind === 'depot' ? `d${s.place}` : `r${s.route}`} className={`fp-row ${s.own ? '' : 'far'}`} style={{ ['--i' as string]: i }}
              title={s.kind === 'depot'
                ? `Из парка «${short(s.name)}»${s.own ? ' (своя площадка)' : ' (другая площадка, перегон дольше)'}: готовы ${s.avail}, берём ${s.take} → №${r.route}`
                : `С ветки №${s.route}${s.own ? ' (та же площадка)' : ' (другая площадка, перегон дольше)'}: ${s.take} ${vag(s.take)} → №${r.route}; у №${s.route} загрузка станет ${pct(s.before)} → ${pct(s.after)}`}>
              {s.kind === 'depot'
                ? <span className="fp-src depot"><Warehouse size={14} />{short(s.name)}</span>
                : <span className="fp-src rnum lg" style={{ background: s.color }}>{s.route}</span>}
              <span className="fp-track">
                <span className="fp-line" />
                <span className="fp-car"><TramSide size={11} /></span>
                <span className="fp-sub">
                  {s.kind === 'depot'
                    ? <>в парке {s.avail}</>
                    : <>{pct(s.before)}<ArrowRight size={10} /><em style={{ color: LEVEL_COLORS[levelOf(s.after)] }}>{pct(s.after)}</em></>}
                  {!s.own && <Route size={11} className="far-ico" />}
                </span>
              </span>
              <span className="fp-dst rnum lg" style={{ background: r.color }}>{r.route}</span>
              <b className="fp-take"><TramSide size={14} />+{s.take}</b>
            </div>
          ))}
        </div>
      )}

      {left > 0 && (soft
        ? <div className="fs-left soft" title={`Ещё ${left} ${vag(left)} свободных нет: остальной запас нужен перегруженным веткам. Ветка в нормативе — можно не добавлять.`}>
            <Info size={14} /><b>{left === need ? 'свободных нет' : `ещё ${left}`}</b><span>— запас нужен перегруженным</span>
          </div>
        : <div className="fs-left" title={`Ещё ${left} ${vag(left)} взять неоткуда: все площадки выпустили пиковый состав, у веток нет запаса. Сдвинуть выпуск раньше или сократить интервал на соседних часах.`}>
            <TriangleAlert size={14} /><b>−{left}</b><TramSide size={14} /><span>взять неоткуда</span>
          </div>)}
      {soft && reserved.length > 0 && (
        <div className="fp-res" title="Сначала вагоны получают ветки выше норматива в эти же часы — им хватит; этой ветке предлагается только оставшийся запас">
          <ShieldCheck size={13} /><span>перегруженным оставлено:</span>
          {reserved.map((x) => <span key={x.route} className="fp-resi"><span className="rnum" style={{ background: x.color }}>{x.route}</span>+{x.take}</span>)}
        </div>
      )}
    </div>
  )
}
