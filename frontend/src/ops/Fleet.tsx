import { useEffect, useMemo, useState } from 'react'
import { Clock, Info, Route, ShieldCheck, TriangleAlert, Warehouse } from 'lucide-react'
import { vehicleVariants, freeVariants, DONOR_MAX, FREE, FREE_TARGET, SOFT, type DayRoute, type Depot } from '../api'

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
const span = (w: { from: number; to: number }) => `${hh(w.from)}–${String(w.to + 1).padStart(2, '0')}:00`
const pct = (r: number) => `${Math.round(r * 100)}%`
const vag = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'вагон' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'вагона' : 'вагонов')

/** Подпись варианта — сами источники (или получатели): парк по названию, ветка — её номером в цвете. */
function Places({ items, short }: { items: ({ kind: 'depot'; name: string } | { kind: 'route'; route: number; color: string })[]; short: (n: string) => string }) {
  return <>{items.map((it, i) => it.kind === 'depot'
    ? <span key={`d${i}`} className="fp-tchip depot" title={short(it.name)}><Warehouse size={12} /><span className="nm">{short(it.name)}</span></span>
    : <span key={`r${it.route}`} className="fp-tchip rnum" style={{ background: it.color }}>{it.route}</span>)}</>
}
const hours = (w: { from: number; to: number }) => `${w.to - w.from + 1} ч`

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
      <div className="fp-head" title={`${soft
        ? `${soon ? `Через ${win.from - hour} ч` : 'Сейчас'} загрузка выше ${pct(SOFT)} (${span(win)}): можно подогнать +${need} ${vag(need)} из свободных — было ${was}, станет ${was + need}. Перегруженным веткам вагоны оставлены.`
        : `${soon ? `Через ${win.from - hour} ч` : 'Сейчас'} перегрузка ${span(win)}: нужно +${need} ${vag(need)} — было ${was}, станет ${was + need}`}\n\n${note}`}>
        <span className="fp-say need">{soon ? `Через ${win.from - hour} ч нужны вагоны` : 'Нужны вагоны'}: <b>+{need}</b></span>
      </div>

      <div className={`fp-tabbox ${plans.length > 1 ? 'tabbed' : ''}`} data-pos={pick === 0 ? 'first' : pick === plans.length - 1 ? 'last' : 'mid'}>
      {plans.length > 1 && (
        <div className="fp-tabs" role="tablist" style={{ ['--n' as string]: plans.length }}>
          {plans.map((p, i) => (
            <button key={p.key} role="tab" aria-selected={i === pick} className={i === pick ? 'on' : ''} onClick={() => setPick(i)}
              title={`Вариант ${i + 1}: ${p.title.toLowerCase()} — ${p.sources.map((s) => (s.kind === 'depot' ? short(s.name) : `№${s.route}`) + ` +${s.take}`).join(', ')}`}>
              <span className="fp-tplaces"><Places items={p.sources} short={short} /></span>
              <span className="fp-tn"><TramSide size={12} />×{p.sources.reduce((a, x) => a + x.take, 0)}</span>
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
              <span className="fp-from">
                {s.kind === 'depot'
                  ? <span className="fp-src depot"><Warehouse size={14} />{short(s.name)}</span>
                  : <span className="fp-src rnum lg" style={{ background: s.color }}>{s.route}</span>}
                <span className="fp-have"><TramSide size={12} />×{s.kind === 'depot' ? s.avail : Math.floor(list.find((x) => x.route === s.route)?.vehicles[win.from] ?? 0)}</span>
              </span>
              <span className="fp-track">
                <span className="fp-dur" title={`На ${span(win)}`}><Clock size={11} />{hours(win)}</span>
                <span className="fp-line" />
                <span className="fp-car"><TramSide size={11} /></span>
                <span className="fp-sub"><TramSide size={13} />×{s.take}{!s.own && <Route size={11} className="far-ico" />}</span>
              </span>
              <span className="fp-dst rnum lg" style={{ background: r.color }}>{r.route}</span>
            </div>
          ))}
        </div>
      )}
      </div>

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

/** Схема «можно освободить линию»: загрузка ниже 50% — сколько вагонов снять и куда их деть.
 *  Строка: эта ветка → ветка, которой вагонов не хватает (или парк), сколько вагонов; как у добавления, вагончик бежит по стрелке. */
