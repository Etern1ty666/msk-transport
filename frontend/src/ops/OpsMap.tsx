import type { ExpressionSpecification, GeoJSONSource, Map as MLMap, MapLayerMouseEvent } from 'maplibre-gl'
import { Map as MapIcon, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
type ML = typeof import('maplibre-gl')
import SchemeView, { type SchemeApi } from './scheme/SchemeView'
import { at24, levelOf, overLabel, type DayView, type RouteGeo, type Schema, type Segment } from '../api'

// Светлая подложка OpenFreeMap (OSM, без ключа) — ближе всего к официальной схеме: https://openfreemap.org
const STYLE = 'https://tiles.openfreemap.org/styles/positron'
// экстент трамвайной сети (по OSM) — стартовый вид вписывает её целиком
const NETWORK: [[number, number], [number, number]] = [[37.45, 55.596], [37.821, 55.888]]
export type MapMode = 'map' | 'schema' | 'metro'
// переключатель: схема маршрутов ⇄ подробная карта (режим 'schema' — выпрямленная сеть поверх OSM — оставлен в коде, в UI не показывается)
const MODE_NEXT: Record<MapMode, MapMode> = { map: 'metro', schema: 'metro', metro: 'map' }
const MODE_TITLE: Record<MapMode, string> = { map: 'Карта', schema: 'Схема', metro: 'Схема' }
// отступы камеры под раскладку: на телефоне шкала снизу, карточка ветки — шторкой снизу; на десктопе карточка слева
export const isPhone = () => window.innerWidth <= 720
const homePad = () => (isPhone() ? { top: 230, bottom: 80, left: 20, right: 60 } : { top: 120, bottom: 80, left: 40, right: 80 })
const sidePad = () => (isPhone()
  ? { top: 200, bottom: Math.round(window.innerHeight * 0.56) + 16, left: 24, right: 24 }
  : { left: sideW() + 50, right: 90, top: 170, bottom: 90 })
const BOUNDS: [[number, number], [number, number]] = [[37.30, 55.53], [37.98, 55.95]]
// ширина колонки карточки ветки — как --side в CSS (уже на средних экранах)
const sideW = () => (window.innerWidth <= 900 ? 352 : window.innerWidth <= 1180 ? 392 : 440)

// толщина линии и шаг «пучка» по зуму — как на схеме, линии общих участков идут параллельно
const byZoom = (k: number): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], 10, 3 * k, 12, 4.6 * k, 14, 7.5 * k, 16, 12 * k]
const offsetExpr = (): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], 10, ['*', ['get', 'k'], 3.2], 12, ['*', ['get', 'k'], 4.9], 14, ['*', ['get', 'k'], 8], 16, ['*', ['get', 'k'], 12.8]]

type Props = {
  geo: RouteGeo[]; segments: Segment[]; schema: Schema | null; day: DayView | null; hour: number
  selected: number | null; selectedStop: string | null
  onSelect: (route: number | null, stopId?: string | null) => void
  mode: MapMode; onMode: (m: MapMode) => void
  paused?: boolean // карту закрывает страница раздела — анимацию не крутим
  wxBtn?: React.ReactNode // кнопка эффектов погоды — в столбце управления картой
  timeRef?: React.MutableRefObject<number> // текущая минута (дробная) — для плавного «дыхания» свечения без перерисовки React
}

