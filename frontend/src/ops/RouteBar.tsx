import { useEffect, useRef, useState } from 'react'
import type { DayRoute, RouteGeo } from '../api'

type Props = {
  geo: RouteGeo[]; allRoutes: string[]; routes: DayRoute[]; hour: number
  selected: number | null; onSelect: (r: number | null) => void
}

/** Номера маршрутов: сначала те, по которым есть прогноз, затем остальные трамваи Москвы — неактивными. */
export default function RouteBar({ geo, allRoutes, routes, hour, selected, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  const known = new Set(geo.map((g) => String(g.route)))
  const rest = allRoutes.filter((r) => !known.has(r))

  const measure = () => {
    const el = box.current
    if (el) setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }
  useEffect(() => {
    const el = box.current!
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // вертикальное колесо прокручивает панель по горизонтали
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => { ro.disconnect(); el.removeEventListener('wheel', wheel) }
  }, [])
  useEffect(measure, [geo, allRoutes])
  useEffect(() => {
    box.current?.querySelector('.rb-chip.on')?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [selected])

  return (
    <div className={`float glass routebar ${edge.l ? 'fl' : ''} ${edge.r ? 'fr' : ''}`}>
      <div className="rb-scroll" ref={box} onScroll={measure}>
        {geo.map((g) => {
          const r = routes.find((x) => x.route === g.route)
          const idle = !r || r.vehicles[hour] === 0
          const ratio = idle ? 0 : r!.ratio[hour]
          const k = Math.max(0, Math.min(1, (ratio - 0.9) / 0.4)) // 90% → 0, 130% → 1
          const lvl = ratio >= 1.2 ? 'crit' : ratio >= 1 ? 'high' : 'mid'
          return (
            // цвет кнопки всегда цвет маршрута; загрузку показывает огонёк внутри кнопки:
            // чем выше загрузка к нормативу, тем он ярче и чаще пульсирует (ниже ~90% — огонька нет)
            <button key={g.route} className={`rb-chip ${selected === g.route ? 'on' : ''}`}
              style={{ ['--c' as string]: g.color }}
              title={`${g.name}${idle ? ' — нет выпуска в этот час' : ` — загрузка ${Math.round(ratio * 100)}%`}`}
              onClick={() => onSelect(selected === g.route ? null : g.route)}>
              {g.route}
              {k > 0 && <i className={`rb-led ${lvl}`} style={{ ['--k' as string]: k.toFixed(2) } as React.CSSProperties} />}
            </button>
          )
        })}
        {rest.length > 0 && <span className="rb-sep" />}
        {rest.map((r) => (
          <span key={r} className="rb-chip off" title={`Трамвай №${r} — нет данных в датасете, прогноз не строится`}>{r}</span>
        ))}
      </div>
    </div>
  )
}
