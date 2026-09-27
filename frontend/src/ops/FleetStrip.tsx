import { useId } from 'react'
import { fillRGB } from './scheme/SchemeView'

const vag = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'вагон' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'вагона' : 'вагонов')

/** Мини-вагон сбоку; заливка снизу вверх — заполненность, пунктир — вагон, которого не хватает. */
function Car({ fill, color, ghost, over, spare }: { fill: number; color: string; ghost?: boolean; over?: boolean; spare?: boolean }) {
  const clip = useId()
  const h = 11 * Math.min(1, Math.max(0, fill))
  return (
    <svg className={`fcar ${ghost ? 'ghost' : ''} ${over ? 'over' : ''} ${spare ? 'spare' : ''}`} viewBox="0 0 30 22" aria-hidden="true">
      <clipPath id={clip}><rect x="2" y="6" width="26" height="11" rx="3.5" /></clipPath>
      <path className="pan" d="M12 6 15 2l3 4" />
      {!ghost && <rect clipPath={`url(#${clip})`} x="2" y={17 - h} width="26" height={h} fill={color} />}
      <rect className="shell" x="2" y="6" width="26" height="11" rx="3.5" />
      <circle className="wheel" cx="8.5" cy="19" r="1.6" />
      <circle className="wheel" cx="21.5" cy="19" r="1.6" />
    </svg>
  )
}

/** Вагоны ветки на линии в выбранный час: по одному значку на вагон, заливка — средняя заполненность,
 *  пунктирные — сколько вагонов нужно добавить до норматива, приглушённые с зелёной рамкой — сколько можно снять. */
export default function FleetStrip({ vehicles, ratio, extra, spare = 0 }: { vehicles: number; ratio: number; extra: number; spare?: number }) {
  const n = Math.floor(vehicles)
  if (n <= 0) return <div className="fstrip empty" title="В этот час вагонов на линии нет"><b className="fcount">×0</b><Car fill={0} color="" ghost /></div>
  const [r, g, b] = fillRGB(Math.min(1, ratio))
  const color = `rgb(${r},${g},${b})`
  const tip = `${n} ${vag(n)} на линии, каждый заполнен в среднем на ${Math.round(ratio * 100)}% норматива`
    + (extra > 0 ? `; чтобы уложиться в норматив, нужно ещё +${extra} ${vag(extra)} (пунктир)` : '')
    + (spare > 0 ? `; можно снять ${spare} ${vag(spare)} (приглушены)` : '')
  return (
    <div className="fstrip" title={tip} role="img" aria-label={tip}>
      <b className="fcount">×{n}</b>
      {Array.from({ length: n }, (_, i) => <Car key={i} fill={ratio} color={color} over={ratio > 1} spare={i >= n - spare} />)}
      {Array.from({ length: extra }, (_, i) => <Car key={`g${i}`} fill={0} color="" ghost />)}
    </div>
  )
}