export function FreeFleet({ r, list, depots, win, hour }: {
  r: DayRoute; list: DayRoute[]; depots: Record<string, Depot> | null | undefined
  win: { from: number; to: number; spare: number } | null; hour: number
}) {
  const [pick, setPick] = useState(0)
  useEffect(() => { setPick(0) }, [r.route, win?.from])
  const plans = useMemo(() => (win ? freeVariants(r, list, depots, win.from, win.to, win.spare) : []), [r, list, depots, win])
  if (!win || !plans.length) return null
  const plan = plans[Math.min(pick, plans.length - 1)]
  const soon = hour < win.from
  const was = Math.floor(r.vehicles[win.from])
  const short = (name: string) => name.replace(/^площадка\s+/i, '')
  const note = `Загрузка ниже ${pct(FREE)} норматива: можно снять ${win.spare} ${vag(win.spare)} — после этого загрузка не выше ${pct(FREE_TARGET)}, `
    + `а на линии остаётся не меньше половины вагонов. Сначала вагоны получают ветки, которым их не хватает (перегруженные, затем выше ${pct(SOFT)}), остальные уходят в парк.`

  return (
    <div className={`fplan free ${soon ? 'soon' : 'now'}`}>
      <div className="fp-head" title={`${soon ? 'Через час' : 'Сейчас'} ${span(win)} загрузка ниже ${pct(FREE)}: можно снять ${win.spare} ${vag(win.spare)} — было ${was}, останется ${was - win.spare}\n\n${note}`}>
        <span className="fp-say ok">Вагоны не нужны{soon ? ` через ${win.from - hour} ч` : ''} — можно снять <b>{win.spare}</b></span>
      </div>

      <div className={`fp-tabbox ${plans.length > 1 ? 'tabbed' : ''}`} data-pos={pick === 0 ? 'first' : pick === plans.length - 1 ? 'last' : 'mid'}>
      {plans.length > 1 && (
        <div className="fp-tabs" role="tablist" style={{ ['--n' as string]: plans.length }}>
          {plans.map((p, i) => (
            <button key={p.key} role="tab" aria-selected={i === pick} className={i === pick ? 'on' : ''} onClick={() => setPick(i)}
              title={`Вариант ${i + 1}: ${p.dests.map((d) => (d.kind === 'depot' ? `в парк ${d.give}` : `№${d.route} +${d.give}`)).join(', ')}`}>
              <span className="fp-tplaces"><Places items={p.dests} short={short} /></span>
              <span className="fp-tn"><TramSide size={12} />×{p.dests.reduce((a, x) => a + x.give, 0)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="fp-rows" key={plan.key}>
        {plan.dests.map((d, i) => (
          <div key={d.kind === 'depot' ? 'park' : `r${d.route}`} className={`fp-row ${d.kind === 'route' && !d.own ? 'far' : ''}`} style={{ ['--i' as string]: i }}
            title={d.kind === 'depot'
              ? `${d.give} ${vag(d.give)} с №${r.route} — в парк «${short(d.name)}»`
              : `${d.give} ${vag(d.give)} с №${r.route} на №${d.route}${d.own ? ' (та же площадка)' : ' (другая площадка, перегон дольше)'}: у №${d.route} загрузка станет ${pct(d.before)} → ${pct(d.after)}`}>
            <span className="fp-from">
              <span className="fp-src rnum lg" style={{ background: r.color }}>{r.route}</span>
              <span className="fp-have"><TramSide size={12} />×{was}</span>
            </span>
            <span className="fp-track">
              <span className="fp-dur" title={`На ${span(win)}`}><Clock size={11} />{hours(win)}</span>
              <span className="fp-line" />
              <span className="fp-car"><TramSide size={11} /></span>
              <span className="fp-sub"><TramSide size={13} />×{d.give}{d.kind === 'route' && !d.own && <Route size={11} className="far-ico" />}</span>
            </span>
            {d.kind === 'depot'
              ? <span className="fp-dst fp-src depot"><Warehouse size={14} />{short(d.name)}</span>
              : <span className="fp-dst rnum lg" style={{ background: d.color }}>{d.route}</span>}
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}

/** Когда перебрасывать нечего: ни перегрузки / >80% впереди, ни лишних вагонов — спокойная карточка на месте схемы. */
export function FleetCalm({ r, hour }: { r: DayRoute; hour: number }) {
  const v = Math.floor(r.vehicles[hour])
  const run = r.vehicles.some((x, h) => h > hour && x > 0)
  return (
    <div className="fplan calm" title={v > 0
      ? `Загрузка ${pct(r.ratio[hour])}: вагонов в самый раз — не нужно ни добавлять (до конца суток не выше ${pct(SOFT)}), ни снимать (не ниже ${pct(FREE)})`
      : 'В этот час ветка не работает'}>
      <div className="fp-head">
        <span className="fp-say ok">{v > 0 ? 'Вагоны не нужны' : run ? 'Вагоны не нужны — нет выпуска' : 'Вагоны не нужны — выпуск окончен'}</span>
      </div>
    </div>
  )
}
