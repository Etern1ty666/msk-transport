import { useEffect, useRef, useState } from 'react'
import { overLabel, type DayRoute, type RouteGeo } from '../api'

type Props = {
  geo: RouteGeo[]; routes: DayRoute[]; hour: number
  selected: number | null; onSelect: (r: number | null) => void
}

/** Номера маршрутов, по которым есть прогноз, — в постоянном порядке. */
export default function RouteBar({ geo, routes, hour, selected, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })

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
  useEffect(measure, [geo])
  useEffect(() => {
    box.current?.querySelector('.rb-chip.on')?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
  }, [selected])

  const chips = geo.map((g) => {
    const r = routes.find((x) => x.route === g.route)
    const idle = !r || r.vehicles[hour] === 0
    const ratio = idle ? 0 : r!.ratio[hour]
    return { g, idle, ratio, hot: ratio >= 1 }
  })

  return (
    <div className={`float glass routebar ${edge.l ? 'fl' : ''} ${edge.r ? 'fr' : ''}`}>
      <div className="rb-scroll" ref={box} onScroll={measure}>
        {chips.map(({ g, idle, ratio, hot: h }) => (
          // цвет кнопки — цвет маршрута; перегрузка (≥100% норматива) — красный мигающий маячок и «+N%» прямо на кнопке
          <button key={g.route} className={`rb-chip ${selected === g.route ? 'on' : ''} ${h ? 'hot' : ''}`}
            style={{ ['--c' as string]: g.color }}
            title={`${g.name}${idle ? ' — нет выпуска в этот час' : ` — загрузка ${Math.round(ratio * 100)}%${h ? ' — перегрузка' : ''}`}`}
            onClick={() => onSelect(selected === g.route ? null : g.route)}>
            {g.route}
            {h && <><em>{overLabel(ratio)}</em><i className="rb-led" /></>}
          </button>
        ))}
      </div>
    </div>
  )
}