type Feat = { type: 'Feature'; properties: Record<string, number>; geometry: { type: 'Point'; coordinates: number[] } }
type GlowSrc = { geo: RouteGeo[]; day: DayView | null; sch: Schema | null; selected: number | null }
function glowData({ geo, day, sch, selected }: GlowSrc, minute: number) {
  const fc = (features: Feat[]) => ({ type: 'FeatureCollection' as const, features })
  if (!day) return { heat: fc([]), hot: fc([]) }
  const byRoute = Object.fromEntries(day.routes.map((r) => [r.route, r]))
  // нормировка по пику суток, чтобы ночью свечение действительно гасло
  let peak = 1
  for (const g of geo) {
    const r = byRoute[g.route]; if (!r) continue
    const wmax = Math.max(0, ...g.stops.map((s) => s.weight))
    peak = Math.max(peak, Math.max(...r.boardings) * wmax)
  }
  const pos = (route: number, s: { stop_id: string; lon: number; lat: number }) => sch?.stops[route]?.[s.stop_id] ?? [s.lon, s.lat]
  const heat: Feat[] = [], hot: Feat[] = []
  for (const g of geo) {
    const r = byRoute[g.route]; if (!r) continue
    const b = at24(r.boardings, minute)
    const veh = at24(r.vehicles, minute)
    const ratio = veh > 0.05 ? at24(r.ratio, minute) : 0
    const dim = selected != null && selected !== g.route
    for (const s of g.stops) {
      const v = b * s.weight
      if (v > 0) heat.push({ type: 'Feature', properties: { w: Math.min(1, Math.sqrt(v / peak)) * (dim ? 0.3 : 1) }, geometry: { type: 'Point', coordinates: pos(g.route, s) } })
    }
    // появление/угасание вокруг порога 100% — без щелчков, градиентом
    const fade = Math.max(0, Math.min(1, (ratio - 0.96) / 0.08))
    if (fade <= 0 || dim) continue
    const sev = Math.max(0, Math.min(1, (ratio - 1) / 0.3))
    const top = [...g.stops].sort((a, c) => c.weight - a.weight).slice(0, 4)
    for (const s of top) {
      const v = b * s.weight
      hot.push({ type: 'Feature', properties: { s: sev, r: 0.55 + 0.9 * Math.sqrt(Math.min(1, v / peak)), o: fade * (0.65 + 0.35 * sev) },
        geometry: { type: 'Point', coordinates: pos(g.route, s) } })
    }
  }
  return { heat: fc(heat), hot: fc(hot) }
}

