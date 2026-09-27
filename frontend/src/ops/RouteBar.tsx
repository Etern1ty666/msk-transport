import { useEffect, useRef, useState } from 'react'
import type { RouteGeo } from '../api'

type Props = {
  geo: RouteGeo[]
  selected: number | null; onSelect: (r: number | null) => void
  focused?: boolean // стрелки ← → сейчас листают маршруты
}

/** Номера маршрутов, по которым есть прогноз, — в постоянном порядке. */
export default function RouteBar({ geo, selected, onSelect, focused }: Props) {
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

  return (
    <div className={`float glass routebar ${edge.l ? 'fl' : ''} ${edge.r ? 'fr' : ''} ${focused ? 'kfocus' : ''}`}>
      <div className="rb-scroll" ref={box} onScroll={measure}>
        {geo.map((g) => (
          // только выбор ветки: кнопка в цвет маршрута, выбранная — с обводкой
          <button key={g.route} className={`rb-chip ${selected === g.route ? 'on' : ''}`} style={{ ['--c' as string]: g.color }}
            title={g.name} onClick={() => onSelect(selected === g.route ? null : g.route)}>
            {g.route}
          </button>
        ))}
      </div>
    </div>
  )
}