export default function OpsMap({ geo, segments, schema, day, hour, selected, selectedStop, onSelect, mode, onMode, timeRef, paused = false, wxBtn }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MLMap | null>(null)
  const base = useRef<{ id: string; keep: boolean; vis: string }[]>([])
  const waterColor = useRef<string>('#c8d7e2')
  const [ready, setReady] = useState(false)
  const cb = useRef(onSelect)
  cb.current = onSelect
  const sch = mode === 'schema' && schema ? schema : null
  // актуальные данные для цикла анимации (он живёт вне React-рендера)
  const live = useRef({ geo, day, sch, selected, dirty: true })
  live.current = { geo, day, sch, selected, dirty: true }
  // MapLibre (≈800 КБ и WebGL) грузим и создаём только когда впервые открыта «Карта»:
  // в режиме «Схема» скрытая карта раньше перерисовывалась 60 раз в секунду впустую
  const [ml, setMl] = useState<ML | null>(null)
  const mlRef = useRef<ML | null>(null)
  useEffect(() => {
    if (mode !== 'map' || ml) return
    let alive = true
    import('maplibre-gl').then((mod) => {
      const lib = ((mod as unknown as { default?: ML }).default ?? mod) as ML // сборка может отдать модуль как default
      if (alive) { mlRef.current = lib; setMl(() => lib) }
    })
    return () => { alive = false }
  }, [mode, ml])
  const active = mode !== 'metro' && !paused

  useEffect(() => {
    if (!el.current || map.current || !ml) return
    const maplibregl = ml
    const m = new maplibregl.Map({
      container: el.current, style: STYLE, bounds: NETWORK, fitBoundsOptions: { padding: homePad() }, minZoom: 9.8, maxZoom: 17, maxBounds: BOUNDS,
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    })
    m.touchZoomRotate.disableRotation()
    m.on('load', () => {
      // подпись источников карты — свёрнутой кнопкой ⓘ, чтобы не перекрывать панель маршрутов
      el.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
      // приглушаем подложку, чтобы линии маршрутов читались как на схеме
      for (const l of m.getStyle().layers) {
        if (l.type === 'symbol' && /poi|housenum|transit|aeroway/.test(l.id)) m.setLayoutProperty(l.id, 'visibility', 'none')
      }
      // слои подложки: в режиме «Схема» оставляем только фон и воду (для ориентира)
      base.current = m.getStyle().layers.map((l) => ({
        id: l.id, keep: l.type === 'background' || (l.type === 'fill' && /water/.test(l.id)),
        vis: (m.getLayoutProperty(l.id, 'visibility') as string) ?? 'visible',
      }))
      const w = base.current.find((l) => l.keep && m.getLayer(l.id)?.type === 'fill')
      if (w) waterColor.current = (m.getPaintProperty(w.id, 'fill-color') as string) ?? waterColor.current
      const empty = { type: 'FeatureCollection' as const, features: [] }
      for (const s of ['lines', 'stops', 'allstops', 'badges', 'heat', 'hot', 'termini']) m.addSource(s, { type: 'geojson', data: empty })
      const lay = { 'line-cap': 'round' as const, 'line-join': 'round' as const }
      // «дыхание» города: мягкое свечение спроса у остановок — разгорается в часы пик, гаснет ночью
      m.addLayer({ id: 'heat', type: 'heatmap', source: 'heat',
        paint: {
          'heatmap-weight': ['get', 'w'],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 1.4],
          'heatmap-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 30, 12, 52, 14, 100, 16, 180],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(20,184,166,0)', 0.12, 'rgba(20,184,166,0.12)', 0.35, 'rgba(20,184,166,0.26)', 0.65, 'rgba(14,165,233,0.38)', 1, 'rgba(99,102,241,0.5)'],
          'heatmap-opacity': 0.95,
        } })
      // горячие точки: самые загруженные остановки перегруженных веток — пульсирующее свечение
      m.addLayer({ id: 'hot', type: 'circle', source: 'hot',
        paint: {
          'circle-color': ['interpolate', ['linear'], ['get', 's'], 0, '#fb923c', 1, '#ef4444'],
          'circle-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 10, ['*', ['get', 'r'], 23], 12, ['*', ['get', 'r'], 37], 14, ['*', ['get', 'r'], 66], 16, ['*', ['get', 'r'], 115]],
          'circle-blur': 1, 'circle-opacity': ['get', 'o'],
        } })
      // расходящееся кольцо — «сигнал» у проблемной остановки
      m.addLayer({ id: 'hot-ring', type: 'circle', source: 'hot',
        paint: {
          'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2,
          'circle-stroke-color': ['interpolate', ['linear'], ['get', 's'], 0, '#f97316', 1, '#ef4444'],
          'circle-radius': 6, 'circle-stroke-opacity': 0,
        } })
      // проблемная ветка — чёткая цветная обводка (без размытия), пульсирует прозрачностью
      // проблемная ветка — сплошная светлая обводка (без прозрачности: соседние подсветки не «накладываются» кашей), пульсирует шириной
      m.addLayer({ id: 'halo', type: 'line', source: 'lines', filter: ['>', ['get', 'alert'], 0], layout: lay,
        paint: { 'line-color': ['case', ['==', ['get', 'alert'], 2], '#fbb4b4', '#fdd0a2'], 'line-width': byZoom(2.3), 'line-offset': offsetExpr() } })
      m.addLayer({ id: 'casing', type: 'line', source: 'lines', layout: lay,
        paint: { 'line-color': '#ffffff', 'line-width': byZoom(1.5), 'line-offset': offsetExpr(), 'line-opacity': ['get', 'op'] } })
      m.addLayer({ id: 'lines', type: 'line', source: 'lines', layout: lay,
        paint: { 'line-color': ['get', 'color'], 'line-width': byZoom(1), 'line-offset': offsetExpr(), 'line-opacity': ['get', 'op'] } })
      m.addLayer({ id: 'hit', type: 'line', source: 'lines', paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 } })
      // номера маршрутов — прямые цветные бейджи на конечных, как на официальной схеме
      const pill = document.createElement('canvas'); pill.width = pill.height = 40
      const pc = pill.getContext('2d')!
      pc.fillStyle = '#fff'; pc.beginPath(); pc.roundRect(2, 2, 36, 36, 10); pc.fill()
      m.addImage('pill', pc.getImageData(0, 0, 40, 40), { sdf: true, pixelRatio: 2, stretchX: [[11, 29]], stretchY: [[11, 29]], content: [9, 9, 31, 31] })
      m.addLayer({ id: 'termini', type: 'symbol', source: 'termini',
        layout: {
          'text-field': ['get', 'num'], 'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 12, 14, 15],
          'icon-image': 'pill', 'icon-text-fit': 'both', 'icon-text-fit-padding': [3, 6, 3, 6],
          'text-variable-anchor': ['bottom', 'top', 'left', 'right', 'bottom-left', 'bottom-right', 'top-left', 'top-right'], 'text-radial-offset': 1.1,
          'text-justify': 'auto', 'symbol-sort-key': ['get', 'rank'], 'text-padding': 2,
        },
        paint: { 'text-color': '#ffffff', 'icon-color': ['get', 'color'], 'icon-halo-color': '#ffffff', 'icon-halo-width': 1.5,
          'text-opacity': ['get', 'op'], 'icon-opacity': ['get', 'op'] } })
      // все остановки сети — только в режиме «Схема», как на официальной схеме
      m.addLayer({ id: 'allstops', type: 'circle', source: 'allstops', minzoom: 11.3,
        paint: { 'circle-color': '#ffffff', 'circle-stroke-color': '#334155', 'circle-stroke-width': 1.3,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.3, 2.2, 14, 4] } })
      m.addLayer({ id: 'allstop-labels', type: 'symbol', source: 'allstops', minzoom: 12.6,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0.8, 0], 'text-anchor': 'left',
          'text-optional': true, 'text-padding': 3 },
        paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } })
      m.addLayer({ id: 'stops', type: 'circle', source: 'stops',
        paint: { 'circle-color': ['case', ['==', ['get', 'sel'], 1], ['get', 'color'], '#ffffff'], 'circle-stroke-color': ['case', ['==', ['get', 'sel'], 1], '#ffffff', ['get', 'color']],
          'circle-stroke-width': ['case', ['==', ['get', 'sel'], 1], 4, 2.2], 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 11, ['get', 'r']] } })
      m.addLayer({ id: 'stop-labels', type: 'symbol', source: 'stops', filter: ['==', ['get', 'label'], 1],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['case', ['==', ['get', 'sel'], 1], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]], 'text-size': ['case', ['==', ['get', 'sel'], 1], 14, 11.5], 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } })
      m.addLayer({ id: 'badges', type: 'symbol', source: 'badges',
        layout: { 'text-field': ['get', 'text'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': false, 'text-offset': [0, -1.4], 'symbol-sort-key': ['get', 'rank'] },
        paint: { 'text-color': '#ffffff', 'text-halo-color': ['get', 'color'], 'text-halo-width': 4 } })

      m.on('click', (e: MapLayerMouseEvent) => {
        const s = m.queryRenderedFeatures(e.point, { layers: ['stops'] })[0]
        if (s) return cb.current(Number(s.properties.route), String(s.properties.stop_id))
        const b = m.queryRenderedFeatures(e.point, { layers: ['badges'] })[0]
        if (b) return cb.current(Number(b.properties.route), null)
        const r = m.queryRenderedFeatures(e.point, { layers: ['hit'] })[0]
        cb.current(r ? Number(r.properties.route) : null, null)
      })
      for (const l of ['stops', 'hit', 'badges']) {
        m.on('mouseenter', l, () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', l, () => { m.getCanvas().style.cursor = '' })
      }
      setReady(true)
    })
    map.current = m
    return () => { m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ml])

  // пульс проблемных веток и горячих точек: только когда карта видна и есть что подсвечивать.
  // Каждое setPaintProperty заставляет WebGL перерисовать всю карту, поэтому ~30 кадров в секунду, а без тревог — ни одного
  const alertCount = useRef(0)
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !active) return
    let raf = 0, lastMin = -1, lastBuild = 0, lastPulse = 0, hotN = 0, calm = false
    const pulse = (t: number) => {
      raf = requestAnimationFrame(pulse)
      // плавная интерполяция по минутам: пересобираем свечение не чаще ~12 раз в секунду и только если время сдвинулось
      const min = timeRef?.current ?? 0
      if (m.getSource('heat') && t - lastBuild > 80 && (Math.abs(min - lastMin) >= 0.5 || live.current.dirty)) {
        lastBuild = t; lastMin = min; live.current.dirty = false
        const { heat, hot } = glowData(live.current, min)
        hotN = hot.features.length
        ;(m.getSource('heat') as GeoJSONSource).setData(heat)
        ;(m.getSource('hot') as GeoJSONSource).setData(hot)
      }
      if (!hotN && !alertCount.current) { calm = true; return }
      if (t - lastPulse < 33 && !calm) return
      lastPulse = t; calm = false
      const p = 0.5 + 0.5 * Math.sin(t / 380)
      if (alertCount.current) m.setPaintProperty('halo', 'line-width', byZoom(1.75 + 0.75 * p))
      if (hotN) {
        m.setPaintProperty('hot', 'circle-opacity', ['*', ['get', 'o'], 0.6 + 0.4 * p])
        // кольцо расходится и тает, раз в ~1,6 с
        const k = (t % 1600) / 1600, z = m.getZoom(), base = z < 12 ? 8 : z < 14 ? 12 : 18
        m.setPaintProperty('hot-ring', 'circle-radius', ['*', ['get', 'r'], base * (1 + 2.2 * k)])
        m.setPaintProperty('hot-ring', 'circle-stroke-opacity', ['*', ['get', 'o'], 1.1 * (1 - k)])
      }
    }
    raf = requestAnimationFrame(pulse)
    return () => cancelAnimationFrame(raf)
  }, [ready, active, timeRef])

  // режим просмотра: «Карта» — подложка OSM; «Схема» — только фон, вода и выпрямленные линии
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    for (const l of base.current) m.setLayoutProperty(l.id, 'visibility', mode === 'schema' && !l.keep ? 'none' : l.vis as 'visible' | 'none')
    const bg = base.current.find((l) => m.getLayer(l.id)?.type === 'background')
    if (bg) m.setPaintProperty(bg.id, 'background-color', mode === 'schema' ? '#f7f7f4' : '#f2f3f0')
    for (const l of base.current) if (l.keep && m.getLayer(l.id)?.type === 'fill') m.setPaintProperty(l.id, 'fill-color', mode === 'schema' ? '#dce8f1' : waterColor.current)
  }, [mode, ready])

  // слои: пучки линий по официальным цветам + подсветка проблем на выбранный час
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !segments.length) return
    const byRoute = Object.fromEntries((day?.routes ?? []).map((r) => [r.route, r]))
    const alertOf = (route: number) => {
      const r = byRoute[route]
      if (!r || r.vehicles[hour] === 0) return 0
      const l = levelOf(r.ratio[hour])
      return l === 'crit' ? 2 : l === 'high' ? 1 : 0
    }
    const color = Object.fromEntries(geo.map((g) => [g.route, g.color]))
    const alerts = Object.fromEntries(geo.map((g) => [g.route, alertOf(g.route)]))
    alertCount.current = geo.filter((g) => alerts[g.route] > 0 && (selected == null || selected === g.route)).length
    const segs = sch ? sch.segments : segments
    const at = (route: number, s: { stop_id: string; lon: number; lat: number }) => sch?.stops[route]?.[s.stop_id] ?? [s.lon, s.lat]
    const lines = segs.flatMap((s) => s.routes.map((r, i) => {
      const dim = selected != null && selected !== r
      return {
        type: 'Feature' as const,
        properties: {
          route: r, color: color[r] ?? '#888', k: i - (s.routes.length - 1) / 2,
          alert: dim ? 0 : alerts[r], op: dim ? 0.18 : r === 5 ? 0.5 : 1, label: dim ? 0 : 1,
        },
        geometry: { type: 'LineString' as const, coordinates: s.coords },
      }
    }))
    const stops = geo.filter((g) => g.route === selected).flatMap((g) => {
      const b = byRoute[g.route]?.boardings[hour] ?? 0
      const vals = g.stops.map((s) => b * s.weight)
      const top = new Set(vals.map((v, i) => [v, i]).sort((a, c) => c[0] - a[0]).slice(0, 5).map((x) => x[1]))
      return g.stops.map((s, i) => ({
        type: 'Feature' as const,
        properties: { route: g.route, stop_id: s.stop_id, name: s.name, color: g.color, sel: s.stop_id === selectedStop ? 1 : 0,
          r: 4 + Math.min(7, Math.sqrt(vals[i]) * 0.5), label: top.has(i) || s.stop_id === selectedStop || i === 0 || i === g.stops.length - 1 ? 1 : 0 },
        geometry: { type: 'Point' as const, coordinates: at(g.route, s) },
      }))
    })
    // все остановки (одна точка на название) — для режима «Схема»
    const seen = new Set<string>()
    const allstops = sch && selected == null ? geo.flatMap((g) => g.stops.filter((s) => !seen.has(s.name) && (seen.add(s.name), true)).map((s) => ({
      type: 'Feature' as const, properties: { name: s.name }, geometry: { type: 'Point' as const, coordinates: at(g.route, s) },
    }))) : []
    // бейджи «№ · +N%» над проблемными ветками (в середине самой длинной линии маршрута)
    const badges = geo.filter((g) => alerts[g.route] > 0 && (selected == null || selected === g.route) && g.lines.length).map((g) => {
      const longest = g.lines.reduce((a, c) => (c.length > a.length ? c : a), g.lines[0])
      let mid = longest[Math.floor(longest.length / 2)]
      if (sch) { // на схеме — ближайшая к середине точка выпрямленной линии маршрута
        const pts = sch.segments.filter((s) => s.routes.includes(g.route)).flatMap((s) => s.coords)
        mid = pts.reduce((a, p) => (Math.hypot(p[0] - mid[0], p[1] - mid[1]) < Math.hypot(a[0] - mid[0], a[1] - mid[1]) ? p : a), pts[0] ?? mid)
      }
      const r = byRoute[g.route]
      return { type: 'Feature' as const, properties: { route: g.route, rank: -r.ratio[hour], color: alerts[g.route] === 2 ? '#dc2626' : '#ea580c',
        text: `№${g.route} · ${overLabel(r.ratio[hour])}` }, geometry: { type: 'Point' as const, coordinates: mid } }
    })
    const termini = geo.filter((g) => g.stops.length).flatMap((g) => {
      const dim = selected != null && selected !== g.route
      return [g.stops[0], g.stops[g.stops.length - 1]].map((s) => ({
        type: 'Feature' as const,
        properties: { num: String(g.route), color: g.color, op: dim ? 0.25 : g.route === 5 ? 0.6 : 1, rank: dim ? 100 + g.route : g.route },
        geometry: { type: 'Point' as const, coordinates: at(g.route, s) },
      }))
    })
    ;(m.getSource('termini') as GeoJSONSource).setData({ type: 'FeatureCollection', features: termini })
    ;(m.getSource('lines') as GeoJSONSource).setData({ type: 'FeatureCollection', features: lines })
    ;(m.getSource('stops') as GeoJSONSource).setData({ type: 'FeatureCollection', features: stops })
    ;(m.getSource('allstops') as GeoJSONSource).setData({ type: 'FeatureCollection', features: allstops })
    ;(m.getSource('badges') as GeoJSONSource).setData({ type: 'FeatureCollection', features: badges })
  }, [geo, segments, sch, day, hour, ready, selected, selectedStop])

  // плавный перелёт камеры: выбранная ветка — в центре видимой области (справа от боковой панели)
  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    const g = geo.find((x) => x.route === selected)
    const st = g?.stops.find((x) => x.stop_id === selectedStop)
    if (g && st) {
      // выбрана остановка — приближаемся к ней, оставляя её в центре видимой области
      const c = (sch?.stops[g.route]?.[st.stop_id] ?? [st.lon, st.lat]) as [number, number]
      m.flyTo({ center: c, zoom: Math.max(m.getZoom(), 14.6), padding: isPhone() ? { top: 190, bottom: Math.round(window.innerHeight * 0.56), left: 0, right: 0 } : { left: sideW(), right: 0, top: 100, bottom: 0 },
        duration: 1300, easing: ease, essential: true })
      return
    }
    if (selected == null || !g) {
      m.fitBounds(NETWORK, { padding: homePad(), duration: 1400, easing: ease, essential: true })
      return
    }
    const pts = (sch ? sch.segments.filter((s) => s.routes.includes(g.route)).flatMap((s) => s.coords) : g.lines.flat()) as [number, number][]
    if (!pts.length) return
    const b = pts.reduce((bb, p) => bb.extend(p), new mlRef.current!.LngLatBounds(pts[0], pts[0]))
    m.fitBounds(b, { padding: sidePad(), duration: 1600, easing: ease, maxZoom: 13.8, essential: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedStop, geo, ready])

  const scheme = useRef<SchemeApi>(null)
  const zoom = (d: number) => (mode === 'metro' ? scheme.current?.zoom(d) : map.current?.easeTo({ zoom: map.current.getZoom() + d, duration: 300 }))
  // схема маршрутов: загрузка и перегрузка по данным выбранного часа
  const schemeAlerts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of day?.routes ?? []) {
      if (r.vehicles[hour] === 0) continue
      const l = levelOf(r.ratio[hour])
      if (l === 'crit' || l === 'high') out[String(r.route)] = l === 'crit' ? 2 : 1
    }
    return out
  }, [day, hour])
  const dataRoutes = useMemo(() => new Set(geo.map((g) => String(g.route))), [geo])
  useEffect(() => { if (mode === 'metro') scheme.current?.focus(selected != null ? String(selected) : null, selectedStop) }, [selected, selectedStop, mode])
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 1600); return () => clearTimeout(t) }, [toast])
  const pickScheme = (r: string | null, stopId?: string | null) => {
    if (r == null) return onSelect(null)
    if (dataRoutes.has(r)) onSelect(Number(r), stopId ?? null)
    else setToast(`Трамвай №${r} — нет данных в датасете`)
  }

  return (
    <>
      <div ref={el} className="map" style={{ visibility: mode === 'metro' ? 'hidden' : 'visible' }} />
      {mode === 'metro' && (
        <SchemeView ref={scheme} selected={selected != null ? String(selected) : null} selectedStop={selectedStop} onSelect={pickScheme} alerts={schemeAlerts} dataRoutes={dataRoutes}
          geo={geo} day={day} hour={hour} timeRef={timeRef} paused={paused}
          pad={isPhone() ? (selected != null ? { top: 170, bottom: Math.round(window.innerHeight * 0.56) + 10, left: 12, right: 12 } : { top: 220, bottom: 70, left: 8, right: 60 }) : { top: 170, bottom: 76, left: selected != null ? sideW() + 10 : 30, right: 80 }} />
      )}
      {toast && <div className="float glass sch-toast">{toast}</div>}
      <div className="float mapctl">
        {wxBtn}
        {/* переключатель «карта»: одна иконка; нажат (подсвечен) — подложка-карта, отжат — схема */}
        <button className={`mapbtn glass ${mode === 'map' ? 'on' : ''}`} onClick={() => { const nx = MODE_NEXT[mode]; onMode(nx); setToast(MODE_TITLE[nx]) }}
          title={mode === 'map' ? 'Карта включена — выключить (схема)' : 'Включить карту'} aria-label="Карта" aria-pressed={mode === 'map'}>
          <MapIcon size={20} strokeWidth={1.75} />
        </button>
        <div className="zoomctl glass">
          <button onClick={() => zoom(1)} title="Приблизить"><Plus size={20} strokeWidth={1.75} /></button>
          <button onClick={() => zoom(-1)} title="Отдалить"><Minus size={20} strokeWidth={1.75} /></button>
        </div>
      </div>
    </>
  )
}
